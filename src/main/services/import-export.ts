import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import * as XLSX from 'xlsx'
import * as connectionManager from './connection-manager'
import * as metadata from './metadata'
import * as logger from '../utils/logger'

export async function previewImport(filePath: string): Promise<{ columns: string[]; rows: any[]; totalRows: number }> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') {
    const content = fs.readFileSync(filePath, 'utf-8')
    const records = parse(content, { columns: true, skip_empty_lines: true })
    return { columns: records.length ? Object.keys(records[0]) : [], rows: records.slice(0, 100), totalRows: records.length }
  }
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)
  return { columns: rows.length ? Object.keys(rows[0] as any) : [], rows: rows.slice(0, 100), totalRows: rows.length }
}

async function bulkInsert(connId: string, db: string, table: string, rows: Record<string, any>[]): Promise<number> {
  if (!rows.length) return 0
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    const cols = Object.keys(rows[0])
    const colStr = cols.map(c => `\`${c}\``).join(', ')
    const placeholder = `(${cols.map(() => '?').join(', ')})`
    let imported = 0
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500)
      const placeholders = batch.map(() => placeholder).join(', ')
      const values = batch.flatMap(r => cols.map(c => r[c] ?? null))
      await conn.query(`INSERT INTO \`${table}\` (${colStr}) VALUES ${placeholders}`, values)
      imported += batch.length
    }
    return imported
  } finally {
    conn.release()
  }
}

export async function importCSV(connId: string, db: string, table: string, filePath: string, _options?: any): Promise<{ imported: number }> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const rows = parse(content, { columns: true, skip_empty_lines: true })
  const imported = await bulkInsert(connId, db, table, rows)
  return { imported }
}

export async function importExcel(connId: string, db: string, table: string, filePath: string, _options?: any): Promise<{ imported: number }> {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, any>[]
  const imported = await bulkInsert(connId, db, table, rows)
  return { imported }
}

export async function exportToCSV(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    const [rows] = await conn.query(sql)
    const data = rows as any[]
    const csv = stringify(data, { header: true })
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, csv, 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToJSON(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    const [rows] = await conn.query(sql)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToSQL(connId: string, db: string, tables: string[], filePath: string, _options?: any): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    let sql = `-- SQL Export of ${db}\n-- Date: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`
    for (const table of tables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
      const ddl = (ddlRows as any[])[0]?.['Create Table']
      if (ddl) sql += `DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``)
      const dataRows = rows as any[]
      if (dataRows.length) {
        const cols = Object.keys(dataRows[0]).map(c => `\`${c}\``).join(', ')
        for (const r of dataRows) {
          const vals = Object.values(r).map(v => {
            if (v === null) return 'NULL'
            if (typeof v === 'number') return String(v)
            return `'${String(v).replace(/'/g, "\\'")}'`
          }).join(', ')
          sql += `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});\n`
        }
        sql += '\n'
      }
    }
    sql += 'SET FOREIGN_KEY_CHECKS=1;\n'
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportStructure(connId: string, db: string, tables: string[], filePath: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    let sql = `-- Structure Export of ${db}\n-- Date: ${new Date().toISOString()}\n\n`
    for (const table of tables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
      const ddl = (ddlRows as any[])[0]?.['Create Table'] || (ddlRows as any[])[0]?.['Create View']
      if (ddl) sql += `DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}
