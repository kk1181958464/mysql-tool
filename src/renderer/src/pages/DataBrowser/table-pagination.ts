export interface SortSpec {
  column: string
  direction: 'ASC' | 'DESC'
}

const quoteSqlString = (value: string): string => `'${value
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\u0000/g, '\\0')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '\\r')
  .replace(/\u001a/g, '\\Z')}'`

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
  // MySQL sorts NULL as the smallest value, so it comes first in ASC and last in DESC.
  const col = quoteId(sort.column)
  const pkCompare = `${quoteId(pkColumn)} ${op} ${escSQL(anchorPk)}`
  if (anchorSort === null || anchorSort === undefined) {
    return op === '>'
      ? `(${col} IS NOT NULL OR (${col} IS NULL AND ${pkCompare}))`
      : `(${col} IS NULL AND ${pkCompare})`
  }
  const valueCompare = `(${col} ${op} ${escSQL(anchorSort)}) OR (${col} = ${escSQL(anchorSort)} AND ${pkCompare})`
  return op === '>' ? `(${valueCompare})` : `(${valueCompare} OR ${col} IS NULL)`
}
