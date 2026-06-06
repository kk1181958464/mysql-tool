import { create } from 'zustand'
import type { DatabaseInfo, TableInfo, ColumnDetail } from '../../../shared/types/metadata'
import { api } from '../utils/ipc'

const CACHE_TTL = 30_000 // 30s

interface DatabaseState {
  databases: Record<string, DatabaseInfo[]>
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnDetail[]>
  databaseOpenStates: Record<string, boolean>
  loadingDatabases: Record<string, boolean>
  _ts: Record<string, number>
  _inflight: Record<string, Promise<void>>
  _version: Record<string, number>
  loadDatabases: (connectionId: string, force?: boolean) => Promise<void>
  loadTables: (connectionId: string, db: string, force?: boolean) => Promise<void>
  loadColumns: (connectionId: string, db: string, table: string, force?: boolean) => Promise<void>
  isDatabaseOpen: (connectionId: string, dbName: string) => boolean
  setDatabaseOpen: (connectionId: string, dbName: string, open: boolean) => void
  toggleDatabaseOpen: (connectionId: string, dbName: string) => void
  resetDatabaseOpenStates: (connectionId?: string) => void
  clearCache: (connectionId?: string) => void
  clearDatabaseData: (connectionId: string, dbName: string) => void
}

function isFresh(ts: Record<string, number>, key: string): boolean {
  return !!ts[key] && Date.now() - ts[key] < CACHE_TTL
}

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  databases: {},
  tables: {},
  columns: {},
  databaseOpenStates: {},
  loadingDatabases: {},
  _ts: {},
  _inflight: {},
  _version: {},

  loadDatabases: async (connectionId, force) => {
    const key = `dbs:${connectionId}`
    if (!force && isFresh(get()._ts, connectionId)) return
    const inflight = get()._inflight[key]
    if (inflight) {
      await inflight
      return
    }

    const request = (async () => {
      const version = get()._version[connectionId] ?? 0
      set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: true } }))
      try {
        const dbs = await api.meta.databases(connectionId)
        if ((get()._version[connectionId] ?? 0) !== version) return
        set((s) => ({
          databases: { ...s.databases, [connectionId]: dbs },
          _ts: { ...s._ts, [connectionId]: Date.now() },
        }))
      } finally {
        if ((get()._version[connectionId] ?? 0) === version) {
          set((s) => ({ loadingDatabases: { ...s.loadingDatabases, [connectionId]: false } }))
        }
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
      const version = get()._version[connectionId] ?? 0
      const tbls = await api.meta.tables(connectionId, db)
      if ((get()._version[connectionId] ?? 0) !== version) return
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
      const version = get()._version[connectionId] ?? 0
      const cols = await api.meta.columns(connectionId, db, table)
      if ((get()._version[connectionId] ?? 0) !== version) return
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

  isDatabaseOpen: (connectionId, dbName) => {
    const key = `${connectionId}:${dbName}`
    const state = get().databaseOpenStates[key]
    return state === true
  },

  setDatabaseOpen: (connectionId, dbName, open) => {
    const key = `${connectionId}:${dbName}`
    set((s) => ({
      databaseOpenStates: { ...s.databaseOpenStates, [key]: open },
    }))
  },

  toggleDatabaseOpen: (connectionId, dbName) => {
    const key = `${connectionId}:${dbName}`
    const current = get().databaseOpenStates[key]
    set((s) => ({
      databaseOpenStates: { ...s.databaseOpenStates, [key]: current === false },
    }))
  },

  resetDatabaseOpenStates: (connectionId) => {
    if (!connectionId) {
      set({ databaseOpenStates: {} })
      return
    }
    set((s) => {
      const databaseOpenStates = { ...s.databaseOpenStates }
      for (const key of Object.keys(databaseOpenStates)) {
        if (key.startsWith(connectionId + ':')) delete databaseOpenStates[key]
      }
      return { databaseOpenStates }
    })
  },

  clearCache: (connectionId) => {
    if (!connectionId) {
      set((s) => {
        const _version = { ...s._version }
        const ids = new Set<string>()
        Object.keys(s.databases).forEach((id) => ids.add(id))
        Object.keys(s.loadingDatabases).forEach((id) => ids.add(id))
        Object.keys(s._version).forEach((id) => ids.add(id))
        ids.forEach((id) => {
          _version[id] = (_version[id] ?? 0) + 1
        })
        return { databases: {}, tables: {}, columns: {}, databaseOpenStates: {}, loadingDatabases: {}, _ts: {}, _inflight: {}, _version }
      })
      return
    }
    set((s) => {
      const databases = { ...s.databases }
      const tables = { ...s.tables }
      const columns = { ...s.columns }
      const databaseOpenStates = { ...s.databaseOpenStates }
      const _ts = { ...s._ts }
      const _inflight = { ...s._inflight }
      const loadingDatabases = { ...s.loadingDatabases }
      const _version = { ...s._version }
      delete databases[connectionId]
      delete _ts[connectionId]
      delete _inflight[`dbs:${connectionId}`]
      delete loadingDatabases[connectionId]
      _version[connectionId] = (_version[connectionId] ?? 0) + 1
      for (const k of Object.keys(databaseOpenStates)) {
        if (k.startsWith(connectionId + ':')) delete databaseOpenStates[k]
      }
      for (const k of Object.keys(tables)) {
        if (k.startsWith(connectionId + ':')) { delete tables[k]; delete _ts[k]; delete _inflight[`tables:${k}`] }
      }
      for (const k of Object.keys(columns)) {
        if (k.startsWith(connectionId + ':')) { delete columns[k]; delete _ts[k]; delete _inflight[`columns:${k}`] }
      }
      return { databases, tables, columns, databaseOpenStates, loadingDatabases, _ts, _inflight, _version }
    })
  },

  clearDatabaseData: (connectionId, dbName) => {
    const tableKey = `${connectionId}:${dbName}`
    set((s) => {
      const tables = { ...s.tables }
      const columns = { ...s.columns }
      const databaseOpenStates = { ...s.databaseOpenStates }
      const _ts = { ...s._ts }

      delete tables[tableKey]
      delete databaseOpenStates[tableKey]
      delete _ts[tableKey]

      for (const k of Object.keys(columns)) {
        if (k.startsWith(tableKey + ':')) {
          delete columns[k]
          delete _ts[k]
        }
      }

      return { tables, columns, databaseOpenStates, _ts }
    })
  },
}))
