import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as importExport from '../services/import-export'
import * as path from 'path'
import { validateConnectionId, validateDatabase, validateIdentifier, validateSql } from '../utils/query-request'
import { validateExportOptions, validateFilePathString, validateImportOptions, validateTableList } from '../utils/import-export-request'

type ImportOptions = {
  // 预留导入选项
  [key: string]: unknown
}

type ExportDataOptions = {
  taskId?: string
  tables?: string[]
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
  sheetName?: string
  delimiter?: string
  quote?: string
  headers?: boolean
  pretty?: boolean
  arrayMode?: boolean
  consistentSnapshot?: boolean
}

const IMPORT_EXTS = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.sql', '.gz'])
const EXPORT_EXTS = new Set(['.csv', '.json', '.sql', '.xlsx', '.xls'])
const EXPORT_FORMATS: Record<string, { ext: string; label: string; filters: Electron.FileFilter[] }> = {
  csv: { ext: 'csv', label: 'CSV 文件', filters: [{ name: 'CSV 文件', extensions: ['csv'] }] },
  json: { ext: 'json', label: 'JSON 文件', filters: [{ name: 'JSON 文件', extensions: ['json'] }] },
  sql: { ext: 'sql', label: 'SQL 文件', filters: [{ name: 'SQL 文件', extensions: ['sql'] }] },
  xlsx: { ext: 'xlsx', label: 'Excel 文件', filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }] },
}

const runningTasks = new Map<string, AbortController>()
const taskKey = (senderId: number, taskId: string) => `${senderId}:${taskId}`

function startTask(senderId: number, taskId?: string): { signal?: AbortSignal; finish: () => void } {
  if (!taskId) return { finish: () => undefined }
  const key = taskKey(senderId, taskId)
  if (runningTasks.has(key)) throw new Error('任务 ID 正在使用')
  const controller = new AbortController()
  runningTasks.set(key, controller)
  return { signal: controller.signal, finish: () => runningTasks.delete(key) }
}

function normalizeExportFormat(format: string): 'csv' | 'json' | 'sql' | 'xlsx' {
  const normalized = String(format || '').toLowerCase()
  if (normalized === 'excel' || normalized === 'xls' || normalized === 'xlsx') return 'xlsx'
  if (normalized === 'csv' || normalized === 'json' || normalized === 'sql') return normalized
  throw new Error(`不支持的导出格式: ${format}`)
}

async function resolveExportFilePath(sender: Electron.WebContents, filePath: string, format: 'csv' | 'json' | 'sql' | 'xlsx'): Promise<string | null> {
  const config = EXPORT_FORMATS[format]
  if (filePath?.trim()) {
    const parsed = path.parse(filePath)
    return parsed.ext ? filePath : path.join(parsed.dir, `${parsed.name || `export_${Date.now()}`}.${config.ext}`)
  }

  const win = BrowserWindow.fromWebContents(sender) || undefined
  const result = await (dialog.showSaveDialog as any)(win, {
    title: '导出数据',
    defaultPath: `export_${Date.now()}.${config.ext}`,
    filters: config.filters,
  })
  return result.canceled || !result.filePath ? null : result.filePath
}

function validateFilePath(filePath: unknown, allowedExts: Set<string>): string {
  const validPath = validateFilePathString(filePath)
  const ext = path.extname(validPath).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw new Error(`不允许的文件类型: ${ext}`)
  }

  const normalized = path.resolve(validPath)
  const normalizedInput = path.resolve(path.normalize(validPath))
  if (normalized !== normalizedInput) {
    throw new Error('非法文件路径')
  }
  return validPath
}

export function registerImportExportIPC() {
  ipcMain.handle(IPC.IMPORT_FILE, async (e, connId: string, db: string, table: string, filePath: string, options?: ImportOptions) => {
    filePath = validateFilePath(filePath, IMPORT_EXTS)
    const validConnId = validateConnectionId(connId)
    const validDb = validateIdentifier(db, '数据库名')
    const validOptions = validateImportOptions(options)
    const task = startTask(e.sender.id, validOptions.taskId)
    const sendProgress = (data: { current: number; total: number; fail: number; stage: 'reading' | 'executing' }) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.IMPORT_PROGRESS, { ...data, taskId: validOptions.taskId })
    }
    const importOptions = { ...validOptions, signal: task.signal, onProgress: sendProgress }
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.sql' || filePath.toLowerCase().endsWith('.sql.gz')) {
      try { return await importExport.importSQL(validConnId, validDb, filePath, importOptions) } finally { task.finish() }
    }
    if (ext === '.csv' || ext === '.tsv') {
      try { return await importExport.importCSV(validConnId, validDb, validateIdentifier(table, '表名'), filePath, importOptions) } finally { task.finish() }
    }
    try { return await importExport.importExcel(validConnId, validDb, validateIdentifier(table, '表名'), filePath, importOptions) } finally { task.finish() }
  })

  ipcMain.handle(IPC.IMPORT_PREVIEW, async (_e, filePath: string, options?: { sheetName?: string; delimiter?: string; quote?: string; columns?: boolean }) => {
    filePath = validateFilePath(filePath, IMPORT_EXTS)
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.sql') || lower.endsWith('.sql.gz')) {
      return { columns: [], rows: [], totalRows: 0 }
    }
    const validOptions = validateImportOptions(options)
    return importExport.previewImport(filePath, validOptions)
  })

  ipcMain.handle(IPC.EXPORT_DATA, async (e, connId: string, db: string, sql: string, filePath: string, format: string, options?: ExportDataOptions) => {
    const normalizedFormat = normalizeExportFormat(format)
    const validConnId = validateConnectionId(connId)
    const validDb = validateDatabase(db)
    const validOptions = validateExportOptions(options)
    const targetPath = await resolveExportFilePath(e.sender, filePath, normalizedFormat)
    if (!targetPath) return null
    validateFilePath(targetPath, EXPORT_EXTS)
    const task = startTask(e.sender.id, validOptions.taskId)
    if (normalizedFormat === 'csv') {
      try { await importExport.exportToCSV(validConnId, validDb, validateSql(sql), targetPath, { ...validOptions, signal: task.signal }) } finally { task.finish() }
      return targetPath
    }
    if (normalizedFormat === 'json') {
      try { await importExport.exportToJSON(validConnId, validDb, validateSql(sql), targetPath, { ...validOptions, signal: task.signal }) } finally { task.finish() }
      return targetPath
    }
    if (normalizedFormat === 'xlsx') {
      try { await importExport.exportToExcel(validConnId, validDb, validateSql(sql), targetPath, { ...validOptions, signal: task.signal }) } finally { task.finish() }
      return targetPath
    }
    if (normalizedFormat === 'sql') {
      const tables = validOptions.tables || []
      const win = BrowserWindow.fromWebContents(e.sender)
      const sendProgress = (data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => {
        if (!win || win.isDestroyed()) return
        win.webContents.send(IPC.EXPORT_PROGRESS, { ...data, taskId: validOptions.taskId })
      }
      try { await importExport.exportToSQL(validConnId, validateIdentifier(validDb, '数据库名'), tables, targetPath, { ...validOptions, signal: task.signal, onProgress: sendProgress }) } finally { task.finish() }
      return targetPath
    }
  })

  ipcMain.handle(IPC.IMPORT_EXPORT_CANCEL, (e, taskId: string) => {
    const validTaskId = validateIdentifier(taskId, '任务 ID')
    runningTasks.get(taskKey(e.sender.id, validTaskId))?.abort()
  })

  ipcMain.handle(IPC.EXPORT_STRUCTURE, async (_e, connId: string, db: string, tables: string[], filePath: string) => {
    filePath = validateFilePath(filePath, EXPORT_EXTS)
    return importExport.exportStructure(validateConnectionId(connId), validateIdentifier(db, '数据库名'), validateTableList(tables), filePath)
  })
}
