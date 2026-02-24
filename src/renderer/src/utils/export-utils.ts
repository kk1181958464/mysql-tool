export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = Math.round((ms % 60000) / 1000)
  return `${min}m ${sec}s`
}

export function escapeCSV(value: unknown): string {
  const str = value == null ? '' : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function rowsToCSV(
  columns: string[],
  rows: Record<string, unknown>[],
  delimiter = ','
): string {
  const header = columns.map(escapeCSV).join(delimiter)
  const lines = rows.map((row) =>
    columns.map((col) => escapeCSV(row[col])).join(delimiter)
  )
  return [header, ...lines].join('\n')
}

export function rowsToJSON(rows: Record<string, unknown>[], pretty = true): string {
  return pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows)
}

export function rowsToInsertSQL(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return ''
  const colList = columns.map((c) => `\`${c}\``).join(', ')
  const valuesList = rows.map((row) => {
    const vals = columns.map((col) => {
      const v = row[col]
      if (v == null) return 'NULL'
      if (typeof v === 'number') return String(v)
      return `'${String(v).replace(/'/g, "\\'")}'`
    })
    return `(${vals.join(', ')})`
  })
  return `INSERT INTO \`${table}\` (${colList}) VALUES\n${valuesList.join(',\n')};\n`
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
