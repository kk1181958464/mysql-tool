import {
  stripLeadingTrivia,
  findTopLevelKeyword,
  findFirstTopLevelKeyword,
  hasTopLevelStatementSeparator,
} from './sql-cursor'

export const DEFAULT_RESULT_ROW_LIMIT = 5000
const MAX_RESULT_ROW_LIMIT = 100000
const TOP_LEVEL_STATEMENT_KEYWORDS = ['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'REPLACE'] as const

export type ResultRowLimitResult = {
  sql: string
  limited: boolean
  limit: number
}

function normalizeResultLimit(maxRows?: number): number {
  const parsed = Number(maxRows ?? DEFAULT_RESULT_ROW_LIMIT)
  if (!Number.isFinite(parsed)) return DEFAULT_RESULT_ROW_LIMIT
  return Math.max(1, Math.min(Math.trunc(parsed), MAX_RESULT_ROW_LIMIT))
}

function isLimitableResultQuery(stmt: string): boolean {
  const core = stripLeadingTrivia(stmt).trim().replace(/;+\s*$/, '').trim()
  if (!core || findTopLevelKeyword(core, 'LIMIT') >= 0) return false
  if (hasTopLevelStatementSeparator(core)) return false
  if (findTopLevelKeyword(core, 'INTO') >= 0) return false
  if (findTopLevelKeyword(core, 'FOR') >= 0) return false
  if (findTopLevelKeyword(core, 'LOCK') >= 0) return false

  if (/^SELECT\b/i.test(core)) return true

  if (/^WITH\b/i.test(core)) {
    const firstStatement = findFirstTopLevelKeyword(core, TOP_LEVEL_STATEMENT_KEYWORDS)
    return firstStatement?.keyword === 'SELECT'
  }

  return false
}

export function applyResultRowLimit(
  stmt: string,
  options?: { enabled?: boolean; maxRows?: number },
): ResultRowLimitResult {
  const limit = normalizeResultLimit(options?.maxRows)
  if (!options?.enabled || !isLimitableResultQuery(stmt)) {
    return { sql: stmt, limited: false, limit }
  }

  const core = stmt.trim().replace(/;+\s*$/, '').trim()
  return {
    sql: `${core} LIMIT ${limit}`,
    limited: true,
    limit,
  }
}
