type StatementSegment = { start: number; end: number }

const findStatementSegments = (sql: string): StatementSegment[] => {
  const segments: StatementSegment[] = []
  let start = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
      }
      continue
    }
    if (inSingle) {
      if (ch === '\\') { i += 1; continue }
      if (ch === "'" && next === "'") { i += 1; continue }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      if (ch === '\\') { i += 1; continue }
      if (ch === '"' && next === '"') { i += 1; continue }
      if (ch === '"') inDouble = false
      continue
    }
    if (inBacktick) {
      if (ch === '`') inBacktick = false
      continue
    }

    if (ch === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) { inLineComment = true; i += 1; continue }
    if (ch === '#') { inLineComment = true; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue }
    if (ch === "'") { inSingle = true; continue }
    if (ch === '"') { inDouble = true; continue }
    if (ch === '`') { inBacktick = true; continue }
    if (ch !== ';') continue

    segments.push({ start, end: i })
    start = i + 1
  }
  segments.push({ start, end: sql.length })
  return segments
}

const hasStatementBody = (text: string): boolean =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?:--\s|#)[^\n]*/g, '').trim().length > 0

export const findCurrentStatement = (sql: string, offset: number): string => {
  const segments = findStatementSegments(sql)
  // The cursor directly after a `;` still belongs to the statement that `;` ends.
  let index = segments.findIndex((seg) => offset >= seg.start && offset <= seg.end + 1)
  if (index < 0) index = segments.length - 1
  while (index >= 0) {
    const text = sql.slice(segments[index].start, segments[index].end)
    if (hasStatementBody(text)) return text.trim()
    index -= 1
  }
  return ''
}
