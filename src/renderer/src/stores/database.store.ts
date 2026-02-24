import { create } from 'zustand'
import type { DatabaseInfo, TableInfo, ColumnDetail } from '../../../shared/types/metadata'
import { api } from '../utils/ipc'

interface DatabaseState {
  databases: Record<string, DatabaseInfo[]>
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnDetail[]>
  loadingDatabases: Record<string, boolean>
  loadDatabases: (connectionId: string) => Promise<void>
  loadTables: (connectionId: string, db: string) => Promise<void>
  loadColumns: (connectionId: string, db: string, table: string) => Promise<void>
  clearCache: (connectionId?: string) => void
}

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  databases: {},
  tables: {},
  columns: {},
  loadingDatabases: {},

  loadDatabases: async (connectionId) => {
    set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: true } }))
    try {
      const dbs = await api.meta.databases(connectionId)
      set((s) => ({ databases: { ...s.databases, [connectionId]: dbs } }))
    } finally {
      set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: false } }))
    }
  },

  loadTables: async (connectionId, db) => {
    const key = `${connectionId}:${db}`
    const tbls = await api.meta.tables(connectionId, db)
    set((s) => ({ tables: { ...s.tables, [key]: tbls } }))
  },

  loadColumns: async (connectionId, db, table) => {
    const key = `${connectionId}:${db}:${table}`
    const cols = await api.meta.columns(connectionId, db, table)
    set((s) => ({ columns: { ...s.columns, [key]: cols } }))
  },

  clearCache: (connectionId) => {
    if (!connectionId) {
      set({ databases: {}, tables: {}, columns: {} })
      return
    }
    set((s) => {
      const databases = { ...s.databases }
      const tables = { ...s.tables }
      const columns = { ...s.columns }
      delete databases[connectionId]
      for (const k of Object.keys(tables)) {
        if (k.startsWith(connectionId + ':')) delete tables[k]
      }
      for (const k of Object.keys(columns)) {
        if (k.startsWith(connectionId + ':')) delete columns[k]
      }
      return { databases, tables, columns }
    })
  },
}))
