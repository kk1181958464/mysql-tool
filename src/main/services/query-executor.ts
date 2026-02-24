import * as connectionManager from './connection-manager'
import * as localStore from './local-store'
import type { QueryResult, ExplainResult } from '../../shared/types/query'
import * as logger from '../utils/logger'

const runningQueries = new Map<string, any>()

export async function execute(connectionId: string, sql: string, database?: string): Promise<QueryResult> {
  const conn = await connectionManager.getConnection(connectionId)
  const start = Date.now()
  let isSuccess = true
  let errorMessage = ''
  let result: QueryResult

  try {
    if (database) await conn.query(`USE \`${database}\``)

    runningQueries.set(connectionId, conn as any)
    const [rows, fields] = await conn.query(sql)
    const elapsed = Date.now() - start
    const isSelect = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)/i.test(sql)

    if (isSelect && Array.isArray(rows)) {
      result = {
        columns: (fields as any[])?.map(f => ({
          name: f.name,
          type: f.type?.toString() || '',
          nullable: f.flags ? !(f.flags & 1) : true,
          defaultValue: null,
          primaryKey: f.flags ? !!(f.flags & 2) : false,
          autoIncrement: f.flags ? !!(f.flags & 512) : false,
          comment: '',
        })) || [],
        rows: rows as Record<string, unknown>[],
        affectedRows: 0,
        insertId: 0,
        executionTime: elapsed,
        rowCount: (rows as any[]).length,
        sql,
        isSelect: true,
      }
    } else {
      const info = rows as any
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
    if (database) await conn.query(`USE \`${database}\``)
    const [rows] = await conn.query(`EXPLAIN ${sql}`)
    return (rows as any[]).map(r => ({
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
    (conn as any).destroy()
    runningQueries.delete(connectionId)
    logger.info(`Query cancelled for ${connectionId}`)
  }
}
