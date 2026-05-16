export const DEFAULT_RESULT_ROW_LIMIT = 5000
const MAX_RESULT_ROW_LIMIT = 100000
const TOP_LEVEL_STATEMENT_KEYWORDS = ['SELECT', 'UPDATE', 'INSERT', 'DELETE', 'REPLACE'] as const

export type ResultRowLimitResult = {
  sql: string
  limited: boolean
  limit: number
}

function stripLeadingTrivia(stmt: string): string {
  let s = stmt
  while (true) {
    const ws = s.match(/^\s+/)
    if (ws) s = s.slice(ws[0].length)

    if (s.startsWith('--')) {
      const idx = s.indexOf('\n')
      s = idx >= 0 ? s.slice(idx + 1) : ''
      continue
    }
    if (s.startsWith('#')) {
      const idx = s.indexOf('\n')
      s = idx >= 0 ? s.slice(idx + 1) : ''
      continue
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end >= 0 ? s.slice(end + 2) : ''
      continue
    }

    return s
  }
}

function isWordBoundaryChar(ch: string | undefined): boolean {
  return !ch || !/[A-Za-z0-9_$]/.test(ch)
}

function findTopLevelKeyword(sql: string, keyword: string, startIndex = 0): number {
  const upperKeyword = keyword.toUpperCase()
  let inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  let parenDepth = 0

  for (let i = startIndex; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLC) {
      if (ch === '\n') inLC = false
      continue
    }
    if (inBC) {
      if (ch === '*' && next === '/') {
        inBC = false
        i += 1
      }
      continue
    }
    if (inSQ) {
      if (ch === "'" && next === "'") {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === "'") inSQ = false
      continue
    }
    if (inDQ) {
      if (ch === '"' && next === '"') {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === '"') inDQ = false
      continue
    }
    if (inBT) {
      if (ch === '`') inBT = false
      continue
    }

    if (ch === '-' && next === '-') {
      inLC = true
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      inBC = true
      i += 1
      continue
    }
    if (ch === "'") {
      inSQ = true
      continue
    }
    if (ch === '"') {
      inDQ = true
      continue
    }
    if (ch === '`') {
      inBT = true
      continue
    }
    if (ch === '(') {
      parenDepth += 1
      continue
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1
      continue
    }

    if (
      parenDepth === 0
      && sql.slice(i, i + keyword.length).toUpperCase() === upperKeyword
      && isWordBoundaryChar(sql[i - 1])
      && isWordBoundaryChar(sql[i + keyword.length])
    ) {
      return i
    }
  }

  return -1
}

function findFirstTopLevelKeyword(sql: string, keywords: readonly string[]): { keyword: string; index: number } | null {
  let found: { keyword: string; index: number } | null = null

  for (const keyword of keywords) {
    const index = findTopLevelKeyword(sql, keyword)
    if (index >= 0 && (!found || index < found.index)) {
      found = { keyword, index }
    }
  }

  return found
}

function hasTopLevelStatementSeparator(sql: string): boolean {
  let inSQ = false, inDQ = false, inBT = false, inLC = false, inBC = false
  let parenDepth = 0

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLC) {
      if (ch === '\n') inLC = false
      continue
    }
    if (inBC) {
      if (ch === '*' && next === '/') {
        inBC = false
        i += 1
      }
      continue
    }
    if (inSQ) {
      if (ch === "'" && next === "'") {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === "'") inSQ = false
      continue
    }
    if (inDQ) {
      if (ch === '"' && next === '"') {
        i += 1
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === '"') inDQ = false
      continue
    }
    if (inBT) {
      if (ch === '`') inBT = false
      continue
    }

    if (ch === '-' && next === '-') {
      inLC = true
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      inBC = true
      i += 1
      continue
    }
    if (ch === "'") {
      inSQ = true
      continue
    }
    if (ch === '"') {
      inDQ = true
      continue
    }
    if (ch === '`') {
      inBT = true
      continue
    }
    if (ch === '(') {
      parenDepth += 1
      continue
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1
      continue
    }
    if (ch === ';' && parenDepth === 0) return true
  }

  return false
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
