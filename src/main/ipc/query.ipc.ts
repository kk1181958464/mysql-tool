import { ipcMain, BrowserWindow } from 'electron'
import mysql from 'mysql2/promise'
import { IPC } from '../../shared/types/ipc-channels'
import * as queryExecutor from '../services/query-executor'
import * as connectionManager from '../services/connection-manager'
import { format } from 'sql-formatter'
import { quoteId } from '../utils/sql'
import type { QueryResult, QueryStatementResult } from '../../shared/types/query'
import type { ResultSetHeader } from 'mysql2/promise'

const STMT_KEYWORDS = /^(?:CREATE|INSERT|DROP|ALTER|LOCK|UNLOCK|SET|DELETE|UPDATE|REPLACE|SELECT|WITH|CALL|TRUNCATE|USE|GRANT|REVOKE|COMMIT|ROLLBACK|START\s+TRANSACTION|BEGIN|SHOW|DESCRIBE|DESC|EXPLAIN|ANALYZE|OPTIMIZE|RENAME)\s/i
const PARSE_YIELD_EVERY = 5000
const COMPOUND_CREATE_START = /^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`|[^`\s]+)@(?:`[^`]+`|[^`\s]+)\s+)?(?:OR\s+REPLACE\s+)?(?:TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/i
const BLOCK_START_KEYWORDS = new Set(['BEGIN', 'CASE', 'IF', 'LOOP', 'REPEAT', 'WHILE'])

const yieldToEventLoop = async () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * 移除语句开头的空白与注释（-- / # / /* *\/），用于关键词识别与简单解析。
 * 注意：仅处理“前导”注释，不处理语句中间注释。
 */
function stripLeadingTrivia(stmt: string): string {
  let s = stmt
  while (true) {
    // leading whitespace
    const ws = s.match(/^\s+/)
    if (ws) s = s.slice(ws[0].length)

    // leading line comments
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

    // leading block comments
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

function mapFields(fields: Array<{ name: string; type?: number; flags?: number }> = []): QueryResult['columns'] {
  return fields.map((f) => ({
    name: f.name,
    type: f.type?.toString() || '',
    nullable: f.flags ? !(f.flags & 1) : true,
    defaultValue: null,
    primaryKey: f.flags ? !!(f.flags & 2) : false,
    autoIncrement: f.flags ? !!(f.flags & 512) : false,
    comment: '',
  }))
}

async function executeStatement(conn: mysql.Connection, stmt: string, index: number): Promise<QueryStatementResult> {
  const startedAt = Date.now()
  try {
    const [rows, fields] = await conn.query(stmt)
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

      for (let i = 0; i < multiRows.length; i++) {
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
  } catch (e: any) {
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
      error: e?.message || '执行失败',
    }
  }
}

/** 按分号拆分 SQL，尊重字符串/注释，并周期性上报解析进度 */
async function splitStatementsWithProgress(
  sql: string,
  onProgress?: (progress: { current: number; total: number; stage: 'parsing' }) => void,
): Promise<string[]> {
  const stmts: string[] = []
  const total = Math.max(sql.length, 1)
  let cur = '', i = 0, inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  let delimiter = ';'
  let statementStart = 0
  let inCompoundStatement = false
  let compoundDepth = 0
  let lastReported = -1

  const finalizeCurrent = async (endIndex: number) => {
    const t = cur.trim()
    if (t) stmts.push(t)
    cur = ''
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
    const c = sql[i], n = sql[i + 1]
    if (inLC) { if (c === '\n') inLC = false; cur += c; i++; await maybeReport(); continue }
    if (inBC) { if (c === '*' && n === '/') { cur += '*/'; i += 2; await maybeReport(); inBC = false; continue } cur += c; i++; await maybeReport(); continue }
    if (inSQ) { if (c === "'" && n === "'") { cur += "''"; i += 2; await maybeReport(); continue } if (c === '\\') { cur += c + (n || ''); i += 2; await maybeReport(); continue } if (c === "'") inSQ = false; cur += c; i++; await maybeReport(); continue }
    if (inDQ) { if (c === '"' && n === '"') { cur += '""'; i += 2; await maybeReport(); continue } if (c === '\\') { cur += c + (n || ''); i += 2; await maybeReport(); continue } if (c === '"') inDQ = false; cur += c; i++; await maybeReport(); continue }
    if (inBT) { if (c === '`') inBT = false; cur += c; i++; await maybeReport(); continue }
    if (c === '-' && n === '-') { inLC = true; cur += c; i++; await maybeReport(); continue }
    if (c === '/' && n === '*') { inBC = true; cur += '/*'; i += 2; await maybeReport(); continue }
    if (c === "'") { inSQ = true; cur += c; i++; await maybeReport(); continue }
    if (c === '"') { inDQ = true; cur += c; i++; await maybeReport(); continue }
    if (c === '`') { inBT = true; cur += c; i++; await maybeReport(); continue }

    if (!cur.trim()) {
      const lineStart = i === 0 || sql[i - 1] === '\n'
      if (lineStart && sql.slice(i, i + 9).toUpperCase() === 'DELIMITER' && isWordBoundaryChar(sql[i + 9])) {
        let j = i + 9
        while (j < sql.length && /\s/.test(sql[j])) j++
        let k = j
        while (k < sql.length && sql[k] !== '\n' && sql[k] !== '\r') k++
        delimiter = sql.slice(j, k).trim() || ';'
        i = k
        statementStart = i
        await maybeReport()
        continue
      }
    }

    if (!inCompoundStatement && !cur.trim()) {
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
        cur += sql.slice(i, i + keyword.length)
        i += keyword.length
        await maybeReport()
        continue
      }

      if (sql.slice(i, i + 3).toUpperCase() === 'END' && isWordBoundaryChar(sql[i - 1]) && isWordBoundaryChar(sql[i + 3])) {
        if (compoundDepth > 0) compoundDepth -= 1
        cur += 'END'
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

    cur += c; i++
    await maybeReport()
  }

  const t = cur.trim(); if (t) stmts.push(t)
  i = total
  await maybeReport(true)
  return stmts
}

/** 字符级状态机：在字符串/注释外部，检测缺失分号的语句边界并补上 */
function ensureSemicolons(sql: string): string {
  const out: string[] = []
  let i = 0
  let inSingle = false   // 单引号字符串内
  let inDouble = false   // 双引号字符串内
  let inBacktick = false // 反引号内
  let inLineComment = false
  let inBlockComment = false
  let statementBuffer = ''
  let inCompoundStatement = false
  let compoundDepth = 0
  // 记录最后一个非空白字符（字符串外部）
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

    // --- 注释状态 ---
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      out.push(ch); statementBuffer += ch; i++; continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { out.push('*/'); statementBuffer += '*/'; i += 2; inBlockComment = false; continue }
      out.push(ch); statementBuffer += ch; i++; continue
    }

    // --- 字符串/反引号状态 ---
    if (inSingle) {
      if (ch === "'" && next === "'") { out.push("''"); statementBuffer += "''"; i += 2; continue } // 转义
      if (ch === '\\') { out.push(ch, next || ''); statementBuffer += ch + (next || ''); i += 2; continue }      // 反斜杠转义
      if (ch === "'") inSingle = false
      out.push(ch); statementBuffer += ch; i++; continue
    }
    if (inDouble) {
      if (ch === '"' && next === '"') { out.push('""'); statementBuffer += '""'; i += 2; continue }
      if (ch === '\\') { out.push(ch, next || ''); statementBuffer += ch + (next || ''); i += 2; continue }
      if (ch === '"') inDouble = false
      out.push(ch); statementBuffer += ch; i++; continue
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false
      out.push(ch); statementBuffer += ch; i++; continue
    }

    // --- 普通状态：检测进入 ---
    if (ch === '-' && next === '-') { inLineComment = true; out.push(ch); statementBuffer += ch; i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; out.push('/*'); statementBuffer += '/*'; i += 2; continue }
    if (ch === "'") { inSingle = true; out.push(ch); statementBuffer += ch; i++; continue }
    if (ch === '"') { inDouble = true; out.push(ch); statementBuffer += ch; i++; continue }
    if (ch === '`') { inBacktick = true; out.push(ch); statementBuffer += ch; i++; continue }

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

    // --- 换行处：检查是否需要补分号 ---
    if (ch === '\n' && !inCompoundStatement && lastNonWS && lastNonWS !== ';' && lastNonWS !== '{' && lastNonWS !== '}') {
      // 向前看：跳过空白 + 行注释(-- ...)，找到下一个实际语句
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ' ' || sql[j] === '\t' || sql[j] === '\r' || sql[j] === '\n') { j++; continue }
        if (sql[j] === '-' && sql[j + 1] === '-') { while (j < sql.length && sql[j] !== '\n') j++; continue }
        break
      }
      const rest = sql.substring(j, j + 12)
      if (STMT_KEYWORDS.test(rest)) {
        out.push(';\n')
        lastNonWS = ';'
        i = j  // 跳过中间空白和注释
        continue
      }
    }

    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') lastNonWS = ch
    out.push(ch)
    statementBuffer += ch
    if (ch === ';') {
      statementBuffer = ''
      inCompoundStatement = false
      compoundDepth = 0
    }
    i++
  }
  return out.join('')
}


export function registerQueryIPC() {
  ipcMain.handle(IPC.QUERY_EXECUTE, async (_e, connectionId: string, sql: string, database?: string) => {
    return queryExecutor.execute(connectionId, sql, database)
  })

  ipcMain.handle(IPC.QUERY_EXECUTE_MULTI, async (_e, connectionId: string, sql: string, database?: string) => {
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
      let cleaned = sql.replace(/^\uFEFF/, '')
      if (database) await conn.query(`USE ${quoteId(database)}`)
      await conn.query(`SET SQL_MODE=''`)
      await conn.query(`SET FOREIGN_KEY_CHECKS=0`)
      await conn.query(`SET NAMES utf8mb4`)
      const sender = _e.sender
      type ImportProgressPayload = {
        current: number
        total: number
        fail: number
        stage: 'parsing' | 'executing'
        originalStatementTotal?: number
        executableStatementTotal?: number
      }
      const sendProgress = (payload: ImportProgressPayload) => {
        const window = BrowserWindow.fromWebContents(sender)
        if (!window?.isDestroyed()) {
          sender.send('import:progress', payload)
        }
      }

      cleaned = ensureSemicolons(cleaned)
      sendProgress({ current: 0, total: Math.max(cleaned.length, 1), fail: 0, stage: 'parsing' })
      const stmts = await splitStatementsWithProgress(cleaned, ({ current, total, stage }) => {
        sendProgress({ current, total, fail: 0, stage })
      })

      // 覆盖导入：若 SQL 中未包含 DROP TABLE，则为每条 CREATE TABLE 预插入 DROP TABLE IF EXISTS
      // 双重保证：导出带 DROP；导入若缺失则补齐
      const defaultDb = database || poolConfig.database
      const mkKey = (db: string | undefined, table: string) => `${String(db || defaultDb || '').toLowerCase()}::${table.toLowerCase()}`

      const parseDropTable = (stmt: string): { db?: string; table: string } | null => {
        const core = stripLeadingTrivia(stmt)
        const m = core.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:(?:`([^`]+)`|([A-Za-z0-9_]+))\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_]+))/i)
        if (!m) return null
        const db = (m[1] || m[2] || undefined) as string | undefined
        const table = (m[3] || m[4]) as string
        return { db, table }
      }

      const parseCreateTable = (stmt: string): { db?: string; table: string } | null => {
        const core = stripLeadingTrivia(stmt)
        const m = core.match(/^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:`([^`]+)`|([A-Za-z0-9_]+))\s*\.\s*)?(?:`([^`]+)`|([A-Za-z0-9_]+))/i)
        if (!m) return null
        const db = (m[1] || m[2] || undefined) as string | undefined
        const table = (m[3] || m[4]) as string
        return { db, table }
      }

      const buildDropStmt = (db: string | undefined, table: string) => {
        const dbName = db || defaultDb
        return dbName ? `DROP TABLE IF EXISTS ${quoteId(dbName)}.${quoteId(table)}` : `DROP TABLE IF EXISTS ${quoteId(table)}`
      }

      const withDrop: string[] = []
      const seenDrop = new Set<string>()
      for (const stmt of stmts) {
        const trimmed = stmt.trim()
        if (!trimmed) continue

        const dropInfo = parseDropTable(trimmed)
        if (dropInfo) {
          seenDrop.add(mkKey(dropInfo.db, dropInfo.table))
          withDrop.push(trimmed)
          continue
        }

        const createInfo = parseCreateTable(trimmed)
        if (createInfo) {
          const key = mkKey(createInfo.db, createInfo.table)
          if (!seenDrop.has(key)) {
            withDrop.push(buildDropStmt(createInfo.db, createInfo.table))
            seenDrop.add(key)
          }
          withDrop.push(trimmed)
          continue
        }

        withDrop.push(trimmed)
      }

      const originalStatementTotal = stmts.length
      const executableStmts = withDrop
        .map((stmt) => stmt.trim())
        .filter((stmt) => !!stmt)
      let ok = 0, fail = 0
      const errors: string[] = []
      const total = executableStmts.length
      const statementResults: QueryStatementResult[] = []
      sendProgress({
        current: 0,
        total,
        fail: 0,
        stage: total > 0 ? 'executing' : 'parsing',
        originalStatementTotal,
        executableStatementTotal: total,
      })
      const emitProgress = () => {
        sendProgress({
          current: ok + fail,
          total,
          fail,
          stage: 'executing',
          originalStatementTotal,
          executableStatementTotal: total,
        })
      }
      for (let i = 0; i < executableStmts.length; i++) {
        const stmt = executableStmts[i]
        const result = await executeStatement(conn, stmt, i + 1)
        statementResults.push(result)
        if (result.success) {
          ok++
        } else {
          fail++
          if (errors.length < 10) {
            const preview = stmt.length > 120 ? stmt.slice(0, 120) + '...' : stmt
            errors.push(`[${result.index}] ${result.error}\n  SQL: ${preview}`)
          }
        }
        emitProgress()
      }

      const lastSelect = [...statementResults].reverse().find((item) => item.success && item.isSelect)
      const lastMutation = [...statementResults].reverse().find((item) => item.success && !item.isSelect)
      const aggregate: QueryResult = {
        columns: lastSelect?.columns || [],
        rows: lastSelect?.rows || [],
        affectedRows: statementResults.reduce((sum, item) => sum + item.affectedRows, 0),
        insertId: lastMutation?.insertId || lastSelect?.insertId || 0,
        executionTime: statementResults.reduce((sum, item) => sum + item.executionTime, 0),
        rowCount: lastSelect?.rowCount || 0,
        sql,
        isSelect: !!lastSelect,
        statementResults,
        successCount: ok,
        failCount: fail,
      }

      return aggregate
    } catch (err: any) {
      // 脱敏：不将 SQL 内容返回前端，仅返回错误消息
      throw new Error(err.message)
    } finally {
      await conn.end()
    }
  })

  ipcMain.handle(IPC.QUERY_EXPLAIN, async (_e, connectionId: string, sql: string, database?: string) => {
    return queryExecutor.explain(connectionId, sql, database)
  })

  ipcMain.handle(IPC.QUERY_CANCEL, async (_e, connectionId: string) => {
    return queryExecutor.cancel(connectionId)
  })

  ipcMain.handle(IPC.QUERY_FORMAT, async (_e, sql: string) => {
    return format(sql, { language: 'mysql' })
  })
}
