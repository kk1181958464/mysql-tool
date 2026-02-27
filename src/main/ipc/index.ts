import { ipcMain, dialog } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import { IPC } from '../../shared/types/ipc-channels'
import * as perf from '../services/performance'
import * as meta from '../services/metadata'
import * as connectionManager from '../services/connection-manager'
import * as localStore from '../services/local-store'
import { registerConnectionIPC } from './connection.ipc'
import { registerQueryIPC } from './query.ipc'
import { registerMetadataIPC } from './metadata.ipc'
import { registerTableDesignIPC } from './table-design.ipc'
import { registerImportExportIPC } from './import-export.ipc'
import { registerBackupIPC } from './backup.ipc'

export function registerAllIPC() {
  registerConnectionIPC()
  registerQueryIPC()
  registerMetadataIPC()
  registerTableDesignIPC()
  registerImportExportIPC()
  registerBackupIPC()

  // Performance
  ipcMain.handle(IPC.PERF_PROCESS_LIST, async (_e, connId: string) => perf.getProcessList(connId))
  ipcMain.handle(IPC.PERF_INNODB_STATUS, async (_e, connId: string) => perf.getInnoDBStatus(connId))
  ipcMain.handle(IPC.PERF_VARIABLES, async (_e, connId: string, filter?: string) => perf.getVariables(connId, filter))
  ipcMain.handle(IPC.PERF_STATUS, async (_e, connId: string, filter?: string) => perf.getGlobalStatus(connId, filter))

  // Object operations
  ipcMain.handle(IPC.OBJECT_SEARCH, async (_e, connId: string, db: string, keyword: string) => meta.searchObjects(connId, db, keyword))

  ipcMain.handle(IPC.OBJECT_CREATE_VIEW, async (_e, connId: string, db: string, sql: string) => {
    const conn = await connectionManager.getConnection(connId)
    try { await conn.query(`USE \`${db}\``); await conn.query(sql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_PROCEDURE, async (_e, connId: string, db: string, sql: string) => {
    const conn = await connectionManager.getConnection(connId)
    try { await conn.query(`USE \`${db}\``); await conn.query(sql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_TRIGGER, async (_e, connId: string, db: string, sql: string) => {
    const conn = await connectionManager.getConnection(connId)
    try { await conn.query(`USE \`${db}\``); await conn.query(sql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_EVENT, async (_e, connId: string, db: string, sql: string) => {
    const conn = await connectionManager.getConnection(connId)
    try { await conn.query(`USE \`${db}\``); await conn.query(sql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_DROP, async (_e, connId: string, db: string, type: string, name: string) => {
    const conn = await connectionManager.getConnection(connId)
    try { await conn.query(`USE \`${db}\``); await conn.query(`DROP ${type} IF EXISTS \`${name}\``) } finally { conn.release() }
  })

  // Store operations
  ipcMain.handle(IPC.STORE_GET_HISTORY, async (_e, connectionId: string, limit?: number) => localStore.queryHistory.getByConnection(connectionId, limit))
  ipcMain.handle(IPC.STORE_SAVE_HISTORY, async (_e, item) => localStore.queryHistory.save(item))
  ipcMain.handle(IPC.STORE_GET_SNIPPETS, async () => localStore.snippets.getAll())
  ipcMain.handle(IPC.STORE_SAVE_SNIPPET, async (_e, snippet) => localStore.snippets.save(snippet))
  ipcMain.handle(IPC.STORE_GET_SETTINGS, async (_e, key: string) => localStore.settings.get(key))
  ipcMain.handle(IPC.STORE_SAVE_SETTINGS, async (_e, key: string, value: string) => {
    localStore.settings.set(key, value)

    if (key === 'heartbeatIntervalSeconds') {
      const effective = connectionManager.updateHeartbeatInterval(Number(value))
      if (String(effective) !== value) {
        localStore.settings.set(key, String(effective))
      }
    }
  })

  // Dialog
  ipcMain.handle('dialog:saveFile', async (_e, options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showSaveDialog({ defaultPath: options.defaultPath, filters: options.filters })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('dialog:writeFile', async (_e, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('dialog:openFile', async (_e, options: { filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showOpenDialog({ filters: options.filters, properties: ['openFile'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:readFile', async (_e, filePath: string) => {
    return await readFile(filePath, 'utf-8')
  })
}
