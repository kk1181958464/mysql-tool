import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as tableDesigner from '../services/table-designer'
import * as connectionManager from '../services/connection-manager'

type BatchUpdateItem = {
  data: Record<string, any>
  where: Record<string, any>
}

function buildWhereClause(where: Record<string, any>) {
  const entries = Object.entries(where)
  if (entries.length === 0) {
    throw new Error('缺少 WHERE 条件，已拒绝执行批量操作')
  }
  return {
    clause: entries.map(([c]) => `\`${c}\` = ?`).join(' AND '),
    values: entries.map(([, v]) => v),
  }
}

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

  ipcMain.handle(IPC.DATA_BATCH_INSERT, async (_e, connId: string, db: string, table: string, rows: Record<string, any>[]) => {
    if (!rows?.length) return { affectedRows: 0 }
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      await conn.beginTransaction()
      const cols = Object.keys(rows[0])
      if (!cols.length) throw new Error('批量插入缺少字段')
      const colStr = cols.map(c => `\`${c}\``).join(', ')
      const placeholder = `(${cols.map(() => '?').join(', ')})`
      const placeholders = rows.map(() => placeholder).join(', ')
      const values = rows.flatMap(r => cols.map(c => r[c] ?? null))
      const [result] = await conn.query(`INSERT INTO \`${table}\` (${colStr}) VALUES ${placeholders}`, values)
      await conn.commit()
      return result
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_BATCH_UPDATE, async (_e, connId: string, db: string, table: string, items: BatchUpdateItem[]) => {
    if (!items?.length) return { affectedRows: 0 }
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      await conn.beginTransaction()
      let affectedRows = 0
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item?.data || !item?.where) {
          throw new Error(`批量更新参数无效，索引 ${i}`)
        }
        const setEntries = Object.entries(item.data)
        if (setEntries.length === 0) continue
        const sets = setEntries.map(([c]) => `\`${c}\` = ?`).join(', ')
        const setValues = setEntries.map(([, v]) => v)
        const { clause, values: whereValues } = buildWhereClause(item.where)
        const [result] = await conn.query(`UPDATE \`${table}\` SET ${sets} WHERE ${clause}`, [...setValues, ...whereValues]) as any
        affectedRows += Number(result?.affectedRows ?? 0)
      }
      await conn.commit()
      return { affectedRows }
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_BATCH_DELETE, async (_e, connId: string, db: string, table: string, wheres: Record<string, any>[]) => {
    if (!wheres?.length) return { affectedRows: 0 }
    const conn = await connectionManager.getConnection(connId)
    try {
      await conn.query(`USE \`${db}\``)
      await conn.beginTransaction()
      let affectedRows = 0
      for (let i = 0; i < wheres.length; i++) {
        const where = wheres[i]
        const { clause, values } = buildWhereClause(where)
        const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE ${clause}`, values) as any
        affectedRows += Number(result?.affectedRows ?? 0)
      }
      await conn.commit()
      return { affectedRows }
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  })
}
