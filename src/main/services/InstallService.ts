import { readdir } from 'node:fs/promises'
import { MinecraftFolder, Version, type ResolvedVersion } from '@xmcl/core'
import {
  createFabricInstallWorkflow,
  createLegacyForgeInstallWorkflow,
  createModernForgeInstallWorkflow,
  createQuiltInstallWorkflow,
  diagnoseInstallation,
  getForgeVersionList,
  getLoaderArtifactListFor,
  getQuiltLoaderVersionsByMinecraft,
  getVersionList,
  resolveAssetInstallFiles,
  resolveAssetMetadataInstallManifest,
  resolveAssetObjectInstallFiles,
  resolveForgeArtifactVersion,
  resolveForgeInstallerFile,
  resolveLibraryInstallFiles,
  resolveMinecraftJarInstallFile,
  resolveMinecraftVersionJsonInstallFile,
  resolveNeoForgedInstallerFile,
  type InstallFile,
  type InstallForgeOptions,
  type InstallIssue,
  type MinecraftVersionList,
} from '@xmcl/installer'
import type { InstanceConfig, LoaderType, MinecraftVersionListResult } from '@shared/types'
import { SmclError } from '../util/errors'
import { exists } from '../util/fs'
import { runManifest, runWorkflow, type InstallExecContext } from '../util/install'
import { getMirrorOptions, type MirrorOptions } from '../util/mirrors'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'
import type { InstanceService } from './InstanceService'
import type { JavaService } from './JavaService'
import type { TaskHandle, TaskService } from './TaskService'

const VERSION_LIST_TTL = 10 * 60 * 1000
const NEOFORGE_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged'

/** NeoForge version prefix for a Minecraft version: 1.21.1 -> "21.1.", 26.3 -> "26.3.0.". */
export function neoForgePrefix(minecraft: string): string | undefined {
  const legacy = /^1\.(\d+)(?:\.(\d+))?$/.exec(minecraft)
  if (legacy) return `${legacy[1]}.${legacy[2] ?? 0}.`
  const yearly = /^(\d{2})\.(\d+)(?:\.(\d+))?$/.exec(minecraft)
  if (yearly) return `${yearly[1]}.${yearly[2]}.${yearly[3] ?? 0}.`
  return undefined
}

export function compareLooseVersion(a: string, b: string): number {
  const pa = a.split(/[.\-+_]/)
  const pb = b.split(/[.\-+_]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const nx = Number(x)
    const ny = Number(y)
    const d = Number.isFinite(nx) && Number.isFinite(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y)
    if (d !== 0) return d
  }
  return 0
}

type InstallOptions = InstallForgeOptions & {
  json?: MirrorOptions['json']
  client?: MirrorOptions['client']
  assetsHost?: string[]
  assetsIndexUrl?: MirrorOptions['assetsIndexUrl']
  useHashForAssetsIndex?: boolean
}

export class InstallService {
  private versionList?: { at: number; mirror: string; list: MinecraftVersionList }

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
    private readonly java: JavaService,
    private readonly tasks: TaskService,
  ) {}

  get folder() {
    return MinecraftFolder.from(this.paths.minecraft)
  }

  async listMinecraft(force = false): Promise<MinecraftVersionListResult> {
    const list = await this.getVersionList(force)
    return {
      latest: list.latest,
      versions: list.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
    }
  }

  async listLoaders(loader: Exclude<LoaderType, 'vanilla'>, minecraft: string): Promise<string[]> {
    switch (loader) {
      case 'fabric':
        return (await getLoaderArtifactListFor(minecraft)).map((a) => a.loader.version)
      case 'quilt':
        return (await getQuiltLoaderVersionsByMinecraft({ minecraftVersion: minecraft })).map((a) => a.loader.version)
      case 'forge': {
        const list = await getForgeVersionList({ minecraft })
        return list.versions.map((v) => v.version).sort((a, b) => compareLooseVersion(b, a))
      }
      case 'neoforge':
        return this.listNeoForge(minecraft)
    }
  }

  async installedVersions(): Promise<string[]> {
    const dir = this.folder.versions
    if (!(await exists(dir))) return []
    const entries = await readdir(dir, { withFileTypes: true })
    const result: string[] = []
    for (const e of entries) {
      if (e.isDirectory() && (await exists(this.folder.getVersionJson(e.name)))) result.push(e.name)
    }
    return result.sort((a, b) => compareLooseVersion(b, a))
  }

  /** Install (or finish installing) the version an instance needs and store the resulting version id. */
  async installInstance(id: string, parent?: TaskHandle): Promise<InstanceConfig> {
    const instance = this.instances.get(id)
    const run = async (task: TaskHandle) => {
      const versionId = await this.installVersion(instance, task)
      return this.instances.update(id, { versionId })
    }
    return parent ? run(parent) : this.tasks.run(`${instance.name}`, run, `${instance.minecraft} ${instance.loader}`)
  }

  /** Check an installed version and re-download anything missing or corrupted. */
  async repair(versionId: string, task: TaskHandle): Promise<ResolvedVersion> {
    const resolved = await Version.parse(this.folder, versionId)
    task.setDetail('Verifying files')
    const issue = await diagnoseInstallation(resolved, { signal: task.signal })
    if (issue) await this.fixIssue(resolved, issue, this.ctx(task))
    return resolved
  }

  private async installVersion(instance: InstanceConfig, task: TaskHandle): Promise<string> {
    const ctx = this.ctx(task)
    const options = this.installOptions()
    const vanilla = await this.installVanilla(instance.minecraft, ctx, options)
    if (instance.loader === 'vanilla') return vanilla.id
    const loaderVersion = instance.loaderVersion
    if (!loaderVersion) throw new SmclError('InvalidInstance', 'Loader version is required')

    let versionId: string
    switch (instance.loader) {
      case 'fabric':
        versionId = await runWorkflow(
          ctx,
          createFabricInstallWorkflow({
            minecraft: this.folder,
            minecraftVersion: instance.minecraft,
            version: loaderVersion,
            profileUrls: this.mirror.fabricMeta.map(
              (host) => `${host}/v2/versions/loader/${instance.minecraft}/${loaderVersion}/profile/json`,
            ),
          }),
          `Fabric ${loaderVersion}`,
        )
        break
      case 'quilt':
        versionId = await runWorkflow(
          ctx,
          createQuiltInstallWorkflow({ minecraft: this.folder, minecraftVersion: instance.minecraft, version: loaderVersion }),
          `Quilt ${loaderVersion}`,
        )
        break
      case 'forge':
      case 'neoforge':
        versionId = await this.installForgeLike(instance.loader, instance.minecraft, loaderVersion, vanilla, ctx, options)
        break
    }
    const final = await Version.parse(this.folder, versionId)
    await runManifest(
      ctx,
      { schemaVersion: 1, tasks: [{ id: 'final-libraries', type: 'files', files: resolveLibraryInstallFiles(final.libraries, this.folder, options) }] },
      'Libraries',
    )
    return versionId
  }

  private async installVanilla(minecraft: string, ctx: InstallExecContext, options: InstallOptions): Promise<ResolvedVersion> {
    let resolved = await Version.parse(this.folder, minecraft).catch(() => undefined)
    if (!resolved) {
      const list = await this.getVersionList()
      const meta = list.versions.find((v) => v.id === minecraft)
      if (!meta) throw new SmclError('UnknownVersion', `Minecraft ${minecraft} not found in version manifest`)
      await runManifest(
        ctx,
        { schemaVersion: 1, tasks: [{ id: 'version-json', type: 'files', files: [resolveMinecraftVersionJsonInstallFile(meta, this.folder, options)] }] },
        `Minecraft ${minecraft}`,
      )
      resolved = await Version.parse(this.folder, minecraft)
    }
    const jar = resolveMinecraftJarInstallFile(resolved, options)
    await runManifest(
      ctx,
      {
        schemaVersion: 1,
        tasks: [
          { id: 'client-jar', type: 'files', files: jar ? [jar] : [] },
          { id: 'libraries', type: 'files', files: resolveLibraryInstallFiles(resolved.libraries, this.folder, options) },
        ],
      },
      'Game files & libraries',
    )
    await runManifest(ctx, resolveAssetMetadataInstallManifest(resolved, this.folder, options), 'Asset index')
    const assets = await resolveAssetObjectInstallFiles(resolved, this.folder, options)
    await runManifest(ctx, { schemaVersion: 1, tasks: [{ id: 'assets', type: 'files', files: assets }] }, `Assets (${assets.length})`)
    return resolved
  }

  private async installForgeLike(
    loader: 'forge' | 'neoforge',
    minecraft: string,
    version: string,
    vanilla: ResolvedVersion,
    ctx: InstallExecContext,
    options: InstallOptions,
  ): Promise<string> {
    const java = await this.java.ensureFor(vanilla.javaVersion, ctx.task)
    const forgeOptions: InstallForgeOptions = { ...options, java: java.path, inheritsFrom: minecraft, side: 'client' }
    let installer: InstallFile
    let artifactVersion: string
    const legacyUniversal = loader === 'forge' && minecraft.startsWith('1.4.')
    if (loader === 'forge') {
      artifactVersion = resolveForgeArtifactVersion(minecraft, version)
      installer = resolveForgeInstallerFile(artifactVersion, undefined, this.folder, forgeOptions, legacyUniversal).file
    } else {
      const legacy = version.startsWith('47.') || version.startsWith('1.20.1-')
      artifactVersion = legacy && version.startsWith('47.') ? `${minecraft}-${version}` : version
      installer = (await resolveNeoForgedInstallerFile(legacy ? 'forge' : 'neoforge', artifactVersion, this.folder, forgeOptions)).file
    }
    const label = `${loader === 'forge' ? 'Forge' : 'NeoForge'} ${version}`
    if (legacyUniversal) {
      return runWorkflow(
        ctx,
        createLegacyForgeInstallWorkflow({
          id: `${loader}:${version}`,
          minecraft: this.folder,
          minecraftVersion: minecraft,
          universal: installer,
          artifactVersion,
          installOptions: forgeOptions,
        }),
        label,
      )
    }
    const result = await runWorkflow(
      ctx,
      createModernForgeInstallWorkflow({
        id: `${loader}:${version}`,
        minecraft: this.folder,
        minecraftVersion: minecraft,
        installer,
        artifactVersion,
        java: java.path,
        installOptions: forgeOptions,
        side: 'client',
      }),
      label,
    )
    return result.version
  }

  private async fixIssue(resolved: ResolvedVersion, issue: InstallIssue, ctx: InstallExecContext) {
    const options = this.installOptions()
    const files: InstallFile[] = []
    if (issue.jar) {
      const jar = resolveMinecraftJarInstallFile(resolved, options)
      if (jar) files.push(jar)
    }
    if (issue.libraries?.length) files.push(...resolveLibraryInstallFiles(issue.libraries, this.folder, options))
    if (issue.assets?.length) files.push(...resolveAssetInstallFiles(issue.assets, this.folder, options))
    if (files.length) await runManifest(ctx, { schemaVersion: 1, tasks: [{ id: 'repair', type: 'files', files }] }, 'Repairing files')
    if (issue.assetsIndex) {
      await runManifest(ctx, resolveAssetMetadataInstallManifest(resolved, this.folder, options), 'Asset index')
      const assets = await resolveAssetObjectInstallFiles(resolved, this.folder, options)
      await runManifest(ctx, { schemaVersion: 1, tasks: [{ id: 'assets', type: 'files', files: assets }] }, 'Assets')
    }
    if (issue.forge || issue.profile || issue.optifine) {
      throw new SmclError('LoaderCorrupted', 'Mod loader files are damaged; reinstall the instance version')
    }
  }

  private async listNeoForge(minecraft: string): Promise<string[]> {
    if (minecraft === '1.20.1') {
      const res = await fetch(`${NEOFORGE_API}/forge`)
      if (!res.ok) throw new SmclError('LoaderList', `NeoForge list failed: ${res.status}`)
      const { versions } = (await res.json()) as { versions: string[] }
      return versions.filter((v) => v.startsWith('1.20.1-')).sort((a, b) => compareLooseVersion(b, a))
    }
    const prefix = neoForgePrefix(minecraft)
    if (!prefix) return []
    const res = await fetch(`${NEOFORGE_API}/neoforge`)
    if (!res.ok) throw new SmclError('LoaderList', `NeoForge list failed: ${res.status}`)
    const { versions } = (await res.json()) as { versions: string[] }
    return versions.filter((v) => v.startsWith(prefix)).sort((a, b) => compareLooseVersion(b, a))
  }

  private async getVersionList(force = false): Promise<MinecraftVersionList> {
    const mirror = this.mirror.versionManifest
    const cached = this.versionList
    if (!force && cached && cached.mirror === mirror && Date.now() - cached.at < VERSION_LIST_TTL) return cached.list
    const list = await getVersionList({ remote: mirror })
    this.versionList = { at: Date.now(), mirror, list }
    return list
  }

  private get mirror(): MirrorOptions {
    return getMirrorOptions(this.config.get().mirror)
  }

  private installOptions(): InstallOptions {
    const m = this.mirror
    return {
      side: 'client',
      // XMCL stores the asset index as <sha1>.json (aliased to <id>.json) and diagnoseInstallation expects that layout.
      useHashForAssetsIndex: true,
      json: m.json,
      client: m.client,
      assetsHost: m.assetsHost,
      assetsIndexUrl: m.assetsIndexUrl,
      mavenHost: m.mavenHost,
    }
  }

  private ctx(task: TaskHandle): InstallExecContext {
    return { task, concurrency: this.config.get().downloadConcurrency }
  }
}
