import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as queryExecutor from '../services/query-executor'
import { cancelMultiStatementSql, executeMultiStatementSql, type ExecuteMultiOptions } from '../services/sql-script-executor'
import { format } from 'sql-formatter'
import {
  validateConnectionId,
  validateDatabase,
  validateMultiOptions,
  validateOptionalExecutionId,
  validateQueryOptions,
  validateSql,
} from '../utils/query-request'

export function registerQueryIPC() {
  ipcMain.handle(IPC.QUERY_EXECUTE, async (_e, connectionId: string, sql: string, database?: string, options?: { executionId?: string }) => {
    return queryExecutor.execute(validateConnectionId(connectionId), validateSql(sql), validateDatabase(database), validateQueryOptions(options))
  })

  ipcMain.handle(IPC.QUERY_EXECUTE_MULTI, async (_e, connectionId: string, sql: string, database?: string, options?: ExecuteMultiOptions) => {
    const sender = _e.sender
    return executeMultiStatementSql(validateConnectionId(connectionId), validateSql(sql, true), validateDatabase(database), validateMultiOptions(options), (payload) => {
      const window = BrowserWindow.fromWebContents(sender)
      if (!window?.isDestroyed()) {
        sender.send('import:progress', payload)
      }
    })
  })

  ipcMain.handle(IPC.QUERY_EXPLAIN, async (_e, connectionId: string, sql: string, database?: string, options?: { executionId?: string }) => {
    return queryExecutor.explain(validateConnectionId(connectionId), validateSql(sql), validateDatabase(database), validateQueryOptions(options))
  })

  ipcMain.handle(IPC.QUERY_CANCEL, async (_e, connectionId: string, executionId?: string) => {
    const validConnectionId = validateConnectionId(connectionId)
    const validExecutionId = validateOptionalExecutionId(executionId)
    cancelMultiStatementSql(validConnectionId, validExecutionId)
    return queryExecutor.cancel(validConnectionId, validExecutionId)
  })

  ipcMain.handle(IPC.QUERY_FORMAT, async (_e, sql: string) => {
    return format(validateSql(sql), { language: 'mysql' })
  })
}
