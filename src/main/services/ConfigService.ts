import type { AppConfig } from '@shared/types'
import type { EventBus } from '../util/events'
import { readJson, writeJson } from '../util/fs'
import type { SmclPaths } from '../util/paths'

export const DEFAULT_CONFIG: AppConfig = {
  locale: 'zh-TW',
  theme: 'dark',
  accentColor: '#e0a526',
  mirror: 'official',
  downloadConcurrency: 16,
  defaultMaxMemory: 4096,
  closeOnLaunch: false,
  msClientId: '',
  curseforgeApiKey: '',
  customJavaPaths: [],
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export class ConfigService {
  private config: AppConfig = { ...DEFAULT_CONFIG }

  constructor(
    private readonly paths: SmclPaths,
    private readonly bus: EventBus,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async load(): Promise<AppConfig> {
    const stored = await readJson<Partial<AppConfig>>(this.paths.config, {})
    this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...stored })
    return this.get()
  }

  get(): AppConfig {
    return { ...this.config, customJavaPaths: [...this.config.customJavaPaths] }
  }

  async set(patch: Partial<AppConfig>): Promise<AppConfig> {
    this.config = normalizeConfig({ ...this.config, ...patch })
    await writeJson(this.paths.config, this.config)
    const snapshot = this.get()
    this.bus.emit('config:changed', snapshot)
    return snapshot
  }

  /** Azure client ID: settings value first, then SMCL_MS_CLIENT_ID. */
  get msClientId(): string {
    return this.config.msClientId.trim() || (this.env.SMCL_MS_CLIENT_ID ?? '').trim()
  }

  /** CurseForge key: settings value first, then SMCL_CURSEFORGE_KEY. */
  get curseforgeApiKey(): string {
    return this.config.curseforgeApiKey.trim() || (this.env.SMCL_CURSEFORGE_KEY ?? '').trim()
  }
}

export function normalizeConfig(input: AppConfig): AppConfig {
  const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Math.round(Number(value))
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }
  return {
    locale: input.locale === 'en' ? 'en' : 'zh-TW',
    theme: input.theme === 'light' ? 'light' : 'dark',
    accentColor: HEX_COLOR.test(input.accentColor) ? input.accentColor : DEFAULT_CONFIG.accentColor,
    mirror: input.mirror === 'bmclapi' ? 'bmclapi' : 'official',
    downloadConcurrency: clampInt(input.downloadConcurrency, 1, 64, DEFAULT_CONFIG.downloadConcurrency),
    defaultMaxMemory: clampInt(input.defaultMaxMemory, 512, 65536, DEFAULT_CONFIG.defaultMaxMemory),
    closeOnLaunch: Boolean(input.closeOnLaunch),
    msClientId: String(input.msClientId ?? '').trim(),
    curseforgeApiKey: String(input.curseforgeApiKey ?? '').trim(),
    selectedInstanceId: input.selectedInstanceId || undefined,
    selectedAccountId: input.selectedAccountId || undefined,
    customJavaPaths: Array.isArray(input.customJavaPaths)
      ? [...new Set(input.customJavaPaths.filter((p) => typeof p === 'string' && p.trim()))]
      : [],
  }
}
