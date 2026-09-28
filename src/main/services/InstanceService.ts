import { mkdir, readdir } from 'node:fs/promises'
import { LOADER_TYPES, type CreateInstanceInput, type InstanceConfig } from '@shared/types'
import { SmclError } from '../util/errors'
import type { EventBus } from '../util/events'
import { exists, readJson, removeIfExists, sanitizeFileName, writeJson } from '../util/fs'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'

/** Every instance owns an isolated game directory (mods, saves, config...) under instances/<id>. */
export const INSTANCE_SUBDIRS = ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'config']

const IMMUTABLE_KEYS: Array<keyof InstanceConfig> = ['id', 'createdAt']
const VERSION_KEYS: Array<keyof InstanceConfig> = ['minecraft', 'loader', 'loaderVersion']

export class InstanceService {
  private instances = new Map<string, InstanceConfig>()

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly bus: EventBus,
  ) {}

  async load() {
    await mkdir(this.paths.instances, { recursive: true })
    const entries = await readdir(this.paths.instances, { withFileTypes: true })
    const loaded = new Map<string, InstanceConfig>()
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const cfg = await readJson<InstanceConfig | null>(this.paths.instanceConfig(entry.name), null)
      if (cfg && cfg.minecraft) loaded.set(entry.name, { ...cfg, id: entry.name })
    }
    this.instances = loaded
  }

  list(): InstanceConfig[] {
    return [...this.instances.values()]
      .map((i) => ({ ...i }))
      .sort((a, b) => (b.lastPlayed ?? b.createdAt) - (a.lastPlayed ?? a.createdAt))
  }

  get(id: string): InstanceConfig {
    const instance = this.instances.get(id)
    if (!instance) throw new SmclError('InstanceNotFound', `Instance ${id} not found`)
    return { ...instance }
  }

  dir(id: string): string {
    this.get(id)
    return this.paths.instance(id)
  }

  async create(input: CreateInstanceInput, extra: Partial<InstanceConfig> = {}): Promise<InstanceConfig> {
    const name = input.name.trim()
    if (!name) throw new SmclError('InvalidInstance', 'Instance name is required')
    if (!input.minecraft) throw new SmclError('InvalidInstance', 'Minecraft version is required')
    if (!LOADER_TYPES.includes(input.loader)) throw new SmclError('InvalidInstance', `Unknown loader ${input.loader}`)
    if (input.loader !== 'vanilla' && !input.loaderVersion) {
      throw new SmclError('InvalidInstance', 'Loader version is required')
    }
    const id = await this.allocateId(name)
    const instance: InstanceConfig = {
      ...extra,
      id,
      name,
      minecraft: input.minecraft,
      loader: input.loader,
      loaderVersion: input.loader === 'vanilla' ? undefined : input.loaderVersion,
      createdAt: Date.now(),
    }
    const dir = this.paths.instance(id)
    await mkdir(dir, { recursive: true })
    await Promise.all(INSTANCE_SUBDIRS.map((sub) => mkdir(`${dir}/${sub}`, { recursive: true })))
    await this.save(instance)
    if (!this.config.get().selectedInstanceId) await this.select(id)
    return { ...instance }
  }

  async update(id: string, patch: Partial<InstanceConfig>): Promise<InstanceConfig> {
    const current = this.get(id)
    const clean = { ...patch }
    for (const key of IMMUTABLE_KEYS) delete clean[key]
    const next: InstanceConfig = { ...current, ...clean }
    if (!LOADER_TYPES.includes(next.loader)) throw new SmclError('InvalidInstance', `Unknown loader ${next.loader}`)
    if (next.loader === 'vanilla') next.loaderVersion = undefined
    if (next.loader !== 'vanilla' && !next.loaderVersion) throw new SmclError('InvalidInstance', 'Loader version is required')
    if (!next.name.trim()) throw new SmclError('InvalidInstance', 'Instance name is required')
    if (VERSION_KEYS.some((k) => k in clean && clean[k] !== current[k]) && !('versionId' in clean)) {
      next.versionId = undefined
    }
    await this.save(next)
    return { ...next }
  }

  async remove(id: string) {
    this.get(id)
    await removeIfExists(this.paths.instance(id))
    this.instances.delete(id)
    if (this.config.get().selectedInstanceId === id) {
      await this.config.set({ selectedInstanceId: this.list()[0]?.id })
    }
    this.emit()
  }

  async select(id: string) {
    this.get(id)
    await this.config.set({ selectedInstanceId: id })
  }

  async markPlayed(id: string) {
    await this.update(id, { lastPlayed: Date.now() })
  }

  private async save(instance: InstanceConfig) {
    await writeJson(this.paths.instanceConfig(instance.id), instance)
    this.instances.set(instance.id, { ...instance })
    this.emit()
  }

  private async allocateId(name: string): Promise<string> {
    const base = sanitizeFileName(name).replace(/\s/g, '-')
    let id = base
    for (let n = 2; this.instances.has(id) || (await exists(this.paths.instance(id))); n++) {
      id = `${base}-${n}`
    }
    return id
  }

  private emit() {
    this.bus.emit('instances:changed', this.list())
  }
}
