import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as backup from '../services/backup'
import * as path from 'path'
import { validateFilePathString } from '../utils/import-export-request'
import { validateConnectionId } from '../utils/query-request'
import { validateBackupCreateRequest, validateBackupRestoreOptions, validateBackupScheduleRequest } from '../utils/backup-request'

export function registerBackupIPC() {
  ipcMain.handle(IPC.BACKUP_CREATE, async (_e, config) => {
    return backup.createBackup(validateBackupCreateRequest(config))
  })

  ipcMain.handle(IPC.BACKUP_RESTORE, async (_e, connId: string, filePath: string, options) => {
    const validPath = validateFilePathString(filePath)
    const lower = validPath.toLowerCase()
    if (path.extname(lower) !== '.sql' && !lower.endsWith('.sql.gz')) throw new Error('恢复文件必须是 .sql 或 .sql.gz')
    return backup.restoreBackup(validateConnectionId(connId), validPath, validateBackupRestoreOptions(options))
  })

  ipcMain.handle(IPC.BACKUP_LIST, async (_e, connId: string) => {
    return backup.listBackups(validateConnectionId(connId))
  })

  ipcMain.handle(IPC.BACKUP_SCHEDULE, async (_e, request) => {
    return backup.handleScheduleRequest(validateBackupScheduleRequest(request))
  })
}
