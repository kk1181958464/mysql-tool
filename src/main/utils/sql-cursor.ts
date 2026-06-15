/**
 * 统一 SQL 解析状态机 — 消除 4 处重复的字符级 SQL 解析。
 *
 * 被 sql-result-limit / sql-script-executor 共用。
 */

/** 检查字符是否为单词边界（非标识符字符） */
export function isWordBoundaryChar(ch: string | undefined): boolean {
  return !ch || !/[A-Za-z0-9_$]/.test(ch)
}

/** 跳过前导空白和注释，返回有效内容起始位置 */
function skipTriviaTo(sql: string, startIndex: number): number {
  let i = startIndex
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1
      continue
    }

    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i + 2)
      i = nl >= 0 ? nl + 1 : sql.length
      continue
    }
    if (ch === '#') {
      const nl = sql.indexOf('\n', i + 1)
      i = nl >= 0 ? nl + 1 : sql.length
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end >= 0 ? end + 2 : sql.length
      continue
    }

    break
  }
  return i
}

/** 跳过前导空白和注释，返回起始处到有效内容的子串 */
export function stripLeadingTrivia(stmt: string): string {
  const idx = skipTriviaTo(stmt, 0)
  return idx > 0 ? stmt.slice(idx) : stmt
}

/**
 * 在 SQL 中查找顶层（括号深度=0，不在字符串/注释内）的关键字位置。
 * 返回关键字首字符索引，未找到返回 -1。
 */
export function findTopLevelKeyword(
  sql: string,
  keyword: string,
  startIndex = 0,
): number {
  const upperKeyword = keyword.toUpperCase()
  const kwLen = keyword.length
  let inSQ = false
  let inDQ = false
  let inBT = false
  let inLC = false
  let inBC = false
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
      if (ch === "'" && next === "'") { i += 1; continue }
      if (ch === '\\') { i += 1; continue }
      if (ch === "'") inSQ = false
      continue
    }
    if (inDQ) {
      if (ch === '"' && next === '"') { i += 1; continue }
      if (ch === '\\') { i += 1; continue }
      if (ch === '"') inDQ = false
      continue
    }
    if (inBT) {
      if (ch === '`') inBT = false
      continue
    }

    if (ch === '-' && next === '-') { inLC = true; i += 1; continue }
    if (ch === '/' && next === '*') { inBC = true; i += 1; continue }
    if (ch === "'") { inSQ = true; continue }
    if (ch === '"') { inDQ = true; continue }
    if (ch === '`') { inBT = true; continue }
    if (ch === '(') { parenDepth += 1; continue }
    if (ch === ')' && parenDepth > 0) { parenDepth -= 1; continue }

    if (
      parenDepth === 0
      && sql.slice(i, i + kwLen).toUpperCase() === upperKeyword
      && isWordBoundaryChar(sql[i - 1])
      && isWordBoundaryChar(sql[i + kwLen])
    ) {
      return i
    }
  }

  return -1
}

/**
 * 在 SQL 中查找第一个出现的顶层关键字（按关键字数组顺序），
 * 返回最先匹配到的关键字和位置。
 */
export function findFirstTopLevelKeyword(
  sql: string,
  keywords: readonly string[],
): { keyword: string; index: number } | null {
  let found: { keyword: string; index: number } | null = null

  for (const keyword of keywords) {
    const index = findTopLevelKeyword(sql, keyword)
    if (index >= 0 && (!found || index < found.index)) {
      found = { keyword, index }
    }
  }

  return found
}

/**
 * 检查 SQL 是否包含顶层的分号语句分隔符（不在字符串/注释/子查询内）。
 */
export function hasTopLevelStatementSeparator(sql: string): boolean {
  let inSQ = false
  let inDQ = false
  let inBT = false
  let inLC = false
  let inBC = false
  let parenDepth = 0

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLC) {
      if (ch === '\n') inLC = false
      continue
    }
    if (inBC) {
      if (ch === '*' && next === '/') { inBC = false; i += 1 }
      continue
    }
    if (inSQ) {
      if (ch === "'" && next === "'") { i += 1; continue }
      if (ch === '\\') { i += 1; continue }
      if (ch === "'") inSQ = false
      continue
    }
    if (inDQ) {
      if (ch === '"' && next === '"') { i += 1; continue }
      if (ch === '\\') { i += 1; continue }
      if (ch === '"') inDQ = false
      continue
    }
    if (inBT) {
      if (ch === '`') inBT = false
      continue
    }

    if (ch === '-' && next === '-') { inLC = true; i += 1; continue }
    if (ch === '/' && next === '*') { inBC = true; i += 1; continue }
    if (ch === "'") { inSQ = true; continue }
    if (ch === '"') { inDQ = true; continue }
    if (ch === '`') { inBT = true; continue }
    if (ch === '(') { parenDepth += 1; continue }
    if (ch === ')' && parenDepth > 0) { parenDepth -= 1; continue }
    if (ch === ';' && parenDepth === 0) return true
  }

  return false
}
