import mysql from 'mysql2/promise'
import type { ResultSetHeader } from 'mysql2/promise'
import * as connectionManager from './connection-manager'
import * as localStore from './local-store'
import type { QueryExecuteOptions, QueryResult, QueryStatementResult, ExplainResult } from '../../shared/types/query'
import * as logger from '../utils/logger'
import { quoteId } from '../utils/sql'
import { applyResultRowLimit } from '../utils/sql-result-limit'

/** mysql2 FieldPacket 的运行时字段（类型定义不完整，此处补齐） */
type MysqlField = { name: string; type?: number; flags?: number }
type DbRow = Record<string, any>

const runningQueries = new Map<string, mysql.PoolConnection>()

function getRunningQueryKey(connectionId: string, executionId?: string): string {
  return executionId ? `${connectionId}:${executionId}` : connectionId
}

function mapFields(fields: MysqlField[]): QueryResult['columns'] {
  return fields.map(f => ({
    name: f.name,
    type: f.type?.toString() || '',
    nullable: f.flags ? !(f.flags & 1) : true,
    defaultValue: null,
    primaryKey: f.flags ? !!(f.flags & 2) : false,
    autoIncrement: f.flags ? !!(f.flags & 512) : false,
    comment: '',
  }))
}

export async function execute(connectionId: string, sql: string, database?: string, options?: QueryExecuteOptions): Promise<QueryResult> {
  if (!sql.trim()) {
    throw new Error('没有可执行的 SQL 语句')
  }

  const conn = await connectionManager.getConnection(connectionId)
  const start = Date.now()
  let isSuccess = true
  let errorMessage = ''
  let result: QueryResult | null = null
  const runningKey = getRunningQueryKey(connectionId, options?.executionId)
  runningQueries.set(runningKey, conn)

  try {
    if (database) await conn.query(`USE ${quoteId(database)}`)

    const limitedSql = applyResultRowLimit(sql, { enabled: true })
    const [rows, fields] = await conn.query(limitedSql.sql)
    const elapsed = Date.now() - start

    // 检查是否是多语句执行的结果（数组中包含数组）
    const isMultipleStatements = Array.isArray(rows) && rows.length > 0 && Array.isArray((rows as unknown[])[0])

    if (isMultipleStatements) {
      // 多结果集执行：保留每个结果集/执行头，前端按独立结果展示。
      let totalAffectedRows = 0
      let lastInsertId = 0
      let firstRows: DbRow[] = []
      let firstColumns: QueryResult['columns'] = []
      const statementResults: QueryStatementResult[] = []
      const multiRows = rows as unknown[]
      const multiFields = fields as unknown[]

      for (let i = 0; i < multiRows.length; i++) {
        const statementResult = multiRows[i]
        const statementFields = multiFields?.[i] as MysqlField[] | undefined
        const index = i + 1

        if (Array.isArray(statementResult)) {
          const resultRows = statementResult as DbRow[]
          const resultColumns = mapFields(statementFields || [])
          if (firstColumns.length === 0) {
            firstRows = resultRows
            firstColumns = resultColumns
          }
          statementResults.push({
            index,
            sql,
            isSelect: true,
            success: true,
            columns: resultColumns,
            rows: resultRows,
            affectedRows: 0,
            insertId: 0,
            executionTime: elapsed,
            rowCount: resultRows.length,
            error: null,
            limited: limitedSql.limited,
            limitApplied: limitedSql.limited ? limitedSql.limit : undefined,
          })
        } else if (statementResult && typeof statementResult === 'object') {
          const header = statementResult as ResultSetHeader
          const affectedRows = header.affectedRows || 0
          const insertId = header.insertId || 0
          totalAffectedRows += affectedRows
          if (header.insertId && header.insertId > lastInsertId) {
            lastInsertId = header.insertId
          }
          statementResults.push({
            index,
            sql,
            isSelect: false,
            success: true,
            columns: [],
            rows: [],
            affectedRows,
            insertId,
            executionTime: elapsed,
            rowCount: 0,
            error: null,
          })
        }
      }

      result = {
        columns: firstColumns,
        rows: firstRows,
        affectedRows: totalAffectedRows,
        insertId: lastInsertId,
        executionTime: elapsed,
        rowCount: firstRows.length,
        sql,
        isSelect: firstColumns.length > 0,
        statementResults,
        successCount: statementResults.length,
        failCount: 0,
        limited: statementResults.some((item) => item.limited),
        limitApplied: statementResults.find((item) => item.limited)?.limitApplied,
      }
    } else if (Array.isArray(rows)) {
      result = {
        columns: mapFields(fields as MysqlField[]),
        rows: rows as DbRow[],
        affectedRows: 0,
        insertId: 0,
        executionTime: elapsed,
        rowCount: rows.length,
        sql,
        isSelect: true,
        limited: limitedSql.limited,
        limitApplied: limitedSql.limited ? limitedSql.limit : undefined,
      }
    } else {
      const info = rows as ResultSetHeader
      result = {
        columns: [],
        rows: [],
        affectedRows: info.affectedRows || 0,
        insertId: info.insertId || 0,
        executionTime: elapsed,
        rowCount: 0,
        sql,
        isSelect: false,
      }
    }
  } catch (err: any) {
    isSuccess = false
    errorMessage = err.message
    throw err
  } finally {
    runningQueries.delete(runningKey)
    conn.release()
    const elapsed = Date.now() - start
    try {
      localStore.queryHistory.save({
        connectionId,
        databaseName: database || '',
        sqlText: sql,
        executionTimeMs: elapsed,
        rowCount: isSuccess && result ? (result.rowCount || result.affectedRows) : 0,
        isSuccess,
        errorMessage,
        isSlow: elapsed > 1000,
        createdAt: new Date().toISOString(),
      })
    } catch (e) {
      logger.warn('Failed to save query history', e)
    }
  }
  if (!result) {
    throw new Error('查询执行完成但没有返回结果对象')
  }
  return result
}

export async function explain(connectionId: string, sql: string, database?: string, options?: QueryExecuteOptions): Promise<ExplainResult[]> {
  const conn = await connectionManager.getConnection(connectionId)
  const runningKey = getRunningQueryKey(connectionId, options?.executionId)
  runningQueries.set(runningKey, conn)
  try {
    if (database) await conn.query(`USE ${quoteId(database)}`)
    const [rows] = await conn.query(`EXPLAIN ${sql}`)
    return (rows as DbRow[]).map(r => ({
      id: r.id,
      selectType: r.select_type,
      table: r.table,
      partitions: r.partitions,
      type: r.type,
      possibleKeys: r.possible_keys,
      key: r.key,
      keyLen: r.key_len,
      ref: r.ref,
      rows: r.rows,
      filtered: r.filtered,
      extra: r.Extra,
    }))
  } finally {
    runningQueries.delete(runningKey)
    conn.release()
  }
}

export async function cancel(connectionId: string, executionId?: string): Promise<void> {
  const runningKey = getRunningQueryKey(connectionId, executionId)
  const conn = runningQueries.get(runningKey)
  if (conn) {
    conn.destroy()
    runningQueries.delete(runningKey)
    logger.info(`Query cancelled for ${runningKey}`)
    if (executionId) return
  }

  if (executionId) return

  for (const [key, runningConn] of runningQueries.entries()) {
    if (key !== connectionId && !key.startsWith(`${connectionId}:`)) continue
    runningConn.destroy()
    runningQueries.delete(key)
  }
}
