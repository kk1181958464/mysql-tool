import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import * as XLSX from 'xlsx'
import * as connectionManager from './connection-manager'
function formatExportTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function toSqlLiteral(v: any): string {
  if (v === null || v === undefined) return 'NULL'
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${formatExportTime(v)}'`

  // mysql2 对 JSON 列可能返回 object，必须序列化后再写入 SQL
  const raw = (typeof v === 'object') ? JSON.stringify(v) : String(v)
  const s = raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u0000/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0008/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\u001a/g, '\\Z')
  return `'${s}'`
}

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

export async function exportToSQL(connId: string, db: string, tables: string[], filePath: string, options?: any): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)

    const dropTable = options?.dropTable !== false
    const createTable = options?.createTable !== false
    const includeData = options?.includeData !== false
    const insertStyle: 'single' | 'multi' | 'ignore' | 'replace' = options?.insertStyle || 'single'

    const insertHead = insertStyle === 'ignore'
      ? 'INSERT IGNORE INTO'
      : insertStyle === 'replace'
        ? 'REPLACE INTO'
        : 'INSERT INTO'

    let sql = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`

    for (const table of tables) {
      if (createTable) {
        const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
        const ddl = (ddlRows as any[])[0]?.['Create Table']
        if (ddl) {
          sql += `-- ----------------------------\n-- Table structure for \`${table}\`\n-- ----------------------------\n`
          if (dropTable) sql += `DROP TABLE IF EXISTS \`${table}\`;\n`
          sql += `${ddl};\n\n`
        }
      }

      if (!includeData) continue
      const [rows] = await conn.query(`SELECT * FROM \`${table}\``)
      const dataRows = rows as any[]
      if (!dataRows.length) continue

      const cols = Object.keys(dataRows[0]).map(c => `\`${c}\``).join(', ')
      sql += `-- ----------------------------\n-- Records of \`${table}\`\n-- ----------------------------\n`

      if (insertStyle === 'multi') {
        const batchSize = 300
        for (let i = 0; i < dataRows.length; i += batchSize) {
          const batch = dataRows.slice(i, i + batchSize)
          const values = batch.map(r => `(${Object.values(r).map(v => toSqlLiteral(v)).join(', ')})`).join(',\n')
          sql += `${insertHead} \`${table}\` (${cols}) VALUES\n${values};\n`
        }
      } else {
        for (const r of dataRows) {
          const vals = Object.values(r).map(v => toSqlLiteral(v)).join(', ')
          sql += `${insertHead} \`${table}\` (${cols}) VALUES (${vals});\n`
        }
      }
      sql += '\n'
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
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

    let sql = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`

    for (const table of tables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
      const ddl = (ddlRows as any[])[0]?.['Create Table'] || (ddlRows as any[])[0]?.['Create View']
      if (!ddl) continue
      sql += `-- ----------------------------\n-- Table structure for \`${table}\`\n-- ----------------------------\n`
      sql += `DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}
