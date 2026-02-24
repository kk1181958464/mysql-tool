export interface DatabaseInfo {
  name: string
  charset: string
  collation: string
  tableCount?: number
}

export interface TableInfo {
  name: string
  type: 'TABLE' | 'VIEW'
  engine: string
  rows: number
  dataLength: number
  indexLength: number
  autoIncrement: number | null
  collation: string
  comment: string
  createTime: string
  updateTime: string
}

export interface ColumnDetail {
  name: string
  ordinalPosition: number
  defaultValue: unknown
  nullable: boolean
  dataType: string
  columnType: string
  maxLength: number | null
  numericPrecision: number | null
  numericScale: number | null
  characterSet: string | null
  collation: string | null
  primaryKey: boolean
  autoIncrement: boolean
  comment: string
  extra: string
}

export interface IndexInfo {
  name: string
  columns: { name: string; order: 'ASC' | 'DESC'; subPart: number | null }[]
  unique: boolean
  type: string
  comment: string
}

export interface ForeignKeyInfo {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onUpdate: string
  onDelete: string
}

export interface ViewInfo {
  name: string
  definition: string
  definer: string
  security: string
}

export interface ProcedureInfo {
  name: string
  type: 'PROCEDURE' | 'FUNCTION'
  definer: string
  paramList: string
  returnType?: string
  body: string
  created: string
  modified: string
  comment: string
}

export interface TriggerInfo {
  name: string
  event: 'INSERT' | 'UPDATE' | 'DELETE'
  timing: 'BEFORE' | 'AFTER'
  table: string
  statement: string
  definer: string
  created: string
}

export interface EventInfo {
  name: string
  definer: string
  timeZone: string
  type: 'ONE TIME' | 'RECURRING'
  interval: string
  starts: string | null
  ends: string | null
  status: 'ENABLED' | 'DISABLED' | 'SLAVESIDE_DISABLED'
  body: string
  created: string
}

export interface ObjectSearchResult {
  name: string
  type: 'TABLE' | 'VIEW' | 'PROCEDURE' | 'FUNCTION' | 'TRIGGER' | 'EVENT'
  database: string
  comment?: string
}
