import mysql from 'mysql2/promise'
import type { ResultSetHeader } from 'mysql2/promise'
import * as fs from 'fs'
import * as readline from 'readline'
import type { Readable } from 'stream'
import * as connectionManager from './connection-manager'
import * as localStore from './local-store'
import { quoteId } from '../utils/sql'
import { applyResultRowLimit } from '../utils/sql-result-limit'
import * as logger from '../utils/logger'
import type { QueryResult, QueryStatementResult } from '../../shared/types/query'

const STMT_KEYWORDS = /^(?:CREATE|INSERT|DROP|ALTER|LOCK|UNLOCK|SET|DELETE|UPDATE|REPLACE|SELECT|WITH|CALL|TRUNCATE|USE|GRANT|REVOKE|COMMIT|ROLLBACK|START\s+TRANSACTION|BEGIN|SHOW|DESCRIBE|DESC|EXPLAIN|ANALYZE|OPTIMIZE|RENAME)\s/i
const PARSE_YIELD_EVERY = 5000
const IMPORT_INSERT_BATCH_MAX_STATEMENTS = 500
const IMPORT_INSERT_BATCH_MAX_SQL_LENGTH = 4 * 1024 * 1024
const COMPOUND_CREATE_START = /^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`|[^`\s]+)@(?:`[^`]+`|[^`\s]+)\s+)?(?:OR\s+REPLACE\s+)?(?:TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/i
const BLOCK_START_KEYWORDS = new Set(['BEGIN', 'CASE', 'IF', 'LOOP', 'REPEAT', 'WHILE'])

const yieldToEventLoop = async () => new Promise<void>((resolve) => setImmediate(resolve))

type ExecutionStatement = {
  index: number
  sql: string
}

type ExecutionUnit = {
  sql: string
  statements: ExecutionStatement[]
  batchedInsert: boolean
}

type BatchableInsertStatement = {
  head: string
  headKey: string
  valuesSql: string
}

export type ExecuteMultiOptions = {
  optimizeInserts?: boolean
  stopOnError?: boolean
  limitResultRows?: boolean
  maxResultRows?: number
  saveHistory?: boolean
  scriptMode?: 'query' | 'import'
}

export type ExecuteMultiProgressPayload = {
  current: number
  total: number
  fail: number
  stage: 'parsing' | 'executing'
  originalStatementTotal?: number
  executableStatementTotal?: number
}

export type ExecuteSqlFileResult = {
  imported: number
  errors: number
  executed: number
  firstError?: string
}

const runningScriptConnections = new Map<string, Set<mysql.Connection>>()

function stripLeadingTrivia(stmt: string): string {
  let s = stmt
  while (true) {
    const ws = s.match(/^\s+/)
    if (ws) s = s.slice(ws[0].length)

    if (s.startsWith('--')) {
      const idx = s.indexOf('\n')
      s = idx >= 0 ? s.slice(idx + 1) : ''
      continue
    }
    if (s.startsWith('#')) {
      const idx = s.indexOf('\n')
      s = idx >= 0 ? s.slice(idx + 1) : ''
      continue
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end >= 0 ? s.slice(end + 2) : ''
      continue
    }

    return s
  }
}

function isWordBoundaryChar(ch: string | undefined): boolean {
  return !ch || !/[A-Za-z0-9_$]/.test(ch)
}

function matchKeywordAt(sql: string, index: number): string | null {
  for (const keyword of BLOCK_START_KEYWORDS) {
    if (sql.slice(index, index + keyword.length).toUpperCase() !== keyword) continue
    const prev = sql[index - 1]
    const next = sql[index + keyword.length]
    if (isWordBoundaryChar(prev) && isWordBoundaryChar(next)) {
      return keyword
    }
  }
  return null
}

function findTopLevelKeyword(sql: string, keyword: string, startIndex = 0): number {
  const upperKeyword = keyword.toUpperCase()
  let inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  let parenDepth = 0

  for (let i = startIndex; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLC) {
      if (ch === '\n') inLC = false
      continue
    }
    if (inBC) {
      if (ch === '*' && next === '/') {
        inBC = false
        i += 1
      }
      continue
    }
    if (inSQ) {
      if (ch === "'" && next === "'") {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === "'") inSQ = false
      continue
    }
    if (inDQ) {
      if (ch === '"' && next === '"') {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === '"') inDQ = false
      continue
    }
    if (inBT) {
      if (ch === '`') inBT = false
      continue
    }

    if (ch === '-' && next === '-') {
      inLC = true
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      inBC = true
      i += 1
      continue
    }
    if (ch === "'") {
      inSQ = true
      continue
    }
    if (ch === '"') {
      inDQ = true
      continue
    }
    if (ch === '`') {
      inBT = true
      continue
    }
    if (ch === '(') {
      parenDepth += 1
      continue
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1
      continue
    }

    if (
      parenDepth === 0
      && sql.slice(i, i + keyword.length).toUpperCase() === upperKeyword
      && isWordBoundaryChar(sql[i - 1])
      && isWordBoundaryChar(sql[i + keyword.length])
    ) {
      return i
    }
  }

  return -1
}

function parseBatchableInsert(stmt: string): BatchableInsertStatement | null {
  const core = stripLeadingTrivia(stmt).trim().replace(/;+\s*$/, '').trim()
  if (!/^(?:INSERT|REPLACE)\s/i.test(core)) return null

  const valuesIndex = findTopLevelKeyword(core, 'VALUES')
  if (valuesIndex < 0) return null

  const trailingClauseIndex = findTopLevelKeyword(core, 'ON', valuesIndex + 'VALUES'.length)
  if (trailingClauseIndex >= 0) return null

  const head = core.slice(0, valuesIndex).trimEnd()
  const valuesSql = core.slice(valuesIndex + 'VALUES'.length).trim()
  if (!valuesSql.startsWith('(') || !valuesSql.endsWith(')')) return null
  if (/^(?:INSERT|REPLACE)\s+.*\bSET\s/i.test(head)) return null

  return {
    head,
    headKey: head.replace(/\s+/g, ' ').toLowerCase(),
    valuesSql,
  }
}

function buildInsertBatchUnit(pending: ExecutionStatement[], parsed: BatchableInsertStatement): ExecutionUnit {
  const values = pending
    .map((item) => parseBatchableInsert(item.sql)?.valuesSql)
    .filter((value): value is string => Boolean(value))

  return {
    sql: `${parsed.head} VALUES ${values.join(', ')}`,
    statements: pending,
    batchedInsert: pending.length > 1,
  }
}

function buildExecutionUnits(statements: string[]): ExecutionUnit[] {
  const units: ExecutionUnit[] = []
  let pendingInsert: ExecutionStatement[] = []
  let pendingParsed: BatchableInsertStatement | null = null
  let pendingSqlLength = 0

  const flushPendingInsert = () => {
    if (!pendingParsed || !pendingInsert.length) return
    units.push(buildInsertBatchUnit(pendingInsert, pendingParsed))
    pendingInsert = []
    pendingParsed = null
    pendingSqlLength = 0
  }

  statements.forEach((sql, index) => {
    const statement: ExecutionStatement = { index: index + 1, sql }
    const parsed = parseBatchableInsert(sql)

    if (!parsed) {
      flushPendingInsert()
      units.push({ sql, statements: [statement], batchedInsert: false })
      return
    }

    const projectedLength = pendingSqlLength + parsed.valuesSql.length + 2
    const canJoinPending = pendingParsed
      && pendingParsed.headKey === parsed.headKey
      && pendingInsert.length < IMPORT_INSERT_BATCH_MAX_STATEMENTS
      && projectedLength <= IMPORT_INSERT_BATCH_MAX_SQL_LENGTH

    if (!canJoinPending) {
      flushPendingInsert()
      pendingParsed = parsed
      pendingSqlLength = parsed.head.length + ' VALUES '.length
    }

    pendingInsert.push(statement)
    pendingSqlLength += parsed.valuesSql.length + 2
  })

  flushPendingInsert()
  return units
}

function splitBatchResult(result: QueryStatementResult, unit: ExecutionUnit): QueryStatementResult[] {
  if (unit.statements.length === 1) {
    return [{ ...result, index: unit.statements[0].index, sql: unit.statements[0].sql }]
  }

  const affectedRows = Math.max(0, Number(result.affectedRows || 0))
  const perStatementAffectedRows = Math.floor(affectedRows / unit.statements.length)
  const remainder = affectedRows % unit.statements.length
  const perStatementExecutionTime = Math.max(0, result.executionTime / unit.statements.length)

  return unit.statements.map((statement, offset) => ({
    ...result,
    index: statement.index,
    sql: statement.sql,
    affectedRows: perStatementAffectedRows + (offset < remainder ? 1 : 0),
    insertId: offset === 0 ? result.insertId : 0,
    executionTime: perStatementExecutionTime,
    rowCount: 0,
    columns: [],
    rows: [],
  }))
}

function mapFields(fields: Array<{ name: string; type?: number; flags?: number }> = []): QueryResult['columns'] {
  return fields.map((field) => ({
    name: field.name,
    type: field.type?.toString() || '',
    nullable: field.flags ? !(field.flags & 1) : true,
    defaultValue: null,
    primaryKey: field.flags ? !!(field.flags & 2) : false,
    autoIncrement: field.flags ? !!(field.flags & 512) : false,
    comment: '',
  }))
}

async function executeStatement(conn: mysql.Connection, stmt: string, index: number, options?: ExecuteMultiOptions): Promise<QueryStatementResult> {
  const startedAt = Date.now()
  const limitedStmt = applyResultRowLimit(stmt, {
    enabled: options?.limitResultRows === true,
    maxRows: options?.maxResultRows,
  })
  try {
    const [rows, fields] = await conn.query(limitedStmt.sql)
    const executionTime = Date.now() - startedAt
    const isMultipleStatements = Array.isArray(rows) && rows.length > 0 && Array.isArray((rows as unknown[])[0])

    if (isMultipleStatements) {
      let totalAffectedRows = 0
      let lastInsertId = 0
      const allRows: Record<string, unknown>[] = []
      let allColumns: QueryResult['columns'] = []
      let hasSelectResult = false
      const multiRows = rows as unknown[]
      const multiFields = fields as unknown[]

      for (let i = 0; i < multiRows.length; i += 1) {
        const statementResult = multiRows[i]
        const statementFields = multiFields?.[i] as Array<{ name: string; type?: number; flags?: number }> | undefined
        if (Array.isArray(statementResult)) {
          hasSelectResult = true
          allRows.push(...statementResult as Record<string, unknown>[])
          if (allColumns.length === 0 && statementFields) {
            allColumns = mapFields(statementFields)
          }
        } else if (statementResult && typeof statementResult === 'object') {
          const header = statementResult as ResultSetHeader
          totalAffectedRows += Number(header.affectedRows || 0)
          if (header.insertId && header.insertId > lastInsertId) {
            lastInsertId = header.insertId
          }
        }
      }

      return {
        index,
        sql: stmt,
        isSelect: hasSelectResult,
        success: true,
        columns: allColumns,
        rows: allRows,
        affectedRows: totalAffectedRows,
        insertId: lastInsertId,
        executionTime,
        rowCount: allRows.length,
        error: null,
        limited: limitedStmt.limited,
        limitApplied: limitedStmt.limited ? limitedStmt.limit : undefined,
      }
    }

    if (Array.isArray(rows)) {
      return {
        index,
        sql: stmt,
        isSelect: true,
        success: true,
        columns: mapFields(fields as Array<{ name: string; type?: number; flags?: number }>),
        rows: rows as Record<string, unknown>[],
        affectedRows: 0,
        insertId: 0,
        executionTime,
        rowCount: rows.length,
        error: null,
        limited: limitedStmt.limited,
        limitApplied: limitedStmt.limited ? limitedStmt.limit : undefined,
      }
    }

    const info = rows as ResultSetHeader
    return {
      index,
      sql: stmt,
      isSelect: false,
      success: true,
      columns: [],
      rows: [],
      affectedRows: Number(info.affectedRows || 0),
      insertId: Number(info.insertId || 0),
      executionTime,
      rowCount: 0,
      error: null,
    }
  } catch (error: any) {
    return {
      index,
      sql: stmt,
      isSelect: false,
      success: false,
      columns: [],
      rows: [],
      affectedRows: 0,
      insertId: 0,
      executionTime: Date.now() - startedAt,
      rowCount: 0,
      error: error?.message || '执行失败',
    }
  }
}

async function executeUnit(conn: mysql.Connection, unit: ExecutionUnit, options?: ExecuteMultiOptions): Promise<QueryStatementResult[]> {
  const result = await executeStatement(conn, unit.sql, unit.statements[0].index, options)
  if (result.success) {
    return splitBatchResult(result, unit)
  }

  if (!unit.batchedInsert) {
    return [{ ...result, index: unit.statements[0].index, sql: unit.statements[0].sql }]
  }

  const results: QueryStatementResult[] = []
  for (const statement of unit.statements) {
    results.push(await executeStatement(conn, statement.sql, statement.index, options))
  }
  return results
}

async function splitStatementsWithProgress(
  sql: string,
  onProgress?: (progress: { current: number; total: number; stage: 'parsing' }) => void,
): Promise<string[]> {
  const statements: string[] = []
  const total = Math.max(sql.length, 1)
  let currentStatement = ''
  let i = 0
  let inSQ = false
  let inDQ = false
  let inBT = false
  let inLC = false
  let inBC = false
  let delimiter = ';'
  let statementStart = 0
  let inCompoundStatement = false
  let compoundDepth = 0
  let lastReported = -1

  const finalizeCurrent = async (endIndex: number) => {
    const trimmed = currentStatement.trim()
    if (trimmed) statements.push(trimmed)
    currentStatement = ''
    statementStart = endIndex
    inCompoundStatement = false
    compoundDepth = 0
    await maybeReport()
  }

  const maybeReport = async (force = false) => {
    if (!onProgress) return
    const current = Math.min(i, total)
    if (!force && current - lastReported < PARSE_YIELD_EVERY && current < total) return
    lastReported = current
    onProgress({ current, total, stage: 'parsing' })
    await yieldToEventLoop()
  }

  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (inLC) { if (c === '\n') inLC = false; currentStatement += c; i += 1; await maybeReport(); continue }
    if (inBC) { if (c === '*' && n === '/') { currentStatement += '*/'; i += 2; await maybeReport(); inBC = false; continue } currentStatement += c; i += 1; await maybeReport(); continue }
    if (inSQ) { if (c === "'" && n === "'") { currentStatement += "''"; i += 2; await maybeReport(); continue } if (c === '\\') { currentStatement += c + (n || ''); i += 2; await maybeReport(); continue } if (c === "'") inSQ = false; currentStatement += c; i += 1; await maybeReport(); continue }
    if (inDQ) { if (c === '"' && n === '"') { currentStatement += '""'; i += 2; await maybeReport(); continue } if (c === '\\') { currentStatement += c + (n || ''); i += 2; await maybeReport(); continue } if (c === '"') inDQ = false; currentStatement += c; i += 1; await maybeReport(); continue }
    if (inBT) { if (c === '`') inBT = false; currentStatement += c; i += 1; await maybeReport(); continue }
    if (c === '-' && n === '-') { inLC = true; currentStatement += c; i += 1; await maybeReport(); continue }
    if (c === '/' && n === '*') { inBC = true; currentStatement += '/*'; i += 2; await maybeReport(); continue }
    if (c === "'") { inSQ = true; currentStatement += c; i += 1; await maybeReport(); continue }
    if (c === '"') { inDQ = true; currentStatement += c; i += 1; await maybeReport(); continue }
    if (c === '`') { inBT = true; currentStatement += c; i += 1; await maybeReport(); continue }

    if (!currentStatement.trim()) {
      const lineStart = i === 0 || sql[i - 1] === '\n'
      if (lineStart && sql.slice(i, i + 9).toUpperCase() === 'DELIMITER' && isWordBoundaryChar(sql[i + 9])) {
        let j = i + 9
        while (j < sql.length && /\s/.test(sql[j])) j += 1
        let k = j
        while (k < sql.length && sql[k] !== '\n' && sql[k] !== '\r') k += 1
        delimiter = sql.slice(j, k).trim() || ';'
        i = k
        statementStart = i
        await maybeReport()
        continue
      }
    }

    if (!inCompoundStatement && !currentStatement.trim()) {
      const upcoming = sql.slice(i)
      if (COMPOUND_CREATE_START.test(stripLeadingTrivia(upcoming))) {
        inCompoundStatement = true
        compoundDepth = 0
      }
    }

    if (inCompoundStatement) {
      const keyword = matchKeywordAt(sql, i)
      if (keyword) {
        if (keyword === 'BEGIN') {
          compoundDepth += 1
        } else if (compoundDepth > 0) {
          compoundDepth += 1
        }
        currentStatement += sql.slice(i, i + keyword.length)
        i += keyword.length
        await maybeReport()
        continue
      }

      if (sql.slice(i, i + 3).toUpperCase() === 'END' && isWordBoundaryChar(sql[i - 1]) && isWordBoundaryChar(sql[i + 3])) {
        if (compoundDepth > 0) compoundDepth -= 1
        currentStatement += 'END'
        i += 3
        await maybeReport()
        continue
      }
    }

    if (delimiter && sql.slice(i, i + delimiter.length) === delimiter) {
      if (!inCompoundStatement || compoundDepth === 0) {
        await finalizeCurrent(i + delimiter.length)
        i += delimiter.length
        continue
      }
    }

    currentStatement += c
    i += 1
    await maybeReport()
  }

  const trimmed = currentStatement.trim()
  if (trimmed) statements.push(trimmed)
  i = total
  await maybeReport(true)
  return statements
}

function ensureSemicolons(sql: string): string {
  const out: string[] = []
  let i = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let statementBuffer = ''
  let inCompoundStatement = false
  let compoundDepth = 0
  let parenDepth = 0
  let lastNonWS = ''

  const refreshCompoundState = () => {
    const trimmed = stripLeadingTrivia(statementBuffer)
    if (!trimmed) return
    if (!inCompoundStatement && COMPOUND_CREATE_START.test(trimmed)) {
      inCompoundStatement = true
      compoundDepth = 0
    }
  }

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      out.push(ch)
      statementBuffer += ch
      i += 1
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        out.push('*/')
        statementBuffer += '*/'
        i += 2
        inBlockComment = false
        continue
      }
      out.push(ch)
      statementBuffer += ch
      i += 1
      continue
    }

    if (inSingle) {
      if (ch === "'" && next === "'") { out.push("''"); statementBuffer += "''"; i += 2; continue }
      if (ch === '\\') { out.push(ch, next || ''); statementBuffer += ch + (next || ''); i += 2; continue }
      if (ch === "'") inSingle = false
      out.push(ch)
      statementBuffer += ch
      i += 1
      continue
    }
    if (inDouble) {
      if (ch === '"' && next === '"') { out.push('""'); statementBuffer += '""'; i += 2; continue }
      if (ch === '\\') { out.push(ch, next || ''); statementBuffer += ch + (next || ''); i += 2; continue }
      if (ch === '"') inDouble = false
      out.push(ch)
      statementBuffer += ch
      i += 1
      continue
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false
      out.push(ch)
      statementBuffer += ch
      i += 1
      continue
    }

    if (ch === '-' && next === '-') { inLineComment = true; out.push(ch); statementBuffer += ch; i += 1; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; out.push('/*'); statementBuffer += '/*'; i += 2; continue }
    if (ch === "'") { inSingle = true; out.push(ch); statementBuffer += ch; i += 1; continue }
    if (ch === '"') { inDouble = true; out.push(ch); statementBuffer += ch; i += 1; continue }
    if (ch === '`') { inBacktick = true; out.push(ch); statementBuffer += ch; i += 1; continue }

    const keyword = matchKeywordAt(sql, i)
    if (keyword) {
      refreshCompoundState()
      if (inCompoundStatement) {
        if (keyword === 'BEGIN') {
          compoundDepth += 1
        } else if (compoundDepth > 0) {
          compoundDepth += 1
        }
      }
      out.push(keyword)
      statementBuffer += keyword
      if (keyword.length > 1) lastNonWS = keyword[keyword.length - 1]
      i += keyword.length
      continue
    }

    if (sql.slice(i, i + 3).toUpperCase() === 'END' && isWordBoundaryChar(sql[i - 1]) && isWordBoundaryChar(sql[i + 3])) {
      if (inCompoundStatement && compoundDepth > 0) compoundDepth -= 1
      out.push('END')
      statementBuffer += 'END'
      lastNonWS = 'D'
      i += 3
      continue
    }

    if (
      ch === '\n'
      && !inCompoundStatement
      && parenDepth === 0
      && lastNonWS
      && lastNonWS !== ';'
      && lastNonWS !== '{'
      && lastNonWS !== '}'
      && !'([,=:+-*/%<>'.includes(lastNonWS)
    ) {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ' ' || sql[j] === '\t' || sql[j] === '\r' || sql[j] === '\n') { j += 1; continue }
        if (sql[j] === '-' && sql[j + 1] === '-') { while (j < sql.length && sql[j] !== '\n') j += 1; continue }
        break
      }
      const rest = sql.substring(j, j + 12)
      if (STMT_KEYWORDS.test(rest)) {
        out.push(';\n')
        lastNonWS = ';'
        i = j
        continue
      }
    }

    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') lastNonWS = ch
    if (ch === '(') parenDepth += 1
    if (ch === ')' && parenDepth > 0) parenDepth -= 1
    out.push(ch)
    statementBuffer += ch
    if (ch === ';') {
      statementBuffer = ''
      inCompoundStatement = false
      compoundDepth = 0
      parenDepth = 0
    }
    i += 1
  }
  return out.join('')
}

function injectDropBeforeCreateTables(
  statements: string[],
  defaultDb?: string,
): string[] {
  const mkKey = (db: string | undefined, table: string) => `${String(db || defaultDb || '').toLowerCase()}::${table.toLowerCase()}`

  const parseDropTable = (stmt: string): { db?: string; table: string } | null => {
    const core = stripLeadingTrivia(stmt)
    const match = core.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:`([^`]+)`|([A-Za-z0-9_]+))\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_]+))/i)
    if (!match) return null
    const db = (match[1] || match[2] || undefined) as string | undefined
    const table = (match[3] || match[4]) as string
    return { db, table }
  }

  const parseCreateTable = (stmt: string): { db?: string; table: string } | null => {
    const core = stripLeadingTrivia(stmt)
    const match = core.match(/^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:`([^`]+)`|([A-Za-z0-9_]+))\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_]+))/i)
    if (!match) return null
    const db = (match[1] || match[2] || undefined) as string | undefined
    const table = (match[3] || match[4]) as string
    return { db, table }
  }

  const buildDropStmt = (db: string | undefined, table: string) => {
    const dbName = db || defaultDb
    return dbName ? `DROP TABLE IF EXISTS ${quoteId(dbName)}.${quoteId(table)}` : `DROP TABLE IF EXISTS ${quoteId(table)}`
  }

  const statementsWithDrop: string[] = []
  const seenDrop = new Set<string>()
  for (const stmt of statements) {
    const trimmed = stmt.trim()
    if (!trimmed) continue

    const dropInfo = parseDropTable(trimmed)
    if (dropInfo) {
      seenDrop.add(mkKey(dropInfo.db, dropInfo.table))
      statementsWithDrop.push(trimmed)
      continue
    }

    const createInfo = parseCreateTable(trimmed)
    if (createInfo) {
      const key = mkKey(createInfo.db, createInfo.table)
      if (!seenDrop.has(key)) {
        statementsWithDrop.push(buildDropStmt(createInfo.db, createInfo.table))
        seenDrop.add(key)
      }
      statementsWithDrop.push(trimmed)
      continue
    }

    statementsWithDrop.push(trimmed)
  }

  return statementsWithDrop
}

export async function executeMultiStatementSql(
  connectionId: string,
  sql: string,
  database?: string,
  options?: ExecuteMultiOptions,
  onProgress?: (payload: ExecuteMultiProgressPayload) => void,
): Promise<QueryResult> {
  const startedAt = Date.now()
  let result: QueryResult | null = null
  let isSuccess = true
  let historyErrorMessage = ''
  const pool = connectionManager.getPool(connectionId) as { pool?: { config?: { connectionConfig?: Record<string, unknown> } }; config?: { connectionConfig?: Record<string, unknown> } }
  const poolConfig = pool?.pool?.config?.connectionConfig || pool?.config?.connectionConfig || {} as Record<string, unknown>
  const conn = await mysql.createConnection({
    host: poolConfig.host,
    port: poolConfig.port,
    user: poolConfig.user,
    password: poolConfig.password,
    database: database || poolConfig.database,
    charset: poolConfig.charset,
    multipleStatements: true,
  })

  try {
    let runningSet = runningScriptConnections.get(connectionId)
    if (!runningSet) {
      runningSet = new Set()
      runningScriptConnections.set(connectionId, runningSet)
    }
    runningSet.add(conn)

    let cleaned = sql.replace(/^\uFEFF/, '')
    if (database) await conn.query(`USE ${quoteId(database)}`)
    const importMode = options?.scriptMode === 'import' || options?.optimizeInserts === true
    if (importMode) {
      await conn.query(`SET SQL_MODE=''`)
      await conn.query(`SET FOREIGN_KEY_CHECKS=0`)
    }
    await conn.query(`SET NAMES utf8mb4`)

    if (importMode) {
      cleaned = ensureSemicolons(cleaned)
    }
    onProgress?.({ current: 0, total: Math.max(cleaned.length, 1), fail: 0, stage: 'parsing' })
    const parsedStatements = await splitStatementsWithProgress(cleaned, ({ current, total, stage }) => {
      onProgress?.({ current, total, fail: 0, stage })
    })

    const optimizeInserts = options?.optimizeInserts === true
    const originalStatementTotal = parsedStatements.length
    const executableStatements = (importMode ? injectDropBeforeCreateTables(parsedStatements, String(database || poolConfig.database || '') || undefined) : parsedStatements)
      .map((stmt) => stmt.trim())
      .filter(Boolean)
    if (executableStatements.length === 0) {
      return {
        columns: [],
        rows: [],
        affectedRows: 0,
        insertId: 0,
        executionTime: 0,
        rowCount: 0,
        sql,
        isSelect: false,
        statementResults: [{
          index: 1,
          sql: sql.trim() || '(空 SQL)',
          isSelect: false,
          success: false,
          columns: [],
          rows: [],
          affectedRows: 0,
          insertId: 0,
          executionTime: 0,
          rowCount: 0,
          error: '没有可执行的 SQL 语句',
        }],
        successCount: 0,
        failCount: 1,
      }
    }
    const executionUnits = optimizeInserts
      ? buildExecutionUnits(executableStatements)
      : executableStatements.map((stmt, index) => ({
          sql: stmt,
          statements: [{ index: index + 1, sql: stmt }],
          batchedInsert: false,
        } satisfies ExecutionUnit))

    let successCount = 0
    let failCount = 0
    const statementResults: QueryStatementResult[] = []
    const total = executableStatements.length
    const executionTotal = executionUnits.length

    onProgress?.({
      current: 0,
      total,
      fail: 0,
      stage: total > 0 ? 'executing' : 'parsing',
      originalStatementTotal,
      executableStatementTotal: total,
    })

    let executedUnits = 0
    const emitProgress = () => {
      onProgress?.({
        current: successCount + failCount,
        total,
        fail: failCount,
        stage: 'executing',
        originalStatementTotal,
        executableStatementTotal: total,
      })
    }

    for (const unit of executionUnits) {
      const unitResults = await executeUnit(conn, unit, options)
      executedUnits += 1
      for (const result of unitResults) {
        statementResults.push(result)
        if (result.success) successCount += 1
        else failCount += 1
      }
      emitProgress()
      if (options?.stopOnError && unitResults.some((item) => !item.success)) {
        break
      }
      if (executionTotal > 0 && executedUnits % 20 === 0) {
        await yieldToEventLoop()
      }
    }

    statementResults.sort((a, b) => a.index - b.index)
    const lastSelect = [...statementResults].reverse().find((item) => item.success && item.isSelect)
    const lastMutation = [...statementResults].reverse().find((item) => item.success && !item.isSelect)

    result = {
      columns: lastSelect?.columns || [],
      rows: lastSelect?.rows || [],
      affectedRows: statementResults.reduce((sum, item) => sum + item.affectedRows, 0),
      insertId: lastMutation?.insertId || lastSelect?.insertId || 0,
      executionTime: statementResults.reduce((sum, item) => sum + item.executionTime, 0),
      rowCount: lastSelect?.rowCount || 0,
      sql,
      isSelect: !!lastSelect,
      statementResults,
      successCount,
      failCount,
      limited: statementResults.some((item) => item.limited),
      limitApplied: statementResults.find((item) => item.limited)?.limitApplied,
    }
    return result
  } catch (error: any) {
    isSuccess = false
    historyErrorMessage = error?.message || '执行失败'
    throw new Error(error.message)
  } finally {
    const runningSet = runningScriptConnections.get(connectionId)
    runningSet?.delete(conn)
    if (runningSet && runningSet.size === 0) {
      runningScriptConnections.delete(connectionId)
    }
    await conn.end()
    if (options?.saveHistory) {
      const elapsed = Date.now() - startedAt
      try {
        localStore.queryHistory.save({
          connectionId,
          databaseName: database || '',
          sqlText: sql,
          executionTimeMs: elapsed,
          rowCount: isSuccess && result ? (result.rowCount || result.affectedRows) : 0,
          isSuccess,
          errorMessage: historyErrorMessage,
          isSlow: elapsed > 1000,
          createdAt: new Date().toISOString(),
        })
      } catch (historyError) {
        logger.warn('Failed to save query history', historyError)
      }
    }
  }
}

export function cancelMultiStatementSql(connectionId: string): void {
  const runningSet = runningScriptConnections.get(connectionId)
  if (!runningSet) return
  for (const conn of runningSet) {
    try {
      conn.destroy()
    } catch {
      // ignore destroy errors
    }
  }
  runningScriptConnections.delete(connectionId)
}

export async function executeSqlFile(
  connectionId: string,
  filePathOrStream: string | Readable,
  database?: string,
  options?: ExecuteMultiOptions,
): Promise<ExecuteSqlFileResult> {
  const pool = connectionManager.getPool(connectionId) as { pool?: { config?: { connectionConfig?: Record<string, unknown> } }; config?: { connectionConfig?: Record<string, unknown> } }
  const poolConfig = pool?.pool?.config?.connectionConfig || pool?.config?.connectionConfig || {} as Record<string, unknown>
  const conn = await mysql.createConnection({
    host: poolConfig.host,
    port: poolConfig.port,
    user: poolConfig.user,
    password: poolConfig.password,
    database: database || poolConfig.database,
    charset: poolConfig.charset,
    multipleStatements: true,
  })

  let runningSet = runningScriptConnections.get(connectionId)
  if (!runningSet) {
    runningSet = new Set()
    runningScriptConnections.set(connectionId, runningSet)
  }
  runningSet.add(conn)

  let imported = 0
  let errors = 0
  let executed = 0
  let firstError: string | undefined
  let statementIndex = 0
  let pendingInserts: ExecutionStatement[] = []
  let pendingParsed: BatchableInsertStatement | null = null
  let pendingSqlLength = 0

  const executeStatements = async (statements: ExecutionStatement[]) => {
    if (!statements.length) return true
    const units = options?.optimizeInserts ? buildExecutionUnits(statements.map((item) => item.sql)) : statements.map((statement) => ({
      sql: statement.sql,
      statements: [statement],
      batchedInsert: false,
    } satisfies ExecutionUnit))

    for (const unit of units) {
      const unitResults = await executeUnit(conn, unit)
      for (const result of unitResults) {
        executed += 1
        if (result.success) {
          imported += result.affectedRows || 0
        } else {
          errors += 1
          firstError ||= result.error || 'SQL 执行失败'
        }
      }
      if (options?.stopOnError && unitResults.some((item) => !item.success)) return false
    }
    return true
  }

  const flushPendingInserts = async () => {
    const batch = pendingInserts
    pendingInserts = []
    pendingParsed = null
    pendingSqlLength = 0
    return executeStatements(batch)
  }

  const enqueueStatement = async (sql: string) => {
    const trimmed = sql.trim()
    if (!trimmed) return true
    statementIndex += 1
    const statement: ExecutionStatement = { index: statementIndex, sql: trimmed }
    const parsed = options?.optimizeInserts ? parseBatchableInsert(trimmed) : null

    if (!parsed) {
      const ok = await flushPendingInserts()
      if (!ok) return false
      return executeStatements([statement])
    }

    const projectedLength = pendingSqlLength + parsed.valuesSql.length + 2
    const canJoinPending = pendingParsed
      && pendingParsed.headKey === parsed.headKey
      && pendingInserts.length < IMPORT_INSERT_BATCH_MAX_STATEMENTS
      && projectedLength <= IMPORT_INSERT_BATCH_MAX_SQL_LENGTH

    if (!canJoinPending) {
      const ok = await flushPendingInserts()
      if (!ok) return false
      pendingParsed = parsed
      pendingSqlLength = parsed.head.length + ' VALUES '.length
    }

    pendingInserts.push(statement)
    pendingSqlLength += parsed.valuesSql.length + 2
    return true
  }

  try {
    if (database) await conn.query(`USE ${quoteId(database)}`)
    await conn.query(`SET SQL_MODE=''`)
    await conn.query(`SET FOREIGN_KEY_CHECKS=0`)
    await conn.query(`SET NAMES utf8mb4`)

    const input = typeof filePathOrStream === 'string'
      ? fs.createReadStream(filePathOrStream, { encoding: 'utf-8' })
      : filePathOrStream
    const rl = readline.createInterface({
      input,
      crlfDelay: Infinity,
    })

    let delimiter = ';'
    let buffer = ''
    let stopped = false
    for await (const line of rl) {
      const delimiterMatch = line.match(/^\s*DELIMITER\s+(.+?)\s*$/i)
      if (delimiterMatch && !buffer.trim()) {
        delimiter = delimiterMatch[1] || ';'
        continue
      }

      buffer += `${line}\n`
      const trimmedEnd = buffer.trimEnd()
      if (!trimmedEnd.endsWith(delimiter)) continue

      const stmt = trimmedEnd.slice(0, -delimiter.length)
      buffer = ''
      const ok = await enqueueStatement(stmt)
      if (!ok) {
        stopped = true
        rl.close()
        break
      }
    }

    if (!stopped && buffer.trim()) {
      await enqueueStatement(buffer)
    }
    if (!stopped) {
      await flushPendingInserts()
    }

    return { imported, errors, executed, firstError }
  } finally {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=1')
    } catch {
      // ignore cleanup reset errors
    }
    const runningSet = runningScriptConnections.get(connectionId)
    runningSet?.delete(conn)
    if (runningSet && runningSet.size === 0) {
      runningScriptConnections.delete(connectionId)
    }
    await conn.end()
  }
}
