import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC } from '../../shared/types/ipc-channels'
import type { AppUpdateState } from '../../shared/types/app-update'
import * as logger from '../utils/logger'

const RELEASES_URL = 'https://github.com/kk1181958464/mysql-tool/releases/latest'
const STARTUP_CHECK_DELAY_MS = 5_000

let initialized = false
let startupTimer: NodeJS.Timeout | null = null
let beforeInstall: (() => Promise<void>) | null = null
let state: AppUpdateState = createInitialState()

function createInitialState(): AppUpdateState {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE)
  return {
    status: !app.isPackaged || portable ? 'unsupported' : 'idle',
    currentVersion: app.getVersion(),
    portable,
  }
}

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return notes.trim() || undefined
  if (!Array.isArray(notes)) return undefined
  const normalized = notes
    .map((item) => item.note?.trim())
    .filter((item): item is string => Boolean(item))
    .join('\n\n')
  return normalized || undefined
}

function broadcastState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.APP_UPDATE_STATE_CHANGED, state)
    }
  }
}

function updateState(next: Partial<AppUpdateState>): AppUpdateState {
  state = { ...state, ...next }
  broadcastState()
  return state
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error || '更新失败')
}

async function checkForUpdates(): Promise<AppUpdateState> {
  if (!app.isPackaged || state.portable) {
    return updateState({ status: 'unsupported' })
  }

  updateState({ status: 'checking', error: undefined, progress: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    logger.error('Failed to check for updates', error)
    updateState({ status: 'error', error: toErrorMessage(error) })
  }
  return state
}

async function downloadUpdate(): Promise<AppUpdateState> {
  if (state.status !== 'available' && state.status !== 'error') return state
  updateState({ status: 'downloading', error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    logger.error('Failed to download update', error)
    updateState({ status: 'error', error: toErrorMessage(error) })
  }
  return state
}

async function installUpdate(): Promise<void> {
  if (state.status !== 'downloaded') return
  if (beforeInstall) await beforeInstall()
  autoUpdater.quitAndInstall(false, true)
}

export function initializeAppUpdater(options: { beforeInstall?: () => Promise<void> } = {}): void {
  if (initialized) return
  initialized = true
  beforeInstall = options.beforeInstall || null
  state = createInitialState()

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    updateState({ status: 'checking', error: undefined })
  })
  autoUpdater.on('update-available', (info) => {
    updateState({
      status: 'available',
      version: info.version,
      releaseName: info.releaseName || undefined,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progress: undefined,
      error: undefined,
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    updateState({
      status: 'not-available',
      version: info.version,
      releaseName: info.releaseName || undefined,
      releaseNotes: undefined,
      progress: undefined,
      error: undefined,
    })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateState({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
      error: undefined,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateState({
      status: 'downloaded',
      version: info.version,
      releaseName: info.releaseName || undefined,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progress: state.progress ? { ...state.progress, percent: 100 } : undefined,
      error: undefined,
    })
  })
  autoUpdater.on('error', (error) => {
    logger.error('Auto updater error', error)
    updateState({ status: 'error', error: toErrorMessage(error) })
  })

  ipcMain.handle(IPC.APP_UPDATE_GET_STATE, () => state)
  ipcMain.handle(IPC.APP_UPDATE_CHECK, () => checkForUpdates())
  ipcMain.handle(IPC.APP_UPDATE_DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IPC.APP_UPDATE_INSTALL, () => installUpdate())
  ipcMain.handle(IPC.APP_UPDATE_OPEN_RELEASE, () => shell.openExternal(RELEASES_URL))
}

export function scheduleStartupUpdateCheck(): void {
  if (startupTimer || !app.isPackaged || state.portable) return
  startupTimer = setTimeout(() => {
    startupTimer = null
    void checkForUpdates()
  }, STARTUP_CHECK_DELAY_MS)
  startupTimer.unref()
}
