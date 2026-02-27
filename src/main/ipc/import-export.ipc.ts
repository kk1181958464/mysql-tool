import { ipcMain } from 'electron'
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
}

const IMPORT_EXTS = new Set(['.csv', '.tsv', '.xlsx', '.xls'])
const EXPORT_EXTS = new Set(['.csv', '.json', '.sql', '.xlsx', '.xls'])

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
    if (ext === '.csv' || ext === '.tsv') {
      return importExport.importCSV(connId, db, table, filePath, options)
    }
    return importExport.importExcel(connId, db, table, filePath, options)
  })

  ipcMain.handle(IPC.IMPORT_PREVIEW, async (_e, filePath: string) => {
    validateFilePath(filePath, IMPORT_EXTS)
    return importExport.previewImport(filePath)
  })

  ipcMain.handle(IPC.EXPORT_DATA, async (_e, connId: string, db: string, sql: string, filePath: string, format: string, options?: ExportDataOptions) => {
    validateFilePath(filePath, EXPORT_EXTS)
    if (format === 'csv') return importExport.exportToCSV(connId, db, sql, filePath)
    if (format === 'json') return importExport.exportToJSON(connId, db, sql, filePath)
    if (format === 'sql') {
      const tables = options?.tables || []
      return importExport.exportToSQL(connId, db, tables, filePath, options)
    }
  })

  ipcMain.handle(IPC.EXPORT_STRUCTURE, async (_e, connId: string, db: string, tables: string[], filePath: string) => {
    validateFilePath(filePath, EXPORT_EXTS)
    return importExport.exportStructure(connId, db, tables, filePath)
  })
}
