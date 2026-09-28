import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { ConfigService, DEFAULT_CONFIG, normalizeConfig } from '../../src/main/services/ConfigService'
import { EventBus } from '../../src/main/util/events'
import { SmclPaths } from '../../src/main/util/paths'
import { tempDir } from './helpers'

describe('ConfigService', () => {
  it('starts from defaults: zh-TW, dark theme, official mirror', async () => {
    const service = new ConfigService(new SmclPaths(await tempDir()), new EventBus(), {})
    const cfg = await service.load()
    expect(cfg).toEqual(DEFAULT_CONFIG)
    expect(cfg.locale).toBe('zh-TW')
    expect(cfg.theme).toBe('dark')
  })

  it('persists changes, emits config:changed and reloads them', async () => {
    const root = await tempDir()
    const bus = new EventBus()
    const events: unknown[] = []
    bus.on('config:changed', (c) => events.push(c))
    const service = new ConfigService(new SmclPaths(root), bus, {})
    await service.load()
    await service.set({ theme: 'light', mirror: 'bmclapi', downloadConcurrency: 8 })
    expect(events).toHaveLength(1)
    const reloaded = new ConfigService(new SmclPaths(root), new EventBus(), {})
    const cfg = await reloaded.load()
    expect(cfg.theme).toBe('light')
    expect(cfg.mirror).toBe('bmclapi')
    expect(cfg.downloadConcurrency).toBe(8)
    expect(JSON.parse(await readFile(new SmclPaths(root).config, 'utf8')).mirror).toBe('bmclapi')
  })

  it('falls back to environment variables for service keys, settings take priority', async () => {
    const service = new ConfigService(new SmclPaths(await tempDir()), new EventBus(), {
      SMCL_MS_CLIENT_ID: ' env-client ',
      SMCL_CURSEFORGE_KEY: 'env-key',
    })
    await service.load()
    expect(service.msClientId).toBe('env-client')
    expect(service.curseforgeApiKey).toBe('env-key')
    await service.set({ msClientId: 'settings-client' })
    expect(service.msClientId).toBe('settings-client')
  })

  it('reports keys as missing when neither settings nor env provide them', async () => {
    const service = new ConfigService(new SmclPaths(await tempDir()), new EventBus(), {})
    await service.load()
    expect(service.msClientId).toBe('')
    expect(service.curseforgeApiKey).toBe('')
  })

  it('normalizes invalid values', () => {
    const cfg = normalizeConfig({
      ...DEFAULT_CONFIG,
      locale: 'fr' as never,
      theme: 'neon' as never,
      accentColor: 'red',
      mirror: 'other' as never,
      downloadConcurrency: 999,
      defaultMaxMemory: 1,
      customJavaPaths: ['/a', '/a', '', 3 as never],
    })
    expect(cfg.locale).toBe('zh-TW')
    expect(cfg.theme).toBe('dark')
    expect(cfg.accentColor).toBe(DEFAULT_CONFIG.accentColor)
    expect(cfg.mirror).toBe('official')
    expect(cfg.downloadConcurrency).toBe(64)
    expect(cfg.defaultMaxMemory).toBe(512)
    expect(cfg.customJavaPaths).toEqual(['/a'])
  })
})
