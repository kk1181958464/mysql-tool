import { BrowserWindow, ipcMain, dialog, type WebContents } from 'electron'
import { writeFile, readFile, stat } from 'fs/promises'
import * as path from 'path'
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
import { quoteId } from '../utils/sql'
import {
  HEARTBEAT_SETTING_KEY,
  HEARTBEAT_TIMEOUT_SETTING_KEY,
  HEARTBEAT_CONCURRENCY_SETTING_KEY,
  HEARTBEAT_AUTOTUNE_SETTING_KEY,
} from '../../shared/constants'
import * as logger from '../utils/logger'
import { validateConnectionId } from '../utils/query-request'
import { validateHistoryItem, validateHistoryPage, validateOptionalFilter, validateSettingKey, validateSettingValue, validateSnippet } from '../utils/store-request'
import { validateFileContent, validateOpenDialogOptions, validateSaveDialogOptions } from '../utils/dialog-request'

type FileAccess = 'read' | 'write'
type DroppableObjectType = 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TRIGGER' | 'EVENT'

const fileAccessGrants = new WeakMap<WebContents, Record<FileAccess, Set<string>>>()
const DROPPABLE_OBJECT_TYPES = new Set<DroppableObjectType>(['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT'])
const MAX_SQL_LENGTH = 2 * 1024 * 1024
const MAX_ROUTINE_PARAMS = 1024

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`${label}必须是字符串`)
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label}不能为空`)
  }
  if (value.length > maxLength) {
    throw new Error(`${label}长度不能超过 ${maxLength} 个字符`)
  }
  return value
}

function requireIdentifier(value: unknown, label: string): string {
  return requireString(value, label, 64)
}

function requireSql(value: unknown): string {
  return requireString(value, 'SQL', MAX_SQL_LENGTH)
}

function requireDroppableObjectType(value: unknown): DroppableObjectType {
  if (typeof value !== 'string') {
    throw new Error('对象类型无效')
  }
  const normalized = value.toUpperCase() as DroppableObjectType
  if (!DROPPABLE_OBJECT_TYPES.has(normalized)) {
    throw new Error(`不支持的对象类型: ${value}`)
  }
  return normalized
}

function requireRoutineType(value: unknown): 'PROCEDURE' | 'FUNCTION' {
  const normalized = requireDroppableObjectType(value)
  if (normalized !== 'PROCEDURE' && normalized !== 'FUNCTION') {
    throw new Error(`不支持的例程类型: ${value}`)
  }
  return normalized
}

function requireRoutineParams(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ROUTINE_PARAMS) {
    throw new Error(`例程参数必须是数组且不能超过 ${MAX_ROUTINE_PARAMS} 项`)
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`例程参数 ${index + 1} 必须是字符串`)
    }
    if (item.length > 64 * 1024) {
      throw new Error(`例程参数 ${index + 1} 过长`)
    }
    return item
  })
}

function normalizeGrantedPath(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function getFileAccessGrants(sender: WebContents): Record<FileAccess, Set<string>> {
  let grants = fileAccessGrants.get(sender)
  if (!grants) {
    grants = { read: new Set(), write: new Set() }
    fileAccessGrants.set(sender, grants)
  }
  return grants
}

function grantFileAccess(sender: WebContents, access: FileAccess, filePath: string): void {
  getFileAccessGrants(sender)[access].add(normalizeGrantedPath(filePath))
}

function consumeFileAccess(sender: WebContents, access: FileAccess, filePath: string): void {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('文件路径无效')
  }

  const normalized = normalizeGrantedPath(filePath)
  const grants = getFileAccessGrants(sender)[access]
  if (!grants.delete(normalized)) {
    throw new Error('文件路径未经系统对话框授权')
  }
}

export function registerAllIPC() {
  registerConnectionIPC()
  registerQueryIPC()
  registerMetadataIPC()
  registerTableDesignIPC()
  registerImportExportIPC()
  registerBackupIPC()

  // Performance
  ipcMain.handle(IPC.PERF_PROCESS_LIST, async (_e, connId: string) => perf.getProcessList(validateConnectionId(connId)))
  ipcMain.handle(IPC.PERF_INNODB_STATUS, async (_e, connId: string) => perf.getInnoDBStatus(validateConnectionId(connId)))
  ipcMain.handle(IPC.PERF_VARIABLES, async (_e, connId: string, filter?: string) => perf.getVariables(validateConnectionId(connId), validateOptionalFilter(filter)))
  ipcMain.handle(IPC.PERF_STATUS, async (_e, connId: string, filter?: string) => perf.getGlobalStatus(validateConnectionId(connId), validateOptionalFilter(filter)))
  ipcMain.handle(IPC.PERF_METRIC, async () => {
    // 性能指标采集保留调用链，默认不落日志，避免控制台噪音
  })

  // Object operations
  ipcMain.handle(IPC.OBJECT_SEARCH, async (_e, connId: string, db: string, keyword: string) => {
    return meta.searchObjects(
      requireString(connId, '连接 ID', 256),
      requireIdentifier(db, '数据库名'),
      requireString(keyword, '搜索词', 256),
    )
  })

  ipcMain.handle(IPC.OBJECT_CREATE_VIEW, async (_e, connId: string, db: string, sql: string) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validSql = requireSql(sql)
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try { await conn.query(`USE ${quoteId(validDb)}`); await conn.query(validSql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_PROCEDURE, async (_e, connId: string, db: string, sql: string) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validSql = requireSql(sql)
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try { await conn.query(`USE ${quoteId(validDb)}`); await conn.query(validSql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_TRIGGER, async (_e, connId: string, db: string, sql: string) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validSql = requireSql(sql)
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try { await conn.query(`USE ${quoteId(validDb)}`); await conn.query(validSql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_CREATE_EVENT, async (_e, connId: string, db: string, sql: string) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validSql = requireSql(sql)
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try { await conn.query(`USE ${quoteId(validDb)}`); await conn.query(validSql) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_DROP, async (_e, connId: string, db: string, type: string, name: string) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validType = requireDroppableObjectType(type)
    const validName = requireIdentifier(name, '对象名')
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try { await conn.query(`USE ${quoteId(validDb)}`); await conn.query(`DROP ${validType} IF EXISTS ${quoteId(validName)}`) } finally { conn.release() }
  })

  ipcMain.handle(IPC.OBJECT_EXEC_ROUTINE, async (_e, connId: string, db: string, name: string, type: 'PROCEDURE' | 'FUNCTION', params: string[]) => {
    const validDb = requireIdentifier(db, '数据库名')
    const validName = requireIdentifier(name, '例程名')
    const validType = requireRoutineType(type)
    const validParams = requireRoutineParams(params)
    const conn = await connectionManager.getConnection(requireString(connId, '连接 ID', 256))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      const placeholders = validParams.map(() => '?').join(', ')
      const sql = validType === 'FUNCTION'
        ? `SELECT ${quoteId(validName)}(${placeholders}) AS result`
        : `CALL ${quoteId(validName)}(${placeholders})`
      const [rows] = await conn.query(sql, validParams)
      return { rows: rows as unknown[] }
    } finally { conn.release() }
  })

  // Store operations
  ipcMain.handle(IPC.STORE_GET_HISTORY, async (_e, connectionId: string, limit?: number, offset?: number) => {
    const page = validateHistoryPage(limit, offset)
    return localStore.queryHistory.getByConnection(validateConnectionId(connectionId), page.limit, page.offset)
  })
  ipcMain.handle(IPC.STORE_SAVE_HISTORY, async (_e, item) => localStore.queryHistory.save(validateHistoryItem(item)))
  ipcMain.handle(IPC.STORE_GET_SNIPPETS, async () => localStore.snippets.getAll())
  ipcMain.handle(IPC.STORE_SAVE_SNIPPET, async (_e, snippet) => localStore.snippets.save(validateSnippet(snippet)))
  ipcMain.handle(IPC.STORE_GET_SETTINGS, async (_e, key: string) => localStore.settings.get(validateSettingKey(key)))
  ipcMain.handle(IPC.STORE_SAVE_SETTINGS, async (_e, key: string, value: string) => {
    key = validateSettingKey(key)
    value = validateSettingValue(key, value)
    localStore.settings.set(key, value)

    if (key === HEARTBEAT_SETTING_KEY) {
      const effective = connectionManager.updateHeartbeatInterval(Number(value))
      if (String(effective) !== value) {
        localStore.settings.set(key, String(effective))
      }
      return
    }

    if (key === HEARTBEAT_TIMEOUT_SETTING_KEY) {
      const effective = connectionManager.updateHeartbeatTimeoutMs(Number(value))
      if (String(effective) !== value) {
        localStore.settings.set(key, String(effective))
      }
      return
    }

    if (key === HEARTBEAT_CONCURRENCY_SETTING_KEY) {
      const effective = connectionManager.updateHeartbeatConcurrency(Number(value))
      if (String(effective) !== value) {
        localStore.settings.set(key, String(effective))
      }
      return
    }

    if (key === HEARTBEAT_AUTOTUNE_SETTING_KEY) {
      const effective = connectionManager.updateHeartbeatAutoTuneEnabled(String(value).toLowerCase() === 'true')
      if (String(effective) !== value) {
        localStore.settings.set(key, String(effective))
      }
    }
  })

  // Dialog
  ipcMain.handle('dialog:saveFile', async (e, options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = validateSaveDialogOptions(options)
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return null
    grantFileAccess(e.sender, 'write', result.filePath)
    return result.filePath
  })

  ipcMain.handle('dialog:writeFile', async (e, filePath: string, content: string) => {
    consumeFileAccess(e.sender, 'write', filePath)
    await writeFile(filePath, validateFileContent(content), 'utf-8')
  })

  ipcMain.handle('dialog:openFile', async (e, options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = validateOpenDialogOptions(options)
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return null
    grantFileAccess(e.sender, 'read', result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:readFile', async (e, filePath: string) => {
    consumeFileAccess(e.sender, 'read', filePath)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > 16 * 1024 * 1024) throw new Error('文件必须是普通文件且不能超过 16 MiB')
    return await readFile(filePath, 'utf-8')
  })
}
