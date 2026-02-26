import { ipcMain, BrowserWindow } from 'electron'
import mysql from 'mysql2/promise'
import { IPC } from '../../shared/types/ipc-channels'
import * as queryExecutor from '../services/query-executor'
import * as connectionManager from '../services/connection-manager'
import { format } from 'sql-formatter'

const STMT_KEYWORDS = /^(?:CREATE|INSERT|DROP|ALTER|LOCK|UNLOCK|SET|DELETE|UPDATE|REPLACE)\s/i

/** 按分号拆分 SQL，尊重字符串/注释 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = []
  let cur = '', i = 0, inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1]
    if (inLC) { if (c === '\n') inLC = false; cur += c; i++; continue }
    if (inBC) { if (c === '*' && n === '/') { cur += '*/'; i += 2; inBC = false; continue } cur += c; i++; continue }
    if (inSQ) { if (c === "'" && n === "'") { cur += "''"; i += 2; continue } if (c === '\\') { cur += c + (n || ''); i += 2; continue } if (c === "'") inSQ = false; cur += c; i++; continue }
    if (inDQ) { if (c === '"' && n === '"') { cur += '""'; i += 2; continue } if (c === '\\') { cur += c + (n || ''); i += 2; continue } if (c === '"') inDQ = false; cur += c; i++; continue }
    if (inBT) { if (c === '`') inBT = false; cur += c; i++; continue }
    if (c === '-' && n === '-') { inLC = true; cur += c; i++; continue }
    if (c === '/' && n === '*') { inBC = true; cur += '/*'; i += 2; continue }
    if (c === "'") { inSQ = true; cur += c; i++; continue }
    if (c === '"') { inDQ = true; cur += c; i++; continue }
    if (c === '`') { inBT = true; cur += c; i++; continue }
    if (c === ';') { const t = cur.trim(); if (t) stmts.push(t); cur = ''; i++; continue }
    cur += c; i++
  }
  const t = cur.trim(); if (t) stmts.push(t)
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
    const pool = connectionManager.getPool(connectionId)
    const poolConfig = (pool as any).pool?.config?.connectionConfig || (pool as any).config?.connectionConfig || {}
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
      if (database) await conn.query(`USE \`${database}\``)
      await conn.query(`SET SQL_MODE=''`)
      await conn.query(`SET FOREIGN_KEY_CHECKS=0`)
      await conn.query(`SET NAMES utf8mb4`)
      const sender = _e.sender

      cleaned = cleaned.replace(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`(\w+)`/gi,
        (m, name) => `DROP TABLE IF EXISTS \`${name}\`;\n${m}`)
      cleaned = ensureSemicolons(cleaned)
      const stmts = splitStatements(cleaned)
      let ok = 0, fail = 0
      const errors: string[] = []
      const total = stmts.length
      sender.send('import:progress', { current: 0, total, fail: 0 })
      const BATCH = 200
      for (let i = 0; i < stmts.length; i += BATCH) {
        const batch = stmts.slice(i, i + BATCH)
        try {
          await conn.query(batch.join(';\n'))
          ok += batch.length
        } catch {
          for (const stmt of batch) {
            try { await conn.query(stmt); ok++ }
            catch (e: any) {
              fail++
              if (errors.length < 10) {
                const preview = stmt.length > 120 ? stmt.slice(0, 120) + '...' : stmt
                errors.push(`[${ok + fail}] ${e.message}\n  SQL: ${preview}`)
              }
            }
          }
        }
        sender.send('import:progress', { current: ok + fail, total, fail })
      }
      if (fail > 0) {
        throw new Error(`执行完成：${ok} 条成功，${fail} 条失败\n\n` + errors.join('\n\n'))
      }
      return { success: true }
    } catch (err: any) {
      if (err.message.startsWith('执行完成')) throw err
      const preview = sql.split('\n').slice(0, 30).join('\n')
      throw new Error(err.message + '\n\n--- SQL前30行 ---\n' + preview)
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
