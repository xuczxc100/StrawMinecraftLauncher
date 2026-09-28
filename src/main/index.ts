import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { createContext } from './context'
import { registerIpc } from './ipc'
import { plainSecretStore, type SecretStore } from './services/AccountService'

const here = dirname(fileURLToPath(import.meta.url))

if (process.env.SMCL_DATA_DIR) app.setPath('userData', process.env.SMCL_DATA_DIR)

const electronSecretStore: SecretStore = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) return plainSecretStore.encrypt(plain)
    return `safe:${safeStorage.encryptString(plain).toString('base64')}`
  },
  decrypt(cipher) {
    if (!cipher.startsWith('safe:')) return plainSecretStore.decrypt(cipher)
    return safeStorage.decryptString(Buffer.from(cipher.slice(5), 'base64'))
  },
}

let mainWindow: BrowserWindow | undefined

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'StrawMinecraftLauncher',
    backgroundColor: '#15171b',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(here, '../../resources/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) event.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  mainWindow = win
  return win
}

async function bootstrap() {
  await app.whenReady()
  const ctx = await createContext({
    dataRoot: app.getPath('userData'),
    version: app.getVersion(),
    secrets: electronSecretStore,
    launchHooks: {
      onGameStarted: () => {
        if (ctx.config.get().closeOnLaunch) mainWindow?.hide()
      },
      onAllGamesExited: () => {
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show()
      },
    },
  })
  registerIpc(ctx, () => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const gotLock = process.env.SMCL_ALLOW_MULTI === '1' || app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  bootstrap().catch((e) => {
    console.error('SMCL failed to start', e)
    app.exit(1)
  })
}
