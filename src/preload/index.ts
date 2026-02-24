import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types/ipc-channels'
import type { ElectronAPI } from './types'

const api: ElectronAPI = {
  connection: {
    test: (config) => ipcRenderer.invoke(IPC.CONNECTION_TEST, config),
    connect: (config) => ipcRenderer.invoke(IPC.CONNECTION_CONNECT, config),
    disconnect: (id) => ipcRenderer.invoke(IPC.CONNECTION_DISCONNECT, id),
    list: () => ipcRenderer.invoke(IPC.CONNECTION_LIST),
    save: (config) => ipcRenderer.invoke(IPC.CONNECTION_SAVE, config),
    delete: (id) => ipcRenderer.invoke(IPC.CONNECTION_DELETE, id),
  },
  query: {
    execute: (connId, sql, db) => ipcRenderer.invoke(IPC.QUERY_EXECUTE, connId, sql, db),
    executeMulti: (connId, sql, db) => ipcRenderer.invoke(IPC.QUERY_EXECUTE_MULTI, connId, sql, db),
    explain: (connId, sql, db) => ipcRenderer.invoke(IPC.QUERY_EXPLAIN, connId, sql, db),
    cancel: (connId) => ipcRenderer.invoke(IPC.QUERY_CANCEL, connId),
    format: (sql) => ipcRenderer.invoke(IPC.QUERY_FORMAT, sql),
  },
  meta: {
    databases: (connId) => ipcRenderer.invoke(IPC.META_DATABASES, connId),
    tables: (connId, db) => ipcRenderer.invoke(IPC.META_TABLES, connId, db),
    columns: (connId, db, table) => ipcRenderer.invoke(IPC.META_COLUMNS, connId, db, table),
    indexes: (connId, db, table) => ipcRenderer.invoke(IPC.META_INDEXES, connId, db, table),
    foreignKeys: (connId, db, table) => ipcRenderer.invoke(IPC.META_FOREIGN_KEYS, connId, db, table),
    tableDDL: (connId, db, table) => ipcRenderer.invoke(IPC.META_TABLE_DDL, connId, db, table),
    tableStatus: (connId, db) => ipcRenderer.invoke(IPC.META_TABLE_STATUS, connId, db),
    views: (connId, db) => ipcRenderer.invoke(IPC.META_VIEWS, connId, db),
    procedures: (connId, db) => ipcRenderer.invoke(IPC.META_PROCEDURES, connId, db),
    functions: (connId, db) => ipcRenderer.invoke(IPC.META_FUNCTIONS, connId, db),
    triggers: (connId, db) => ipcRenderer.invoke(IPC.META_TRIGGERS, connId, db),
    events: (connId, db) => ipcRenderer.invoke(IPC.META_EVENTS, connId, db),
  },
  design: {
    createTable: (connId, db, design) => ipcRenderer.invoke(IPC.DESIGN_CREATE_TABLE, connId, db, design),
    alterTable: (connId, db, tableName, diff) => ipcRenderer.invoke(IPC.DESIGN_ALTER_TABLE, connId, db, tableName, diff),
    dropTable: (connId, db, table) => ipcRenderer.invoke(IPC.DESIGN_DROP_TABLE, connId, db, table),
    diff: (oldDesign, newDesign) => ipcRenderer.invoke(IPC.DESIGN_DIFF, oldDesign, newDesign),
  },
  data: {
    insert: (connId, db, table, data) => ipcRenderer.invoke(IPC.DATA_INSERT, connId, db, table, data),
    update: (connId, db, table, data, where) => ipcRenderer.invoke(IPC.DATA_UPDATE, connId, db, table, data, where),
    delete: (connId, db, table, where) => ipcRenderer.invoke(IPC.DATA_DELETE, connId, db, table, where),
  },
  importExport: {
    importFile: (connId, db, table, filePath, options) => ipcRenderer.invoke(IPC.IMPORT_FILE, connId, db, table, filePath, options),
    preview: (filePath) => ipcRenderer.invoke(IPC.IMPORT_PREVIEW, filePath),
    exportData: (connId, db, sql, filePath, format, options) => ipcRenderer.invoke(IPC.EXPORT_DATA, connId, db, sql, filePath, format, options),
    exportStructure: (connId, db, tables, filePath) => ipcRenderer.invoke(IPC.EXPORT_STRUCTURE, connId, db, tables, filePath),
  },
  perf: {
    processList: (connId) => ipcRenderer.invoke(IPC.PERF_PROCESS_LIST, connId),
    innodbStatus: (connId) => ipcRenderer.invoke(IPC.PERF_INNODB_STATUS, connId),
    variables: (connId, filter) => ipcRenderer.invoke(IPC.PERF_VARIABLES, connId, filter),
    status: (connId, filter) => ipcRenderer.invoke(IPC.PERF_STATUS, connId, filter),
  },
  backup: {
    create: (config) => ipcRenderer.invoke(IPC.BACKUP_CREATE, config),
    restore: (connId, filePath) => ipcRenderer.invoke(IPC.BACKUP_RESTORE, connId, filePath),
    list: (connId) => ipcRenderer.invoke(IPC.BACKUP_LIST, connId),
    schedule: (schedule) => ipcRenderer.invoke(IPC.BACKUP_SCHEDULE, schedule),
  },
  object: {
    search: (connId, db, keyword) => ipcRenderer.invoke(IPC.OBJECT_SEARCH, connId, db, keyword),
    createView: (connId, db, sql) => ipcRenderer.invoke(IPC.OBJECT_CREATE_VIEW, connId, db, sql),
    createProcedure: (connId, db, sql) => ipcRenderer.invoke(IPC.OBJECT_CREATE_PROCEDURE, connId, db, sql),
    createTrigger: (connId, db, sql) => ipcRenderer.invoke(IPC.OBJECT_CREATE_TRIGGER, connId, db, sql),
    createEvent: (connId, db, sql) => ipcRenderer.invoke(IPC.OBJECT_CREATE_EVENT, connId, db, sql),
    drop: (connId, db, type, name) => ipcRenderer.invoke(IPC.OBJECT_DROP, connId, db, type, name),
  },
  store: {
    getHistory: (connectionId, limit) => ipcRenderer.invoke(IPC.STORE_GET_HISTORY, connectionId, limit),
    saveHistory: (item) => ipcRenderer.invoke(IPC.STORE_SAVE_HISTORY, item),
    getSnippets: () => ipcRenderer.invoke(IPC.STORE_GET_SNIPPETS),
    saveSnippet: (snippet) => ipcRenderer.invoke(IPC.STORE_SAVE_SNIPPET, snippet),
    getSettings: (key) => ipcRenderer.invoke(IPC.STORE_GET_SETTINGS, key),
    saveSettings: (key, value) => ipcRenderer.invoke(IPC.STORE_SAVE_SETTINGS, key, value),
  },
  dialog: {
    saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
    writeFile: (filePath, content) => ipcRenderer.invoke('dialog:writeFile', filePath, content),
    openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
    readFile: (filePath) => ipcRenderer.invoke('dialog:readFile', filePath),
  },
  onImportProgress: (cb: (data: { current: number; total: number; fail: number }) => void) => {
    const handler = (_: any, data: any) => cb(data)
    ipcRenderer.on('import:progress', handler)
    return () => ipcRenderer.removeListener('import:progress', handler)
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (maximized: boolean) => void) => {
      const handler = (_: any, v: boolean) => cb(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
