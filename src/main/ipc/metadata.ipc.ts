import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as meta from '../services/metadata'
import { isConnectionLostError } from '../services/connection-manager'
import { validateConnectionId, validateIdentifier } from '../utils/query-request'

function normalizeMetaError(err: any): Error {
  const msg = err?.message || String(err)
  if (isConnectionLostError(err)) {
    return new Error(`连接已失效，请重试或重新连接。(${msg})`)
  }
  return err instanceof Error ? err : new Error(msg)
}

export function registerMetadataIPC() {
  ipcMain.handle(IPC.META_DATABASES, async (_e, connId: string) => meta.getDatabases(validateConnectionId(connId)))
  ipcMain.handle(IPC.META_TABLES, async (_e, connId: string, db: string) => meta.getTables(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
  ipcMain.handle(IPC.META_COLUMNS, async (_e, connId: string, db: string, table: string) => meta.getColumns(validateConnectionId(connId), validateIdentifier(db, '数据库名'), validateIdentifier(table, '表名')))
  ipcMain.handle(IPC.META_INDEXES, async (_e, connId: string, db: string, table: string) => meta.getIndexes(validateConnectionId(connId), validateIdentifier(db, '数据库名'), validateIdentifier(table, '表名')))
  ipcMain.handle(IPC.META_FOREIGN_KEYS, async (_e, connId: string, db: string, table: string) => meta.getForeignKeys(validateConnectionId(connId), validateIdentifier(db, '数据库名'), validateIdentifier(table, '表名')))
  ipcMain.handle(IPC.META_TABLE_DDL, async (_e, connId: string, db: string, table: string) => meta.getTableDDL(validateConnectionId(connId), validateIdentifier(db, '数据库名'), validateIdentifier(table, '表名')))
  ipcMain.handle(IPC.META_TABLE_STATUS, async (_e, connId: string, db: string) => {
    try {
      return await meta.getTableStatus(validateConnectionId(connId), validateIdentifier(db, '数据库名'))
    } catch (err: any) {
      throw normalizeMetaError(err)
    }
  })
  ipcMain.handle(IPC.META_VIEWS, async (_e, connId: string, db: string) => meta.getViews(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
  ipcMain.handle(IPC.META_PROCEDURES, async (_e, connId: string, db: string) => meta.getProcedures(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
  ipcMain.handle(IPC.META_FUNCTIONS, async (_e, connId: string, db: string) => meta.getFunctions(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
  ipcMain.handle(IPC.META_TRIGGERS, async (_e, connId: string, db: string) => meta.getTriggers(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
  ipcMain.handle(IPC.META_EVENTS, async (_e, connId: string, db: string) => meta.getEvents(validateConnectionId(connId), validateIdentifier(db, '数据库名')))
}
