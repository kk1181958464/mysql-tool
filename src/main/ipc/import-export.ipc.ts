import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as importExport from '../services/import-export'
import * as path from 'path'

export function registerImportExportIPC() {
  ipcMain.handle(IPC.IMPORT_FILE, async (_e, connId: string, db: string, table: string, filePath: string, options?: any) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.csv' || ext === '.tsv') {
      return importExport.importCSV(connId, db, table, filePath, options)
    }
    return importExport.importExcel(connId, db, table, filePath, options)
  })

  ipcMain.handle(IPC.IMPORT_PREVIEW, async (_e, filePath: string) => {
    return importExport.previewImport(filePath)
  })

  ipcMain.handle(IPC.EXPORT_DATA, async (_e, connId: string, db: string, sql: string, filePath: string, format: string, options?: any) => {
    if (format === 'csv') return importExport.exportToCSV(connId, db, sql, filePath)
    if (format === 'json') return importExport.exportToJSON(connId, db, sql, filePath)
    if (format === 'sql') {
      const tables = options?.tables || []
      return importExport.exportToSQL(connId, db, tables, filePath, options)
    }
  })

  ipcMain.handle(IPC.EXPORT_STRUCTURE, async (_e, connId: string, db: string, tables: string[], filePath: string) => {
    return importExport.exportStructure(connId, db, tables, filePath)
  })
}
