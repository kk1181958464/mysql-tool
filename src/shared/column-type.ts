export interface ParsedColumnType {
  type: string
  length: string
  decimals: string
  unsigned: boolean
  zerofill: boolean
}

const LIST_TYPES = new Set(['ENUM', 'SET'])

export function parseColumnType(columnType: string): ParsedColumnType {
  const match = String(columnType || '').trim().match(/^([A-Za-z]+)\s*(?:\(([\s\S]*)\))?([\s\S]*)$/)
  if (!match) return { type: String(columnType || '').toUpperCase(), length: '', decimals: '', unsigned: false, zerofill: false }
  const type = match[1].toUpperCase()
  const args = (match[2] ?? '').trim()
  const suffix = (match[3] ?? '').toLowerCase()
  let length = ''
  let decimals = ''
  if (LIST_TYPES.has(type)) {
    length = args
  } else if (args) {
    const [first, second] = args.split(',').map((part) => part.trim())
    length = first ?? ''
    decimals = second ?? ''
  }
  return { type, length, decimals, unsigned: /\bunsigned\b/.test(suffix), zerofill: /\bzerofill\b/.test(suffix) }
}

export function isTextualColumnType(type: string): boolean {
  return /^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET)$/i.test(type)
}

const DEFAULT_EXPRESSION = /^(?:NULL|CURRENT_TIMESTAMP(?:\(\d*\))?|NOW\(\d*\)|LOCALTIME(?:STAMP)?(?:\(\d*\))?|CURRENT_DATE|CURRENT_TIME|TRUE|FALSE)$/i

export function quoteSqlLiteral(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u0000/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u001a/g, '\\Z')}'`
}

// information_schema.COLUMN_DEFAULT is the raw value; turn it back into a SQL expression.
export function columnDefaultToSql(defaultValue: unknown, dataType: string, extra: string): string {
  if (defaultValue === null || defaultValue === undefined) return ''
  const raw = String(defaultValue)
  if (/DEFAULT_GENERATED/i.test(extra)) return /^\(.*\)$/s.test(raw) || DEFAULT_EXPRESSION.test(raw) ? raw : `(${raw})`
  if (DEFAULT_EXPRESSION.test(raw)) return raw
  if (/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|BIT|YEAR)$/i.test(dataType) && /^-?\d+(?:\.\d+)?$/.test(raw)) return raw
  if (/^b'[01]*'$/i.test(raw)) return raw
  return quoteSqlLiteral(raw)
}
