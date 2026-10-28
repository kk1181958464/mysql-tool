import * as connectionManager from './connection-manager'

type DbRow = Record<string, any>

async function query(connId: string, sql: string, params?: unknown[]): Promise<DbRow[]> {
  const conn = await connectionManager.getConnection(connId)
  try {
    const [rows] = await conn.query(sql, params)
    return rows as DbRow[]
  } finally {
    conn.release()
  }
}

export async function getProcessList(connId: string): Promise<DbRow[]> {
  return query(connId, 'SHOW PROCESSLIST')
}

export async function getInnoDBStatus(connId: string): Promise<string> {
  const rows = await query(connId, 'SHOW ENGINE INNODB STATUS')
  return rows[0]?.Status || ''
}

export async function getVariables(connId: string, filter?: string): Promise<Record<string, string>> {
  const rows = filter ? await query(connId, 'SHOW VARIABLES LIKE ?', [filter]) : await query(connId, 'SHOW VARIABLES')
  const result: Record<string, string> = {}
  for (const r of rows) result[r.Variable_name] = r.Value
  return result
}

export async function getGlobalStatus(connId: string, filter?: string): Promise<Record<string, string>> {
  const rows = filter ? await query(connId, 'SHOW GLOBAL STATUS LIKE ?', [filter]) : await query(connId, 'SHOW GLOBAL STATUS')
  const result: Record<string, string> = {}
  for (const r of rows) result[r.Variable_name] = r.Value
  return result
}
