export interface QueryResult {
  columns: ColumnInfo[]
  rows: Record<string, unknown>[]
  affectedRows: number
  insertId: number
  executionTime: number
  rowCount: number
  sql: string
  isSelect: boolean
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue: unknown
  primaryKey: boolean
  autoIncrement: boolean
  comment: string
}

export interface QueryHistoryItem {
  id: number
  connectionId: string
  databaseName: string
  sqlText: string
  executionTimeMs: number
  rowCount: number
  isSuccess: boolean
  errorMessage: string
  isSlow: boolean
  createdAt: string
}

export interface ExplainResult {
  id: number
  selectType: string
  table: string
  partitions: string | null
  type: string
  possibleKeys: string | null
  key: string | null
  keyLen: string | null
  ref: string | null
  rows: number
  filtered: number
  extra: string
}

export interface Snippet {
  id: string
  name: string
  category: string
  sqlText: string
  description: string
  createdAt: string
}
