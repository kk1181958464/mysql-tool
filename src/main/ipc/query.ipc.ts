import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as queryExecutor from '../services/query-executor'
import { cancelMultiStatementSql, executeMultiStatementSql, type ExecuteMultiOptions } from '../services/sql-script-executor'
import { format } from 'sql-formatter'

export function registerQueryIPC() {
  ipcMain.handle(IPC.QUERY_EXECUTE, async (_e, connectionId: string, sql: string, database?: string, options?: { executionId?: string }) => {
    return queryExecutor.execute(connectionId, sql, database, options)
  })

  ipcMain.handle(IPC.QUERY_EXECUTE_MULTI, async (_e, connectionId: string, sql: string, database?: string, options?: ExecuteMultiOptions) => {
    const sender = _e.sender
    return executeMultiStatementSql(connectionId, sql, database, options, (payload) => {
      const window = BrowserWindow.fromWebContents(sender)
      if (!window?.isDestroyed()) {
        sender.send('import:progress', payload)
      }
    })
  })

  ipcMain.handle(IPC.QUERY_EXPLAIN, async (_e, connectionId: string, sql: string, database?: string, options?: { executionId?: string }) => {
    return queryExecutor.explain(connectionId, sql, database, options)
  })

  ipcMain.handle(IPC.QUERY_CANCEL, async (_e, connectionId: string, executionId?: string) => {
    cancelMultiStatementSql(connectionId, executionId)
    return queryExecutor.cancel(connectionId, executionId)
  })

  ipcMain.handle(IPC.QUERY_FORMAT, async (_e, sql: string) => {
    return format(sql, { language: 'mysql' })
  })
}
