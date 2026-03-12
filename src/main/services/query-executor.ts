import mysql from 'mysql2/promise'
import type { ResultSetHeader } from 'mysql2/promise'
import * as connectionManager from './connection-manager'
import * as localStore from './local-store'
import type { QueryResult, ExplainResult } from '../../shared/types/query'
import * as logger from '../utils/logger'
import { quoteId } from '../utils/sql'

/** mysql2 FieldPacket 的运行时字段（类型定义不完整，此处补齐） */
type MysqlField = { name: string; type?: number; flags?: number }
type DbRow = Record<string, unknown>

const runningQueries = new Map<string, mysql.PoolConnection>()

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

export async function execute(connectionId: string, sql: string, database?: string): Promise<QueryResult> {
  const conn = await connectionManager.getConnection(connectionId)
  const start = Date.now()
  let isSuccess = true
  let errorMessage = ''
  let result: QueryResult

  try {
    if (database) await conn.query(`USE ${quoteId(database)}`)

    runningQueries.set(connectionId, conn)
    const [rows, fields] = await conn.query(sql)
    const elapsed = Date.now() - start
    const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)/i.test(sql)

    // 检查是否是多语句执行的结果（数组中包含数组）
    const isMultipleStatements = Array.isArray(rows) && rows.length > 0 && Array.isArray((rows as unknown[])[0])

    if (isMultipleStatements) {
      // 多语句执行：汇总所有语句的结果
      let totalAffectedRows = 0
      let lastInsertId = 0
      const allRows: DbRow[] = []
      let allColumns: QueryResult['columns'] = []
      let hasSelectResult = false
      const multiRows = rows as unknown[]
      const multiFields = fields as unknown[]

      for (let i = 0; i < multiRows.length; i++) {
        const statementResult = multiRows[i]
        const statementFields = multiFields?.[i] as MysqlField[] | undefined

        if (Array.isArray(statementResult)) {
          hasSelectResult = true
          allRows.push(...statementResult)
          if (allColumns.length === 0 && statementFields) {
            allColumns = mapFields(statementFields)
          }
        } else if (statementResult && typeof statementResult === 'object') {
          const header = statementResult as ResultSetHeader
          totalAffectedRows += header.affectedRows || 0
          if (header.insertId && header.insertId > lastInsertId) {
            lastInsertId = header.insertId
          }
        }
      }

      result = {
        columns: allColumns,
        rows: allRows,
        affectedRows: totalAffectedRows,
        insertId: lastInsertId,
        executionTime: elapsed,
        rowCount: allRows.length,
        sql,
        isSelect: hasSelectResult,
      }
    } else if (isSelect && Array.isArray(rows)) {
      result = {
        columns: mapFields(fields as MysqlField[]),
        rows: rows as DbRow[],
        affectedRows: 0,
        insertId: 0,
        executionTime: elapsed,
        rowCount: rows.length,
        sql,
        isSelect: true,
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
    runningQueries.delete(connectionId)
    conn.release()
    const elapsed = Date.now() - start
    try {
      localStore.queryHistory.save({
        connectionId,
        databaseName: database || '',
        sqlText: sql,
        executionTimeMs: elapsed,
        rowCount: isSuccess ? (result!.rowCount || result!.affectedRows) : 0,
        isSuccess,
        errorMessage,
        isSlow: elapsed > 1000,
        createdAt: new Date().toISOString(),
      })
    } catch (e) {
      logger.warn('Failed to save query history', e)
    }
  }
  return result!
}

export async function explain(connectionId: string, sql: string, database?: string): Promise<ExplainResult[]> {
  const conn = await connectionManager.getConnection(connectionId)
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
    conn.release()
  }
}

export async function cancel(connectionId: string): Promise<void> {
  const conn = runningQueries.get(connectionId)
  if (conn) {
    conn.destroy()
    runningQueries.delete(connectionId)
    logger.info(`Query cancelled for ${connectionId}`)
  }
}
