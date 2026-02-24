import * as connectionManager from './connection-manager'

async function query(connId: string, sql: string): Promise<any[]> {
  const conn = await connectionManager.getConnection(connId)
  try {
    const [rows] = await conn.query(sql)
    return rows as any[]
  } finally {
    conn.release()
  }
}

export async function getProcessList(connId: string): Promise<any[]> {
  return query(connId, 'SHOW PROCESSLIST')
}

export async function getInnoDBStatus(connId: string): Promise<string> {
  const rows = await query(connId, 'SHOW ENGINE INNODB STATUS')
  return rows[0]?.Status || ''
}

export async function getVariables(connId: string, filter?: string): Promise<Record<string, string>> {
  const sql = filter ? `SHOW VARIABLES LIKE '${filter}'` : 'SHOW VARIABLES'
  const rows = await query(connId, sql)
  const result: Record<string, string> = {}
  for (const r of rows) result[r.Variable_name] = r.Value
  return result
}

export async function getGlobalStatus(connId: string, filter?: string): Promise<Record<string, string>> {
  const sql = filter ? `SHOW GLOBAL STATUS LIKE '${filter}'` : 'SHOW GLOBAL STATUS'
  const rows = await query(connId, sql)
  const result: Record<string, string> = {}
  for (const r of rows) result[r.Variable_name] = r.Value
  return result
}
