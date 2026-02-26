import { app, BrowserWindow, nativeTheme, ipcMain } from 'electron'
import * as path from 'path'
import * as localStore from './services/local-store'
import * as connectionManager from './services/connection-manager'
import { registerAllIPC } from './ipc/index'
import * as logger from './utils/logger'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const isDark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: isDark ? '#171c28' : '#f5f7fa',
    icon: path.join(__dirname, '../../resources/icon.png'),
    frame: false,
    transparent: false,
    thickFrame: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  logger.info('App starting...')
  localStore.init()
  registerAllIPC()

  // Window control IPC
  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.close())
  ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized() ?? false)

  createWindow()

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('native-theme-changed', nativeTheme.shouldUseDarkColors)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  logger.info('App quitting, cleaning up...')
  await connectionManager.disconnectAll()
})
