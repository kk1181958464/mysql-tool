import * as connectionManager from './connection-manager'
import type {
  DatabaseInfo, TableInfo, ColumnDetail, IndexInfo, ForeignKeyInfo,
  ViewInfo, ProcedureInfo, TriggerInfo, EventInfo, ObjectSearchResult
} from '../../shared/types/metadata'

async function query(connId: string, sql: string, db?: string): Promise<any[]> {
  const conn = await connectionManager.getConnection(connId)
  try {
    if (db) await conn.query(`USE \`${db}\``)
    const [rows] = await conn.query(sql)
    return rows as any[]
  } finally {
    conn.release()
  }
}

export async function getDatabases(connId: string): Promise<DatabaseInfo[]> {
  const rows = await query(connId, `SELECT SCHEMA_NAME as name, DEFAULT_CHARACTER_SET_NAME as charset, DEFAULT_COLLATION_NAME as collation FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`)
  return rows.map(r => ({ name: r.name, charset: r.charset, collation: r.collation }))
}

export async function getTables(connId: string, db: string): Promise<TableInfo[]> {
  const rows = await query(connId, `SELECT TABLE_NAME as name, TABLE_TYPE as type, ENGINE as engine, TABLE_ROWS as \`rows\`, DATA_LENGTH as dataLength, INDEX_LENGTH as indexLength, AUTO_INCREMENT as autoIncrement, TABLE_COLLATION as collation, TABLE_COMMENT as comment, CREATE_TIME as createTime, UPDATE_TIME as updateTime FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${db}' ORDER BY TABLE_NAME`)
  return rows.map(r => ({
    name: r.name,
    type: r.type === 'VIEW' ? 'VIEW' : 'TABLE',
    engine: r.engine || '',
    rows: r.rows || 0,
    dataLength: r.dataLength || 0,
    indexLength: r.indexLength || 0,
    autoIncrement: r.autoIncrement,
    collation: r.collation || '',
    comment: r.comment || '',
    createTime: r.createTime || '',
    updateTime: r.updateTime || '',
  }))
}

export async function getColumns(connId: string, db: string, table: string): Promise<ColumnDetail[]> {
  const rows = await query(connId, `SELECT COLUMN_NAME as name, ORDINAL_POSITION as ordinalPosition, COLUMN_DEFAULT as defaultValue, IS_NULLABLE as nullable, DATA_TYPE as dataType, COLUMN_TYPE as columnType, CHARACTER_MAXIMUM_LENGTH as maxLength, NUMERIC_PRECISION as numericPrecision, NUMERIC_SCALE as numericScale, CHARACTER_SET_NAME as characterSet, COLLATION_NAME as collation, COLUMN_KEY as columnKey, EXTRA as extra, COLUMN_COMMENT as comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION`)
  return rows.map(r => ({
    name: r.name,
    ordinalPosition: r.ordinalPosition,
    defaultValue: r.defaultValue,
    nullable: r.nullable === 'YES',
    dataType: r.dataType,
    columnType: r.columnType,
    maxLength: r.maxLength,
    numericPrecision: r.numericPrecision,
    numericScale: r.numericScale,
    characterSet: r.characterSet,
    collation: r.collation,
    primaryKey: r.columnKey === 'PRI',
    autoIncrement: r.extra?.includes('auto_increment') || false,
    comment: r.comment || '',
    extra: r.extra || '',
  }))
}

export async function getIndexes(connId: string, db: string, table: string): Promise<IndexInfo[]> {
  const rows = await query(connId, `SHOW INDEX FROM \`${db}\`.\`${table}\``)
  const map = new Map<string, IndexInfo>()
  for (const r of rows) {
    const name = r.Key_name
    if (!map.has(name)) {
      map.set(name, { name, columns: [], unique: !r.Non_unique, type: r.Index_type, comment: r.Index_comment || '' })
    }
    map.get(name)!.columns.push({ name: r.Column_name, order: r.Collation === 'D' ? 'DESC' : 'ASC', subPart: r.Sub_part })
  }
  return Array.from(map.values())
}

export async function getForeignKeys(connId: string, db: string, table: string): Promise<ForeignKeyInfo[]> {
  const rows = await query(connId, `SELECT CONSTRAINT_NAME as name, COLUMN_NAME as col, REFERENCED_TABLE_NAME as refTable, REFERENCED_COLUMN_NAME as refCol FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='${table}' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`)
  const map = new Map<string, ForeignKeyInfo>()
  for (const r of rows) {
    if (!map.has(r.name)) {
      const ref = await query(connId, `SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA='${db}' AND CONSTRAINT_NAME='${r.name}'`)
      map.set(r.name, { name: r.name, columns: [], referencedTable: r.refTable, referencedColumns: [], onUpdate: ref[0]?.UPDATE_RULE || 'RESTRICT', onDelete: ref[0]?.DELETE_RULE || 'RESTRICT' })
    }
    map.get(r.name)!.columns.push(r.col)
    map.get(r.name)!.referencedColumns.push(r.refCol)
  }
  return Array.from(map.values())
}

export async function getTableDDL(connId: string, db: string, table: string): Promise<string> {
  const rows = await query(connId, `SHOW CREATE TABLE \`${db}\`.\`${table}\``)
  return rows[0]?.['Create Table'] || rows[0]?.['Create View'] || ''
}

export async function getTableStatus(connId: string, db: string): Promise<TableInfo[]> {
  const rows = await query(connId, `SHOW TABLE STATUS FROM \`${db}\``)
  return rows.map(r => ({
    name: r.Name,
    type: r.Comment === 'VIEW' ? 'VIEW' as const : 'TABLE' as const,
    engine: r.Engine || '',
    rows: r.Rows || 0,
    dataLength: r.Data_length || 0,
    indexLength: r.Index_length || 0,
    autoIncrement: r.Auto_increment,
    collation: r.Collation || '',
    comment: r.Comment || '',
    createTime: r.Create_time || '',
    updateTime: r.Update_time || '',
  }))
}

export async function getViews(connId: string, db: string): Promise<ViewInfo[]> {
  const rows = await query(connId, `SELECT TABLE_NAME as name, VIEW_DEFINITION as definition, DEFINER as definer, SECURITY_TYPE as security FROM information_schema.VIEWS WHERE TABLE_SCHEMA='${db}'`)
  return rows.map(r => ({ name: r.name, definition: r.definition || '', definer: r.definer, security: r.security }))
}

export async function getProcedures(connId: string, db: string): Promise<ProcedureInfo[]> {
  const rows = await query(connId, `SELECT ROUTINE_NAME as name, ROUTINE_TYPE as type, DEFINER as definer, PARAM_LIST as paramList, RETURNS as returnType, ROUTINE_BODY as body, CREATED as created, LAST_ALTERED as modified, ROUTINE_COMMENT as comment FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${db}' AND ROUTINE_TYPE='PROCEDURE'`)
  return rows.map(r => ({ name: r.name, type: 'PROCEDURE', definer: r.definer, paramList: r.paramList || '', returnType: r.returnType || '', body: r.body || '', created: r.created || '', modified: r.modified || '', comment: r.comment || '' }))
}

export async function getFunctions(connId: string, db: string): Promise<ProcedureInfo[]> {
  const rows = await query(connId, `SELECT ROUTINE_NAME as name, ROUTINE_TYPE as type, DEFINER as definer, PARAM_LIST as paramList, DTD_IDENTIFIER as returnType, ROUTINE_BODY as body, CREATED as created, LAST_ALTERED as modified, ROUTINE_COMMENT as comment FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${db}' AND ROUTINE_TYPE='FUNCTION'`)
  return rows.map(r => ({ name: r.name, type: 'FUNCTION', definer: r.definer, paramList: r.paramList || '', returnType: r.returnType || '', body: r.body || '', created: r.created || '', modified: r.modified || '', comment: r.comment || '' }))
}

export async function getTriggers(connId: string, db: string): Promise<TriggerInfo[]> {
  const rows = await query(connId, `SELECT TRIGGER_NAME as name, EVENT_MANIPULATION as event, ACTION_TIMING as timing, EVENT_OBJECT_TABLE as \`table\`, ACTION_STATEMENT as statement, DEFINER as definer, CREATED as created FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${db}'`)
  return rows.map(r => ({ name: r.name, event: r.event, timing: r.timing, table: r.table, statement: r.statement, definer: r.definer, created: r.created || '' }))
}

export async function getEvents(connId: string, db: string): Promise<EventInfo[]> {
  const rows = await query(connId, `SELECT EVENT_NAME as name, DEFINER as definer, TIME_ZONE as timeZone, EVENT_TYPE as type, INTERVAL_VALUE as \`interval\`, STARTS as starts, ENDS as ends, STATUS as status, EVENT_BODY as body, CREATED as created FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${db}'`)
  return rows.map(r => ({ name: r.name, definer: r.definer, timeZone: r.timeZone, type: r.type, interval: r.interval || '', starts: r.starts, ends: r.ends, status: r.status, body: r.body || '', created: r.created || '' }))
}

export async function searchObjects(connId: string, db: string, keyword: string): Promise<ObjectSearchResult[]> {
  const like = `%${keyword}%`
  const results: ObjectSearchResult[] = []
  const tables = await query(connId, `SELECT TABLE_NAME as name, TABLE_TYPE as type FROM information_schema.TABLES WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME LIKE '${like}'`)
  for (const t of tables) {
    results.push({ name: t.name, type: t.type === 'VIEW' ? 'VIEW' : 'TABLE', database: db })
  }
  const routines = await query(connId, `SELECT ROUTINE_NAME as name, ROUTINE_TYPE as type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='${db}' AND ROUTINE_NAME LIKE '${like}'`)
  for (const r of routines) {
    results.push({ name: r.name, type: r.type, database: db })
  }
  const triggers = await query(connId, `SELECT TRIGGER_NAME as name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${db}' AND TRIGGER_NAME LIKE '${like}'`)
  for (const t of triggers) {
    results.push({ name: t.name, type: 'TRIGGER', database: db })
  }
  const events = await query(connId, `SELECT EVENT_NAME as name FROM information_schema.EVENTS WHERE EVENT_SCHEMA='${db}' AND EVENT_NAME LIKE '${like}'`)
  for (const e of events) {
    results.push({ name: e.name, type: 'EVENT', database: db })
  }
  return results
}
