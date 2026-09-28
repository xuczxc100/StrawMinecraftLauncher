import type {
  Account,
  AppConfig,
  AppInfo,
  CreateInstanceInput,
  DeviceCodeInfo,
  InstanceConfig,
  JavaInstall,
  LaunchLogLine,
  LaunchState,
  LoaderType,
  LocalResource,
  MinecraftVersionListResult,
  ModpackExportOptions,
  ModpackImportResult,
  ResourceInstallResult,
  ResourceKind,
  ResourceSearchQuery,
  ResourceSearchResult,
  ResourceSource,
  ResourceVersion,
  TaskInfo,
} from './types'

export type LocalResourceKind = Exclude<ResourceKind, 'modpack'>

/**
 * Request/response channels. Every renderer call goes through `smcl.invoke(channel, ...args)`.
 * Keys are the IPC channel names; the main process registers one handler per key.
 */
export interface SmclApi {
  'app:info'(): AppInfo
  'config:get'(): AppConfig
  'config:set'(patch: Partial<AppConfig>): AppConfig

  'account:list'(): { accounts: Account[]; selectedId?: string }
  'account:addOffline'(name: string): Account
  'account:microsoftBegin'(): DeviceCodeInfo
  'account:microsoftComplete'(sessionId: string): Account
  'account:microsoftCancel'(sessionId: string): void
  'account:refresh'(id: string): Account
  'account:remove'(id: string): void
  'account:select'(id: string): void

  'instance:list'(): InstanceConfig[]
  'instance:create'(input: CreateInstanceInput): InstanceConfig
  'instance:update'(id: string, patch: Partial<InstanceConfig>): InstanceConfig
  'instance:delete'(id: string): void
  'instance:select'(id: string): void
  'instance:openFolder'(id: string, sub?: string): void

  'version:listMinecraft'(force?: boolean): MinecraftVersionListResult
  'version:listLoaders'(loader: Exclude<LoaderType, 'vanilla'>, minecraft: string): string[]
  'version:installed'(): string[]
  'install:instance'(id: string): InstanceConfig

  'java:list'(): JavaInstall[]
  'java:scan'(): JavaInstall[]
  'java:install'(majorVersion: number): JavaInstall
  'java:addCustom'(path: string): JavaInstall
  'java:removeCustom'(path: string): void

  'launch:start'(id: string): LaunchState
  'launch:kill'(id: string): void
  'launch:states'(): LaunchState[]
  'launch:logs'(id: string): LaunchLogLine[]

  'resource:search'(query: ResourceSearchQuery): ResourceSearchResult
  'resource:versions'(
    source: ResourceSource,
    projectId: string,
    kind: ResourceKind,
    filter: { gameVersion?: string; loader?: LoaderType },
  ): ResourceVersion[]
  'resource:install'(instanceId: string, kind: LocalResourceKind, source: ResourceSource, projectId: string, versionId?: string): ResourceInstallResult
  'resource:listLocal'(instanceId: string, kind: LocalResourceKind): LocalResource[]
  'resource:toggle'(instanceId: string, kind: LocalResourceKind, fileName: string, enabled: boolean): LocalResource[]
  'resource:delete'(instanceId: string, kind: LocalResourceKind, fileName: string): LocalResource[]

  'modpack:importFile'(filePath: string): ModpackImportResult
  'modpack:importRemote'(source: ResourceSource, projectId: string, versionId?: string): ModpackImportResult
  'modpack:export'(instanceId: string, options: ModpackExportOptions): string

  'task:list'(): TaskInfo[]
  'task:cancel'(id: string): void
  'task:clearFinished'(): void

  'dialog:openFile'(filters: Array<{ name: string; extensions: string[] }>): string | undefined
  'dialog:saveFile'(defaultName: string, filters: Array<{ name: string; extensions: string[] }>): string | undefined
  'shell:openExternal'(url: string): void
}

export type SmclChannel = keyof SmclApi
export type SmclArgs<C extends SmclChannel> = Parameters<SmclApi[C]>
export type SmclResult<C extends SmclChannel> = ReturnType<SmclApi[C]>

/** Push events from main to renderer. */
export interface SmclEvents {
  'task:update': TaskInfo
  'launch:state': LaunchState
  'launch:log': LaunchLogLine
  'accounts:changed': { accounts: Account[]; selectedId?: string }
  'instances:changed': InstanceConfig[]
  'config:changed': AppConfig
}

export type SmclEvent = keyof SmclEvents

export interface SmclErrorPayload {
  code: string
  message: string
}

export type SmclResponse<T> = { ok: true; data: T } | { ok: false; error: SmclErrorPayload }

export interface SmclBridge {
  invoke<C extends SmclChannel>(channel: C, ...args: SmclArgs<C>): Promise<SmclResult<C>>
  on<E extends SmclEvent>(event: E, listener: (payload: SmclEvents[E]) => void): () => void
}

const INVOKE_CHANNEL_MAP: Record<SmclChannel, true> = {
  'app:info': true,
  'config:get': true,
  'config:set': true,
  'account:list': true,
  'account:addOffline': true,
  'account:microsoftBegin': true,
  'account:microsoftComplete': true,
  'account:microsoftCancel': true,
  'account:refresh': true,
  'account:remove': true,
  'account:select': true,
  'instance:list': true,
  'instance:create': true,
  'instance:update': true,
  'instance:delete': true,
  'instance:select': true,
  'instance:openFolder': true,
  'version:listMinecraft': true,
  'version:listLoaders': true,
  'version:installed': true,
  'install:instance': true,
  'java:list': true,
  'java:scan': true,
  'java:install': true,
  'java:addCustom': true,
  'java:removeCustom': true,
  'launch:start': true,
  'launch:kill': true,
  'launch:states': true,
  'launch:logs': true,
  'resource:search': true,
  'resource:versions': true,
  'resource:install': true,
  'resource:listLocal': true,
  'resource:toggle': true,
  'resource:delete': true,
  'modpack:importFile': true,
  'modpack:importRemote': true,
  'modpack:export': true,
  'task:list': true,
  'task:cancel': true,
  'task:clearFinished': true,
  'dialog:openFile': true,
  'dialog:saveFile': true,
  'shell:openExternal': true,
}

export const SMCL_INVOKE_CHANNELS = Object.keys(INVOKE_CHANNEL_MAP) as SmclChannel[]

const EVENT_MAP: Record<SmclEvent, true> = {
  'task:update': true,
  'launch:state': true,
  'launch:log': true,
  'accounts:changed': true,
  'instances:changed': true,
  'config:changed': true,
}

export const SMCL_EVENTS = Object.keys(EVENT_MAP) as SmclEvent[]
