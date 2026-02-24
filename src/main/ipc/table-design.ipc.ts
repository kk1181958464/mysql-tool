import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as tableDesigner from '../services/table-designer'
import * as connectionManager from '../services/connection-manager'

export function registerTableDesignIPC() {
  ipcMain.handle(IPC.DESIGN_CREATE_TABLE, async (_e, connId: string, db: string, design) => {
    const sql = tableDesigner.generateCreateTableSQL(design)
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_ALTER_TABLE, async (_e, connId: string, db: string, tableName: string, diff) => {
    const sql = tableDesigner.generateAlterTableSQL(tableName, diff)
    if (!sql) return ''
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_DROP_TABLE, async (_e, connId: string, db: string, table: string) => {
    const sql = tableDesigner.generateDropTableSQL(db, table)
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_DIFF, async (_e, oldDesign, newDesign) => {
    return tableDesigner.diffTables(oldDesign, newDesign)
  })

  ipcMain.handle(IPC.DATA_INSERT, async (_e, connId: string, db: string, table: string, data: Record<string, any>) => {
    const cols = Object.keys(data).map(c => `\`${c}\``).join(', ')
    const placeholders = Object.keys(data).map(() => '?').join(', ')
    const values = Object.values(data)
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      const [result] = await conn.query(`INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`, values)
      return result
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_UPDATE, async (_e, connId: string, db: string, table: string, data: Record<string, any>, where: Record<string, any>) => {
    const sets = Object.keys(data).map(c => `\`${c}\` = ?`).join(', ')
    const wheres = Object.keys(where).map(c => `\`${c}\` = ?`).join(' AND ')
    const values = [...Object.values(data), ...Object.values(where)]
    const sql = `UPDATE \`${table}\` SET ${sets} WHERE ${wheres}`
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      const [result] = await conn.query(sql, values)
      return result
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_DELETE, async (_e, connId: string, db: string, table: string, where: Record<string, any>) => {
    const wheres = Object.keys(where).map(c => `\`${c}\` = ?`).join(' AND ')
    const values = Object.values(where)
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE ${wheres}`, values)
      return result
    } finally {
      conn.release()
    }
  })
}
