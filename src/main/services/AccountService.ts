import { randomUUID } from 'node:crypto'
import { getOfflineUUID, MicrosoftAuthenticator, MojangClient, newToken, ProfileNotFoundError } from '@xmcl/user'
import type { Account, DeviceCodeInfo } from '@shared/types'
import { SmclError } from '../util/errors'
import type { EventBus } from '../util/events'
import { readJson, writeJson } from '../util/fs'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'

export interface SecretStore {
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

/** Fallback for tests/headless environments without an OS keyring. Not secret, only encoded. */
export const plainSecretStore: SecretStore = {
  encrypt: (plain) => `plain:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decrypt: (cipher) => Buffer.from(cipher.replace(/^plain:/, ''), 'base64').toString('utf8'),
}

interface AccountSecret {
  refreshToken?: string
  accessToken: string
}

interface StoredAccount extends Account {
  secret?: string
}

interface AccountFile {
  accounts: StoredAccount[]
}

interface DeviceSession {
  deviceCode: string
  interval: number
  expiresAt: number
  cancelled: boolean
}

export interface LaunchCredentials {
  name: string
  uuid: string
  accessToken: string
  userType: 'mojang'
}

const MS_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const MS_SCOPE = 'XboxLive.signin offline_access'
const OFFLINE_NAME = /^[A-Za-z0-9_]{3,16}$/
const REFRESH_MARGIN_MS = 5 * 60 * 1000

type FetchFn = typeof fetch

export class AccountService {
  private accounts: StoredAccount[] = []
  private readonly sessions = new Map<string, DeviceSession>()

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly bus: EventBus,
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async load() {
    const file = await readJson<AccountFile>(this.paths.accounts, { accounts: [] })
    this.accounts = Array.isArray(file.accounts) ? file.accounts : []
  }

  list(): { accounts: Account[]; selectedId?: string } {
    const selected = this.config.get().selectedAccountId
    const selectedId = this.accounts.some((a) => a.id === selected) ? selected : this.accounts[0]?.id
    return { accounts: this.accounts.map(toPublic), selectedId }
  }

  async addOffline(rawName: string): Promise<Account> {
    const name = rawName.trim()
    if (!OFFLINE_NAME.test(name)) {
      throw new SmclError('InvalidName', 'Offline name must be 3-16 characters: letters, digits or _')
    }
    const uuid = getOfflineUUID(name)
    const existing = this.accounts.find((a) => a.type === 'offline' && a.uuid === uuid)
    if (existing) {
      await this.select(existing.id)
      return toPublic(existing)
    }
    const account: StoredAccount = { id: randomUUID(), type: 'offline', name, uuid }
    this.accounts.push(account)
    await this.persist()
    await this.select(account.id)
    return toPublic(account)
  }

  async microsoftBegin(): Promise<DeviceCodeInfo> {
    const clientId = this.requireClientId()
    const res = await this.fetchFn(`${MS_AUTHORITY}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: MS_SCOPE }),
    })
    const body = (await res.json()) as Record<string, unknown>
    if (!res.ok) throw new SmclError('MicrosoftDeviceCode', String(body.error_description ?? body.error ?? res.status))
    const sessionId = randomUUID()
    const expiresIn = Number(body.expires_in ?? 900)
    this.sessions.set(sessionId, {
      deviceCode: String(body.device_code),
      interval: Math.max(1, Number(body.interval ?? 5)),
      expiresAt: Date.now() + expiresIn * 1000,
      cancelled: false,
    })
    return {
      sessionId,
      userCode: String(body.user_code),
      verificationUri: String(body.verification_uri),
      expiresIn,
      message: String(body.message ?? ''),
    }
  }

  cancelMicrosoft(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (session) session.cancelled = true
  }

  /** Poll the token endpoint until the user finishes the device-code login, then add the account. */
  async microsoftComplete(sessionId: string): Promise<Account> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new SmclError('MicrosoftSession', 'Login session not found')
    const clientId = this.requireClientId()
    try {
      let interval = session.interval
      while (true) {
        if (session.cancelled) throw new SmclError('Cancelled', 'Login cancelled')
        if (Date.now() > session.expiresAt) throw new SmclError('MicrosoftExpired', 'Device code expired')
        await this.sleep(interval * 1000)
        if (session.cancelled) throw new SmclError('Cancelled', 'Login cancelled')
        const res = await this.fetchFn(`${MS_AUTHORITY}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: clientId,
            device_code: session.deviceCode,
          }),
        })
        const body = (await res.json()) as Record<string, unknown>
        if (res.ok) {
          return await this.finishMicrosoft(String(body.access_token), String(body.refresh_token ?? ''))
        }
        const error = String(body.error ?? '')
        if (error === 'authorization_pending') continue
        if (error === 'slow_down') {
          interval += 5
          continue
        }
        throw new SmclError('MicrosoftLogin', String(body.error_description ?? error ?? res.status))
      }
    } finally {
      this.sessions.delete(sessionId)
    }
  }

  async refresh(id: string): Promise<Account> {
    const account = this.find(id)
    if (account.type !== 'microsoft') return toPublic(account)
    const secret = this.readSecret(account)
    if (!secret?.refreshToken) throw new SmclError('MicrosoftRelogin', 'Please sign in again')
    const res = await this.fetchFn(`${MS_AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.requireClientId(),
        refresh_token: secret.refreshToken,
        scope: MS_SCOPE,
      }),
    })
    const body = (await res.json()) as Record<string, unknown>
    if (!res.ok) throw new SmclError('MicrosoftRelogin', String(body.error_description ?? body.error ?? res.status))
    return this.finishMicrosoft(String(body.access_token), String(body.refresh_token ?? secret.refreshToken))
  }

  async remove(id: string) {
    this.accounts = this.accounts.filter((a) => a.id !== id)
    await this.persist()
    if (this.config.get().selectedAccountId === id) {
      await this.config.set({ selectedAccountId: this.accounts[0]?.id })
    }
    this.emitChanged()
  }

  async select(id: string) {
    this.find(id)
    await this.config.set({ selectedAccountId: id })
    this.emitChanged()
  }

  /** Credentials for launching; refreshes Microsoft tokens that are about to expire. */
  async getLaunchCredentials(id?: string): Promise<LaunchCredentials> {
    const targetId = id ?? this.list().selectedId
    if (!targetId) throw new SmclError('NoAccount', 'Add an account before launching')
    let account = this.find(targetId)
    if (account.type === 'offline') {
      return { name: account.name, uuid: account.uuid, accessToken: newToken(), userType: 'mojang' }
    }
    if (!account.expiresAt || account.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      await this.refresh(account.id)
      account = this.find(targetId)
    }
    const secret = this.readSecret(account)
    if (!secret?.accessToken) throw new SmclError('MicrosoftRelogin', 'Please sign in again')
    return { name: account.name, uuid: account.uuid, accessToken: secret.accessToken, userType: 'mojang' }
  }

  private async finishMicrosoft(oauthToken: string, refreshToken: string): Promise<Account> {
    const auth = new MicrosoftAuthenticator({ fetch: this.fetchFn })
    const { minecraftXstsResponse } = await auth.acquireXBoxToken(oauthToken)
    const uhs = minecraftXstsResponse.DisplayClaims.xui[0].uhs
    const mc = await auth.loginMinecraftWithXBox(uhs, minecraftXstsResponse.Token)
    let profile
    try {
      profile = await new MojangClient({ fetch: this.fetchFn as never }).getProfile(mc.access_token)
    } catch (e) {
      if (e instanceof ProfileNotFoundError) {
        throw new SmclError('NoMinecraftProfile', 'This Microsoft account does not own Minecraft Java Edition', { cause: e })
      }
      throw e
    }
    const skin = profile.skins?.find((s) => s.state === 'ACTIVE')?.url
    const secret = this.secrets.encrypt(JSON.stringify({ accessToken: mc.access_token, refreshToken } satisfies AccountSecret))
    const expiresAt = Date.now() + mc.expires_in * 1000
    let account = this.accounts.find((a) => a.type === 'microsoft' && a.uuid === profile.id)
    if (account) {
      Object.assign(account, { name: profile.name, skinUrl: skin, expiresAt, secret })
    } else {
      account = { id: randomUUID(), type: 'microsoft', name: profile.name, uuid: profile.id, skinUrl: skin, expiresAt, secret }
      this.accounts.push(account)
    }
    await this.persist()
    await this.select(account.id)
    return toPublic(account)
  }

  private readSecret(account: StoredAccount): AccountSecret | undefined {
    if (!account.secret) return undefined
    try {
      return JSON.parse(this.secrets.decrypt(account.secret)) as AccountSecret
    } catch {
      return undefined
    }
  }

  private requireClientId(): string {
    const id = this.config.msClientId
    if (!id) throw new SmclError('MicrosoftNotConfigured', 'Set an Azure client ID in Settings to use Microsoft login')
    return id
  }

  private find(id: string): StoredAccount {
    const account = this.accounts.find((a) => a.id === id)
    if (!account) throw new SmclError('AccountNotFound', `Account ${id} not found`)
    return account
  }

  private async persist() {
    await writeJson(this.paths.accounts, { accounts: this.accounts } satisfies AccountFile)
    this.emitChanged()
  }

  private emitChanged() {
    this.bus.emit('accounts:changed', this.list())
  }
}

function toPublic(account: StoredAccount): Account {
  const { secret: _secret, ...rest } = account
  return rest
}
