import { totalmem } from 'node:os'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { SmclApi, SmclChannel, SmclResponse } from '@shared/ipc'
import { SMCL_INVOKE_CHANNELS } from '@shared/ipc'
import type { SmclContext } from './context'
import { SmclError, toErrorPayload } from './util/errors'

type Handlers = { [C in SmclChannel]: (...args: Parameters<SmclApi[C]>) => ReturnType<SmclApi[C]> | Promise<ReturnType<SmclApi[C]>> }

const ALLOWED_EXTERNAL = /^https:\/\//

export function createHandlers(ctx: SmclContext, getWindow: () => BrowserWindow | undefined): Handlers {
  const { config, accounts, instances, install, java, launcher, resources, modpacks, tasks, paths } = ctx
  return {
    'app:info': () => ({
      name: 'StrawMinecraftLauncher',
      version: ctx.version,
      platform: process.platform,
      arch: process.arch,
      dataRoot: paths.root,
      totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
      msLoginAvailable: Boolean(config.msClientId),
      curseforgeAvailable: Boolean(config.curseforgeApiKey),
    }),
    'config:get': () => config.get(),
    'config:set': (patch) => config.set(patch),

    'account:list': () => accounts.list(),
    'account:addOffline': (name) => accounts.addOffline(name),
    'account:microsoftBegin': async () => {
      const info = await accounts.microsoftBegin()
      void shell.openExternal(info.verificationUri)
      return info
    },
    'account:microsoftComplete': (sessionId) => accounts.microsoftComplete(sessionId),
    'account:microsoftCancel': (sessionId) => accounts.cancelMicrosoft(sessionId),
    'account:refresh': (id) => accounts.refresh(id),
    'account:remove': (id) => accounts.remove(id),
    'account:select': (id) => accounts.select(id),

    'instance:list': () => instances.list(),
    'instance:create': (input) => instances.create(input),
    'instance:update': (id, patch) => instances.update(id, patch),
    'instance:delete': (id) => instances.remove(id),
    'instance:select': (id) => instances.select(id),
    'instance:openFolder': async (id, sub) => {
      const dir = instances.dir(id)
      const target = sub ? `${dir}/${sub.replace(/[\\/]|\.\./g, '')}` : dir
      const error = await shell.openPath(target)
      if (error) throw new SmclError('OpenFolder', error)
    },

    'version:listMinecraft': (force) => install.listMinecraft(force),
    'version:listLoaders': (loader, minecraft) => install.listLoaders(loader, minecraft),
    'version:installed': () => install.installedVersions(),
    'install:instance': (id) => install.installInstance(id),

    'java:list': () => java.list(),
    'java:scan': () => java.scan(),
    'java:install': (major) => java.install(major),
    'java:addCustom': (path) => java.addCustom(path),
    'java:removeCustom': (path) => java.removeCustom(path),

    'launch:start': (id) => launcher.start(id),
    'launch:kill': (id) => launcher.kill(id),
    'launch:states': () => launcher.states(),
    'launch:logs': (id) => launcher.logs(id),

    'resource:search': (query) => resources.search(query),
    'resource:versions': (source, projectId, kind, filter) => resources.versions(source, projectId, filter, kind),
    'resource:install': (instanceId, kind, source, projectId, versionId) =>
      resources.install(instanceId, kind, source, projectId, versionId),
    'resource:listLocal': (instanceId, kind) => resources.listLocal(instanceId, kind),
    'resource:toggle': (instanceId, kind, fileName, enabled) => resources.toggle(instanceId, kind, fileName, enabled),
    'resource:delete': (instanceId, kind, fileName) => resources.remove(instanceId, kind, fileName),

    'modpack:importFile': (filePath) => modpacks.importFile(filePath),
    'modpack:importRemote': (source, projectId, versionId) => modpacks.importRemote(source, projectId, versionId),
    'modpack:export': (instanceId, options) => modpacks.exportMrpack(instanceId, options),

    'task:list': () => tasks.list(),
    'task:cancel': (id) => tasks.cancel(id),
    'task:clearFinished': () => tasks.clearFinished(),

    'dialog:openFile': async (filters) => {
      const win = getWindow()
      const opts = { properties: ['openFile' as const], filters }
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return result.canceled ? undefined : result.filePaths[0]
    },
    'dialog:saveFile': async (defaultName, filters) => {
      const win = getWindow()
      const opts = { defaultPath: defaultName, filters }
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return result.canceled ? undefined : result.filePath
    },
    'shell:openExternal': async (url) => {
      if (!ALLOWED_EXTERNAL.test(url)) throw new SmclError('BlockedUrl', 'Only https links can be opened')
      await shell.openExternal(url)
    },
  }
}

export function registerIpc(ctx: SmclContext, getWindow: () => BrowserWindow | undefined) {
  const handlers = createHandlers(ctx, getWindow)
  for (const channel of SMCL_INVOKE_CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, async (_event, ...args): Promise<SmclResponse<unknown>> => {
      try {
        return { ok: true, data: await handler(...args) }
      } catch (e) {
        return { ok: false, error: toErrorPayload(e) }
      }
    })
  }
  ctx.bus.onAny((event, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(event, payload)
    }
  })
}
