import { ipcMain, BrowserWindow } from 'electron'
import mysql from 'mysql2/promise'
import { IPC } from '../../shared/types/ipc-channels'
import * as queryExecutor from '../services/query-executor'
import * as connectionManager from '../services/connection-manager'
import { format } from 'sql-formatter'
import { quoteId } from '../utils/sql'

const STMT_KEYWORDS = /^(?:CREATE|INSERT|DROP|ALTER|LOCK|UNLOCK|SET|DELETE|UPDATE|REPLACE)\s/i
const PARSE_YIELD_EVERY = 5000

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

/** 按分号拆分 SQL，尊重字符串/注释，并周期性上报解析进度 */
async function splitStatementsWithProgress(
  sql: string,
  onProgress?: (progress: { current: number; total: number; stage: 'parsing' }) => void,
): Promise<string[]> {
  const stmts: string[] = []
  const total = Math.max(sql.length, 1)
  let cur = '', i = 0, inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  let lastReported = -1

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
    if (c === ';') { const t = cur.trim(); if (t) stmts.push(t); cur = ''; i++; await maybeReport(); continue }
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
  // 记录最后一个非空白字符（字符串外部）
  let lastNonWS = ''

  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    // --- 注释状态 ---
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      out.push(ch); i++; continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { out.push('*/'); i += 2; inBlockComment = false; continue }
      out.push(ch); i++; continue
    }

    // --- 字符串/反引号状态 ---
    if (inSingle) {
      if (ch === "'" && next === "'") { out.push("''"); i += 2; continue } // 转义
      if (ch === '\\') { out.push(ch, next || ''); i += 2; continue }      // 反斜杠转义
      if (ch === "'") inSingle = false
      out.push(ch); i++; continue
    }
    if (inDouble) {
      if (ch === '"' && next === '"') { out.push('""'); i += 2; continue }
      if (ch === '\\') { out.push(ch, next || ''); i += 2; continue }
      if (ch === '"') inDouble = false
      out.push(ch); i++; continue
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false
      out.push(ch); i++; continue
    }

    // --- 普通状态：检测进入 ---
    if (ch === '-' && next === '-') { inLineComment = true; out.push(ch); i++; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; out.push('/*'); i += 2; continue }
    if (ch === "'") { inSingle = true; out.push(ch); i++; continue }
    if (ch === '"') { inDouble = true; out.push(ch); i++; continue }
    if (ch === '`') { inBacktick = true; out.push(ch); i++; continue }

    // --- 换行处：检查是否需要补分号 ---
    if (ch === '\n' && lastNonWS && lastNonWS !== ';' && lastNonWS !== '{' && lastNonWS !== '}') {
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
      const executableStmts = withDrop.filter((stmt) => STMT_KEYWORDS.test(stripLeadingTrivia(stmt)))
      let ok = 0, fail = 0
      const errors: string[] = []
      const total = executableStmts.length
      sendProgress({
        current: 0,
        total,
        fail: 0,
        stage: total > 0 ? 'executing' : 'parsing',
        originalStatementTotal,
        executableStatementTotal: total,
      })
      const BATCH = 50
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
      for (let i = 0; i < executableStmts.length; i += BATCH) {
        const batch = executableStmts.slice(i, i + BATCH)
        try {
          await conn.query(batch.join(';\n'))
          ok += batch.length
          emitProgress()
        } catch {
          for (const stmt of batch) {
            try {
              await conn.query(stmt)
              ok++
            }
            catch (e: any) {
              fail++
              if (errors.length < 10) {
                const preview = stmt.length > 120 ? stmt.slice(0, 120) + '...' : stmt
                errors.push(`[${ok + fail}] ${e.message}\n  SQL: ${preview}`)
              }
            }
            emitProgress()
          }
        }
        emitProgress()
      }
      if (fail > 0) {
        throw new Error(`执行完成：${ok} 条成功，${fail} 条失败\n\n` + errors.join('\n\n'))
      }
      return { success: true }
    } catch (err: any) {
      if (err.message.startsWith('执行完成')) throw err
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
