import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types/ipc-channels'
import type { ElectronAPI, ImportProgressPayload } from './types'
import { stripIpcErrorPrefix } from '../shared/error-message'

const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    throw new Error(stripIpcErrorPrefix(error instanceof Error ? error.message : String(error)))
  })

const api: ElectronAPI = {
  connection: {
    test: (config) => invoke(IPC.CONNECTION_TEST, config),
    connect: (config) => invoke(IPC.CONNECTION_CONNECT, config),
    disconnect: (id) => invoke(IPC.CONNECTION_DISCONNECT, id),
    list: () => invoke(IPC.CONNECTION_LIST),
    save: (config) => invoke(IPC.CONNECTION_SAVE, config),
    delete: (id) => invoke(IPC.CONNECTION_DELETE, id),
  },
  query: {
    execute: (connId, sql, db, options) => invoke(IPC.QUERY_EXECUTE, connId, sql, db, options),
    executeMulti: (connId, sql, db, options) => invoke(IPC.QUERY_EXECUTE_MULTI, connId, sql, db, options),
    explain: (connId, sql, db, options) => invoke(IPC.QUERY_EXPLAIN, connId, sql, db, options),
    cancel: (connId, executionId) => invoke(IPC.QUERY_CANCEL, connId, executionId),
    format: (sql) => invoke(IPC.QUERY_FORMAT, sql),
  },
  meta: {
    databases: (connId) => invoke(IPC.META_DATABASES, connId),
    tables: (connId, db) => invoke(IPC.META_TABLES, connId, db),
    columns: (connId, db, table) => invoke(IPC.META_COLUMNS, connId, db, table),
    indexes: (connId, db, table) => invoke(IPC.META_INDEXES, connId, db, table),
    foreignKeys: (connId, db, table) => invoke(IPC.META_FOREIGN_KEYS, connId, db, table),
    tableDDL: (connId, db, table) => invoke(IPC.META_TABLE_DDL, connId, db, table),
    tableStatus: (connId, db) => invoke(IPC.META_TABLE_STATUS, connId, db),
    views: (connId, db) => invoke(IPC.META_VIEWS, connId, db),
    procedures: (connId, db) => invoke(IPC.META_PROCEDURES, connId, db),
    functions: (connId, db) => invoke(IPC.META_FUNCTIONS, connId, db),
    triggers: (connId, db) => invoke(IPC.META_TRIGGERS, connId, db),
    events: (connId, db) => invoke(IPC.META_EVENTS, connId, db),
  },
  design: {
    createTable: (connId, db, design) => invoke(IPC.DESIGN_CREATE_TABLE, connId, db, design),
    alterTable: (connId, db, tableName, diff, newDesign) => invoke(IPC.DESIGN_ALTER_TABLE, connId, db, tableName, diff, newDesign),
    dropTable: (connId, db, table) => invoke(IPC.DESIGN_DROP_TABLE, connId, db, table),
    diff: (oldDesign, newDesign) => invoke(IPC.DESIGN_DIFF, oldDesign, newDesign),
  },
  data: {
    insert: (connId, db, table, data) => invoke(IPC.DATA_INSERT, connId, db, table, data),
    update: (connId, db, table, data, where) => invoke(IPC.DATA_UPDATE, connId, db, table, data, where),
    delete: (connId, db, table, where) => invoke(IPC.DATA_DELETE, connId, db, table, where),
    batchInsert: (connId, db, table, rows) => invoke(IPC.DATA_BATCH_INSERT, connId, db, table, rows),
    batchUpdate: (connId, db, table, items) => invoke(IPC.DATA_BATCH_UPDATE, connId, db, table, items),
    batchDelete: (connId, db, table, wheres) => invoke(IPC.DATA_BATCH_DELETE, connId, db, table, wheres),
  },
  importExport: {
    importFile: (connId, db, table, filePath, options) => invoke(IPC.IMPORT_FILE, connId, db, table, filePath, options),
    preview: (filePath, options) => invoke(IPC.IMPORT_PREVIEW, filePath, options),
    exportData: (connId, db, sql, filePath, format, options) => invoke(IPC.EXPORT_DATA, connId, db, sql, filePath, format, options),
    exportStructure: (connId, db, tables, filePath) => invoke(IPC.EXPORT_STRUCTURE, connId, db, tables, filePath),
    cancel: (taskId) => invoke(IPC.IMPORT_EXPORT_CANCEL, taskId),
  },
  perf: {
    processList: (connId) => invoke(IPC.PERF_PROCESS_LIST, connId),
    innodbStatus: (connId) => invoke(IPC.PERF_INNODB_STATUS, connId),
    variables: (connId, filter) => invoke(IPC.PERF_VARIABLES, connId, filter),
    status: (connId, filter) => invoke(IPC.PERF_STATUS, connId, filter),
    reportMetric: (metric) => invoke(IPC.PERF_METRIC, metric),
  },
  backup: {
    create: (config) => invoke(IPC.BACKUP_CREATE, config),
    restore: (connId, filePath, options) => invoke(IPC.BACKUP_RESTORE, connId, filePath, options),
    list: (connId) => invoke(IPC.BACKUP_LIST, connId),
    schedule: (request) => invoke(IPC.BACKUP_SCHEDULE, request),
  },
  object: {
    search: (connId, db, keyword) => invoke(IPC.OBJECT_SEARCH, connId, db, keyword),
    createView: (connId, db, sql) => invoke(IPC.OBJECT_CREATE_VIEW, connId, db, sql),
    createProcedure: (connId, db, sql) => invoke(IPC.OBJECT_CREATE_PROCEDURE, connId, db, sql),
    createTrigger: (connId, db, sql) => invoke(IPC.OBJECT_CREATE_TRIGGER, connId, db, sql),
    createEvent: (connId, db, sql) => invoke(IPC.OBJECT_CREATE_EVENT, connId, db, sql),
    drop: (connId, db, type, name) => invoke(IPC.OBJECT_DROP, connId, db, type, name),
    execRoutine: (connId, db, name, type, params) => invoke(IPC.OBJECT_EXEC_ROUTINE, connId, db, name, type, params),
  },
  store: {
    getHistory: (connectionId, limit, offset) => invoke(IPC.STORE_GET_HISTORY, connectionId, limit, offset),
    saveHistory: (item) => invoke(IPC.STORE_SAVE_HISTORY, item),
    getSnippets: () => invoke(IPC.STORE_GET_SNIPPETS),
    saveSnippet: (snippet) => invoke(IPC.STORE_SAVE_SNIPPET, snippet),
    getSettings: (key) => invoke(IPC.STORE_GET_SETTINGS, key),
    saveSettings: (key, value) => invoke(IPC.STORE_SAVE_SETTINGS, key, value),
  },
  dialog: {
    saveFile: (options) => invoke('dialog:saveFile', options),
    writeFile: (filePath, content) => invoke('dialog:writeFile', filePath, content),
    openFile: (options) => invoke('dialog:openFile', options),
    readFile: (filePath) => invoke('dialog:readFile', filePath),
  },
  onImportProgress: (cb: (data: ImportProgressPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ImportProgressPayload) => cb(data)
    ipcRenderer.on(IPC.IMPORT_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.IMPORT_PROGRESS, handler)
  },
  onExportProgress: (cb: (data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => cb(data)
    ipcRenderer.on(IPC.EXPORT_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.EXPORT_PROGRESS, handler)
  },
  updater: {
    getState: () => invoke(IPC.APP_UPDATE_GET_STATE),
    check: () => invoke(IPC.APP_UPDATE_CHECK),
    download: () => invoke(IPC.APP_UPDATE_DOWNLOAD),
    install: () => invoke(IPC.APP_UPDATE_INSTALL),
    openRelease: () => invoke(IPC.APP_UPDATE_OPEN_RELEASE),
    onStateChanged: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.APP_UPDATE_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.APP_UPDATE_STATE_CHANGED, handler)
    },
  },
  win: {
    minimize: () => ipcRenderer.send(IPC.WIN_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.WIN_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.WIN_CLOSE),
    hideToTray: () => ipcRenderer.send(IPC.WIN_HIDE_TO_TRAY),
    quit: () => ipcRenderer.send(IPC.WIN_QUIT),
    isMaximized: () => invoke(IPC.WIN_IS_MAXIMIZED),
    setTheme: (theme: 'light' | 'dark') => ipcRenderer.send(IPC.WIN_SET_THEME, theme),
    onMaximized: (cb: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, v: boolean) => cb(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
