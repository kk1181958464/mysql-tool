export interface SortSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

const quoteSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

export const quoteId = (id: string): string => `\`${String(id).replace(/`/g, '``')}\``

export const escSQL = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    try {
      return quoteSqlString(JSON.stringify(value))
    } catch {
      return quoteSqlString(String(value))
    }
  }
  return quoteSqlString(String(value))
}

export const parseSort = (orderBy: string): SortSpec | null => {
  const match = orderBy.match(/^`([^`]+)`\s+(ASC|DESC)$/i)
  if (!match) return null
  return { column: match[1], direction: match[2].toUpperCase() === 'DESC' ? 'DESC' : 'ASC' }
}

export const compareDirection = (direction: 'ASC' | 'DESC', action: 'next' | 'prev'): '>' | '<' => {
  const forward = direction === 'ASC' ? '>' : '<'
  const backward = direction === 'ASC' ? '<' : '>'
  return action === 'next' ? forward : backward
}

export const buildKeysetPredicate = (
  sort: SortSpec | null,
  pkColumn: string,
  anchorSort: unknown,
  anchorPk: unknown,
  op: '>' | '<',
): string => {
  if (!sort || sort.column === pkColumn) {
    return `${quoteId(pkColumn)} ${op} ${escSQL(anchorPk)}`
  }
  if (anchorSort === null || anchorSort === undefined) {
    const nullOp = op === '>' ? 'IS NOT NULL' : 'IS NULL'
    return `(${quoteId(sort.column)} ${nullOp} OR (${quoteId(sort.column)} IS NULL AND ${quoteId(pkColumn)} ${op} ${escSQL(anchorPk)}))`
  }
  return `((${quoteId(sort.column)} ${op} ${escSQL(anchorSort)}) OR (${quoteId(sort.column)} = ${escSQL(anchorSort)} AND ${quoteId(pkColumn)} ${op} ${escSQL(anchorPk)}))`
}
