import { useEffect } from 'react'
import { useDatabaseStore } from '../stores/database.store'

export function useDatabase(connectionId: string | null) {
  const store = useDatabaseStore()

  useEffect(() => {
    if (connectionId) store.loadDatabases(connectionId)
  }, [connectionId])

  const databases = connectionId ? store.databases[connectionId] ?? [] : []

  const loadTables = (db: string) => {
    if (connectionId) return store.loadTables(connectionId, db)
  }

  const loadColumns = (db: string, table: string) => {
    if (connectionId) return store.loadColumns(connectionId, db, table)
  }

  const getTables = (db: string) => {
    if (!connectionId) return []
    return store.tables[`${connectionId}:${db}`] ?? []
  }

  const getColumns = (db: string, table: string) => {
    if (!connectionId) return []
    return store.columns[`${connectionId}:${db}:${table}`] ?? []
  }

  return {
    databases,
    getTables,
    getColumns,
    loadDatabases: () => connectionId && store.loadDatabases(connectionId),
    loadTables,
    loadColumns,
    clearCache: store.clearCache,
  }
}
