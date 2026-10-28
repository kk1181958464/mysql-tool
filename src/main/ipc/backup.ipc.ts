import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as backup from '../services/backup'
import * as path from 'path'
import { validateFilePathString } from '../utils/import-export-request'
import { requireFileAccess } from '../utils/file-access'
import { validateConnectionId } from '../utils/query-request'
import { validateBackupCreateRequest, validateBackupRestoreOptions, validateBackupScheduleRequest } from '../utils/backup-request'

export function registerBackupIPC() {
  ipcMain.handle(IPC.BACKUP_CREATE, async (e, config) => {
    const request = validateBackupCreateRequest(config)
    if (request.filePath) requireFileAccess(e.sender, 'write', request.filePath)
    return backup.createBackup(request)
  })

  ipcMain.handle(IPC.BACKUP_RESTORE, async (e, connId: string, filePath: string, options) => {
    const validConnId = validateConnectionId(connId)
    const validPath = validateFilePathString(filePath)
    const lower = validPath.toLowerCase()
    if (path.extname(lower) !== '.sql' && !lower.endsWith('.sql.gz')) throw new Error('恢复文件必须是 .sql 或 .sql.gz')
    const known = (await backup.listBackups(validConnId)).some((record) => path.resolve(record.filePath).toLowerCase() === path.resolve(validPath).toLowerCase())
    if (!known) requireFileAccess(e.sender, 'read', validPath)
    return backup.restoreBackup(validConnId, validPath, validateBackupRestoreOptions(options))
  })

  ipcMain.handle(IPC.BACKUP_LIST, async (_e, connId: string) => {
    return backup.listBackups(validateConnectionId(connId))
  })

  ipcMain.handle(IPC.BACKUP_SCHEDULE, async (_e, request) => {
    return backup.handleScheduleRequest(validateBackupScheduleRequest(request))
  })
}
