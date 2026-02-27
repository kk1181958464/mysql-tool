import { create } from 'zustand'
import type { DatabaseInfo, TableInfo, ColumnDetail } from '../../../shared/types/metadata'
import { api } from '../utils/ipc'

const CACHE_TTL = 30_000 // 30s

interface DatabaseState {
  databases: Record<string, DatabaseInfo[]>
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnDetail[]>
  loadingDatabases: Record<string, boolean>
  _ts: Record<string, number>
  _inflight: Record<string, Promise<void>>
  loadDatabases: (connectionId: string, force?: boolean) => Promise<void>
  loadTables: (connectionId: string, db: string, force?: boolean) => Promise<void>
  loadColumns: (connectionId: string, db: string, table: string, force?: boolean) => Promise<void>
  clearCache: (connectionId?: string) => void
}

function isFresh(ts: Record<string, number>, key: string): boolean {
  return !!ts[key] && Date.now() - ts[key] < CACHE_TTL
}

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  databases: {},
  tables: {},
  columns: {},
  loadingDatabases: {},
  _ts: {},
  _inflight: {},

  loadDatabases: async (connectionId, force) => {
    const key = `dbs:${connectionId}`
    if (!force && isFresh(get()._ts, connectionId)) return
    const inflight = get()._inflight[key]
    if (inflight) {
      await inflight
      return
    }

    const request = (async () => {
      set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: true } }))
      try {
        const dbs = await api.meta.databases(connectionId)
        set((s) => ({
          databases: { ...s.databases, [connectionId]: dbs },
          _ts: { ...s._ts, [connectionId]: Date.now() },
        }))
      } finally {
        set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: false } }))
      }
    })()

    set((s) => ({ _inflight: { ...s._inflight, [key]: request } }))
    try {
      await request
    } finally {
      set((s) => {
        const next = { ...s._inflight }
        delete next[key]
        return { _inflight: next }
      })
    }
  },

  loadTables: async (connectionId, db, force) => {
    const key = `${connectionId}:${db}`
    const inflightKey = `tables:${key}`
    if (!force && isFresh(get()._ts, key)) return
    const inflight = get()._inflight[inflightKey]
    if (inflight) {
      await inflight
      return
    }

    const request = (async () => {
      const tbls = await api.meta.tables(connectionId, db)
      set((s) => ({
        tables: { ...s.tables, [key]: tbls },
        _ts: { ...s._ts, [key]: Date.now() },
      }))
    })()

    set((s) => ({ _inflight: { ...s._inflight, [inflightKey]: request } }))
    try {
      await request
    } finally {
      set((s) => {
        const next = { ...s._inflight }
        delete next[inflightKey]
        return { _inflight: next }
      })
    }
  },

  loadColumns: async (connectionId, db, table, force) => {
    const key = `${connectionId}:${db}:${table}`
    const inflightKey = `columns:${key}`
    if (!force && isFresh(get()._ts, key)) return
    const inflight = get()._inflight[inflightKey]
    if (inflight) {
      await inflight
      return
    }

    const request = (async () => {
      const cols = await api.meta.columns(connectionId, db, table)
      set((s) => ({
        columns: { ...s.columns, [key]: cols },
        _ts: { ...s._ts, [key]: Date.now() },
      }))
    })()

    set((s) => ({ _inflight: { ...s._inflight, [inflightKey]: request } }))
    try {
      await request
    } finally {
      set((s) => {
        const next = { ...s._inflight }
        delete next[inflightKey]
        return { _inflight: next }
      })
    }
  },

  clearCache: (connectionId) => {
    if (!connectionId) {
      set({ databases: {}, tables: {}, columns: {}, _ts: {}, _inflight: {} })
      return
    }
    set((s) => {
      const databases = { ...s.databases }
      const tables = { ...s.tables }
      const columns = { ...s.columns }
      const _ts = { ...s._ts }
      const _inflight = { ...s._inflight }
      delete databases[connectionId]
      delete _ts[connectionId]
      delete _inflight[`dbs:${connectionId}`]
      for (const k of Object.keys(tables)) {
        if (k.startsWith(connectionId + ':')) { delete tables[k]; delete _ts[k]; delete _inflight[`tables:${k}`] }
      }
      for (const k of Object.keys(columns)) {
        if (k.startsWith(connectionId + ':')) { delete columns[k]; delete _ts[k]; delete _inflight[`columns:${k}`] }
      }
      return { databases, tables, columns, _ts, _inflight }
    })
  },
}))
