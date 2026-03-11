import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { IPC } from '../shared/types/ipc-channels'
import { registerAllIPC } from './ipc/index'
import * as connectionManager from './services/connection-manager'
import * as localStore from './services/local-store'
import * as logger from './utils/logger'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const getAppIconPath = () => {
  const candidates = [
    process.platform === 'win32' ? path.join(process.resourcesPath, 'icon.ico') : '',
    path.join(process.resourcesPath, 'icon.png'),
    path.join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png'),
    path.join(__dirname, '../../resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    path.join(__dirname, '../../resources/icon.png')
  ].filter(Boolean)

  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) {
      continue
    }

    const image = nativeImage.createFromPath(iconPath)
    if (!image.isEmpty()) {
      return iconPath
    }
  }

  return path.join(__dirname, '../../resources/icon.png')
}

const showAndFocusMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  if (tray) {
    return
  }

  try {
    const iconPath = getAppIconPath()
    const icon = nativeImage.createFromPath(iconPath)

    if (icon.isEmpty()) {
      logger.error(`Tray icon is empty: ${iconPath}`)
      return
    }

    tray = new Tray(icon)
    tray.setToolTip('MySQL 连接工具')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开',
          click: () => showAndFocusMainWindow(),
        },
        {
          type: 'separator',
        },
        {
          label: '退出',
          click: () => {
            isQuitting = true
            app.quit()
          },
        },
      ]),
    )

    tray.on('double-click', () => {
      showAndFocusMainWindow()
    })
  } catch (error) {
    logger.error('Failed to create tray', error)
  }
}

function createWindow() {
  const isDark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: isDark ? '#171c28' : '#f5f7fa',
    icon: getAppIconPath(),
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

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('win:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('win:maximized', false))

  // 生产环境禁用 Ctrl+R 刷新功能
  if (!process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'r' && (input.control || input.meta)) {
        event.preventDefault()
      }
    })
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  logger.info('App starting...')
  localStore.init()
  connectionManager.initializeHeartbeatInterval()
  registerAllIPC()

  // Window control IPC
  ipcMain.on(IPC.WIN_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IPC.WIN_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on(IPC.WIN_CLOSE, () => mainWindow?.close())
  ipcMain.on(IPC.WIN_HIDE_TO_TRAY, () => mainWindow?.hide())
  ipcMain.on(IPC.WIN_QUIT, () => {
    isQuitting = true
    app.quit()
  })
  ipcMain.handle(IPC.WIN_IS_MAXIMIZED, () => mainWindow?.isMaximized() ?? false)

  createWindow()
  createTray()

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('native-theme-changed', nativeTheme.shouldUseDarkColors)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      showAndFocusMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  isQuitting = true
  logger.info('App quitting, cleaning up...')
  tray?.destroy()
  tray = null
  localStore.flushLocalStoreQueues()
  await connectionManager.disconnectAll()
})
