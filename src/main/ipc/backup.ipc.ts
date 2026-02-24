import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as backup from '../services/backup'
import * as localStore from '../services/local-store'

export function registerBackupIPC() {
  ipcMain.handle(IPC.BACKUP_CREATE, async (_e, config) => {
    return backup.createBackup(config)
  })

  ipcMain.handle(IPC.BACKUP_RESTORE, async (_e, connId: string, filePath: string) => {
    return backup.restoreBackup(connId, filePath)
  })

  ipcMain.handle(IPC.BACKUP_LIST, async (_e, connId: string) => {
    return backup.listBackups(connId)
  })

  ipcMain.handle(IPC.BACKUP_SCHEDULE, async (_e, schedule) => {
    localStore.backupSchedules.save(schedule)
  })
}
