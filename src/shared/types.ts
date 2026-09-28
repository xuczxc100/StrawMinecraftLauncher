export type LoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric' | 'quilt'
export const LOADER_TYPES: LoaderType[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt']

export type MirrorSource = 'official' | 'bmclapi'
export type Locale = 'zh-TW' | 'en'
export type ThemeMode = 'dark' | 'light'

export interface AppConfig {
  locale: Locale
  theme: ThemeMode
  accentColor: string
  mirror: MirrorSource
  downloadConcurrency: number
  defaultMaxMemory: number
  closeOnLaunch: boolean
  msClientId: string
  curseforgeApiKey: string
  selectedInstanceId?: string
  selectedAccountId?: string
  customJavaPaths: string[]
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  dataRoot: string
  totalMemoryMB: number
  msLoginAvailable: boolean
  curseforgeAvailable: boolean
}

export type AccountType = 'microsoft' | 'offline'

export interface Account {
  id: string
  type: AccountType
  name: string
  uuid: string
  skinUrl?: string
  expiresAt?: number
}

export interface DeviceCodeInfo {
  sessionId: string
  userCode: string
  verificationUri: string
  expiresIn: number
  message: string
}

export interface InstanceResolution {
  width: number
  height: number
  fullscreen: boolean
}

export interface InstanceConfig {
  id: string
  name: string
  minecraft: string
  loader: LoaderType
  loaderVersion?: string
  versionId?: string
  javaPath?: string
  minMemory?: number
  maxMemory?: number
  jvmArgs?: string
  mcArgs?: string
  resolution?: InstanceResolution
  server?: { host: string; port?: number }
  createdAt: number
  lastPlayed?: number
  modpack?: { source: ResourceSource | 'local'; projectId?: string; versionId?: string; name?: string; version?: string }
}

export interface CreateInstanceInput {
  name: string
  minecraft: string
  loader: LoaderType
  loaderVersion?: string
}

export interface MinecraftVersionEntry {
  id: string
  type: string
  releaseTime: string
}

export interface MinecraftVersionListResult {
  latest: { release: string; snapshot: string }
  versions: MinecraftVersionEntry[]
}

export interface JavaInstall {
  path: string
  version: string
  majorVersion: number
  source: 'system' | 'managed' | 'custom'
}

export type TaskStatus = 'running' | 'success' | 'failed' | 'cancelled'

export interface TaskInfo {
  id: string
  title: string
  detail?: string
  status: TaskStatus
  progress: number
  total: number
  unit: 'bytes' | 'items' | 'none'
  error?: string
  startedAt: number
  endedAt?: number
}

export type ResourceSource = 'modrinth' | 'curseforge'
export type ResourceKind = 'mod' | 'resourcepack' | 'shader' | 'modpack'
export type ResourceSort = 'relevance' | 'downloads' | 'updated' | 'newest'

export interface ResourceSearchQuery {
  source: ResourceSource
  kind: ResourceKind
  query: string
  gameVersion?: string
  loader?: LoaderType
  sort: ResourceSort
  offset: number
  limit: number
}

export interface ResourceHit {
  source: ResourceSource
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  downloads: number
  categories: string[]
  pageUrl: string
}

export interface ResourceSearchResult {
  hits: ResourceHit[]
  total: number
  offset: number
}

export type DependencyType = 'required' | 'optional' | 'incompatible' | 'embedded'

export interface ResourceFile {
  filename: string
  url?: string
  size: number
  sha1?: string
  primary: boolean
}

export interface ResourceVersion {
  source: ResourceSource
  projectId: string
  versionId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  releaseType: 'release' | 'beta' | 'alpha'
  published: string
  files: ResourceFile[]
  dependencies: Array<{ projectId: string; versionId?: string; type: DependencyType }>
}

export interface InstalledResourceMeta {
  source: ResourceSource
  projectId: string
  versionId: string
  title?: string
}

export interface LocalResource {
  kind: Exclude<ResourceKind, 'modpack'>
  fileName: string
  enabled: boolean
  size: number
  name?: string
  version?: string
  modId?: string
  description?: string
  loaders?: string[]
  origin?: InstalledResourceMeta
}

export interface ResourceInstallResult {
  installed: Array<{ projectId: string; fileName: string }>
  skipped: Array<{ projectId: string; reason: string }>
}

export interface ModpackExportOptions {
  name: string
  version: string
  summary?: string
  include: string[]
  destination: string
}

export interface ModpackImportResult {
  instance: InstanceConfig
  skippedFiles: string[]
}

export type LaunchStatus = 'preparing' | 'launching' | 'running' | 'exited' | 'crashed' | 'failed'

export interface LaunchState {
  instanceId: string
  status: LaunchStatus
  pid?: number
  exitCode?: number | null
  crashReport?: string
  crashReportPath?: string
  error?: string
  startedAt: number
}

export interface LaunchLogLine {
  instanceId: string
  stream: 'stdout' | 'stderr' | 'smcl'
  line: string
}
