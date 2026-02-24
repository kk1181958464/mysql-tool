export interface TableDesign {
  name: string
  engine: string
  charset: string
  collation: string
  comment: string
  columns: ColumnDesign[]
  indexes: IndexDesign[]
  foreignKeys: ForeignKeyDesign[]
}

export interface ColumnDesign {
  name: string
  type: string
  length: string
  decimals: string
  nullable: boolean
  defaultValue: string
  autoIncrement: boolean
  primaryKey: boolean
  unique: boolean
  comment: string
  unsigned: boolean
  zerofill: boolean
  onUpdateCurrentTimestamp: boolean
}

export interface IndexDesign {
  name: string
  type: 'INDEX' | 'UNIQUE' | 'FULLTEXT' | 'SPATIAL'
  method: 'BTREE' | 'HASH'
  columns: { name: string; length?: number; order: 'ASC' | 'DESC' }[]
  comment: string
}

export interface ForeignKeyDesign {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onUpdate: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT'
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT'
}

export interface TableDiff {
  addColumns: ColumnDesign[]
  modifyColumns: { old: string; new: ColumnDesign }[]
  dropColumns: string[]
  addIndexes: IndexDesign[]
  dropIndexes: string[]
  addForeignKeys: ForeignKeyDesign[]
  dropForeignKeys: string[]
  changeOptions: Partial<Pick<TableDesign, 'engine' | 'charset' | 'collation' | 'comment'>>
}

export interface BackupConfig {
  id: string
  connectionId: string
  databaseName: string
  backupType: 'full' | 'structure' | 'data'
  filePath: string
  compress: boolean
  encrypt: boolean
}

export interface BackupRecord {
  id: string
  connectionId: string
  databaseName: string
  backupType: string
  filePath: string
  fileSize: number
  isCompressed: boolean
  isEncrypted: boolean
  status: 'running' | 'completed' | 'failed'
  createdAt: string
}

export interface BackupSchedule {
  id: string
  connectionId: string
  databaseName: string
  cronExpression: string
  backupType: string
  compress: boolean
  retentionDays: number
  isActive: boolean
  lastRun: string | null
  createdAt: string
}
