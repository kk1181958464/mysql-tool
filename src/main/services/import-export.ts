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

function formatTableStructureTitle(name: string): string {
  // Navicat dump: 不带反引号
  return `-- Table structure for ${name}`
}

function formatRecordsTitle(name: string): string {
  // Navicat dump: 不带反引号
  return `-- Records of ${name}`
}

function formatNavicatDDL(table: string, ddl: string, defaultCharset?: string, defaultCollate?: string, autoIncrement?: number | null): string {
  // 基于 SHOW CREATE TABLE 输出做轻量规则重写，覆盖 Navicat 样例差异。
  // 目标：尽量逐字符对齐 Navicat。
  let s = ddl.trim()

  // --- 先从 DDL 尾行提取表默认 charset/collate（供列展开用） ---
  const tailMatch = s.match(/\)\s*(.+?)$/s)
  const tailStr = tailMatch ? tailMatch[1] : ''
  const tblCharset = defaultCharset || (() => {
    const m = tailStr.match(/DEFAULT\s+CHARSET=(\w+)/i) || tailStr.match(/CHARACTER\s+SET\s*=?\s*(\w+)/i)
    return m ? m[1] : 'utf8mb4'
  })()
  const tblCollate = defaultCollate || (() => {
    const m = tailStr.match(/COLLATE\s*=?\s*(\w+)/i)
    return m ? m[1] : `${tblCharset}_general_ci`
  })()

  // 字符串类型正则
  const charTypeRe = /^(varchar|char|tinytext|text|mediumtext|longtext|enum|set)\b/i

  const escapeNavicatComment = (text: string): string => {
    // Navicat dump 会把 comment 中的 " 写出来（例如 规则\",\"隔开）
    // 这里仅补齐未转义的双引号，避免把已有 \" 再次双重转义。
    let t = String(text)
    t = t.replace(/([^\\])"/g, '$1\\"')
    t = t.replace(/^"/g, '\\"')
    return t
  }

  // 1) CREATE TABLE 行：双空格 + "  ("
  s = s.replace(new RegExp(`^CREATE\\s+TABLE\\s+${escapeRegExp(quoteId(table))}\\s*\\(`, 'm'), `CREATE TABLE ${quoteId(table)}  (`)

  // 2) 行内规则：decimal(10,2) -> decimal(10, 2)
  s = s.replace(/decimal\((\d+),(\d+)\)/gi, 'decimal($1, $2)')

  // 3) unsigned -> UNSIGNED
  s = s.replace(/\bunsigned\b/g, 'UNSIGNED')

  // 4) KEY -> INDEX（含 FULLTEXT/UNIQUE）
  s = s.replace(/^(\s{2})FULLTEXT KEY\b/gm, '$1FULLTEXT INDEX')
  s = s.replace(/^(\s{2})UNIQUE KEY\b/gm, '$1UNIQUE INDEX')
  s = s.replace(/^(\s{2})KEY\b/gm, '$1INDEX')

  // 5) WITH PARSER：展开条件注释
  s = s.replace(/\/\*!\d+\s+WITH PARSER\s+(`[^`]+`)\s*\*\//g, 'WITH PARSER $1')

  // 6) INDEX 行：去索引名和括号间多余空格 `idx_foo` (`col`) -> `idx_foo`(`col`)
  s = s.replace(/^(\s{2}(?:INDEX|UNIQUE INDEX|FULLTEXT INDEX)\s+`[^`]+`)\s+\(/gm, '$1(')

  // 7) 逐行规则
  const lines = s.split(/\r?\n/)
  const outLines: string[] = []
  for (const line of lines) {
    let l = line

    // 跳过非列定义行（PRIMARY KEY / INDEX / CREATE TABLE / ) ENGINE 等）
    const isColumnLine = /^\s{2}`[^`]+`\s+\w+/.test(l) && !/^\s{2}(PRIMARY|INDEX|UNIQUE|FULLTEXT|CONSTRAINT|KEY)\b/i.test(l)

    if (isColumnLine) {
      // 提取列类型
      const colTypeMatch = l.match(/^\s+`[^`]+`\s+(\w+(?:\([^)]*\))?)/i)
      const colType = colTypeMatch ? colTypeMatch[1] : ''
      const baseType = colType.replace(/\(.*\)/, '').toLowerCase()

      // COMMENT 文本：对齐 Navicat 的 \" 风格
      l = l.replace(/\bCOMMENT\s+'([^']*)'/i, (_m, text: string) => `COMMENT '${escapeNavicatComment(text)}'`)

      // 仅对数值列：DEFAULT '123' 去引号（varchar/char 等字符串列必须保留引号）
      if (isNumericColumnType(baseType)) {
        l = l.replace(/\bDEFAULT\s+'(-?\d+(?:\.\d+)?)'/gi, 'DEFAULT $1')
      }

      // json 列：Navicat 样例里 NULL 列通常不输出 DEFAULT NULL
      if (baseType === 'json') {
        l = l.replace(/\s+DEFAULT\s+NULL\b/gi, '')
      }

      // 对字符类型列补 CHARACTER SET ... COLLATE ...
      if (charTypeRe.test(baseType)) {
        // 已有 CHARACTER SET？跳过
        if (!/\bCHARACTER\s+SET\b/i.test(l)) {
          // 已有 COLLATE？
          const existingCollateMatch = l.match(/\bCOLLATE\s+(\w+)/i)
          if (existingCollateMatch) {
            const col = existingCollateMatch[1]
            const cs = String(col).split('_')[0]
            // 在 COLLATE 前插入 CHARACTER SET
            l = l.replace(/\bCOLLATE\s+(\w+)/i, `CHARACTER SET ${cs} COLLATE $1`)
          } else {
            // 无 COLLATE，补表默认 charset/collate
            // 在类型后面插入（在 NOT NULL / NULL / DEFAULT / COMMENT / , 之前）
            const insertPos = l.search(/\s+(NOT\s+NULL|NULL|DEFAULT|COMMENT|AUTO_INCREMENT)/i)
            const trailingComma = l.trimEnd().endsWith(',')
            if (insertPos > 0) {
              l = l.substring(0, insertPos) + ` CHARACTER SET ${tblCharset} COLLATE ${tblCollate}` + l.substring(insertPos)
            } else if (trailingComma) {
              l = l.trimEnd().slice(0, -1) + ` CHARACTER SET ${tblCharset} COLLATE ${tblCollate},`
            }
          }
        }
      }

      // 对非 NOT NULL 列，补显式 NULL 关键字
      if (!/\bNOT\s+NULL\b/i.test(l) && !/\bAUTO_INCREMENT\b/i.test(l)) {
        // 检查是否已有显式 NULL
        // 排除 "DEFAULT NULL" 中的 NULL——真正的显式 NULL 是在 DEFAULT/COMMENT 之前独立出现的
        const withoutDefault = l.replace(/DEFAULT\s+NULL/gi, 'DEFAULT_PLACEHOLDER')
        if (!/\bNULL\b/i.test(withoutDefault)) {
          // 在 DEFAULT 或 COMMENT 前插入 NULL
          if (/\bDEFAULT\b/i.test(l)) {
            l = l.replace(/(\s)(DEFAULT\b)/i, '$1NULL $2')
          } else if (/\bCOMMENT\b/i.test(l)) {
            l = l.replace(/(\s)(COMMENT\b)/i, '$1NULL $2')
          } else {
            // 列尾逗号前
            const trimmed = l.trimEnd()
            if (trimmed.endsWith(',')) {
              l = trimmed.slice(0, -1) + ' NULL,'
            } else {
              l = trimmed + ' NULL'
            }
          }
        }
      }
    }

    // 普通索引：Navicat dump 通常显式 USING BTREE（SHOW CREATE TABLE 可能省略）
    const isNormalIndexLine = /^\s{2}(?:INDEX|UNIQUE INDEX)\b/i.test(l)
    const isFullTextIndexLine = /^\s{2}FULLTEXT INDEX\b/i.test(l)
    if (isNormalIndexLine && !isFullTextIndexLine && !/\bUSING\s+\w+\b/i.test(l)) {
      const trimmed = l.trimEnd()
      const hasComma = trimmed.endsWith(',')
      const base = hasComma ? trimmed.slice(0, -1) : trimmed
      l = base + ' USING BTREE' + (hasComma ? ',' : '')
    }

    outLines.push(l)
  }
  s = outLines.join('\n')

  // 清理行尾空白，避免与 Navicat 的逐字符差异（仅清理行尾空格/Tab，不吞掉换行）
  s = s.replace(/[ \t]+$/gm, '')

  // 8) 尾行 table options：解析所有键值对，按 Navicat 顺序输出
  const optionsTailMatch = s.match(/\)\s*([^)]+)$/s)
  if (optionsTailMatch) {
    const rawTail = optionsTailMatch[1].replace(/;\s*$/, '').trim()
    const opts: Record<string, string> = {}

    // 解析各选项（考虑任意顺序、可选空格）
    const engineM = rawTail.match(/ENGINE\s*=\s*(\w+)/i)
    if (engineM) opts['ENGINE'] = engineM[1]

    const autoIncM = rawTail.match(/AUTO_INCREMENT\s*=\s*(\d+)/i)
    if (autoIncM) opts['AUTO_INCREMENT'] = autoIncM[1]

    const charsetM = rawTail.match(/(?:DEFAULT\s+)?CHARSET\s*=\s*(\w+)/i) || rawTail.match(/CHARACTER\s+SET\s*=\s*(\w+)/i)
    if (charsetM) opts['CHARACTER SET'] = charsetM[1]

    // SHOW CREATE TABLE 的尾部可能是 "DEFAULT CHARSET=utf8mb4"（没有等号），也可能是 "CHARSET=utf8mb4"
    if (!opts['CHARACTER SET']) {
      const charset2M = rawTail.match(/DEFAULT\s+CHARSET\s*=\s*(\w+)/i) || rawTail.match(/DEFAULT\s+CHARSET\s+(\w+)/i) || rawTail.match(/CHARSET\s*=\s*(\w+)/i)
      if (charset2M) opts['CHARACTER SET'] = charset2M[1]
    }

    const collateM = rawTail.match(/COLLATE\s*=\s*(\w+)/i)
    if (collateM) opts['COLLATE'] = collateM[1]

    // 没有显式 AUTO_INCREMENT 时，如果外部传了 autoIncrement，则强制补齐（用于 AUTO_INCREMENT=1 也要输出）
    if (!opts['AUTO_INCREMENT'] && autoIncrement !== null && autoIncrement !== undefined && Number.isFinite(autoIncrement)) {
      opts['AUTO_INCREMENT'] = String(autoIncrement)
    }
    // 如果没有显式 COLLATE，根据 charset 补默认
    if (!opts['COLLATE'] && opts['CHARACTER SET']) {
      opts['COLLATE'] = `${opts['CHARACTER SET']}_general_ci`
    }

    const commentM = rawTail.match(/COMMENT\s*=\s*'([^']*)'/i)
    if (commentM) opts['COMMENT'] = escapeNavicatComment(commentM[1])

    const rowFmtM = rawTail.match(/ROW_FORMAT\s*=\s*(\w+)/i)
    if (rowFmtM) opts['ROW_FORMAT'] = rowFmtM[1]

    // 按 Navicat 顺序组装
    const newParts: string[] = [')']
    if (opts['ENGINE']) newParts.push(`ENGINE = ${opts['ENGINE']}`)
    if (opts['AUTO_INCREMENT']) newParts.push(`AUTO_INCREMENT = ${opts['AUTO_INCREMENT']}`)
    if (opts['CHARACTER SET']) newParts.push(`CHARACTER SET = ${opts['CHARACTER SET']}`)
    if (opts['COLLATE']) newParts.push(`COLLATE = ${opts['COLLATE']}`)
    if (opts['COMMENT'] !== undefined) newParts.push(`COMMENT = '${opts['COMMENT']}'`)
    if (opts['ROW_FORMAT']) newParts.push(`ROW_FORMAT = ${opts['ROW_FORMAT']}`)

    const newTail = newParts.join(' ') + ';'
    s = s.replace(/\)\s*[^)]+$/s, newTail)
  }

  return s
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isNumericColumnType(type: string): boolean {
  const t = type.toLowerCase()
  return t.startsWith('int')
    || t.startsWith('tinyint')
    || t.startsWith('smallint')
    || t.startsWith('mediumint')
    || t.startsWith('bigint')
    || t.startsWith('float')
    || t.startsWith('double')
    || t.startsWith('decimal')
    || t.startsWith('numeric')
    || t.startsWith('bit')
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
  onBatch: (rows: RowRecord[], offset: number) => Promise<void>,
  selectSql?: string
): Promise<void> {
  const MAX_RETRIES = 2

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const conn = await connectionManager.ensureConnection(connId)
    try {
      await conn.query(`USE ${quoteId(db)}`)
      let offset = 0
      const baseSelect = selectSql || `SELECT * FROM ${quoteId(table)}`
      while (true) {
        const [rows] = await conn.query(`${baseSelect} LIMIT ${batchSize} OFFSET ${offset}`)
        const batch = rows as RowRecord[]
        if (!batch.length) break
        await onBatch(batch, offset)
        offset += batch.length
        if (batch.length < batchSize) break
      }
      return
    } catch (err: any) {
      if (attempt < MAX_RETRIES && connectionManager.isConnectionLostError(err)) {
        continue
      }
      throw err
    } finally {
      try { conn.release() } catch { /* ignore */ }
    }
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

  let tmpPath: string | null = null
  let out: fs.WriteStream | null = null

  try {
    await conn.query(`USE ${quoteId(db)}`)

    // tables 为空时：主进程兜底拉全库对象（BASE TABLE + VIEW）
    const requestedTables = tables.length
      ? [...tables]
      : Array.from(await getExistingTableNames(conn)).sort((a, b) => a.localeCompare(b))

    const existingTables = await getExistingTableNames(conn)
    assertTablesExist(existingTables, requestedTables)

    await mkdir(path.dirname(filePath), { recursive: true })

    // 临时文件 + 成功后原子替换，杜绝半截 SQL 落盘
    tmpPath = path.join(
      path.dirname(filePath),
      `${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`
    )
    out = fs.createWriteStream(tmpPath, { encoding: 'utf-8' })

    await writeChunk(out, await buildNavicatHeader(connId, conn, db))
    await writeChunk(out, 'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n')

    const dropTable = options?.dropTable !== false
    const createTable = options?.createTable !== false
    const includeData = options?.includeData !== false

    // NavicatCompat：强制逐行、无列名列表
    const insertHead = 'INSERT INTO'

    for (let tableIndex = 0; tableIndex < requestedTables.length; tableIndex += 1) {
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

      // DDL
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
            // VIEW：不强行重排（样例库未出现 VIEW），保留原始输出并确保分号
            const body = ddlRaw.trimEnd().endsWith(';') ? ddlRaw.trimEnd().slice(0, -1) : ddlRaw.trimEnd()
            ddlBlock += `${body};\n\n`
          }

          await writeChunk(out, ddlBlock)
        }
      }

      // Records 区块：即使 0 行也输出
      if (includeData) {
        const recordsHeader = `-- ----------------------------\n${formatRecordsTitle(table)}\n-- ----------------------------\n`
        await writeChunk(out, recordsHeader)
      }

      // 数据导出
      if (!includeData) {
        reportProgress(0, tableIndex + 1)
        continue
      }

      const tableColumns = await getTableColumns(conn, table)
      if (!tableColumns.length) {
        await writeChunk(out, '\n')
        reportProgress(0, tableIndex + 1)
        continue
      }

      // 为逐字符对齐 Navicat：JSON 列需要保留 JSON literal null 的“文本形态”。
      // MySQL JSON literal null 在 Navicat dump 中表现为字符串 'null'，但 mysql2 可能直接返回 JS null。
      // 通过 CAST(jsonCol AS CHAR) 可让 JSON literal null 读取为 "null"，从而导出为 'null'。
      const selectSql = tableColumns.some((c) => isJsonColumnType(c.type))
        ? `SELECT ${tableColumns
            .map((c) => (isJsonColumnType(c.type)
              ? `CAST(${quoteId(c.name)} AS CHAR) AS ${quoteId(c.name)}`
              : `${quoteId(c.name)}`))
            .join(', ')} FROM ${quoteId(table)}`
        : undefined

      let exportedRows = 0
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        if (!rows.length) return
        for (const row of rows) {
          const vals = getRowNavicatSqlValues(row, tableColumns).join(', ')
          await writeChunk(out, `${insertHead} ${quoteId(table)} VALUES (${vals});\n`)
        }
        exportedRows += rows.length
        reportProgress(exportedRows)
      }, selectSql)

      await writeChunk(out, '\n')
      reportProgress(exportedRows, tableIndex + 1)
    }

    await writeChunk(out, 'SET FOREIGN_KEY_CHECKS = 1;\n')
    await closeStream(out)

    await fs.promises.rename(tmpPath, filePath)

    // 注意：finished 仅代表“全局完成（已 rename 成最终文件名）”，避免 UI 过早显示完成。
    options?.onProgress?.({
      current: requestedTables[requestedTables.length - 1] || '',
      done: requestedTables.length,
      total: requestedTables.length,
      rows: 0,
      finished: true,
    })

    tmpPath = null
  } finally {
    try {
      if (out && !out.writableFinished) {
        out.destroy()
      }
    } finally {
      conn.release()

      if (tmpPath) {
        try { await fs.promises.unlink(tmpPath) } catch { /* ignore */ }
      }
    }
  }
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
    await writeFile(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}
