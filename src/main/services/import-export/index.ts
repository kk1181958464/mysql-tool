import * as fs from 'fs'
import * as zlib from 'zlib'
import { once } from 'events'
import { mkdir, stat, writeFile } from 'fs/promises'
import * as path from 'path'
import type { Readable, Writable } from 'stream'
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
  return (columnRows as Array<{ Field: string; Type: string }>).map((column) => ({
    name: column.Field,
    type: String(column.Type || '').toLowerCase(),
  }))
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

async function getExistingTableNames(conn: any): Promise<Set<string>> {
  const [tableRows] = await conn.query('SHOW FULL TABLES WHERE Table_type IN (\'BASE TABLE\', \'VIEW\')')
  return new Set(
    (tableRows as Record<string, string>[])
      .map((row) => Object.values(row).find((value) => typeof value === 'string'))
      .filter((value): value is string => Boolean(value))
  )
}

async function getTableAutoIncrement(conn: any, db: string, table: string): Promise<number | null> {
  // Navicat dump 会在尾部始终输出 AUTO_INCREMENT（即使为 1）。
  // 但 SHOW CREATE TABLE 在 AUTO_INCREMENT=1 时通常会省略，因此需要额外查 information_schema.
  const [rows] = await conn.query(
    'SELECT AUTO_INCREMENT AS autoIncrement FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [db, table]
  )
  const raw = (rows as Array<{ autoIncrement?: number | string | null }>)[0]?.autoIncrement
  if (raw === undefined || raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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
  // Navicat dump 对 JSON 字段有两种“空”语义：
  // 1) SQL NULL（字段本身为 NULL） -> 导出为 SQL NULL
  // 2) JSON literal null（字段存储 JSON 文本 null） -> 导出为 SQL 字符串 'null'
  if (value === undefined || value === null) return null

  // 连接层可能把 JSON literal null 读成 string "null"；为对齐 Navicat，这里保留为 'null'
  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return 'null'

  // 对字符串：如果它本身是 JSON 文本，则先 parse 再 stringify，以便统一空格风格
  let v: any = value
  if (typeof v === 'string') {
    const t = v.trim()
    const looksLikeJson = t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || /^-?\d/.test(t) || t === 'true' || t === 'false'
    if (looksLikeJson) {
      try {
        v = JSON.parse(t)
      } catch {
        // ignore
      }
    }
  }

  if (Buffer.isBuffer(v)) return formatNavicatJsonText(JSON.stringify(v.toString('base64')))
  if (v instanceof Date) return formatNavicatJsonText(JSON.stringify(formatExportTime(v)))
  if (typeof v === 'bigint') return formatNavicatJsonText(JSON.stringify(v.toString()))

  return formatNavicatJsonText(JSON.stringify(v))
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

async function getTriggerNames(conn: any, db: string): Promise<string[]> {
  return getObjectNames(
    conn,
    'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
    db,
  )
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

async function exportToSqlStream(
  connId: string,
  db: string,
  tables: string[],
  out: Writable,
  options?: SqlExportStreamOptions,
): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)

    const requestedTables = tables.length
      ? [...tables]
      : Array.from(await getExistingTableNames(conn)).sort((a, b) => a.localeCompare(b))

    const existingTables = await getExistingTableNames(conn)
    assertTablesExist(existingTables, requestedTables)

    await writeNavicatChunk(out, await buildNavicatHeader(connId, conn, db))
    await writeNavicatChunk(out, 'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n')

    const dropTable = options?.dropTable !== false
    const createTable = options?.createTable !== false
    const includeData = options?.includeData !== false
    const insertHead = 'INSERT INTO'

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
            const autoInc = await getTableAutoIncrement(conn, db, table)
            ddlBlock += `${formatNavicatDDL(table, ddlRaw, undefined, undefined, autoInc)}\n\n`
          } else {
            const body = ddlRaw.trimEnd().endsWith(';') ? ddlRaw.trimEnd().slice(0, -1) : ddlRaw.trimEnd()
            ddlBlock += `${body};\n\n`
          }

          await writeNavicatChunk(out, ddlBlock)
        }
      }

      if (includeData) {
        const recordsHeader = `-- ----------------------------\n${formatRecordsTitle(table)}\n-- ----------------------------\n`
        await writeNavicatChunk(out, recordsHeader)
      }

      if (!includeData) {
        reportProgress(0, tableIndex + 1)
        continue
      }

      const tableColumns = await getTableColumns(conn, table)
      if (!tableColumns.length) {
        await writeNavicatChunk(out, '\n')
        reportProgress(0, tableIndex + 1)
        continue
      }

      const selectSql = tableColumns.some((c) => isJsonColumnType(c.type))
        ? `SELECT ${tableColumns
            .map((c) => (isJsonColumnType(c.type)
              ? `CAST(${quoteId(c.name)} AS CHAR) AS ${quoteId(c.name)}`
              : `${quoteId(c.name)}`))
            .join(', ')} FROM ${quoteId(table)}`
        : undefined

      let exportedRows = 0
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        throwIfAborted(options?.signal)
        if (!rows.length) return
        for (const row of rows) {
          const vals = getRowNavicatSqlValues(row, tableColumns).join(', ')
          await writeNavicatChunk(out, `${insertHead} ${quoteId(table)} VALUES (${vals});\n`)
        }
        exportedRows += rows.length
        reportProgress(exportedRows)
      }, selectSql)

      await writeNavicatChunk(out, '\n')
      reportProgress(exportedRows, tableIndex + 1)
    }

    await exportTriggers(conn, db, out)
    await exportRoutines(conn, db, out, 'PROCEDURE')
    await exportRoutines(conn, db, out, 'FUNCTION')
    await exportEvents(conn, db, out)
    await writeNavicatChunk(out, 'SET FOREIGN_KEY_CHECKS = 1;\n')

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
    conn.release()
  }
}

async function writeDelimitedCreate(out: Writable, sql: string): Promise<void> {
  const body = sql.trim().replace(/;\s*$/, '')
  await writeNavicatChunk(out, 'DELIMITER ;;\n')
  await writeNavicatChunk(out, `${body};;\n`)
  await writeNavicatChunk(out, 'DELIMITER ;\n\n')
}

async function exportTriggers(conn: any, db: string, out: Writable): Promise<void> {
  const names = await getTriggerNames(conn, db)
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
): Promise<void> {
  const MAX_RETRIES = 2
  let offset = 0
  let lastCursorValue: unknown = null
  let cursorColumn: string | null | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const conn = await connectionManager.ensureConnection(connId)
    try {
      await conn.query(`USE ${quoteId(db)}`)
      if (consistentSnapshot) {
        await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
      }
      const baseSelect = selectSql || `SELECT * FROM ${quoteId(table)}`
      if (cursorColumn === undefined) {
        cursorColumn = selectSql ? null : await getSingleColumnPrimaryKey(conn, table)
      }
      while (true) {
        throwIfAborted(signal)
        const [rows] = cursorColumn
          ? lastCursorValue === null
            ? await conn.query(`${baseSelect} ORDER BY ${quoteId(cursorColumn)} ASC LIMIT ${batchSize}`)
            : await conn.query(
                `${baseSelect} WHERE ${quoteId(cursorColumn)} > ? ORDER BY ${quoteId(cursorColumn)} ASC LIMIT ${batchSize}`,
                [lastCursorValue]
              )
          : await conn.query(`${baseSelect} LIMIT ${batchSize} OFFSET ${offset}`)
        const batch = rows as RowRecord[]
        if (!batch.length) break
        await onBatch(batch, offset)
        if (cursorColumn) {
          lastCursorValue = batch[batch.length - 1]?.[cursorColumn]
        }
        offset += batch.length
        if (batch.length < batchSize) break
      }
      if (consistentSnapshot) await conn.commit()
      return
    } catch (err: any) {
      if (consistentSnapshot) {
        try { await conn.rollback() } catch { /* preserve original error */ }
      }
      if (!consistentSnapshot && attempt < MAX_RETRIES && connectionManager.isConnectionLostError(err)) {
        continue
      }
      throw err
    } finally {
      try { conn.release() } catch { /* ignore */ }
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
        if (rows.length < IMPORT_PREVIEW_ROWS) rows.push(row)
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
  } finally {
    conn.release()
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
      batch.push(mapImportRow(row, options?.columnMapping))
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
  const wb = XLSX.readFile(filePath, { sheetRows: MAX_EXCEL_IMPORT_ROWS + 2 })
  const sheet = wb.Sheets[options?.sheetName || wb.SheetNames[0]]
  if (!sheet) return { imported: 0, errors: 0 }
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet)
  if (rows.length > MAX_EXCEL_IMPORT_ROWS) {
    throw new Error(`Excel 单工作表最多导入 ${MAX_EXCEL_IMPORT_ROWS.toLocaleString('en-US')} 行`)
  }
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
    const mappedRows = rows.map((row) => mapImportRow(row, options?.columnMapping))
    const batchSize = getImportBatchSize(options)
    for (let i = 0; i < mappedRows.length; i += batchSize) {
      throwIfAborted(options?.signal)
      const result = await insertImportBatch(conn, table, mappedRows.slice(i, i + batchSize), options?.ignoreErrors === true)
      imported += result.imported
      errors += result.errors
      failed.push(...result.failed)
      options?.onProgress?.({ current: Math.min(i + batchSize, mappedRows.length), total: Math.max(mappedRows.length, 1), fail: errors, stage: 'executing' })
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
  let lastReported = 0
  source.on('data', () => {
    if (options?.signal?.aborted) source.destroy(new Error('任务已取消'))
    if (source.bytesRead - lastReported < 256 * 1024 && source.bytesRead < fileSize) return
    lastReported = source.bytesRead
    options?.onProgress?.({ current: Math.min(source.bytesRead, fileSize), total: fileSize, fail: 0, stage: 'reading' })
  })
  const input = filePath.toLowerCase().endsWith('.gz') ? source.pipe(zlib.createGunzip()) : source
  const abortSql = () => {
    source.destroy(new Error('任务已取消'))
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
            if (!csv.write(row)) {
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
        if (!csv.write(row)) await once(csv, 'drain')
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
        try {
          await conn.query(`USE ${quoteId(db)}`)
          const columns = await getTableColumnNames(conn, table)
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
        } finally {
          conn.release()
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
  const rows: RowRecord[] = []

  if (table) {
    await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (batchRows) => {
      if (rows.length + batchRows.length > MAX_EXCEL_EXPORT_ROWS) {
        throw new Error(`Excel 最多导出 ${MAX_EXCEL_EXPORT_ROWS.toLocaleString('en-US')} 行，请改用 CSV 或 JSON 导出大数据`)
      }
      rows.push(...batchRows)
    }, undefined, options?.signal, options?.consistentSnapshot)
  } else {
    await streamQueryRows(connId, db, sql, async (row) => {
      if (rows.length >= MAX_EXCEL_EXPORT_ROWS) {
        throw new Error(`Excel 最多导出 ${MAX_EXCEL_EXPORT_ROWS.toLocaleString('en-US')} 行，请改用 CSV 或 JSON 导出大数据`)
      }
      rows.push(row)
    }, options?.signal)
  }

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => normalizeRowForJson(row, Object.keys(row))))
  XLSX.utils.book_append_sheet(wb, sheet, (options?.sheetName || 'Sheet1').slice(0, 31))
  try {
    XLSX.writeFile(wb, tmpPath, { bookType: 'xlsx' })
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
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(db)}`)
    await mkdir(path.dirname(filePath), { recursive: true })

    let sql = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`

    const requestedTables = tables.length
      ? [...tables]
      : Array.from(await getExistingTableNames(conn)).sort((a, b) => a.localeCompare(b))

    for (const table of requestedTables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE ${quoteId(table)}`)
      const row0 = (ddlRows as Record<string, string>[])[0] || {}
      const ddlRaw = row0['Create Table'] || row0['Create View']
      if (!ddlRaw) continue

      sql += `-- ----------------------------\n${formatTableStructureTitle(table)}\n-- ----------------------------\n`

      const isView = Boolean(row0['Create View']) && !row0['Create Table']
      sql += isView
        ? `DROP VIEW IF EXISTS ${quoteId(table)};\n`
        : `DROP TABLE IF EXISTS ${quoteId(table)};\n`

      if (row0['Create Table']) {
        const autoInc = await getTableAutoIncrement(conn, db, table)
        sql += `${formatNavicatDDL(table, ddlRaw, undefined, undefined, autoInc)}\n\n`
      } else {
        const body = ddlRaw.trimEnd().endsWith(';') ? ddlRaw.trimEnd().slice(0, -1) : ddlRaw.trimEnd()
        sql += `${body};\n\n`
      }
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
    await writeFile(filePath, normalizeNavicatSqlText(sql), 'utf-8')
  } finally {
    conn.release()
  }
}
