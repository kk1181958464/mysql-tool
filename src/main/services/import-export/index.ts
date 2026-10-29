import * as fs from 'fs'
import * as zlib from 'zlib'
import { once } from 'events'
import { mkdir, stat } from 'fs/promises'
import * as path from 'path'
import { Transform, pipeline, type Readable, type Writable } from 'stream'
import { parse as parseStream } from 'csv-parse'
import { stringify as stringifyStream } from 'csv-stringify'
import { finished } from 'stream/promises'
import * as XLSX from 'xlsx'
import * as connectionManager from '../connection-manager'
import { cancelMultiStatementSql, executeSqlFile } from '../sql-script-executor'
import { quoteId } from '../../utils/sql'
import { formatNavicatDDL, formatTableStructureTitle, formatRecordsTitle, formatObjectTitle, isNumericColumnType } from './navicat-ddl'

type Primitive = string | number | boolean | bigint | null | undefined
type SqlValue = Primitive | Date | Buffer | Record<string, unknown> | unknown[]
type RowRecord = Record<string, SqlValue>
type StreamableConnection = { query(sql: string): { stream(options?: { highWaterMark?: number }): Readable } }
type TableColumn = {
  name: string
  type: string
  generated?: boolean
}

type ExportSqlOptions = {
  signal?: AbortSignal
  consistentSnapshot?: boolean
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
  onProgress?: (data: { current: string; done: number; total: number; rows: number; finished?: boolean }) => void
}

type SqlExportStreamOptions = ExportSqlOptions & {
  emitFinished?: boolean
}

type ImportFileOptions = {
  taskId?: string
  signal?: AbortSignal
  batchSize?: number
  ignoreErrors?: boolean
  truncate?: boolean
  atomic?: boolean
  columnMapping?: Record<string, string>
  delimiter?: string
  quote?: string
  columns?: boolean
  sheetName?: string
  onProgress?: (data: { current: number; total: number; fail: number; stage: 'reading' | 'executing' }) => void
}
type ImportTargetColumn = {
  name: string
  required: boolean
}
type FailedImportRow = { row: RowRecord; error: string }

type ExportCsvOptions = { delimiter?: string; quote?: string; headers?: boolean; signal?: AbortSignal; consistentSnapshot?: boolean }
type ExportJsonOptions = { pretty?: boolean; arrayMode?: boolean; signal?: AbortSignal; consistentSnapshot?: boolean }

type ExportExcelOptions = {
  sheetName?: string
  signal?: AbortSignal
  consistentSnapshot?: boolean
}

const DEFAULT_IMPORT_BATCH_SIZE = 1000
const MIN_IMPORT_BATCH_SIZE = 100
const MAX_IMPORT_BATCH_SIZE = 10000
const EXPORT_BATCH_SIZE = 1000
const IMPORT_PREVIEW_ROWS = 100
const MAX_EXCEL_FILE_SIZE = 100 * 1024 * 1024
const MAX_EXCEL_IMPORT_ROWS = 250000
const MAX_EXCEL_EXPORT_ROWS = 250000
const EXCEL_SHEET_CHUNK = 5000
const NAVICAT_EOL = '\r\n'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('任务已取消')
}

function getImportBatchSize(options?: ImportFileOptions): number {
  const raw = Number(options?.batchSize)
  if (!Number.isFinite(raw)) return DEFAULT_IMPORT_BATCH_SIZE
  return Math.min(MAX_IMPORT_BATCH_SIZE, Math.max(MIN_IMPORT_BATCH_SIZE, Math.floor(raw)))
}

function formatExportTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatNavicatDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

function toNavicatSqlLiteral(v: SqlValue, columnType?: string): string {
  if (v === null || v === undefined) return 'NULL'

  // JSON literal null：Navicat dump 会导出成字符串 'null'
  if (typeof v === 'string' && columnType === 'json' && v.trim().toLowerCase() === 'null') {
    return toSqlLiteral('null')
  }

  // mysql2 在 typeCast 下，DATETIME/DATE/TIMESTAMP 会转成 string（见 connection-manager.ts:314-319）
  // Navicat INSERT 中日期时间是单引号字符串
  if (typeof v === 'string') {
    if (columnType && isNumericColumnType(columnType)) {
      // DECIMAL 可能以 string 返回，Navicat 输出不带引号
      const trimmed = v.trim()
      if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed
    }
    return toSqlLiteral(v)
  }

  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${formatExportTime(v)}'`

  // JSON/object/array：作为字符串写入（保持与 Navicat dump 的转义风格）
  const raw = (typeof v === 'object') ? JSON.stringify(v) : String(v)
  return toSqlLiteral(raw)
}

function getRowNavicatSqlValues(row: RowRecord, columns: TableColumn[]): string[] {
  return columns.map((column) => {
    const value = row[column.name]
    if (isJsonColumnType(column.type)) {
      // JSON 列：导出成字符串字面量（与 Navicat dump 的转义风格对齐）
      return toNavicatSqlLiteral(normalizeValueForJsonColumn(value), 'json')
    }
    return toNavicatSqlLiteral(value, column.type)
  })
}

async function getTableColumns(conn: any, table: string): Promise<TableColumn[]> {
  const [columnRows] = await conn.query(`SHOW COLUMNS FROM ${quoteId(table)}`)
  return (columnRows as Array<{ Field: string; Type: string; Extra?: string }>).map((column) => ({
    name: column.Field,
    type: String(column.Type || '').toLowerCase(),
    generated: /\bGENERATED\b/i.test(String(column.Extra || '')),
  }))
}

function buildExportSelect(table: string, columns: TableColumn[]): string {
  const list = columns
    .map((c) => (isJsonColumnType(c.type) ? `CAST(${quoteId(c.name)} AS CHAR) AS ${quoteId(c.name)}` : quoteId(c.name)))
    .join(', ')
  return `SELECT ${list} FROM ${quoteId(table)}`
}

async function getTableColumnNames(conn: any, table: string): Promise<string[]> {
  const columns = await getTableColumns(conn, table)
  return columns.map((column) => column.name)
}

async function getSingleColumnPrimaryKey(conn: any, table: string): Promise<string | null> {
  const [rows] = await conn.query(`SHOW KEYS FROM ${quoteId(table)} WHERE Key_name = 'PRIMARY'`)
  const keys = rows as Array<{ Column_name: string; Seq_in_index: number }>
  const ordered = keys.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
  return ordered.length === 1 ? ordered[0].Column_name : null
}

async function getTableTypes(conn: any): Promise<Map<string, 'BASE TABLE' | 'VIEW'>> {
  const [tableRows] = await conn.query('SHOW FULL TABLES WHERE Table_type IN (\'BASE TABLE\', \'VIEW\')')
  const types = new Map<string, 'BASE TABLE' | 'VIEW'>()
  for (const row of tableRows as Record<string, string>[]) {
    const values = Object.values(row)
    const name = values[0]
    if (typeof name === 'string' && name) types.set(name, values[1] === 'VIEW' ? 'VIEW' : 'BASE TABLE')
  }
  return types
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

  const connConfig = connectionManager.getConnectionConfig(connId)
  const sourceServerName = connConfig?.name || db

  // Source Host 仅用于 dump 注释，不影响导入执行；为逐字符对齐 Navicat，强制写死 127.0.0.1:3306
  const host = '127.0.0.1'
  const port = 3306

  const versionNumber = (() => {
    // e.g. 5.7.40-log => 50740
    const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!m) return 'unknown'
    const major = Number(m[1])
    const minor = Number(m[2])
    const patch = Number(m[3])
    if (![major, minor, patch].every(Number.isFinite)) return 'unknown'
    return `${major}${String(minor).padStart(2, '0')}${String(patch).padStart(2, '0')}`
  })()
  const versionDisplay = versionNumber === 'unknown' ? String(version) : `${versionNumber} (${version})`

  return [
    '/*',
    ' Navicat Premium Dump SQL',
    '',
    ` Source Server         : ${sourceServerName}`,
    ' Source Server Type    : MySQL',
    ` Source Server Version : ${versionDisplay}`,
    ` Source Host           : ${host}:${port}`,
    ` Source Schema         : ${db}`,
    '',
    ' Target Server Type    : MySQL',
    ` Target Server Version : ${versionDisplay}`,
    ' File Encoding         : 65001',
    '',
    ` Date: ${exportTime}`,
    '*/',
    '',
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
    .replace(/\"/g, '\\\"')
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

function formatNavicatJsonText(jsonText: string): string {
  // Navicat dump 在 JSON 文本中通常会保留 ": " 与 ", " 的空格（但不应影响字符串内部内容）。
  let out = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < jsonText.length; i += 1) {
    const ch = jsonText[i]

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === ':') {
      out += ':'
      if (jsonText[i + 1] !== ' ') out += ' '
      continue
    }

    if (ch === ',') {
      out += ','
      if (jsonText[i + 1] !== ' ') out += ' '
      continue
    }

    out += ch
  }

  return out
}

function normalizeValueForJsonColumn(value: SqlValue): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return formatNavicatJsonText(JSON.stringify(value))
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
  const match = normalized.match(/^SELECT\s+\*\s+FROM\s+`?([\w$]+)`?\s*;?\s*$/i)
  return match?.[1] || null
}

const CSV_NULL = '\\N'

function toCsvRow(row: RowRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? CSV_NULL : value]))
}

function fromCsvRow(row: RowRecord): RowRecord {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === CSV_NULL ? null : value]))
}

function getRowColumns(rows: RowRecord[]): string[] {
  return rows.length ? Object.keys(rows[0]) : []
}

async function writeChunk(stream: Writable, chunk: string): Promise<void> {
  if (!stream.write(chunk, 'utf-8')) {
    await once(stream, 'drain')
  }
}

async function getObjectNames(conn: any, sql: string, db: string): Promise<string[]> {
  const [rows] = await conn.query(sql, [db])
  return (rows as Array<Record<string, unknown>>)
    .map((row) => String(row.name ?? Object.values(row)[0] ?? ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

async function getTriggerNames(conn: any, db: string, tables: Set<string>): Promise<string[]> {
  const [rows] = await conn.query(
    'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tbl FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
    [db],
  )
  return (rows as Array<{ name?: string; tbl?: string }>)
    .filter((row) => row.name && row.tbl && tables.has(row.tbl))
    .map((row) => String(row.name))
    .sort((a, b) => a.localeCompare(b))
}

async function getRoutineNames(conn: any, db: string, type: 'PROCEDURE' | 'FUNCTION'): Promise<string[]> {
  const [rows] = await conn.query(
    'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = ?',
    [db, type],
  )
  return (rows as Array<Record<string, unknown>>)
    .map((row) => String(row.name ?? ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

async function getEventNames(conn: any, db: string): Promise<string[]> {
  return getObjectNames(
    conn,
    'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?',
    db,
  )
}

function normalizeNavicatSqlText(sql: string): string {
  return sql.replace(/\r?\n/g, NAVICAT_EOL)
}

async function writeNavicatChunk(stream: Writable, chunk: string): Promise<void> {
  await writeChunk(stream, normalizeNavicatSqlText(chunk))
}

async function closeStream(stream: Writable): Promise<void> {
  stream.end()
  await finished(stream)
}

function createTemporaryExportPath(filePath: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`)
}

async function commitTemporaryExport(tmpPath: string, filePath: string): Promise<void> {
  await fs.promises.rename(tmpPath, filePath)
}

async function removeTemporaryExport(tmpPath: string | null): Promise<void> {
  if (!tmpPath) return
  try { await fs.promises.unlink(tmpPath) } catch { /* ignore cleanup errors */ }
}

const MULTI_INSERT_MAX_LENGTH = 1024 * 1024

// 视图可能引用其他视图，按依赖顺序输出，避免导入时引用尚未创建的视图
async function orderViewsByDependency(conn: any, views: string[]): Promise<string[]> {
  if (views.length < 2) return views
  const ddl = new Map<string, string>()
  for (const view of views) {
    const [rows] = await conn.query(`SHOW CREATE VIEW ${quoteId(view)}`)
    ddl.set(view, String((rows as Record<string, string>[])[0]?.['Create View'] || ''))
  }
  const ordered: string[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (view: string) => {
    if (state.has(view)) return
    state.set(view, 'visiting')
    const text = ddl.get(view) || ''
    for (const other of views) {
      if (other !== view && text.includes(quoteId(other))) visit(other)
    }
    state.set(view, 'done')
    ordered.push(view)
  }
  views.forEach(visit)
  return ordered
}

function insertHeadFor(style: ExportSqlOptions['insertStyle']): string {
  if (style === 'ignore') return 'INSERT IGNORE INTO'
  if (style === 'replace') return 'REPLACE INTO'
  return 'INSERT INTO'
}

async function exportToSqlStream(
  connId: string,
  db: string,
  tables: string[],
  out: Writable,
  options?: SqlExportStreamOptions,
): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  let previousTimeZone: string | null = null
  let inSnapshot = false
  try {
    await conn.query(`USE ${quoteId(db)}`)

    // TIMESTAMP 按 UTC 导出，并在文件中声明，导入到不同时区的服务器时值不变
    const [tzRows] = await conn.query('SELECT @@session.time_zone AS tz')
    previousTimeZone = String((tzRows as Array<{ tz?: string }>)[0]?.tz || 'SYSTEM')
    await conn.query("SET time_zone = '+00:00'")

    if (options?.consistentSnapshot) {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      inSnapshot = true
    }

    const tableTypes = await getTableTypes(conn)
    const requested = tables.length
      ? [...tables]
      : Array.from(tableTypes.keys()).sort((a, b) => a.localeCompare(b))
    assertTablesExist(new Set(tableTypes.keys()), requested)
    const requestedSet = new Set(requested)
    const isWholeDatabase = Array.from(tableTypes.keys()).every((name) => requestedSet.has(name))
    const requestedTables = [
      ...requested.filter((name) => tableTypes.get(name) !== 'VIEW'),
      ...await orderViewsByDependency(conn, requested.filter((name) => tableTypes.get(name) === 'VIEW')),
    ]

    await writeNavicatChunk(out, await buildNavicatHeader(connId, conn, db))
    await writeNavicatChunk(out, "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n/*!40103 SET TIME_ZONE = '+00:00' */;\n\n")

    const createTable = options?.createTable !== false
    // 不重建表时绝不能 DROP，否则后续 INSERT 会写入不存在的表
    const dropTable = createTable && options?.dropTable !== false
    const includeData = options?.includeData !== false
    const insertStyle = options?.insertStyle ?? 'single'
    const insertHead = insertHeadFor(insertStyle)

    for (let tableIndex = 0; tableIndex < requestedTables.length; tableIndex += 1) {
      throwIfAborted(options?.signal)
      const table = requestedTables[tableIndex]
      const reportProgress = (rows: number, doneOverride?: number) => {
        options?.onProgress?.({
          current: table,
          done: doneOverride ?? tableIndex,
          total: requestedTables.length,
          rows,
        })
      }

      reportProgress(0)

      if (createTable) {
        const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${quoteId(table)}`)
        const row0 = (ddlRows as Record<string, string>[])[0] || {}
        const ddlRaw = row0['Create Table'] || row0['Create View']

        if (ddlRaw) {
          let ddlBlock = `-- ----------------------------\n${formatTableStructureTitle(table)}\n-- ----------------------------\n`

          if (dropTable) {
            const isView = Boolean(row0['Create View']) && !row0['Create Table']
            ddlBlock += isView
              ? `DROP VIEW IF EXISTS ${quoteId(table)};\n`
              : `DROP TABLE IF EXISTS ${quoteId(table)};\n`
          }

          if (row0['Create Table']) {
            ddlBlock += `${formatNavicatDDL(ddlRaw)}\n\n`
          } else {
            const body = ddlRaw.trimEnd().endsWith(';') ? ddlRaw.trimEnd().slice(0, -1) : ddlRaw.trimEnd()
            ddlBlock += `${body};\n\n`
          }

          await writeNavicatChunk(out, ddlBlock)
        }
      }

      const isView = tableTypes.get(table) === 'VIEW'
      if (includeData && !isView) {
        const recordsHeader = `-- ----------------------------\n${formatRecordsTitle(table)}\n-- ----------------------------\n`
        await writeNavicatChunk(out, recordsHeader)
      }

      if (!includeData || isView) {
        reportProgress(0, tableIndex + 1)
        continue
      }

      const tableColumns = (await getTableColumns(conn, table)).filter((c) => !c.generated)
      if (!tableColumns.length) {
        await writeNavicatChunk(out, '\n')
        reportProgress(0, tableIndex + 1)
        continue
      }

      const selectSql = buildExportSelect(table, tableColumns)
      const columnList = tableColumns.map((c) => quoteId(c.name)).join(', ')
      const prefix = `${insertHead} ${quoteId(table)} (${columnList}) VALUES `

      let exportedRows = 0
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        throwIfAborted(options?.signal)
        if (!rows.length) return
        if (insertStyle === 'multi') {
          let tuples: string[] = []
          let length = 0
          const flush = async () => {
            if (!tuples.length) return
            await writeNavicatChunk(out, `${prefix}${tuples.join(', ')};\n`)
            tuples = []
            length = 0
          }
          for (const row of rows) {
            const tuple = `(${getRowNavicatSqlValues(row, tableColumns).join(', ')})`
            if (length + tuple.length > MULTI_INSERT_MAX_LENGTH) await flush()
            tuples.push(tuple)
            length += tuple.length + 2
          }
          await flush()
        } else {
          for (const row of rows) {
            await writeNavicatChunk(out, `${prefix}(${getRowNavicatSqlValues(row, tableColumns).join(', ')});\n`)
          }
        }
        exportedRows += rows.length
        reportProgress(exportedRows)
      }, selectSql, options?.signal, false, conn)

      await writeNavicatChunk(out, '\n')
      reportProgress(exportedRows, tableIndex + 1)
    }

    // 仅导出数据时不重建对象；只导部分表时只带上这些表的触发器，存储过程/函数/事件属于整库
    if (createTable) {
      await exportTriggers(conn, db, out, new Set(requestedTables))
      if (isWholeDatabase) {
        await exportRoutines(conn, db, out, 'PROCEDURE')
        await exportRoutines(conn, db, out, 'FUNCTION')
        await exportEvents(conn, db, out)
      }
    }
    await writeNavicatChunk(out, 'SET FOREIGN_KEY_CHECKS = 1;\n')

    if (inSnapshot) {
      inSnapshot = false
      await conn.query('COMMIT')
    }

    if (options?.emitFinished !== false) {
      options?.onProgress?.({
        current: requestedTables[requestedTables.length - 1] || '',
        done: requestedTables.length,
        total: requestedTables.length,
        rows: 0,
        finished: true,
      })
    }
  } finally {
    if (inSnapshot) {
      try { await conn.query('ROLLBACK') } catch { /* preserve original error */ }
    }
    if (previousTimeZone) {
      try { await conn.query('SET time_zone = ?', [previousTimeZone]) } catch { /* connection may be broken */ }
    }
    conn.release()
  }
}

async function writeDelimitedCreate(out: Writable, sql: string): Promise<void> {
  const body = sql.trim().replace(/;\s*$/, '')
  await writeNavicatChunk(out, 'DELIMITER ;;\n')
  await writeNavicatChunk(out, `${body};;\n`)
  await writeNavicatChunk(out, 'DELIMITER ;\n\n')
}

async function exportTriggers(conn: any, db: string, out: Writable, tables: Set<string>): Promise<void> {
  const names = await getTriggerNames(conn, db, tables)
  for (const name of names) {
    const [rows] = await conn.query(`SHOW CREATE TRIGGER ${quoteId(name)}`)
    const createSql = (rows as Array<Record<string, string>>)[0]?.['SQL Original Statement']
      || (rows as Array<Record<string, string>>)[0]?.['Create Trigger']
    if (!createSql) continue
    await writeNavicatChunk(out, `-- ----------------------------\n${formatObjectTitle('Trigger', name)}\n-- ----------------------------\n`)
    await writeNavicatChunk(out, `DROP TRIGGER IF EXISTS ${quoteId(name)};\n`)
    await writeDelimitedCreate(out, createSql)
  }
}

async function exportRoutines(conn: any, db: string, out: Writable, type: 'PROCEDURE' | 'FUNCTION'): Promise<void> {
  const names = await getRoutineNames(conn, db, type)
  const titleType = type === 'PROCEDURE' ? 'Procedure' : 'Function'
  const createKey = type === 'PROCEDURE' ? 'Create Procedure' : 'Create Function'
  for (const name of names) {
    const [rows] = await conn.query(`SHOW CREATE ${type} ${quoteId(name)}`)
    const createSql = (rows as Array<Record<string, string>>)[0]?.[createKey]
    if (!createSql) continue
    await writeNavicatChunk(out, `-- ----------------------------\n${formatObjectTitle(titleType, name)}\n-- ----------------------------\n`)
    await writeNavicatChunk(out, `DROP ${type} IF EXISTS ${quoteId(name)};\n`)
    await writeDelimitedCreate(out, createSql)
  }
}

async function exportEvents(conn: any, db: string, out: Writable): Promise<void> {
  const names = await getEventNames(conn, db)
  for (const name of names) {
    const [rows] = await conn.query(`SHOW CREATE EVENT ${quoteId(name)}`)
    const createSql = (rows as Array<Record<string, string>>)[0]?.['Create Event']
    if (!createSql) continue
    await writeNavicatChunk(out, `-- ----------------------------\n${formatObjectTitle('Event', name)}\n-- ----------------------------\n`)
    await writeNavicatChunk(out, `DROP EVENT IF EXISTS ${quoteId(name)};\n`)
    await writeDelimitedCreate(out, createSql)
  }
}

async function queryInBatches(
  connId: string,
  db: string,
  table: string,
  batchSize: number,
  onBatch: (rows: RowRecord[], offset: number) => Promise<void>,
  selectSql?: string,
  signal?: AbortSignal,
  consistentSnapshot = false,
  heldConn?: any,
): Promise<void> {
  const MAX_RETRIES = heldConn ? 0 : 2
  let offset = 0
  let lastCursorValue: unknown = null
  let cursorColumn: string | null | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const conn = heldConn ?? await connectionManager.ensureConnection(connId)
    try {
      await conn.query(`USE ${quoteId(db)}`)
      if (consistentSnapshot) {
        await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      }
      const baseSelect = selectSql || `SELECT * FROM ${quoteId(table)}`
      if (cursorColumn === undefined) {
        cursorColumn = await getSingleColumnPrimaryKey(conn, table)
      }
      if (!cursorColumn) {
        // 无单列主键时 ORDER BY 1 + OFFSET 在首列有重复值时会漏行/重复，改为单次流式读取
        const rawConnection = conn.connection as unknown as StreamableConnection
        const stream = rawConnection.query(baseSelect).stream({ highWaterMark: batchSize })
        let batch: RowRecord[] = []
        try {
          for await (const row of stream as AsyncIterable<RowRecord>) {
            throwIfAborted(signal)
            batch.push(row)
            if (batch.length >= batchSize) {
              await onBatch(batch, offset)
              offset += batch.length
              batch = []
            }
          }
        } finally {
          stream.destroy()
        }
        if (batch.length) await onBatch(batch, offset)
        if (consistentSnapshot) await conn.commit()
        return
      }
      while (true) {
        throwIfAborted(signal)
        const [rows] = lastCursorValue === null
          ? await conn.query(`${baseSelect} ORDER BY ${quoteId(cursorColumn)} ASC LIMIT ${batchSize}`)
          : await conn.query(
              `${baseSelect} WHERE ${quoteId(cursorColumn)} > ? ORDER BY ${quoteId(cursorColumn)} ASC LIMIT ${batchSize}`,
              [lastCursorValue]
            )
        const batch = rows as RowRecord[]
        if (!batch.length) break
        await onBatch(batch, offset)
        lastCursorValue = batch[batch.length - 1]?.[cursorColumn]
        offset += batch.length
        if (batch.length < batchSize) break
      }
      if (consistentSnapshot) await conn.commit()
      return
    } catch (err: any) {
      if (consistentSnapshot) {
        try { await conn.rollback() } catch { /* preserve original error */ }
      }
      // 流式读取已输出部分行时不能重试，否则会重复写出
      if (!consistentSnapshot && attempt < MAX_RETRIES && (cursorColumn || offset === 0) && connectionManager.isConnectionLostError(err)) {
        continue
      }
      throw err
    } finally {
      if (!heldConn) {
        try { conn.release() } catch { /* ignore */ }
      }
    }
  }
}

export async function previewImport(filePath: string, options?: { sheetName?: string; delimiter?: string; quote?: string; columns?: boolean }): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalRows: number; sheetNames?: string[] }> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') {
    const input = fs.createReadStream(filePath, { encoding: 'utf-8' })
    const parser = parseStream({
      columns: options?.columns === false ? (header: string[]) => header.map((_value, index) => `column_${index + 1}`) : true,
      skip_empty_lines: true,
      bom: true,
      delimiter: options?.delimiter || (ext === '.tsv' ? '\t' : ','),
      quote: options?.quote || '"',
    })
    const rows: Record<string, unknown>[] = []
    let totalRows = 0
    input.pipe(parser)
    try {
      for await (const row of parser as AsyncIterable<Record<string, unknown>>) {
        totalRows += 1
        if (rows.length < IMPORT_PREVIEW_ROWS) rows.push(fromCsvRow(row as RowRecord))
      }
    } finally {
      input.destroy()
    }
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows, totalRows }
  }

  await assertExcelFileSize(filePath)
  const wb = XLSX.readFile(filePath, { sheetRows: IMPORT_PREVIEW_ROWS + 1 })
  const sheet = wb.Sheets[options?.sheetName || wb.SheetNames[0]]
  if (!sheet) return { columns: [], rows: [], totalRows: 0, sheetNames: wb.SheetNames }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  const fullRange = sheet['!fullref'] || sheet['!ref']
  const totalRows = fullRange ? Math.max(0, XLSX.utils.decode_range(fullRange).e.r) : rows.length
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, IMPORT_PREVIEW_ROWS), totalRows, sheetNames: wb.SheetNames }
}

async function streamQueryRows(
  connId: string,
  db: string,
  sql: string,
  onRow: (row: RowRecord) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    if (db) await conn.query(`USE ${quoteId(db)}`)
    const rawConnection = conn.connection as unknown as StreamableConnection
    const stream = rawConnection.query(sql).stream({ highWaterMark: 128 })
    for await (const row of stream as AsyncIterable<RowRecord>) {
      throwIfAborted(signal)
      await onRow(row)
    }
    conn.release()
  } catch (error) {
    try { conn.destroy() } catch { /* connection may already be closed */ }
    throw error
  }
}

async function assertExcelFileSize(filePath: string): Promise<void> {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new Error('Excel 路径不是文件')
  if (fileStat.size > MAX_EXCEL_FILE_SIZE) {
    throw new Error(`Excel 文件不能超过 ${MAX_EXCEL_FILE_SIZE / 1024 / 1024} MiB`)
  }
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

function mapImportRow(row: RowRecord, mapping?: Record<string, string>): RowRecord {
  if (!mapping) return row
  return Object.fromEntries(Object.entries(row).flatMap(([source, value]) => {
    const target = mapping[source] === undefined ? source : mapping[source]
    return target ? [[target, value]] : []
  }))
}

async function validateImportColumns(conn: any, table: string, sourceColumns: string[], mapping?: Record<string, string>): Promise<void> {
  if (!sourceColumns.length) throw new Error('导入文件没有可用的数据列')
  const [columnRows] = await conn.query(`SHOW COLUMNS FROM ${quoteId(table)}`)
  const targetColumns = (columnRows as Array<{ Field: string; Null: string; Default: unknown; Extra: string }>).map((column): ImportTargetColumn => ({
    name: column.Field,
    required: column.Null === 'NO' && column.Default === null && !String(column.Extra || '').toLowerCase().includes('auto_increment'),
  }))
  const targetNames = new Set(targetColumns.map((column) => column.name))
  const mappedNames = sourceColumns
    .map((source) => mapping?.[source] === undefined ? source : mapping[source])
    .filter(Boolean)
  if (!mappedNames.length) throw new Error('列映射后没有可导入的目标列')
  const duplicates = mappedNames.filter((name, index) => mappedNames.indexOf(name) !== index)
  if (duplicates.length) throw new Error(`多个源列映射到了同一目标列：${[...new Set(duplicates)].join('、')}`)
  const unknown = mappedNames.filter((name) => !targetNames.has(name))
  if (unknown.length) throw new Error(`目标表不存在以下列：${unknown.join('、')}`)
  const mappedSet = new Set(mappedNames)
  const missing = targetColumns.filter((column) => column.required && !mappedSet.has(column.name)).map((column) => column.name)
  if (missing.length) throw new Error(`缺少目标表必填列：${missing.join('、')}`)
}

async function insertImportBatch(conn: any, table: string, rows: RowRecord[], ignoreErrors: boolean): Promise<{ imported: number; errors: number; failed: FailedImportRow[] }> {
  try {
    return { imported: await insertRowsBatch(conn, table, rows), errors: 0, failed: [] }
  } catch (error: any) {
    if (!ignoreErrors || rows.length === 1) {
      if (!ignoreErrors) throw error
      return { imported: 0, errors: 1, failed: [{ row: rows[0], error: error?.message || '写入失败' }] }
    }
    let imported = 0
    let errors = 0
    const failed: FailedImportRow[] = []
    for (const row of rows) {
      const result = await insertImportBatch(conn, table, [row], true)
      imported += result.imported
      errors += result.errors
      failed.push(...result.failed)
    }
    return { imported, errors, failed }
  }
}

async function writeFailedRowsReport(filePath: string, failed: FailedImportRow[]): Promise<string | undefined> {
  if (!failed.length) return undefined
  const reportPath = `${filePath}.errors.csv`
  const tmpPath = createTemporaryExportPath(reportPath)
  const out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
  const csv = stringifyStream({ header: true })
  csv.pipe(out)
  try {
    for (const item of failed) {
      if (!csv.write({ ...item.row, __error: item.error })) await once(csv, 'drain')
    }
    csv.end()
    await finished(out)
    await commitTemporaryExport(tmpPath, reportPath)
    return reportPath
  } catch (error) {
    csv.destroy()
    out.destroy()
    throw error
  } finally {
    await removeTemporaryExport(tmpPath)
  }
}

export async function importCSV(connId: string, db: string, table: string, filePath: string, options?: ImportFileOptions): Promise<{ imported: number; errors: number; errorReportPath?: string }> {
  const fileSize = Math.max(1, (await stat(filePath)).size)
  const conn = await connectionManager.getConnection(connId)
  const input = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const parser = parseStream({
    columns: options?.columns === false ? (header: string[]) => header.map((_value, index) => `column_${index + 1}`) : true,
    skip_empty_lines: true,
    bom: true,
    delimiter: options?.delimiter || (path.extname(filePath).toLowerCase() === '.tsv' ? '\t' : ','),
    quote: options?.quote || '"',
  })
  const batchSize = getImportBatchSize(options)

  input.pipe(parser)

  try {
    await conn.query(`USE ${quoteId(db)}`)
    if (options?.atomic) await conn.beginTransaction()

    let imported = 0
    let errors = 0
    let batch: RowRecord[] = []
    const failed: FailedImportRow[] = []
    let columnsValidated = false

    for await (const row of parser as AsyncIterable<RowRecord>) {
      throwIfAborted(options?.signal)
      if (!columnsValidated) {
        await validateImportColumns(conn, table, Object.keys(row), options?.columnMapping)
        if (options?.truncate) {
          await conn.query(options.atomic ? `DELETE FROM ${quoteId(table)}` : `TRUNCATE TABLE ${quoteId(table)}`)
        }
        columnsValidated = true
      }
      batch.push(mapImportRow(fromCsvRow(row), options?.columnMapping))
      if (batch.length >= batchSize) {
        const result = await insertImportBatch(conn, table, batch, options?.ignoreErrors === true)
        imported += result.imported
        errors += result.errors
        failed.push(...result.failed)
        options?.onProgress?.({ current: Math.min(input.bytesRead, fileSize), total: fileSize, fail: errors, stage: 'reading' })
        batch = []
      }
    }

    if (batch.length > 0) {
      const result = await insertImportBatch(conn, table, batch, options?.ignoreErrors === true)
      imported += result.imported
      errors += result.errors
      failed.push(...result.failed)
    }

    if (options?.atomic) await conn.commit()
    options?.onProgress?.({ current: fileSize, total: fileSize, fail: errors, stage: 'reading' })
    return { imported, errors, errorReportPath: await writeFailedRowsReport(filePath, failed) }
  } catch (error) {
    if (options?.atomic) {
      try { await conn.rollback() } catch { /* preserve original error */ }
    }
    throw error
  } finally {
    input.destroy()
    conn.release()
  }
}

export async function importExcel(connId: string, db: string, table: string, filePath: string, options?: ImportFileOptions): Promise<{ imported: number; errors: number; errorReportPath?: string }> {
  await assertExcelFileSize(filePath)
  const wb = XLSX.readFile(filePath, { dense: true, cellDates: true, sheetRows: MAX_EXCEL_IMPORT_ROWS + 2 })
  const sheet = wb.Sheets[options?.sheetName || wb.SheetNames[0]]
  if (!sheet) return { imported: 0, errors: 0 }
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet, { defval: null })
  if (rows.length > MAX_EXCEL_IMPORT_ROWS) {
    throw new Error(`Excel 单工作表最多导入 ${MAX_EXCEL_IMPORT_ROWS.toLocaleString('en-US')} 行，请先另存为 CSV 再导入`)
  }
  delete wb.Sheets[options?.sheetName || wb.SheetNames[0]]
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    await validateImportColumns(conn, table, rows.length ? Object.keys(rows[0]) : [], options?.columnMapping)
    if (options?.atomic) await conn.beginTransaction()
    if (options?.truncate) {
      await conn.query(options.atomic ? `DELETE FROM ${quoteId(table)}` : `TRUNCATE TABLE ${quoteId(table)}`)
    }
    let imported = 0
    let errors = 0
    const failed: FailedImportRow[] = []
    const batchSize = getImportBatchSize(options)
    while (rows.length > 0) {
      throwIfAborted(options?.signal)
      const batch = rows.splice(0, batchSize).map((row) => mapImportRow(row, options?.columnMapping))
      const result = await insertImportBatch(conn, table, batch, options?.ignoreErrors === true)
      imported += result.imported
      errors += result.errors
      failed.push(...result.failed)
      options?.onProgress?.({ current: imported + errors, total: Math.max(imported + errors + rows.length, 1), fail: errors, stage: 'executing' })
    }
    if (options?.atomic) await conn.commit()
    return { imported, errors, errorReportPath: await writeFailedRowsReport(filePath, failed) }
  } catch (error) {
    if (options?.atomic) {
      try { await conn.rollback() } catch { /* preserve original error */ }
    }
    throw error
  } finally {
    conn.release()
  }
}

export async function importSQL(connId: string, db: string, filePath: string, options?: ImportFileOptions): Promise<{ imported: number; errors: number; executed: number }> {
  const fileSize = Math.max(1, (await stat(filePath)).size)
  const source = fs.createReadStream(filePath)
  let bytesRead = 0
  let lastReported = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesRead += chunk.length
      if (bytesRead - lastReported >= 256 * 1024 || bytesRead >= fileSize) {
        lastReported = bytesRead
        options?.onProgress?.({ current: Math.min(bytesRead, fileSize), total: fileSize, fail: 0, stage: 'reading' })
      }
      callback(null, chunk)
    },
  })
  const gunzip = filePath.toLowerCase().endsWith('.gz') ? zlib.createGunzip() : null
  const input = gunzip ? pipeline(source, counter, gunzip, () => {}) : pipeline(source, counter, () => {})
  const abortSql = () => {
    const error = new Error('任务已取消')
    source.destroy(error)
    counter.destroy(error)
    gunzip?.destroy(error)
    cancelMultiStatementSql(connId, options?.taskId)
  }
  options?.signal?.addEventListener('abort', abortSql, { once: true })
  let result
  try {
    result = await executeSqlFile(
      connId,
      input,
      db || undefined,
      {
        optimizeInserts: true,
        stopOnError: options?.ignoreErrors !== true,
        executionId: options?.taskId,
      },
    )
  } finally {
    options?.signal?.removeEventListener('abort', abortSql)
    source.destroy()
  }
  if (result.errors > 0 && options?.ignoreErrors !== true) {
    throw new Error(result.firstError || 'SQL 导入失败')
  }
  options?.onProgress?.({ current: fileSize, total: fileSize, fail: result.errors, stage: 'executing' })

  return {
    imported: result.imported,
    errors: result.errors,
    executed: result.executed,
  }
}

export async function exportToCSV(connId: string, db: string, sql: string, filePath: string, options?: ExportCsvOptions): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)
  const tmpPath = createTemporaryExportPath(filePath)

  try {
    if (table) {
      const out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
      const csv = stringifyStream({ header: options?.headers !== false, delimiter: options?.delimiter || ',', quote: options?.quote || '"' })
      csv.pipe(out)
      let success = false

      try {
        await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
          throwIfAborted(options?.signal)
          for (const row of rows) {
            if (!csv.write(toCsvRow(row))) {
              await once(csv, 'drain')
            }
          }
        }, undefined, options?.signal, options?.consistentSnapshot)
        csv.end()
        await finished(out)
        success = true
      } finally {
        if (!success) {
          csv.destroy()
          out.destroy()
        }
      }
      await commitTemporaryExport(tmpPath, filePath)
      return
    }

    const out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
    const csv = stringifyStream({ header: options?.headers !== false, delimiter: options?.delimiter || ',', quote: options?.quote || '"' })
    csv.pipe(out)
    let success = false
    try {
      await streamQueryRows(connId, db, sql, async (row) => {
        if (!csv.write(toCsvRow(row))) await once(csv, 'drain')
      }, options?.signal)
      csv.end()
      await finished(out)
      success = true
    } finally {
      if (!success) {
        csv.destroy()
        out.destroy()
      }
    }
    await commitTemporaryExport(tmpPath, filePath)
  } finally {
    await removeTemporaryExport(tmpPath)
  }
}

export async function exportToJSON(connId: string, db: string, sql: string, filePath: string, options?: ExportJsonOptions): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)
  const tmpPath = createTemporaryExportPath(filePath)

  try {
    if (table) {
      const out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
      let streamClosed = false
      try {
        const conn = await connectionManager.getConnection(connId)
        let columns: string[]
        try {
          await conn.query(`USE ${quoteId(db)}`)
          columns = await getTableColumnNames(conn, table)
        } finally {
          conn.release()
        }
        {
          const arrayMode = options?.arrayMode !== false
          const pretty = options?.pretty !== false
          if (arrayMode) await writeChunk(out, pretty ? '[\n' : '[')
          let isFirst = true
          await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
            throwIfAborted(options?.signal)
            for (const row of rows) {
              const normalizedRow = normalizeRowForJson(row, columns)
              const separator = arrayMode ? (isFirst ? '' : pretty ? ',\n' : ',') : (isFirst ? '' : '\n')
              const line = `${separator}${JSON.stringify(normalizedRow, null, pretty && arrayMode ? 2 : undefined)}`
              await writeChunk(out, line)
              isFirst = false
            }
          }, undefined, options?.signal, options?.consistentSnapshot)
          if (arrayMode) await writeChunk(out, pretty ? '\n]\n' : ']\n')
          else await writeChunk(out, '\n')
          await closeStream(out)
          streamClosed = true
        }
      } finally {
        if (!streamClosed) out.destroy()
      }
      await commitTemporaryExport(tmpPath, filePath)
      return
    }

    const out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
    let streamClosed = false
    try {
      const arrayMode = options?.arrayMode !== false
      const pretty = options?.pretty !== false
      if (arrayMode) await writeChunk(out, pretty ? '[\n' : '[')
      let isFirst = true
      await streamQueryRows(connId, db, sql, async (row) => {
        const normalizedRow = normalizeRowForJson(row, Object.keys(row))
        const separator = arrayMode ? (isFirst ? '' : pretty ? ',\n' : ',') : (isFirst ? '' : '\n')
        await writeChunk(out, `${separator}${JSON.stringify(normalizedRow, null, pretty && arrayMode ? 2 : undefined)}`)
        isFirst = false
      }, options?.signal)
      if (arrayMode) await writeChunk(out, pretty ? '\n]\n' : ']\n')
      else await writeChunk(out, '\n')
      await closeStream(out)
      streamClosed = true
    } finally {
      if (!streamClosed) out.destroy()
    }
    await commitTemporaryExport(tmpPath, filePath)
  } finally {
    await removeTemporaryExport(tmpPath)
  }
}

export async function exportToExcel(connId: string, db: string, sql: string, filePath: string, options?: ExportExcelOptions): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = createTemporaryExportPath(filePath)
  const table = extractTableFromSelectSql(sql)
  const rows: Record<string, unknown>[] = []
  const appendExcelRow = (row: RowRecord) => {
    if (rows.length >= MAX_EXCEL_EXPORT_ROWS) {
      throw new Error(`Excel 最多导出 ${MAX_EXCEL_EXPORT_ROWS.toLocaleString('en-US')} 行，请改用 CSV 或 JSON 导出大数据`)
    }
    rows.push(normalizeRowForJson(row, Object.keys(row)))
  }

  if (table) {
    await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (batchRows) => {
      for (const row of batchRows) appendExcelRow(row)
    }, undefined, options?.signal, options?.consistentSnapshot)
  } else {
    await streamQueryRows(connId, db, sql, async (row) => {
      appendExcelRow(row)
    }, options?.signal)
  }

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows.slice(0, EXCEL_SHEET_CHUNK))
  for (let start = EXCEL_SHEET_CHUNK; start < rows.length; start += EXCEL_SHEET_CHUNK) {
    throwIfAborted(options?.signal)
    await new Promise<void>((resolve) => setImmediate(resolve))
    XLSX.utils.sheet_add_json(sheet, rows.slice(start, start + EXCEL_SHEET_CHUNK), { skipHeader: true, origin: -1 })
  }
  rows.length = 0
  XLSX.utils.book_append_sheet(wb, sheet, (options?.sheetName || 'Sheet1').slice(0, 31))
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
    await fs.promises.writeFile(tmpPath, buffer)
    await commitTemporaryExport(tmpPath, filePath)
  } finally {
    await removeTemporaryExport(tmpPath)
  }
}

export async function exportToSQL(connId: string, db: string, tables: string[], filePath: string, options?: ExportSqlOptions): Promise<void> {
  let tmpPath: string | null = null
  let out: fs.WriteStream | null = null

  try {
    await mkdir(path.dirname(filePath), { recursive: true })

    tmpPath = createTemporaryExportPath(filePath)
    out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })
    await exportToSqlStream(connId, db, tables, out, options)
    await closeStream(out)

    await fs.promises.rename(tmpPath, filePath)
    tmpPath = null
  } finally {
    try {
      if (out && !out.writableFinished) {
        out.destroy()
      }
      if (tmpPath) {
        try { await fs.promises.unlink(tmpPath) } catch { /* ignore */ }
      }
    } finally {
      // no-op
    }
  }
}

export async function exportToSqlWritable(
  connId: string,
  db: string,
  tables: string[],
  writable: Writable,
  options?: ExportSqlOptions,
): Promise<void> {
  await exportToSqlStream(connId, db, tables, writable, { ...options, emitFinished: false })
}

export async function exportStructure(connId: string, db: string, tables: string[], filePath: string): Promise<void> {
  await exportToSQL(connId, db, tables, filePath, { includeData: false, createTable: true, dropTable: true })
}
