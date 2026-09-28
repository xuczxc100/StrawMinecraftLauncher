import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { JavaVersion } from '@xmcl/core'
import {
  createJavaRuntimeInstallWorkflow,
  DEFAULT_RUNTIME_ALL_URL,
  getPotentialJavaLocations,
  resolveJava,
  scanLocalJava,
  type JavaRuntimes,
  type JavaRuntimeTarget,
} from '@xmcl/installer'
import type { JavaInstall } from '@shared/types'
import { SmclError } from '../util/errors'
import { exists, readJson, writeJson } from '../util/fs'
import { runWorkflow } from '../util/install'
import type { SmclPaths } from '../util/paths'
import type { ConfigService } from './ConfigService'
import type { TaskHandle, TaskService } from './TaskService'

type RuntimePlatformKey = keyof JavaRuntimes

export function getRuntimePlatformKey(platform = process.platform, arch = process.arch): RuntimePlatformKey | undefined {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  if (platform === 'linux') return arch === 'x64' ? 'linux' : arch === 'ia32' ? 'linux-i386' : undefined
  return undefined
}

/**
 * Choose a Java for the required major version.
 * Java 8-era versions need exactly Java 8; modern versions accept the closest newer major.
 */
export function pickJava(installs: JavaInstall[], required: number): JavaInstall | undefined {
  const byNewest = [...installs].sort((a, b) => compareJavaVersion(b.version, a.version))
  const exact = byNewest.filter((j) => j.majorVersion === required)
  const preferred = exact.find((j) => j.source !== 'system') ?? exact[0]
  if (preferred) return preferred
  if (required < 16) return undefined
  return [...installs]
    .filter((j) => j.majorVersion > required)
    .sort((a, b) => a.majorVersion - b.majorVersion || compareJavaVersion(b.version, a.version))[0]
}

/** Major version of a Mojang runtime name: "17.0.15" -> 17, "8u202" / "1.8.0_202" -> 8. */
export function runtimeMajorVersion(name: string): number | undefined {
  const m = /^1\.(\d+)/.exec(name) ?? /^(\d+)/.exec(name)
  return m ? Number(m[1]) : undefined
}

function compareJavaVersion(a: string, b: string): number {
  const pa = a.split(/[._+-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[._+-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

const EXECUTABLE_CANDIDATES =
  process.platform === 'win32'
    ? ['bin/javaw.exe', 'bin/java.exe']
    : process.platform === 'darwin'
      ? ['jre.bundle/Contents/Home/bin/java', 'Contents/Home/bin/java', 'bin/java']
      : ['bin/java']

export class JavaService {
  private installs: JavaInstall[] = []
  private runtimeIndex?: JavaRuntimes

  constructor(
    private readonly paths: SmclPaths,
    private readonly config: ConfigService,
    private readonly tasks: TaskService,
  ) {}

  async load() {
    this.installs = await readJson<JavaInstall[]>(this.paths.javaIndex, [])
    if (this.installs.length === 0) await this.scan()
  }

  list(): JavaInstall[] {
    return this.installs.map((j) => ({ ...j }))
  }

  async scan(): Promise<JavaInstall[]> {
    const custom = this.config.get().customJavaPaths
    const managed = await this.managedExecutables()
    const system = await getPotentialJavaLocations().catch(() => [] as string[])
    if (process.env.JAVA_HOME) system.push(join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
    const found = await scanLocalJava([...new Set([...managed, ...custom, ...system])])
    const managedSet = new Set(managed.map(normalize))
    const customSet = new Set(custom.map(normalize))
    const seen = new Set<string>()
    const result: JavaInstall[] = []
    for (const info of found) {
      const key = normalize(info.path)
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        path: preferWindowless(info.path),
        version: info.version,
        majorVersion: info.majorVersion,
        source: managedSet.has(key) ? 'managed' : customSet.has(key) ? 'custom' : 'system',
      })
    }
    this.installs = result.sort((a, b) => b.majorVersion - a.majorVersion)
    await writeJson(this.paths.javaIndex, this.installs)
    return this.list()
  }

  async addCustom(path: string): Promise<JavaInstall> {
    const info = await resolveJava(path)
    if (!info) throw new SmclError('InvalidJava', `Not a working Java executable: ${path}`)
    const custom = this.config.get().customJavaPaths
    if (!custom.includes(path)) await this.config.set({ customJavaPaths: [...custom, path] })
    await this.scan()
    return this.installs.find((j) => normalize(j.path) === normalize(preferWindowless(info.path))) ?? {
      path: info.path,
      version: info.version,
      majorVersion: info.majorVersion,
      source: 'custom',
    }
  }

  async removeCustom(path: string) {
    await this.config.set({ customJavaPaths: this.config.get().customJavaPaths.filter((p) => p !== path) })
    await this.scan()
  }

  /** Download a Mojang Java runtime whose major version equals `majorVersion`. */
  async install(majorVersion: number): Promise<JavaInstall> {
    return this.tasks.run(`Java ${majorVersion}`, (task) => this.downloadRuntime({ majorVersion }, task))
  }

  /** Resolve a Java for a Minecraft version, installing the matching Mojang runtime when missing. */
  async ensureFor(required: JavaVersion, task: TaskHandle, override?: string): Promise<JavaInstall> {
    if (override) {
      const info = await resolveJava(override)
      if (!info) throw new SmclError('InvalidJava', `Configured Java does not work: ${override}`)
      return { path: preferWindowless(info.path), version: info.version, majorVersion: info.majorVersion, source: 'custom' }
    }
    const picked = pickJava(this.installs, required.majorVersion)
    if (picked && (await exists(picked.path))) return picked
    return this.downloadRuntime(required, task)
  }

  private async downloadRuntime(required: Partial<JavaVersion> & { majorVersion: number }, task: TaskHandle) {
    const { component, target } = await this.findRuntime(required)
    const destination = join(this.paths.javaRuntimes, component)
    await runWorkflow(
      { task, concurrency: this.config.get().downloadConcurrency },
      createJavaRuntimeInstallWorkflow({ target, destination }),
      `Java ${target.version.name}`,
    )
    return this.registerManaged(destination)
  }

  private async registerManaged(destination: string): Promise<JavaInstall> {
    const exe = await findExecutable(destination)
    if (!exe) throw new SmclError('JavaInstallFailed', `Java executable not found in ${destination}`)
    const installs = await this.scan()
    const found = installs.find((j) => normalize(j.path) === normalize(preferWindowless(exe)))
    if (!found) throw new SmclError('JavaInstallFailed', `Installed Java at ${exe} does not run`)
    return found
  }

  private async findRuntime(required: Partial<JavaVersion> & { majorVersion: number }) {
    const key = getRuntimePlatformKey()
    if (!key) {
      throw new SmclError(
        'JavaUnsupportedPlatform',
        `No Mojang Java runtime for ${process.platform}-${process.arch}; install Java ${required.majorVersion} manually`,
      )
    }
    if (!this.runtimeIndex) {
      const res = await fetch(DEFAULT_RUNTIME_ALL_URL)
      if (!res.ok) throw new SmclError('JavaIndex', `Failed to fetch Java runtime index: ${res.status}`)
      this.runtimeIndex = (await res.json()) as JavaRuntimes
    }
    const targets = this.runtimeIndex[key]
    const declared = required.component ? targets[required.component]?.[0] : undefined
    let chosen: { component: string; target: JavaRuntimeTarget } | undefined =
      required.component && declared ? { component: required.component, target: declared } : undefined
    if (!chosen) {
      const candidates: Array<{ component: string; target: JavaRuntimeTarget }> = []
      for (const [component, list] of Object.entries(targets)) {
        const target = list[0]
        if (!target || component === 'minecraft-java-exe') continue
        if (runtimeMajorVersion(target.version.name) === required.majorVersion) candidates.push({ component, target })
      }
      chosen = candidates.sort((a, b) => compareJavaVersion(b.target.version.name, a.target.version.name))[0]
    }
    if (!chosen) {
      throw new SmclError('JavaNotAvailable', `Mojang provides no Java ${required.majorVersion} for ${key}`)
    }
    return chosen
  }

  private async managedExecutables(): Promise<string[]> {
    const root = this.paths.javaRuntimes
    if (!(await exists(root))) return []
    const result: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const exe = await findExecutable(join(root, entry.name))
      if (exe) result.push(exe)
    }
    return result
  }
}

async function findExecutable(dir: string): Promise<string | undefined> {
  for (const rel of EXECUTABLE_CANDIDATES) {
    const p = join(dir, rel)
    if (await exists(p)) return p
  }
  return undefined
}

function normalize(p: string) {
  const unified = p.replace(/javaw\.exe$/i, 'java.exe')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/** On Windows launch with javaw.exe so no console window appears. */
function preferWindowless(p: string) {
  if (process.platform !== 'win32' || !/java\.exe$/i.test(p)) return p
  const javaw = join(dirname(p), 'javaw.exe')
  return existsSync(javaw) ? javaw : p
}
