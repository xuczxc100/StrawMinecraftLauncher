import { createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { download } from '@xmcl/file-transfer'
import type { InstallFile } from '@xmcl/installer'
import { open, openEntryReadStream, readAllEntries, readEntry } from '@xmcl/unzip'
import type { Entry, ZipFile } from '@xmcl/yauzl'
import { ZipFile as YazlZip } from 'yazl'
import type {
  CreateInstanceInput,
  InstanceConfig,
  LoaderType,
  ModpackExportOptions,
  ModpackImportResult,
  ResourceSource,
} from '@shared/types'
import { errorMessage, SmclError } from '../util/errors'
import { exists, hashFile, safeJoin } from '../util/fs'
import { runManifest } from '../util/install'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'
import type { InstallService } from './InstallService'
import type { InstanceService } from './InstanceService'
import { curseforgeKind } from './resourceProviders'
import { RESOURCE_DIRS, type ResourceService } from './ResourceService'
import type { TaskHandle, TaskService } from './TaskService'

// ------------------------------------------------------------------ formats

export interface MrpackFile {
  path: string
  hashes: { sha1: string; sha512?: string }
  env?: { client?: 'required' | 'optional' | 'unsupported'; server?: string }
  downloads: string[]
  fileSize: number
}

export interface MrpackIndex {
  formatVersion: 1
  game: 'minecraft'
  versionId: string
  name: string
  summary?: string
  files: MrpackFile[]
  dependencies: Record<string, string>
}

export interface CurseforgeManifest {
  minecraft: { version: string; modLoaders: Array<{ id: string; primary?: boolean }> }
  manifestType?: string
  name: string
  version?: string
  author?: string
  files: Array<{ projectID: number; fileID: number; required?: boolean }>
  overrides?: string
}

const MRPACK_LOADER_KEYS: Record<string, LoaderType> = {
  'fabric-loader': 'fabric',
  'quilt-loader': 'quilt',
  forge: 'forge',
  neoforge: 'neoforge',
}

export function parseMrpackIndex(raw: unknown): MrpackIndex {
  const index = raw as MrpackIndex
  if (!index || index.formatVersion !== 1 || index.game !== 'minecraft') {
    throw new SmclError('InvalidModpack', 'Unsupported modrinth.index.json (formatVersion 1 / game minecraft expected)')
  }
  if (!index.dependencies?.minecraft) throw new SmclError('InvalidModpack', 'Modpack does not declare a Minecraft version')
  if (!Array.isArray(index.files)) throw new SmclError('InvalidModpack', 'Modpack file list is missing')
  return index
}

export function mrpackInstanceInput(index: MrpackIndex): CreateInstanceInput {
  const deps = index.dependencies
  for (const [key, loader] of Object.entries(MRPACK_LOADER_KEYS)) {
    if (deps[key]) return { name: index.name, minecraft: deps.minecraft, loader, loaderVersion: deps[key] }
  }
  return { name: index.name, minecraft: deps.minecraft, loader: 'vanilla' }
}

export function curseforgeInstanceInput(manifest: CurseforgeManifest): CreateInstanceInput {
  if (!manifest?.minecraft?.version) throw new SmclError('InvalidModpack', 'manifest.json does not declare a Minecraft version')
  const loaders = manifest.minecraft.modLoaders ?? []
  const primary = loaders.find((l) => l.primary) ?? loaders[0]
  if (!primary) return { name: manifest.name, minecraft: manifest.minecraft.version, loader: 'vanilla' }
  const dash = primary.id.indexOf('-')
  const kind = primary.id.slice(0, dash)
  const version = primary.id.slice(dash + 1)
  const loader = (['forge', 'neoforge', 'fabric', 'quilt'] as const).find((l) => l === kind)
  if (!loader || !version) throw new SmclError('InvalidModpack', `Unknown mod loader ${primary.id}`)
  return { name: manifest.name, minecraft: manifest.minecraft.version, loader, loaderVersion: version }
}

export function mrpackLoaderKey(loader: LoaderType): string | undefined {
  return Object.entries(MRPACK_LOADER_KEYS).find(([, l]) => l === loader)?.[0]
}

// ------------------------------------------------------------------ service

export class ModpackService {
  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
    private readonly install: InstallService,
    private readonly resources: ResourceService,
    private readonly tasks: TaskService,
  ) {}

  async importFile(filePath: string, parent?: TaskHandle, origin?: InstanceConfig['modpack']): Promise<ModpackImportResult> {
    const run = async (task: TaskHandle) => {
      const zip = await open(filePath).catch((e) => {
        throw new SmclError('InvalidModpack', `Cannot read archive: ${errorMessage(e)}`, { cause: e })
      })
      try {
        const entries = await readAllEntries(zip).catch((e) => {
          throw new SmclError('InvalidModpack', `Corrupted or unsafe archive: ${errorMessage(e)}`, { cause: e })
        })
        const byName = new Map(entries.map((e) => [e.fileName, e]))
        const mrpack = byName.get('modrinth.index.json')
        if (mrpack) return await this.importMrpack(zip, entries, mrpack, task, origin)
        const cf = byName.get('manifest.json')
        if (cf) return await this.importCurseforge(zip, entries, cf, task, origin)
        throw new SmclError('InvalidModpack', 'Not a Modrinth (.mrpack) or CurseForge modpack')
      } finally {
        zip.close()
      }
    }
    return parent ? run(parent) : this.tasks.run(basename(filePath), run)
  }

  async importRemote(source: ResourceSource, projectId: string, versionId?: string): Promise<ModpackImportResult> {
    return this.tasks.run(`Modpack ${projectId}`, async (task) => {
      const provider = this.resources.provider(source)
      const version = versionId
        ? await provider.version(projectId, versionId, task.signal)
        : (await provider.versions(projectId, 'modpack', {}, task.signal))[0]
      if (!version) throw new SmclError('NoCompatibleVersion', 'Modpack has no downloadable version')
      const file = version.files.find((f) => f.primary) ?? version.files[0]
      if (!file?.url) throw new SmclError('NoDownloadUrl', 'Modpack author does not allow third-party downloads')
      task.setDetail(file.filename)
      await mkdir(this.paths.temp, { recursive: true })
      const temp = join(this.paths.temp, `${Date.now()}-${basename(file.filename)}`)
      try {
        await download({ url: file.url, destination: temp, signal: task.signal, expectedTotal: file.size || undefined })
        if (file.sha1 && (await hashFile(temp)) !== file.sha1) throw new SmclError('ChecksumMismatch', 'Modpack download corrupted')
        return await this.importFile(temp, task, { source, projectId, versionId: version.versionId, version: version.versionNumber })
      } finally {
        await unlink(temp).catch(() => undefined)
      }
    })
  }

  async exportMrpack(instanceId: string, options: ModpackExportOptions): Promise<string> {
    const instance = this.instances.get(instanceId)
    return this.tasks.run(`${instance.name} → .mrpack`, async (task) => {
      const root = this.instances.dir(instanceId)
      const files = await collectFiles(root, options.include)
      const resourceDirs = Object.values(RESOURCE_DIRS)
      const candidates = files.filter((rel) => resourceDirs.some((d) => rel.startsWith(`${d}/`)))
      task.setDetail('Hashing files')
      const hashes = new Map<string, { sha1: string; sha512: string; size: number }>()
      for (const rel of candidates) {
        const full = join(root, rel)
        hashes.set(rel, { sha1: await hashFile(full, 'sha1'), sha512: await hashFile(full, 'sha512'), size: (await stat(full)).size })
      }
      task.setDetail('Matching Modrinth files')
      const matches = await this.resources.modrinth
        .versionsBySha1([...hashes.values()].map((h) => h.sha1), task.signal)
        .catch(() => ({}) as Awaited<ReturnType<ResourceService['modrinth']['versionsBySha1']>>)
      const indexFiles: MrpackFile[] = []
      const zip = new YazlZip()
      for (const rel of files) {
        task.throwIfCancelled()
        const h = hashes.get(rel)
        const remote = h ? matches[h.sha1]?.files.find((f) => f.sha1 === h.sha1) : undefined
        if (h && remote?.url) {
          indexFiles.push({
            path: rel,
            hashes: { sha1: h.sha1, sha512: h.sha512 },
            env: { client: 'required', server: 'required' },
            downloads: [remote.url],
            fileSize: h.size,
          })
        } else {
          zip.addFile(join(root, rel), `overrides/${rel}`)
        }
      }
      const index: MrpackIndex = {
        formatVersion: 1,
        game: 'minecraft',
        versionId: options.version,
        name: options.name,
        summary: options.summary,
        files: indexFiles,
        dependencies: { minecraft: instance.minecraft },
      }
      const loaderKey = mrpackLoaderKey(instance.loader)
      if (loaderKey && instance.loaderVersion) index.dependencies[loaderKey] = instance.loaderVersion
      zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2)), 'modrinth.index.json')
      zip.end()
      await pipeline(zip.outputStream, createWriteStream(options.destination))
      return options.destination
    })
  }

  private async importMrpack(zip: ZipFile, entries: Entry[], indexEntry: Entry, task: TaskHandle, origin?: InstanceConfig['modpack']) {
    const index = parseMrpackIndex(JSON.parse((await readEntry(zip, indexEntry)).toString('utf8')))
    const input = mrpackInstanceInput(index)
    const instance = await this.instances.create(input, {
      modpack: origin ?? { source: 'local', name: index.name, version: index.versionId },
    })
    return this.withCleanup(instance, async () => {
      const root = this.instances.dir(instance.id)
      await extractPrefix(zip, entries, 'overrides/', root)
      await extractPrefix(zip, entries, 'client-overrides/', root)
      const files: InstallFile[] = index.files
        .filter((f) => f.env?.client !== 'unsupported')
        .map((f) => ({
          path: safeJoin(root, f.path),
          urls: f.downloads,
          size: f.fileSize,
          checksum: { algorithm: 'sha1', value: f.hashes.sha1 },
        }))
      await runManifest(
        { task, concurrency: this.config.get().downloadConcurrency },
        { schemaVersion: 1, tasks: [{ id: 'modpack-files', type: 'files', files }] },
        `${index.name} (${files.length} files)`,
      )
      const installed = await this.install.installInstance(instance.id, task)
      return { instance: installed, skippedFiles: [] }
    })
  }

  private async importCurseforge(zip: ZipFile, entries: Entry[], manifestEntry: Entry, task: TaskHandle, origin?: InstanceConfig['modpack']) {
    const manifest = JSON.parse((await readEntry(zip, manifestEntry)).toString('utf8')) as CurseforgeManifest
    const input = curseforgeInstanceInput(manifest)
    const cf = this.resources.curseforge()
    const instance = await this.instances.create(input, {
      modpack: origin ?? { source: 'local', name: manifest.name, version: manifest.version },
    })
    return this.withCleanup(instance, async () => {
      const root = this.instances.dir(instance.id)
      await extractPrefix(zip, entries, `${manifest.overrides || 'overrides'}/`, root)
      const wanted = manifest.files.filter((f) => f.required !== false)
      task.setDetail('Resolving CurseForge files')
      const [cfFiles, mods] = await Promise.all([
        cf.getFiles(wanted.map((f) => f.fileID), task.signal),
        cf.getMods([...new Set(wanted.map((f) => f.projectID))], task.signal),
      ])
      const kindByMod = new Map(mods.map((m) => [m.id, curseforgeKind(m.classId)]))
      const skippedFiles: string[] = []
      const files: InstallFile[] = []
      for (const file of cfFiles) {
        if (!file.downloadUrl) {
          skippedFiles.push(file.fileName)
          continue
        }
        const kind = kindByMod.get(file.modId) ?? 'mod'
        const dir = kind === 'modpack' ? RESOURCE_DIRS.mod : RESOURCE_DIRS[kind]
        const sha1 = file.hashes?.find((h) => h.algo === 1)?.value
        files.push({
          path: safeJoin(root, `${dir}/${file.fileName}`),
          urls: [file.downloadUrl],
          size: file.fileLength,
          checksum: sha1 ? { algorithm: 'sha1', value: sha1 } : undefined,
        })
      }
      await runManifest(
        { task, concurrency: this.config.get().downloadConcurrency },
        { schemaVersion: 1, tasks: [{ id: 'modpack-files', type: 'files', files }] },
        `${manifest.name} (${files.length} files)`,
      )
      if (skippedFiles.length) {
        await writeFile(join(root, 'SMCL-skipped-files.txt'), skippedFiles.join('\n'))
      }
      const installed = await this.install.installInstance(instance.id, task)
      return { instance: installed, skippedFiles }
    })
  }

  private async withCleanup<T>(instance: InstanceConfig, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      await this.instances.remove(instance.id).catch(() => undefined)
      throw e
    }
  }
}

async function extractPrefix(zip: ZipFile, entries: Entry[], prefix: string, root: string) {
  for (const entry of entries) {
    if (!entry.fileName.startsWith(prefix) || entry.fileName.endsWith('/')) continue
    const rel = entry.fileName.slice(prefix.length)
    if (!rel) continue
    const target = safeJoin(root, rel)
    await mkdir(join(target, '..'), { recursive: true })
    await pipeline(await openEntryReadStream(zip, entry), createWriteStream(target))
  }
}

/** Relative (posix) paths of files under the included top-level entries; disabled files are skipped. */
async function collectFiles(root: string, include: string[]): Promise<string[]> {
  const result: string[] = []
  const walk = async (full: string) => {
    const info = await stat(full)
    if (info.isDirectory()) {
      for (const child of await readdir(full)) await walk(join(full, child))
    } else if (info.isFile() && !full.endsWith('.disabled')) {
      result.push(relative(root, full).split(sep).join('/'))
    }
  }
  for (const item of include) {
    const full = safeJoin(root, item)
    if (await exists(full)) await walk(full)
  }
  return result.sort()
}
