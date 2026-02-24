import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as meta from '../services/metadata'

export function registerMetadataIPC() {
  ipcMain.handle(IPC.META_DATABASES, async (_e, connId: string) => meta.getDatabases(connId))
  ipcMain.handle(IPC.META_TABLES, async (_e, connId: string, db: string) => meta.getTables(connId, db))
  ipcMain.handle(IPC.META_COLUMNS, async (_e, connId: string, db: string, table: string) => meta.getColumns(connId, db, table))
  ipcMain.handle(IPC.META_INDEXES, async (_e, connId: string, db: string, table: string) => meta.getIndexes(connId, db, table))
  ipcMain.handle(IPC.META_FOREIGN_KEYS, async (_e, connId: string, db: string, table: string) => meta.getForeignKeys(connId, db, table))
  ipcMain.handle(IPC.META_TABLE_DDL, async (_e, connId: string, db: string, table: string) => meta.getTableDDL(connId, db, table))
  ipcMain.handle(IPC.META_TABLE_STATUS, async (_e, connId: string, db: string) => meta.getTableStatus(connId, db))
  ipcMain.handle(IPC.META_VIEWS, async (_e, connId: string, db: string) => meta.getViews(connId, db))
  ipcMain.handle(IPC.META_PROCEDURES, async (_e, connId: string, db: string) => meta.getProcedures(connId, db))
  ipcMain.handle(IPC.META_FUNCTIONS, async (_e, connId: string, db: string) => meta.getFunctions(connId, db))
  ipcMain.handle(IPC.META_TRIGGERS, async (_e, connId: string, db: string) => meta.getTriggers(connId, db))
  ipcMain.handle(IPC.META_EVENTS, async (_e, connId: string, db: string) => meta.getEvents(connId, db))
}
