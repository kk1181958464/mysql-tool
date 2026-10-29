import mysql from 'mysql2/promise'
import { formatErrorMessage } from '../../shared/error-message'
import type { ConnectionOptions, ResultSetHeader } from 'mysql2/promise'
import * as fs from 'fs'
import * as readline from 'readline'
import type { Readable } from 'stream'
import * as connectionManager from './connection-manager'
import * as localStore from './local-store'
import { quoteId } from '../utils/sql'
import { applyResultRowLimit } from '../utils/sql-result-limit'
import { stripLeadingTrivia, findTopLevelKeyword } from '../utils/sql-cursor'
import { SqlStatementScanner } from '../../shared/sql-splitter'
import * as logger from '../utils/logger'
import type { QueryResult, QueryResultSet, QueryStatementResult } from '../../shared/types/query'

const STMT_KEYWORDS = /^(?:CREATE|INSERT|DROP|ALTER|LOCK|UNLOCK|SET|DELETE|UPDATE|REPLACE|SELECT|WITH|CALL|TRUNCATE|USE|GRANT|REVOKE|COMMIT|ROLLBACK|START\s+TRANSACTION|BEGIN|SHOW|DESCRIBE|DESC|EXPLAIN|ANALYZE|OPTIMIZE|RENAME)\s/i
const PARSE_CHUNK_SIZE = 256 * 1024
const IMPORT_INSERT_BATCH_MAX_STATEMENTS = 500
const IMPORT_INSERT_BATCH_MAX_SQL_LENGTH = 4 * 1024 * 1024

// 合并后的 INSERT 不能超过服务器 max_allowed_packet（5.7 默认仅 4MB），否则每批都会失败并退回逐条执行
async function getInsertBatchMaxLength(conn: mysql.Connection): Promise<number> {
  try {
    const [rows] = await conn.query('SELECT @@max_allowed_packet AS packet')
    const packet = Number((rows as Array<{ packet?: number | string }>)[0]?.packet)
    if (!Number.isFinite(packet) || packet <= 0) return IMPORT_INSERT_BATCH_MAX_SQL_LENGTH
    return Math.max(64 * 1024, Math.min(IMPORT_INSERT_BATCH_MAX_SQL_LENGTH, Math.floor(packet / 2)))
  } catch {
    return IMPORT_INSERT_BATCH_MAX_SQL_LENGTH / 4
  }
}

const yieldToEventLoop = async () => new Promise<void>((resolve) => setImmediate(resolve))

const getScriptConnectionOptions = (connectionId: string, database?: string): ConnectionOptions =>
  connectionManager.getScriptConnectionOptions(connectionId, database)

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
  executionId?: string
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
const cancelledConnections = new WeakSet<mysql.Connection>()

function cancelScriptConnection(connectionId: string, conn: mysql.Connection): void {
  cancelledConnections.add(conn)
  const threadId = (conn as unknown as { threadId?: number }).threadId
  const destroy = () => {
    try { conn.destroy() } catch { /* ignore destroy errors */ }
  }
  if (!threadId) {
    destroy()
    return
  }
  let pool: mysql.Pool | null = null
  try { pool = connectionManager.getPool(connectionId) } catch { pool = null }
  if (!pool) {
    destroy()
    return
  }
  pool.query(`KILL QUERY ${Number(threadId)}`).catch(() => {}).finally(destroy)
}

function getRunningScriptKey(connectionId: string, executionId?: string): string {
  return executionId ? `${connectionId}:${executionId}` : connectionId
}

function addRunningScriptConnection(key: string, conn: mysql.Connection): void {
  let runningSet = runningScriptConnections.get(key)
  if (!runningSet) {
    runningSet = new Set()
    runningScriptConnections.set(key, runningSet)
  }
  runningSet.add(conn)
}

function removeRunningScriptConnection(key: string, conn: mysql.Connection): void {
  const runningSet = runningScriptConnections.get(key)
  runningSet?.delete(conn)
  if (runningSet && runningSet.size === 0) {
    runningScriptConnections.delete(key)
  }
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

function buildExecutionUnits(statements: string[], maxSqlLength = IMPORT_INSERT_BATCH_MAX_SQL_LENGTH): ExecutionUnit[] {
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
      && projectedLength <= maxSqlLength

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
      const resultSets: QueryResultSet[] = []
      let hasSelectResult = false
      const multiRows = rows as unknown[]
      const multiFields = fields as unknown[]

      for (let i = 0; i < multiRows.length; i += 1) {
        const statementResult = multiRows[i]
        const statementFields = multiFields?.[i] as Array<{ name: string; type?: number; flags?: number }> | undefined
        if (Array.isArray(statementResult)) {
          hasSelectResult = true
          const resultRows = statementResult as Record<string, unknown>[]
          resultSets.push({ columns: mapFields(statementFields), rows: resultRows, rowCount: resultRows.length })
        } else if (statementResult && typeof statementResult === 'object') {
          const header = statementResult as ResultSetHeader
          totalAffectedRows += Number(header.affectedRows || 0)
          if (header.insertId && header.insertId > lastInsertId) {
            lastInsertId = header.insertId
          }
        }
      }

      const firstResultSet = resultSets[0]

      return {
        index,
        sql: stmt,
        isSelect: hasSelectResult,
        success: true,
        columns: firstResultSet?.columns || [],
        rows: firstResultSet?.rows || [],
        affectedRows: totalAffectedRows,
        insertId: lastInsertId,
        executionTime,
        rowCount: resultSets.reduce((sum, item) => sum + item.rowCount, 0),
        error: null,
        limited: limitedStmt.limited,
        limitApplied: limitedStmt.limited ? limitedStmt.limit : undefined,
        resultSets,
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
      error: formatErrorMessage(error, '执行失败'),
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

export async function splitStatementsWithProgress(
  sql: string,
  onProgress?: (progress: { current: number; total: number; stage: 'parsing' }) => void,
): Promise<string[]> {
  const statements: string[] = []
  const total = Math.max(sql.length, 1)
  const scanner = new SqlStatementScanner()
  const collect = (segments: ReturnType<SqlStatementScanner['feed']>) => {
    for (const segment of segments) if (!segment.empty && segment.text) statements.push(segment.text)
  }
  for (let offset = 0; offset < sql.length; offset += PARSE_CHUNK_SIZE) {
    collect(scanner.feed(sql.slice(offset, offset + PARSE_CHUNK_SIZE)))
    if (onProgress) {
      onProgress({ current: Math.min(offset + PARSE_CHUNK_SIZE, total), total, stage: 'parsing' })
      await yieldToEventLoop()
    }
  }
  collect(scanner.finish())
  onProgress?.({ current: total, total, stage: 'parsing' })
  return statements
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
  const connectionOptions = getScriptConnectionOptions(connectionId, database)
  const conn = await mysql.createConnection(connectionOptions)
  const runningKey = getRunningScriptKey(connectionId, options?.executionId)

  try {
    addRunningScriptConnection(runningKey, conn)

    let cleaned = sql.replace(/^\uFEFF/, '')
    if (database) await conn.query(`USE ${quoteId(database)}`)
    const importMode = options?.scriptMode === 'import' || options?.optimizeInserts === true
    if (importMode) {
      await conn.query(`SET SQL_MODE=''`)
      await conn.query(`SET FOREIGN_KEY_CHECKS=0`)
    }
    await conn.query(`SET NAMES utf8mb4`)

    onProgress?.({ current: 0, total: Math.max(cleaned.length, 1), fail: 0, stage: 'parsing' })
    const parsedStatements = await splitStatementsWithProgress(cleaned, ({ current, total, stage }) => {
      onProgress?.({ current, total, fail: 0, stage })
    })

    const optimizeInserts = options?.optimizeInserts === true
    const originalStatementTotal = parsedStatements.length
    const executableStatements = parsedStatements
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
      ? buildExecutionUnits(executableStatements, await getInsertBatchMaxLength(conn))
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
      if (cancelledConnections.has(conn)) throw new Error('查询已取消')
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
    historyErrorMessage = formatErrorMessage(error, '执行失败')
    throw new Error(historyErrorMessage)
  } finally {
    removeRunningScriptConnection(runningKey, conn)
    try {
      await conn.end()
    } catch {
      // Connection may already be destroyed by cancellation.
    }
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

export function cancelMultiStatementSql(connectionId: string, executionId?: string): void {
  const runningKey = getRunningScriptKey(connectionId, executionId)
  const runningSet = runningScriptConnections.get(runningKey)
  if (runningSet) {
    for (const conn of runningSet) {
      cancelScriptConnection(connectionId, conn)
    }
    runningScriptConnections.delete(runningKey)
    if (executionId) return
  }

  if (executionId) return

  for (const [key, connections] of runningScriptConnections.entries()) {
    if (key !== connectionId && !key.startsWith(`${connectionId}:`)) continue
    for (const conn of connections) {
      cancelScriptConnection(connectionId, conn)
    }
    runningScriptConnections.delete(key)
  }
}

export async function executeSqlFile(
  connectionId: string,
  filePathOrStream: string | Readable,
  database?: string,
  options?: ExecuteMultiOptions,
): Promise<ExecuteSqlFileResult> {
  const conn = await mysql.createConnection(getScriptConnectionOptions(connectionId, database))

  const runningKey = getRunningScriptKey(connectionId, options?.executionId)
  let runningSet = runningScriptConnections.get(runningKey)
  if (!runningSet) {
    runningSet = new Set()
    runningScriptConnections.set(runningKey, runningSet)
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
  let maxBatchSqlLength = IMPORT_INSERT_BATCH_MAX_SQL_LENGTH

  const executeStatements = async (statements: ExecutionStatement[]) => {
    if (!statements.length) return true
    const units = options?.optimizeInserts ? buildExecutionUnits(statements.map((item) => item.sql), maxBatchSqlLength) : statements.map((statement) => ({
      sql: statement.sql,
      statements: [statement],
      batchedInsert: false,
    } satisfies ExecutionUnit))

    for (const unit of units) {
      if (cancelledConnections.has(conn)) throw new Error('任务已取消')
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
      && projectedLength <= maxBatchSqlLength

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
    if (options?.optimizeInserts) maxBatchSqlLength = await getInsertBatchMaxLength(conn)

    const input = typeof filePathOrStream === 'string'
      ? fs.createReadStream(filePathOrStream, { encoding: 'utf-8' })
      : filePathOrStream
    const rl = readline.createInterface({
      input,
      crlfDelay: Infinity,
    })

    const scanner = new SqlStatementScanner()
    let stopped = false

    const enqueueSegments = async (segments: ReturnType<SqlStatementScanner['feed']>) => {
      for (const segment of segments) {
        if (segment.empty || !segment.text) continue
        if (!(await enqueueStatement(segment.text))) {
          stopped = true
          rl.close()
          return
        }
      }
    }

    let firstLine = true
    for await (const rawLine of rl) {
      // readline 不会去掉 UTF-8 BOM，留在首条语句里会导致语法错误
      const line = firstLine ? String(rawLine).replace(/^\uFEFF/, '') : String(rawLine)
      firstLine = false
      await enqueueSegments(scanner.feed(`${line}\n`))
      if (stopped) break
    }

    if (!stopped) await enqueueSegments(scanner.finish())
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
    const runningSet = runningScriptConnections.get(runningKey)
    runningSet?.delete(conn)
    if (runningSet && runningSet.size === 0) {
      runningScriptConnections.delete(runningKey)
    }
    try {
      await conn.end()
    } catch {
      // Connection may already be destroyed by cancellation.
    }
  }
}
