import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { download } from '@xmcl/file-transfer'
import { readFabricMod, readForgeMod, readQuiltMod } from '@xmcl/mod-parser'
import type { LocalResourceKind } from '@shared/ipc'
import type {
  InstalledResourceMeta,
  InstanceConfig,
  LocalResource,
  ResourceInstallResult,
  ResourceKind,
  ResourceSearchQuery,
  ResourceSearchResult,
  ResourceSource,
  ResourceVersion,
} from '@shared/types'
import { SmclError } from '../util/errors'
import { exists, hashFile, readJson, safeJoin, writeJson } from '../util/fs'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'
import type { InstanceService } from './InstanceService'
import { CurseforgeProvider, ModrinthProvider, type ResourceProvider, type VersionFilter } from './resourceProviders'
import type { TaskHandle, TaskService } from './TaskService'

export const RESOURCE_DIRS: Record<LocalResourceKind, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
}

const RESOURCE_EXTENSIONS: Record<LocalResourceKind, RegExp> = {
  mod: /\.(jar|zip)$/i,
  resourcepack: /\.zip$/i,
  shader: /\.zip$/i,
}

const DISABLED_SUFFIX = '.disabled'

export interface InstallPlan {
  install: ResourceVersion[]
  skipped: Array<{ projectId: string; reason: string }>
}

/**
 * Breadth-first walk of required dependencies. Projects already installed or already planned are skipped;
 * a pinned dependency version is honoured, otherwise the newest compatible version is used.
 */
export async function planInstall(
  root: ResourceVersion,
  installedProjects: Set<string>,
  resolve: {
    pinned(projectId: string, versionId: string): Promise<ResourceVersion>
    best(projectId: string): Promise<ResourceVersion | undefined>
  },
): Promise<InstallPlan> {
  const plan: InstallPlan = { install: [], skipped: [] }
  const planned = new Set<string>([root.projectId])
  const queue: ResourceVersion[] = [root]
  while (queue.length) {
    const current = queue.shift()!
    plan.install.push(current)
    for (const dep of current.dependencies) {
      if (dep.type !== 'required') continue
      if (planned.has(dep.projectId) || installedProjects.has(dep.projectId)) continue
      planned.add(dep.projectId)
      const version = dep.versionId ? await resolve.pinned(dep.projectId, dep.versionId) : await resolve.best(dep.projectId)
      if (version) queue.push(version)
      else plan.skipped.push({ projectId: dep.projectId, reason: 'No compatible version' })
    }
  }
  return plan
}

export function metaKey(kind: LocalResourceKind, fileName: string) {
  return `${kind}/${fileName.replace(/\.disabled$/, '')}`
}

export class ResourceService {
  private providerCache?: { key: string; curseforge?: CurseforgeProvider }
  readonly modrinth: ModrinthProvider

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
    private readonly tasks: TaskService,
    userAgent: string,
  ) {
    this.modrinth = new ModrinthProvider(userAgent)
  }

  provider(source: ResourceSource): ResourceProvider {
    if (source === 'modrinth') return this.modrinth
    return this.curseforge()
  }

  curseforge(): CurseforgeProvider {
    const key = this.config.curseforgeApiKey
    if (this.providerCache?.key !== key) this.providerCache = { key, curseforge: key ? new CurseforgeProvider(key) : undefined }
    if (!this.providerCache.curseforge) {
      throw new SmclError('CurseforgeNotConfigured', 'Set a CurseForge API key in Settings to use CurseForge')
    }
    return this.providerCache.curseforge
  }

  search(query: ResourceSearchQuery): Promise<ResourceSearchResult> {
    return this.provider(query.source).search(query)
  }

  versions(source: ResourceSource, projectId: string, filter: VersionFilter, kind: ResourceKind = 'mod') {
    return this.provider(source).versions(projectId, kind, filter)
  }

  async install(
    instanceId: string,
    kind: LocalResourceKind,
    source: ResourceSource,
    projectId: string,
    versionId?: string,
    parent?: TaskHandle,
  ): Promise<ResourceInstallResult> {
    const instance = this.instances.get(instanceId)
    const run = async (task: TaskHandle): Promise<ResourceInstallResult> => {
      const provider = this.provider(source)
      const filter = this.filterFor(instance)
      const pickBest = async (id: string) => (await provider.versions(id, kind, filter, task.signal))[0]
      const root = versionId ? await provider.version(projectId, versionId, task.signal) : await pickBest(projectId)
      if (!root) throw new SmclError('NoCompatibleVersion', `No version for ${instance.minecraft} ${instance.loader}`)
      const meta = await this.readMeta(instanceId)
      const installedProjects = new Set(
        Object.entries(meta)
          .filter(([key, m]) => key.startsWith(`${kind}/`) && m.source === source)
          .map(([, m]) => m.projectId),
      )
      installedProjects.delete(projectId)
      const plan =
        kind === 'mod'
          ? await planInstall(root, installedProjects, {
              pinned: (id, vid) => provider.version(id, vid, task.signal),
              best: (id) => pickBest(id),
            })
          : { install: [root], skipped: [] }
      const titles = await provider.titles(plan.install.map((v) => v.projectId), task.signal).catch(() => ({}) as Record<string, { title: string }>)
      const result: ResourceInstallResult = { installed: [], skipped: [...plan.skipped] }
      let done = 0
      for (const version of plan.install) {
        task.throwIfCancelled()
        task.update(done, plan.install.length, 'items')
        const file = version.files.find((f) => f.primary) ?? version.files[0]
        if (!file?.url) {
          result.skipped.push({ projectId: version.projectId, reason: 'Author does not allow third-party downloads' })
          continue
        }
        task.setDetail(titles[version.projectId]?.title ?? file.filename)
        const fileName = await this.downloadInto(instanceId, kind, file, task)
        await this.removeOldVersions(instanceId, kind, meta, source, version.projectId, fileName)
        meta[metaKey(kind, fileName)] = {
          source,
          projectId: version.projectId,
          versionId: version.versionId,
          title: titles[version.projectId]?.title,
        }
        result.installed.push({ projectId: version.projectId, fileName })
        done++
      }
      await this.writeMeta(instanceId, meta)
      return result
    }
    return parent ? run(parent) : this.tasks.run(`${instance.name}`, run)
  }

  async listLocal(instanceId: string, kind: LocalResourceKind): Promise<LocalResource[]> {
    const dir = this.dir(instanceId, kind)
    await mkdir(dir, { recursive: true })
    const meta = await this.readMeta(instanceId)
    const result: LocalResource[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const enabled = !entry.name.endsWith(DISABLED_SUFFIX)
      const baseName = enabled ? entry.name : entry.name.slice(0, -DISABLED_SUFFIX.length)
      if (!RESOURCE_EXTENSIONS[kind].test(baseName)) continue
      const full = join(dir, entry.name)
      const info = await stat(full)
      const resource: LocalResource = {
        kind,
        fileName: entry.name,
        enabled,
        size: info.size,
        origin: meta[metaKey(kind, entry.name)],
      }
      if (kind === 'mod') Object.assign(resource, await readModInfo(full))
      resource.name ??= resource.origin?.title ?? baseName.replace(/\.(jar|zip)$/i, '')
      result.push(resource)
    }
    return result.sort((a, b) => (a.name ?? a.fileName).localeCompare(b.name ?? b.fileName))
  }

  async toggle(instanceId: string, kind: LocalResourceKind, fileName: string, enabled: boolean) {
    const dir = this.dir(instanceId, kind)
    const current = safeJoin(dir, fileName)
    const isEnabled = !fileName.endsWith(DISABLED_SUFFIX)
    if (isEnabled !== enabled) {
      const target = enabled ? current.slice(0, -DISABLED_SUFFIX.length) : `${current}${DISABLED_SUFFIX}`
      await rename(current, target)
    }
    return this.listLocal(instanceId, kind)
  }

  async remove(instanceId: string, kind: LocalResourceKind, fileName: string) {
    await unlink(safeJoin(this.dir(instanceId, kind), fileName))
    const meta = await this.readMeta(instanceId)
    delete meta[metaKey(kind, fileName)]
    await this.writeMeta(instanceId, meta)
    return this.listLocal(instanceId, kind)
  }

  dir(instanceId: string, kind: LocalResourceKind) {
    return join(this.instances.dir(instanceId), RESOURCE_DIRS[kind])
  }

  async readMeta(instanceId: string): Promise<Record<string, InstalledResourceMeta>> {
    return readJson(join(this.paths.instanceMeta(instanceId), 'resources.json'), {})
  }

  async writeMeta(instanceId: string, meta: Record<string, InstalledResourceMeta>) {
    await writeJson(join(this.paths.instanceMeta(instanceId), 'resources.json'), meta)
  }

  /** Download a file with sha1 verification into the instance folder; returns the stored file name. */
  async downloadInto(instanceId: string, kind: LocalResourceKind, file: ResourceVersion['files'][number], task: TaskHandle) {
    if (!file.url) throw new SmclError('NoDownloadUrl', `${file.filename} cannot be downloaded`)
    const dir = this.dir(instanceId, kind)
    await mkdir(dir, { recursive: true })
    const target = safeJoin(dir, file.filename)
    const temp = `${target}.part`
    await download({ url: file.url, destination: temp, signal: task.signal, expectedTotal: file.size || undefined })
    if (file.sha1) {
      const actual = await hashFile(temp, 'sha1')
      if (actual !== file.sha1) {
        await unlink(temp).catch(() => undefined)
        throw new SmclError('ChecksumMismatch', `${file.filename}: sha1 mismatch`)
      }
    }
    await rename(temp, target)
    if (await exists(`${target}${DISABLED_SUFFIX}`)) await unlink(`${target}${DISABLED_SUFFIX}`)
    return file.filename
  }

  private async removeOldVersions(
    instanceId: string,
    kind: LocalResourceKind,
    meta: Record<string, InstalledResourceMeta>,
    source: ResourceSource,
    projectId: string,
    keepFile: string,
  ) {
    for (const [key, m] of Object.entries(meta)) {
      if (!key.startsWith(`${kind}/`) || m.source !== source || m.projectId !== projectId) continue
      const fileName = key.slice(kind.length + 1)
      if (fileName === keepFile) continue
      const dir = this.dir(instanceId, kind)
      for (const candidate of [fileName, `${fileName}${DISABLED_SUFFIX}`]) {
        await unlink(safeJoin(dir, candidate)).catch(() => undefined)
      }
      delete meta[key]
    }
  }

  private filterFor(instance: InstanceConfig): VersionFilter {
    return { gameVersion: instance.minecraft, loader: instance.loader === 'vanilla' ? undefined : instance.loader }
  }
}

async function readModInfo(file: string): Promise<Partial<LocalResource>> {
  try {
    const fabric = await readFabricMod(file)
    return { modId: fabric.id, name: fabric.name, version: fabric.version, description: fabric.description, loaders: ['fabric'] }
  } catch {
    /* not a fabric mod */
  }
  try {
    const quilt = await readQuiltMod(file)
    const q = quilt.quilt_loader
    return { modId: q.id, name: q.metadata?.name, version: q.version, description: q.metadata?.description, loaders: ['quilt'] }
  } catch {
    /* not a quilt mod */
  }
  try {
    const forge = await readForgeMod(file)
    const toml = forge.modsToml?.[0]
    const info = forge.mcmodInfo?.[0]
    if (toml) return { modId: toml.modid, name: toml.displayName, version: toml.version, loaders: ['forge'] }
    if (info) return { modId: info.modid, name: info.name, version: info.version, description: info.description, loaders: ['forge'] }
  } catch {
    /* unknown format */
  }
  return {}
}
