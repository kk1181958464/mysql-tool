import { format } from 'sql-formatter'

export function formatSQL(sql: string): string {
  return format(sql, {
    language: 'mysql',
    keywordCase: 'upper',
    indentStyle: 'standard',
    logicalOperatorNewline: 'before',
  })
}

export function minifySQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/\s*([,;()])\s*/g, '$1').trim()
}

export function extractStatements(sql: string): string[] {
  return sql.split(';').map((s) => s.trim()).filter(Boolean)
}
