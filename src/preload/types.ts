import type { ConnectionConfig, ConnectionStatus, ConnectionSavePayload } from '../shared/types/connection'
import type { QueryResult, ExplainResult, QueryHistoryItem, Snippet } from '../shared/types/query'
import type { DatabaseInfo, TableInfo, ColumnDetail, IndexInfo, ForeignKeyInfo, ViewInfo, ProcedureInfo, TriggerInfo, EventInfo, ObjectSearchResult } from '../shared/types/metadata'
import type { TableDesign, TableDiff, BackupConfig, BackupRecord, BackupSchedule } from '../shared/types/table-design'

export interface ElectronAPI {
  connection: {
    test(config: ConnectionConfig): Promise<ConnectionStatus>
    connect(config: ConnectionConfig): Promise<ConnectionStatus>
    disconnect(id: string): Promise<void>
    list(): Promise<ConnectionConfig[]>
    save(config: ConnectionSavePayload): Promise<void>
    delete(id: string): Promise<void>
  }
  query: {
    execute(connectionId: string, sql: string, database?: string): Promise<QueryResult>
    executeMulti(connectionId: string, sql: string, database?: string): Promise<{ success: boolean }>
    explain(connectionId: string, sql: string, database?: string): Promise<ExplainResult[]>
    cancel(connectionId: string): Promise<void>
    format(sql: string): Promise<string>
  }
  meta: {
    databases(connId: string): Promise<DatabaseInfo[]>
    tables(connId: string, db: string): Promise<TableInfo[]>
    columns(connId: string, db: string, table: string): Promise<ColumnDetail[]>
    indexes(connId: string, db: string, table: string): Promise<IndexInfo[]>
    foreignKeys(connId: string, db: string, table: string): Promise<ForeignKeyInfo[]>
    tableDDL(connId: string, db: string, table: string): Promise<string>
    tableStatus(connId: string, db: string): Promise<TableInfo[]>
    views(connId: string, db: string): Promise<ViewInfo[]>
    procedures(connId: string, db: string): Promise<ProcedureInfo[]>
    functions(connId: string, db: string): Promise<ProcedureInfo[]>
    triggers(connId: string, db: string): Promise<TriggerInfo[]>
    events(connId: string, db: string): Promise<EventInfo[]>
  }
  design: {
    createTable(connId: string, db: string, design: TableDesign): Promise<string>
    alterTable(connId: string, db: string, tableName: string, diff: TableDiff): Promise<string>
    dropTable(connId: string, db: string, table: string): Promise<string>
    diff(oldDesign: TableDesign, newDesign: TableDesign): Promise<TableDiff>
  }
  data: {
    insert(connId: string, db: string, table: string, data: Record<string, any>): Promise<any>
    update(connId: string, db: string, table: string, data: Record<string, any>, where: Record<string, any>): Promise<any>
    delete(connId: string, db: string, table: string, where: Record<string, any>): Promise<any>
    batchInsert(connId: string, db: string, table: string, rows: Record<string, unknown>[]): Promise<any>
    batchUpdate(connId: string, db: string, table: string, items: Array<{ data: Record<string, unknown>; where: Record<string, unknown> }>): Promise<any>
    batchDelete(connId: string, db: string, table: string, wheres: Record<string, unknown>[]): Promise<any>
  }
  importExport: {
    importFile(connId: string, db: string, table: string, filePath: string, options?: any): Promise<{ imported: number }>
    preview(filePath: string): Promise<{ columns: string[]; rows: any[]; totalRows: number }>
    exportData(connId: string, db: string, sql: string, filePath: string, format: string, options?: any): Promise<void>
    exportStructure(connId: string, db: string, tables: string[], filePath: string): Promise<void>
  }
  perf: {
    processList(connId: string): Promise<any[]>
    innodbStatus(connId: string): Promise<string>
    variables(connId: string, filter?: string): Promise<Record<string, string>>
    status(connId: string, filter?: string): Promise<Record<string, string>>
  }
  backup: {
    create(config: BackupConfig): Promise<BackupRecord>
    restore(connId: string, filePath: string): Promise<void>
    list(connId: string): Promise<BackupRecord[]>
    schedule(schedule: BackupSchedule): Promise<void>
  }
  object: {
    search(connId: string, db: string, keyword: string): Promise<ObjectSearchResult[]>
    createView(connId: string, db: string, sql: string): Promise<void>
    createProcedure(connId: string, db: string, sql: string): Promise<void>
    createTrigger(connId: string, db: string, sql: string): Promise<void>
    createEvent(connId: string, db: string, sql: string): Promise<void>
    drop(connId: string, db: string, type: string, name: string): Promise<void>
    execRoutine(connId: string, db: string, name: string, type: 'PROCEDURE' | 'FUNCTION', params: string[]): Promise<{ rows: unknown[] }>
  }
  store: {
    getHistory(connectionId: string, limit?: number): Promise<QueryHistoryItem[]>
    saveHistory(item: Omit<QueryHistoryItem, 'id'>): Promise<void>
    getSnippets(): Promise<Snippet[]>
    saveSnippet(snippet: Snippet): Promise<void>
    getSettings(key: string): Promise<string | null>
    saveSettings(key: string, value: string): Promise<void>
  }
  dialog: {
    saveFile(options: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    writeFile(filePath: string, content: string): Promise<void>
    openFile(options: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    readFile(filePath: string): Promise<string>
  }
  onImportProgress(cb: (data: { current: number; total: number; fail: number }) => void): () => void
  win: {
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximized(cb: (maximized: boolean) => void): () => void
  }
}
