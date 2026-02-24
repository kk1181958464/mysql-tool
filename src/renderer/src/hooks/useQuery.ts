import { useState, useCallback } from 'react'
import type { QueryResult } from '../../../shared/types/query'
import type { ExplainResult } from '../../../shared/types/query'
import { api } from '../utils/ipc'

export function useQuery() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const executeQuery = useCallback(async (connectionId: string, sql: string, database?: string): Promise<QueryResult | null> => {
    setLoading(true)
    setError(null)
    try {
      return await api.query.execute(connectionId, sql, database)
    } catch (e: any) {
      setError(e.message ?? String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const explainQuery = useCallback(async (connectionId: string, sql: string, database?: string): Promise<ExplainResult[] | null> => {
    setLoading(true)
    setError(null)
    try {
      return await api.query.explain(connectionId, sql, database)
    } catch (e: any) {
      setError(e.message ?? String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const formatSQL = useCallback(async (sql: string): Promise<string | null> => {
    try {
      return await api.query.format(sql)
    } catch (e: any) {
      setError(e.message ?? String(e))
      return null
    }
  }, [])

  return { executeQuery, explainQuery, formatSQL, loading, error }
}
