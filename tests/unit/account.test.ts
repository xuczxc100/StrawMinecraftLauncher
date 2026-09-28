import { readFile } from 'node:fs/promises'
import { getOfflineUUID } from '@xmcl/user'
import { describe, expect, it } from 'vitest'
import { AccountService, type SecretStore } from '../../src/main/services/AccountService'
import { ConfigService } from '../../src/main/services/ConfigService'
import { EventBus } from '../../src/main/util/events'
import { SmclPaths } from '../../src/main/util/paths'
import { jsonResponse, tempDir } from './helpers'

const reversingStore: SecretStore = {
  encrypt: (plain) => `test:${[...plain].reverse().join('')}`,
  decrypt: (stored) => [...stored.slice(5)].reverse().join(''),
}

async function setup(fetchFn?: typeof fetch, env: NodeJS.ProcessEnv = {}) {
  const paths = new SmclPaths(await tempDir())
  const bus = new EventBus()
  const config = new ConfigService(paths, bus, env)
  await config.load()
  const service = new AccountService(paths, config, bus, reversingStore, fetchFn, async () => undefined)
  await service.load()
  return { paths, service, config }
}

describe('AccountService offline', () => {
  it('adds an offline account with the standard offline UUID and selects it', async () => {
    const { service } = await setup()
    const account = await service.addOffline('Straw_Player')
    expect(account.uuid).toBe(getOfflineUUID('Straw_Player'))
    expect(service.list().selectedId).toBe(account.id)
    const creds = await service.getLaunchCredentials()
    expect(creds).toMatchObject({ name: 'Straw_Player', uuid: account.uuid, userType: 'mojang' })
    expect(creds.accessToken).toMatch(/^[0-9a-f]{32}$/)
  })

  it('rejects invalid names and de-duplicates', async () => {
    const { service } = await setup()
    await expect(service.addOffline('ab')).rejects.toMatchObject({ code: 'InvalidName' })
    await expect(service.addOffline('名字')).rejects.toMatchObject({ code: 'InvalidName' })
    const a = await service.addOffline('Steve')
    const b = await service.addOffline('Steve')
    expect(b.id).toBe(a.id)
    expect(service.list().accounts).toHaveLength(1)
  })

  it('requires an account before launching', async () => {
    const { service } = await setup()
    await expect(service.getLaunchCredentials()).rejects.toMatchObject({ code: 'NoAccount' })
  })
})

describe('AccountService Microsoft device code', () => {
  it('is disabled without a client id', async () => {
    const { service } = await setup()
    await expect(service.microsoftBegin()).rejects.toMatchObject({ code: 'MicrosoftNotConfigured' })
  })

  it('completes device-code → Xbox → Minecraft login and stores tokens encrypted', async () => {
    const calls: string[] = []
    let tokenPolls = 0
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      if (url.endsWith('/devicecode')) {
        expect(String(init?.body)).toContain('client_id=test-client')
        return jsonResponse({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/link', expires_in: 900, interval: 1 })
      }
      if (url.endsWith('/token')) {
        tokenPolls++
        if (tokenPolls === 1) return jsonResponse({ error: 'authorization_pending' }, 400)
        if (tokenPolls === 2) return jsonResponse({ error: 'slow_down' }, 400)
        return jsonResponse({ access_token: 'ms-access', refresh_token: 'ms-refresh' })
      }
      if (url.includes('user.auth.xboxlive.com')) return jsonResponse({ Token: 'xbl', DisplayClaims: { xui: [{ uhs: 'uhs1' }] } })
      if (url.includes('device.auth.xboxlive.com')) return jsonResponse({ Token: 'device', NotAfter: new Date(Date.now() + 3600e3).toISOString() })
      if (url.includes('xsts.auth.xboxlive.com')) return jsonResponse({ Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'uhs1' }] } })
      if (url.endsWith('/authentication/login_with_xbox')) return jsonResponse({ access_token: 'mc-access', expires_in: 86400 })
      if (url.endsWith('/minecraft/profile')) {
        return jsonResponse({ id: '0123456789abcdef0123456789abcdef', name: 'StrawMS', skins: [{ state: 'ACTIVE', url: 'https://textures/skin' }] })
      }
      throw new Error(`unexpected ${url}`)
    }) as typeof fetch

    const { service, paths } = await setup(fetchFn, { SMCL_MS_CLIENT_ID: 'test-client' })
    const info = await service.microsoftBegin()
    expect(info.userCode).toBe('ABCD-EFGH')
    const account = await service.microsoftComplete(info.sessionId)
    expect(account).toMatchObject({ type: 'microsoft', name: 'StrawMS', skinUrl: 'https://textures/skin' })
    expect(tokenPolls).toBe(3)
    expect(service.list().selectedId).toBe(account.id)

    const stored = await readFile(paths.accounts, 'utf8')
    expect(stored).not.toContain('mc-access')
    expect(stored).not.toContain('ms-refresh')
    expect(await service.getLaunchCredentials(account.id)).toMatchObject({ accessToken: 'mc-access', name: 'StrawMS' })
    expect(calls.some((u) => u.includes('xsts.auth.xboxlive.com'))).toBe(true)
  })

  it('reports accounts without Minecraft', async () => {
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/devicecode')) return jsonResponse({ device_code: 'd', user_code: 'U', verification_uri: 'https://x', expires_in: 900, interval: 1 })
      if (url.endsWith('/token')) return jsonResponse({ access_token: 'a', refresh_token: 'r' })
      if (url.includes('xboxlive.com')) return jsonResponse({ Token: 't', NotAfter: new Date(Date.now() + 3600e3).toISOString(), DisplayClaims: { xui: [{ uhs: 'u' }] } })
      if (url.endsWith('/login_with_xbox')) return jsonResponse({ access_token: 'mc', expires_in: 100 })
      if (url.endsWith('/minecraft/profile')) return jsonResponse({ error: 'NOT_FOUND', errorMessage: 'not found' }, 404)
      throw new Error(url)
    }) as typeof fetch
    const { service } = await setup(fetchFn, { SMCL_MS_CLIENT_ID: 'c' })
    const info = await service.microsoftBegin()
    await expect(service.microsoftComplete(info.sessionId)).rejects.toMatchObject({ code: 'NoMinecraftProfile' })
  })

  it('stops polling when cancelled', async () => {
    const fetchFn = (async (input: string | URL | Request) => {
      if (String(input).endsWith('/devicecode')) return jsonResponse({ device_code: 'd', user_code: 'U', verification_uri: 'https://x', expires_in: 900, interval: 1 })
      return jsonResponse({ error: 'authorization_pending' }, 400)
    }) as typeof fetch
    const { service } = await setup(fetchFn, { SMCL_MS_CLIENT_ID: 'c' })
    const info = await service.microsoftBegin()
    const pending = service.microsoftComplete(info.sessionId)
    service.cancelMicrosoft(info.sessionId)
    await expect(pending).rejects.toMatchObject({ code: 'Cancelled' })
  })
})
