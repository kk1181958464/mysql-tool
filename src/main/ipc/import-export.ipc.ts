import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as importExport from '../services/import-export'
import * as path from 'path'

type ImportOptions = {
  // 预留导入选项
  [key: string]: unknown
}

type ExportDataOptions = {
  tables?: string[]
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
  sheetName?: string
}

const IMPORT_EXTS = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.sql', '.gz'])
const EXPORT_EXTS = new Set(['.csv', '.json', '.sql', '.xlsx', '.xls'])
const EXPORT_FORMATS: Record<string, { ext: string; label: string; filters: Electron.FileFilter[] }> = {
  csv: { ext: 'csv', label: 'CSV 文件', filters: [{ name: 'CSV 文件', extensions: ['csv'] }] },
  json: { ext: 'json', label: 'JSON 文件', filters: [{ name: 'JSON 文件', extensions: ['json'] }] },
  sql: { ext: 'sql', label: 'SQL 文件', filters: [{ name: 'SQL 文件', extensions: ['sql'] }] },
  xlsx: { ext: 'xlsx', label: 'Excel 文件', filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }] },
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
  const result = await dialog.showSaveDialog(win, {
    title: '导出数据',
    defaultPath: `export_${Date.now()}.${config.ext}`,
    filters: config.filters,
  })
  return result.canceled || !result.filePath ? null : result.filePath
}

function validateFilePath(filePath: string, allowedExts: Set<string>): void {
  const ext = path.extname(filePath).toLowerCase()
  if (!allowedExts.has(ext)) {
    throw new Error(`不允许的文件类型: ${ext}`)
  }

  const normalized = path.resolve(filePath)
  const normalizedInput = path.resolve(path.normalize(filePath))
  if (normalized !== normalizedInput) {
    throw new Error('非法文件路径')
  }
}

export function registerImportExportIPC() {
  ipcMain.handle(IPC.IMPORT_FILE, async (_e, connId: string, db: string, table: string, filePath: string, options?: ImportOptions) => {
    validateFilePath(filePath, IMPORT_EXTS)
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.sql' || filePath.toLowerCase().endsWith('.sql.gz')) {
      return importExport.importSQL(connId, db, filePath, options)
    }
    if (ext === '.csv' || ext === '.tsv') {
      return importExport.importCSV(connId, db, table, filePath, options)
    }
    return importExport.importExcel(connId, db, table, filePath, options)
  })

  ipcMain.handle(IPC.IMPORT_PREVIEW, async (_e, filePath: string) => {
    validateFilePath(filePath, IMPORT_EXTS)
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.sql') || lower.endsWith('.sql.gz')) {
      return { columns: [], rows: [], totalRows: 0 }
    }
    return importExport.previewImport(filePath)
  })

  ipcMain.handle(IPC.EXPORT_DATA, async (e, connId: string, db: string, sql: string, filePath: string, format: string, options?: ExportDataOptions) => {
    const normalizedFormat = normalizeExportFormat(format)
    const targetPath = await resolveExportFilePath(e.sender, filePath, normalizedFormat)
    if (!targetPath) return

    validateFilePath(targetPath, EXPORT_EXTS)
    if (normalizedFormat === 'csv') return importExport.exportToCSV(connId, db, sql, targetPath)
    if (normalizedFormat === 'json') return importExport.exportToJSON(connId, db, sql, targetPath)
    if (normalizedFormat === 'xlsx') return importExport.exportToExcel(connId, db, sql, targetPath, options)
    if (normalizedFormat === 'sql') {
      const tables = options?.tables || []
      const win = BrowserWindow.fromWebContents(e.sender)
      const sendProgress = (data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => {
        if (!win || win.isDestroyed()) return
        win.webContents.send(IPC.EXPORT_PROGRESS, data)
      }
      return importExport.exportToSQL(connId, db, tables, targetPath, { ...options, onProgress: sendProgress })
    }
  })

  ipcMain.handle(IPC.EXPORT_STRUCTURE, async (_e, connId: string, db: string, tables: string[], filePath: string) => {
    validateFilePath(filePath, EXPORT_EXTS)
    return importExport.exportStructure(connId, db, tables, filePath)
  })
}
