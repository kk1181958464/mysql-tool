import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as tableDesigner from '../services/table-designer'
import * as connectionManager from '../services/connection-manager'
import { quoteId } from '../utils/sql'
import type { ResultSetHeader } from 'mysql2/promise'
import { validateConnectionId, validateIdentifier } from '../utils/query-request'
import { validateDataRecord, validateRecordBatch, validateUpdateBatch } from '../utils/data-request'
import { validateTableDesign, validateTableDiff } from '../utils/table-design-request'

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
    clause: entries.map(([c]) => `${quoteId(c)} = ?`).join(' AND '),
    values: entries.map(([, v]) => v),
  }
}

export function registerTableDesignIPC() {
  ipcMain.handle(IPC.DESIGN_CREATE_TABLE, async (_e, connId: string, db: string, design) => {
    const validConnId = validateConnectionId(connId)
    const validDb = validateIdentifier(db, '数据库名')
    const validDesign = validateTableDesign(design)
    const sql = tableDesigner.generateCreateTableSQL(validDesign)
    const conn = await connectionManager.getConnection(validConnId)
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_ALTER_TABLE, async (_e, connId: string, db: string, tableName: string, diff, newDesign) => {
    const validConnId = validateConnectionId(connId)
    const validDb = validateIdentifier(db, '数据库名')
    const validDesign = validateTableDesign(newDesign)
    const validDiff = validateTableDiff(diff, validDesign)
    const sql = tableDesigner.generateAlterTableSQL(validateIdentifier(tableName, '表名'), validDiff, validDesign)
    if (!sql) return ''
    const conn = await connectionManager.getConnection(validConnId)
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_DROP_TABLE, async (_e, connId: string, db: string, table: string) => {
    const sql = tableDesigner.generateDropTableSQL(validateIdentifier(db, '数据库名'), validateIdentifier(table, '表名'))
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(sql)
      return sql
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DESIGN_DIFF, async (_e, oldDesign, newDesign) => {
    return tableDesigner.diffTables(validateTableDesign(oldDesign), validateTableDesign(newDesign))
  })

  ipcMain.handle(IPC.DATA_INSERT, async (_e, connId: string, db: string, table: string, data: Record<string, any>) => {
    const validData = validateDataRecord(data, '插入数据')
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const cols = Object.keys(validData).map(c => quoteId(c)).join(', ')
    const placeholders = Object.keys(validData).map(() => '?').join(', ')
    const values = Object.values(validData)
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      const [result] = await conn.query(`INSERT INTO ${quoteId(validTable)} (${cols}) VALUES (${placeholders})`, values)
      return result
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_UPDATE, async (_e, connId: string, db: string, table: string, data: Record<string, any>, where: Record<string, any>) => {
    const validData = validateDataRecord(data, '更新数据')
    const validWhere = validateDataRecord(where, 'WHERE 条件')
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const sets = Object.keys(validData).map(c => `${quoteId(c)} = ?`).join(', ')
    const wheres = Object.keys(validWhere).map(c => `${quoteId(c)} = ?`).join(' AND ')
    const values = [...Object.values(validData), ...Object.values(validWhere)]
    const sql = `UPDATE ${quoteId(validTable)} SET ${sets} WHERE ${wheres}`
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      const [result] = await conn.query(sql, values)
      return result
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_DELETE, async (_e, connId: string, db: string, table: string, where: Record<string, any>) => {
    const validWhere = validateDataRecord(where, 'WHERE 条件')
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const wheres = Object.keys(validWhere).map(c => `${quoteId(c)} = ?`).join(' AND ')
    const values = Object.values(validWhere)
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      const [result] = await conn.query(`DELETE FROM ${quoteId(validTable)} WHERE ${wheres}`, values)
      return result
    } finally {
      conn.release()
    }
  })

  ipcMain.handle(IPC.DATA_BATCH_INSERT, async (_e, connId: string, db: string, table: string, rows: Record<string, any>[]) => {
    const validRows = validateRecordBatch(rows, '批量插入')
    if (!validRows.length) return { affectedRows: 0 }
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const cols = Object.keys(validRows[0])
    const columnKey = cols.slice().sort().join('\0')
    if (validRows.some((row) => Object.keys(row).slice().sort().join('\0') !== columnKey)) {
      throw new Error('批量插入的所有记录必须包含相同字段')
    }
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      await conn.beginTransaction()
      const colStr = cols.map(c => quoteId(c)).join(', ')
      const placeholder = `(${cols.map(() => '?').join(', ')})`
      const placeholders = validRows.map(() => placeholder).join(', ')
      const values = validRows.flatMap(r => cols.map(c => r[c] ?? null))
      const [result] = await conn.query(`INSERT INTO ${quoteId(validTable)} (${colStr}) VALUES ${placeholders}`, values)
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
    const validItems = validateUpdateBatch(items)
    if (!validItems.length) return { affectedRows: 0 }
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      await conn.beginTransaction()
      let affectedRows = 0
      for (const item of validItems) {
        const setEntries = Object.entries(item.data)
        const sets = setEntries.map(([c]) => `${quoteId(c)} = ?`).join(', ')
        const setValues = setEntries.map(([, v]) => v)
        const { clause, values: whereValues } = buildWhereClause(item.where)
        const [result] = await conn.query(`UPDATE ${quoteId(validTable)} SET ${sets} WHERE ${clause}`, [...setValues, ...whereValues]) as [ResultSetHeader, unknown]
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
    const validWheres = validateRecordBatch(wheres, '批量删除 WHERE 条件')
    if (!validWheres.length) return { affectedRows: 0 }
    const validDb = validateIdentifier(db, '数据库名')
    const validTable = validateIdentifier(table, '表名')
    const conn = await connectionManager.getConnection(validateConnectionId(connId))
    try {
      await conn.query(`USE ${quoteId(validDb)}`)
      await conn.beginTransaction()
      let affectedRows = 0
      for (const where of validWheres) {
        const { clause, values } = buildWhereClause(where)
        const [result] = await conn.query(`DELETE FROM ${quoteId(validTable)} WHERE ${clause}`, values) as [ResultSetHeader, unknown]
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
