export const parseClipboardGrid = (text: string): string[][] => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const input = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '"') {
      if (inQuotes && input[i + 1] === '"') {
        cell += '"'
        i += 1
        continue
      }
      if (inQuotes || cell.length === 0) {
        inQuotes = !inQuotes
        continue
      }
    }
    if (ch === '\t' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n' && !inQuotes) {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += ch
  }

  row.push(cell)
  rows.push(row)
  return rows
}
