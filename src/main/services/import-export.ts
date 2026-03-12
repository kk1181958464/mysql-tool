import * as fs from 'fs'
import { once } from 'events'
import { mkdir, readFile, writeFile } from 'fs/promises'
import * as path from 'path'
import { parse as parseStream } from 'csv-parse'
import { parse as parseSync } from 'csv-parse/sync'
import { stringify as stringifyStream } from 'csv-stringify'
import { stringify as stringifySync } from 'csv-stringify/sync'
import { finished } from 'stream/promises'
import * as XLSX from 'xlsx'
import * as connectionManager from './connection-manager'
import { quoteId } from '../utils/sql'

type Primitive = string | number | boolean | bigint | null | undefined
type SqlValue = Primitive | Date | Buffer | Record<string, unknown> | unknown[]
type RowRecord = Record<string, SqlValue>
type TableColumn = {
  name: string
  type: string
}

type ExportSqlOptions = {
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
  onProgress?: (data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => void
}

const IMPORT_BATCH_SIZE = 500
const EXPORT_BATCH_SIZE = 1000

function formatExportTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatNavicatDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function normalizeJsonValue(value: SqlValue): unknown {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof Date) return formatExportTime(value)
  if (Array.isArray(value)) return value.map(item => normalizeJsonValue(item as SqlValue))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeJsonValue(item as SqlValue)])
    )
  }
  return value
}

function normalizeRowForJson(row: RowRecord, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, normalizeJsonValue(row[column])]))
}

function getRowValues(row: RowRecord, columns: string[]): SqlValue[] {
  return columns.map((column) => row[column])
}

async function getTableColumns(conn: any, table: string): Promise<TableColumn[]> {
  const [columnRows] = await conn.query(`SHOW COLUMNS FROM ${quoteId(table)}`)
  return (columnRows as Array<{ Field: string; Type: string }>).map((column) => ({
    name: column.Field,
    type: String(column.Type || '').toLowerCase(),
  }))
}

async function getTableColumnNames(conn: any, table: string): Promise<string[]> {
  const columns = await getTableColumns(conn, table)
  return columns.map((column) => column.name)
}

async function getExistingTableNames(conn: any): Promise<Set<string>> {
  const [tableRows] = await conn.query('SHOW FULL TABLES WHERE Table_type IN (\'BASE TABLE\', \'VIEW\')')
  return new Set(
    (tableRows as Record<string, string>[])
      .map((row) => Object.values(row).find((value) => typeof value === 'string'))
      .filter((value): value is string => Boolean(value))
  )
}

function assertTablesExist(existingTables: Set<string>, tables: string[]): void {
  const missingTables = tables.filter((table) => !existingTables.has(table))
  if (!missingTables.length) return

  throw new Error(`以下表已不存在：${missingTables.join('、')}，请刷新对象列表后重试`)
}

async function buildNavicatHeader(connId: string, conn: any, db: string): Promise<string> {
  const [versionRows] = await conn.query('SELECT VERSION() AS version')
  const version = (versionRows as Array<{ version?: string }>)[0]?.version || 'unknown'
  const exportTime = formatNavicatDate()
  const pool = connectionManager.getPool(connId) as { pool?: { config?: { connectionConfig?: Record<string, unknown> } }; config?: { connectionConfig?: Record<string, unknown> } }
  const poolConfig = pool?.pool?.config?.connectionConfig || pool?.config?.connectionConfig || {} as Record<string, unknown>
  const host = poolConfig.host || 'unknown'
  const port = poolConfig.port || 3306

  return [
    '/*',
    ' Navicat Premium Dump SQL',
    '',
    ` Source Server         : ${db}`,
    ' Source Server Type    : MySQL',
    ` Source Server Version : ${version}`,
    ` Source Host           : ${host}:${port}`,
    ` Source Schema         : ${db}`,
    '',
    ' Target Server Type    : MySQL',
    ` Target Server Version : ${version}`,
    ' File Encoding         : 65001',
    '',
    ` Date: ${exportTime}`,
    '*/',
    '',
  ].join('\n')
}

function toSqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL'
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${formatExportTime(v)}'`

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

function isJsonColumnType(type: string): boolean {
  return type === 'json'
}

function normalizeValueForJsonColumn(value: SqlValue): string {
  if (value === undefined || value === null) return 'null'
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString('base64'))
  if (value instanceof Date) return JSON.stringify(formatExportTime(value))
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  return JSON.stringify(value)
}

function getRowSqlValues(row: RowRecord, columns: TableColumn[]): string[] {
  return columns.map((column) => {
    const value = row[column.name]
    if (isJsonColumnType(column.type)) {
      return toSqlLiteral(normalizeValueForJsonColumn(value))
    }
    return toSqlLiteral(value)
  })
}

function extractTableFromSelectSql(sql: string): string | null {
  const normalized = sql.trim().replace(/\s+/g, ' ')
  const match = normalized.match(/^SELECT\s+\*\s+FROM\s+`?([\w$]+)`?(?:\s+|;|$)/i)
  return match?.[1] || null
}

function getRowColumns(rows: RowRecord[]): string[] {
  return rows.length ? Object.keys(rows[0]) : []
}

async function writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  if (!stream.write(chunk, 'utf-8')) {
    await once(stream, 'drain')
  }
}

async function closeStream(stream: fs.WriteStream): Promise<void> {
  stream.end()
  await finished(stream)
}

async function queryInBatches(
  connId: string,
  db: string,
  table: string,
  batchSize: number,
  onBatch: (rows: RowRecord[], offset: number) => Promise<void>
): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    let offset = 0
    while (true) {
      const [rows] = await conn.query(`SELECT * FROM ${quoteId(table)} LIMIT ${batchSize} OFFSET ${offset}`)
      const batch = rows as RowRecord[]
      if (!batch.length) break
      await onBatch(batch, offset)
      offset += batch.length
      if (batch.length < batchSize) break
    }
  } finally {
    conn.release()
  }
}

export async function previewImport(filePath: string): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalRows: number }> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') {
    const content = await readFile(filePath, 'utf-8')
    const records = parseSync(content, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
    return { columns: records.length ? Object.keys(records[0]) : [], rows: records.slice(0, 100), totalRows: records.length }
  }
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 100), totalRows: rows.length }
}

async function insertRowsBatch(conn: any, table: string, rows: RowRecord[]): Promise<number> {
  if (!rows.length) return 0
  const cols = Object.keys(rows[0])
  const colStr = cols.map(c => quoteId(c)).join(', ')
  const placeholder = `(${cols.map(() => '?').join(', ')})`
  const placeholders = rows.map(() => placeholder).join(', ')
  const values = rows.flatMap(r => cols.map(c => r[c] ?? null))
  await conn.query(`INSERT INTO ${quoteId(table)} (${colStr}) VALUES ${placeholders}`, values)
  return rows.length
}

async function bulkInsert(connId: string, db: string, table: string, rows: RowRecord[]): Promise<number> {
  if (!rows.length) return 0
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    let imported = 0
    for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
      imported += await insertRowsBatch(conn, table, rows.slice(i, i + IMPORT_BATCH_SIZE))
    }
    return imported
  } finally {
    conn.release()
  }
}

export async function importCSV(connId: string, db: string, table: string, filePath: string, _options?: unknown): Promise<{ imported: number }> {
  const conn = await connectionManager.getConnection(connId)
  const input = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const parser = parseStream({ columns: true, skip_empty_lines: true, bom: true })

  input.pipe(parser)

  try {
    await conn.query(`USE ${quoteId(db)}`)

    let imported = 0
    let batch: RowRecord[] = []

    for await (const row of parser as AsyncIterable<RowRecord>) {
      batch.push(row)
      if (batch.length >= IMPORT_BATCH_SIZE) {
        imported += await insertRowsBatch(conn, table, batch)
        batch = []
      }
    }

    if (batch.length > 0) {
      imported += await insertRowsBatch(conn, table, batch)
    }

    return { imported }
  } finally {
    input.destroy()
    conn.release()
  }
}

export async function importExcel(connId: string, db: string, table: string, filePath: string, _options?: unknown): Promise<{ imported: number }> {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet)
  const imported = await bulkInsert(connId, db, table, rows)
  return { imported }
}

export async function exportToCSV(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)

  if (table) {
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })
    const csv = stringifyStream({ header: true })
    csv.pipe(out)
    let success = false

    try {
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        for (const row of rows) {
          if (!csv.write(row)) {
            await once(csv, 'drain')
          }
        }
      })
      csv.end()
      await finished(out)
      success = true
    } finally {
      if (!success) {
        csv.destroy()
        out.destroy()
      }
    }
    return
  }

  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    const [rows] = await conn.query(sql)
    const csv = stringifySync(rows as RowRecord[], { header: true })
    await writeFile(filePath, csv, 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToJSON(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)

  if (table) {
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })
    let streamClosed = false
    try {
      const conn = await connectionManager.getConnection(connId)
      try {
        await conn.query(`USE ${quoteId(db)}`)
        const columns = await getTableColumnNames(conn, table)
        await writeChunk(out, '[\n')
        let isFirst = true
        await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
          for (const row of rows) {
            const normalizedRow = normalizeRowForJson(row, columns)
            const line = `${isFirst ? '' : ',\n'}${JSON.stringify(normalizedRow)}`
            await writeChunk(out, line)
            isFirst = false
          }
        })
        await writeChunk(out, '\n]\n')
        await closeStream(out)
        streamClosed = true
      } finally {
        conn.release()
      }
    } finally {
      if (!streamClosed) {
        out.destroy()
      }
    }
    return
  }

  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    const [rows] = await conn.query(sql)
    const normalizedRows = (rows as RowRecord[]).map((row) => normalizeRowForJson(row, Object.keys(row)))
    await writeFile(filePath, JSON.stringify(normalizedRows, null, 2), 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToSQL(connId: string, db: string, tables: string[], filePath: string, options?: ExportSqlOptions): Promise<void> {
  const conn = await connectionManager.getConnection(connId)

  try {
    await conn.query(`USE ${quoteId(db)}`)
    const existingTables = await getExistingTableNames(conn)
    assertTablesExist(existingTables, tables)
    await mkdir(path.dirname(filePath), { recursive: true })
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })

    try {
      await writeChunk(out, await buildNavicatHeader(connId, conn, db))
      await writeChunk(out, 'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n')

      const dropTable = options?.dropTable !== false
      const createTable = options?.createTable !== false
      const includeData = options?.includeData !== false
      const insertStyle: 'single' | 'multi' | 'ignore' | 'replace' = options?.insertStyle || 'single'

      const useColumnList = insertStyle !== 'single'
      const insertHead = insertStyle === 'ignore'
        ? 'INSERT IGNORE INTO'
        : insertStyle === 'replace'
          ? 'REPLACE INTO'
          : 'INSERT INTO'

      for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
        const table = tables[tableIndex]
        const reportProgress = (rows: number, finished = false) => {
          options?.onProgress?.({
            current: table,
            done: finished ? tableIndex + 1 : tableIndex,
            total: tables.length,
            rows,
            finished,
          })
        }
        reportProgress(0)
        const tableColumns = await getTableColumns(conn, table)
        const columnNames = tableColumns.map((column) => column.name)
        const cols = columnNames.map((column) => quoteId(column)).join(', ')

        if (createTable) {
          const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${quoteId(table)}`)
          const ddl = (ddlRows as Record<string, string>[])[0]?.['Create Table']
          if (ddl) {
            let ddlBlock = `-- ----------------------------\n-- Table structure for ${quoteId(table)}\n-- ----------------------------\n`
            if (dropTable) ddlBlock += `DROP TABLE IF EXISTS ${quoteId(table)};\n`
            ddlBlock += `${ddl};\n\n`
            await writeChunk(out, ddlBlock)
          }
        }

        if (!includeData || !columnNames.length) continue

        let wroteHeader = false
        let exportedRows = 0
        await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
          if (!rows.length) return

          if (!wroteHeader) {
            const header = `-- ----------------------------\n-- Records of ${quoteId(table)}\n-- ----------------------------\n`
            await writeChunk(out, header)
            wroteHeader = true
          }

          if (insertStyle === 'multi') {
            await writeChunk(out, `${insertHead} ${quoteId(table)} (${cols}) VALUES\n`)
            for (let i = 0; i < rows.length; i += 1) {
              const row = rows[i]
              const prefix = i === 0 ? '' : ',\n'
              const values = getRowSqlValues(row, tableColumns).join(', ')
              await writeChunk(out, `${prefix}(${values})`)
            }
            await writeChunk(out, ';\n')
            exportedRows += rows.length
            reportProgress(exportedRows)
            return
          }

          for (const row of rows) {
            const vals = getRowSqlValues(row, tableColumns).join(', ')
            const columnClause = useColumnList ? ` (${cols})` : ''
            await writeChunk(out, `${insertHead} ${quoteId(table)}${columnClause} VALUES (${vals});\n`)
          }
          exportedRows += rows.length
          reportProgress(exportedRows)
        })

        if (wroteHeader) {
          await writeChunk(out, '\n')
        }
        reportProgress(exportedRows, true)
      }

      await writeChunk(out, 'SET FOREIGN_KEY_CHECKS = 1;\n')
      await closeStream(out)
    } finally {
      if (!out.writableFinished) {
        out.destroy()
      }
    }
  } finally {
    conn.release()
  }
}

export async function exportStructure(connId: string, db: string, tables: string[], filePath: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    await mkdir(path.dirname(filePath), { recursive: true })

    let sql = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`

    for (const table of tables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${quoteId(table)}`)
      const ddl = (ddlRows as Record<string, string>[])[0]?.['Create Table'] || (ddlRows as Record<string, string>[])[0]?.['Create View']
      if (!ddl) continue
      sql += `-- ----------------------------\n-- Table structure for ${quoteId(table)}\n-- ----------------------------\n`
      sql += `DROP TABLE IF EXISTS ${quoteId(table)};\n${ddl};\n\n`
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
    await writeFile(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}
