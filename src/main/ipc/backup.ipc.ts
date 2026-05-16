import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as backup from '../services/backup'

export function registerBackupIPC() {
  ipcMain.handle(IPC.BACKUP_CREATE, async (_e, config) => {
    return backup.createBackup(config)
  })

  ipcMain.handle(IPC.BACKUP_RESTORE, async (_e, connId: string, filePath: string, options) => {
    return backup.restoreBackup(connId, filePath, options)
  })

  ipcMain.handle(IPC.BACKUP_LIST, async (_e, connId: string) => {
    return backup.listBackups(connId)
  })

  ipcMain.handle(IPC.BACKUP_SCHEDULE, async (_e, request) => {
    return backup.handleScheduleRequest(request)
  })
}
