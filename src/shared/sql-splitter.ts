// MySQL 脚本语句切分：查询页（光标语句）、脚本执行与 SQL 文件导入共用同一套规则。
// 支持 DELIMITER、存储过程/函数/触发器/事件的 BEGIN…END 块、字符串/标识符/注释内的分隔符。

export interface SqlStatementSegment {
  text: string
  start: number
  end: number
  next: number
  empty: boolean
}

const COMPOUND_CREATE_START = /^CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]+`|'[^']+'|[^\s@]+)@(?:`[^`]+`|'[^']+'|[^\s]+)\s+)?(?:OR\s+REPLACE\s+)?(?:(?:AGGREGATE\s+)?FUNCTION|PROCEDURE|TRIGGER|EVENT)\b/i
const BLOCK_START_KEYWORDS = ['BEGIN', 'CASE', 'IF', 'LOOP', 'REPEAT', 'WHILE']
// 关键字/DELIMITER/CREATE … 判断需要向后看的字符数；流式输入时保留这么多未处理字符
const LOOKAHEAD = 400

const isWordBoundaryChar = (ch: string | undefined): boolean => !ch || !/[A-Za-z0-9_$]/.test(ch)

// IF()/REPEAT() 是带逗号参数的函数；IF (cond) THEN、REPEAT … END REPEAT 是流程控制块
const parenGroupHasTopLevelComma = (sql: string, openIndex: number): boolean => {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < sql.length; i += 1) {
    const ch = sql[i]
    if (quote) {
      if (ch === '\\' && quote !== '`') { i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return false
    } else if (ch === ',' && depth === 1) return true
    else if (ch === ';' && depth <= 1) return false
  }
  return false
}

const matchBlockKeyword = (sql: string, index: number): string | null => {
  for (const keyword of BLOCK_START_KEYWORDS) {
    if (sql.slice(index, index + keyword.length).toUpperCase() !== keyword) continue
    if (!isWordBoundaryChar(sql[index - 1]) || !isWordBoundaryChar(sql[index + keyword.length])) continue
    const rest = sql.slice(index + keyword.length, index + keyword.length + 24)
    if (keyword === 'IF' && /^\s+(?:NOT\s+)?EXISTS\b/i.test(rest)) return null
    const paren = rest.match(/^\s*\(/)
    if (paren && (keyword === 'IF' || keyword === 'REPEAT')
      && parenGroupHasTopLevelComma(sql, index + keyword.length + paren[0].length - 1)) return null
    return keyword
  }
  return null
}

const compoundEndLength = (sql: string, index: number): number => {
  if (sql.slice(index, index + 3).toUpperCase() !== 'END'
    || !isWordBoundaryChar(sql[index - 1])
    || !isWordBoundaryChar(sql[index + 3])) return 0
  const suffix = sql.slice(index + 3, index + 16).match(/^(\s+)(IF|CASE|LOOP|REPEAT|WHILE)\b/i)
  return 3 + (suffix?.[0].length || 0)
}

const onlyWhitespaceBeforeOnLine = (sql: string, index: number): boolean => {
  for (let j = index - 1; j >= 0; j -= 1) {
    const ch = sql[j]
    if (ch === '\n') return true
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false
  }
  return true
}

/** 增量切分器：可一次性传入整段脚本，也可按行/按块流式传入 */
export class SqlStatementScanner {
  private buf = ''
  private base = 0
  private i = 0
  private textStart = 0
  private delimiter = ';'
  private inCompound = false
  private depth = 0
  private hasBody = false
  private quote: string | null = null
  private inLineComment = false
  private inBlockComment = false

  get position(): number {
    return this.base + this.i
  }

  feed(chunk: string): SqlStatementSegment[] {
    this.buf += chunk
    return this.run(false)
  }

  finish(): SqlStatementSegment[] {
    const out = this.run(true)
    if (this.textStart < this.buf.length || this.hasBody) out.push(this.emit(this.buf.length, this.buf.length))
    return out
  }

  private emit(end: number, next: number): SqlStatementSegment {
    const segment = {
      text: this.buf.slice(this.textStart, end).trim(),
      start: this.base + this.textStart,
      end: this.base + end,
      next: this.base + next,
      empty: !this.hasBody,
    }
    this.textStart = next
    this.hasBody = false
    this.inCompound = false
    this.depth = 0
    return segment
  }

  private run(final: boolean): SqlStatementSegment[] {
    const out: SqlStatementSegment[] = []
    const sql = this.buf
    const length = sql.length
    const limit = final ? length : length - LOOKAHEAD
    let i = this.i

    while (i < limit) {
      const c = sql[i]
      const n = sql[i + 1]

      if (this.inLineComment) {
        if (c === '\n') this.inLineComment = false
        i += 1
        continue
      }
      if (this.inBlockComment) {
        if (c === '*' && n === '/') { this.inBlockComment = false; i += 2; continue }
        i += 1
        continue
      }
      if (this.quote) {
        if (c === '\\' && this.quote !== '`') { i += 2; continue }
        if (c === this.quote) {
          if (n === this.quote) { i += 2; continue }
          this.quote = null
        }
        i += 1
        continue
      }

      if (c === '-' && n === '-' && (i + 2 >= length || /\s/.test(sql[i + 2]))) { this.inLineComment = true; i += 2; continue }
      if (c === '#') { this.inLineComment = true; i += 1; continue }
      if (c === '/' && n === '*') {
        // /*! … */ 是 MySQL 可执行注释，属于语句内容
        if (sql[i + 2] === '!') this.hasBody = true
        this.inBlockComment = true
        i += 2
        continue
      }

      if (!this.hasBody && (c === 'D' || c === 'd') && sql.slice(i, i + 9).toUpperCase() === 'DELIMITER'
        && /[ \t]/.test(sql[i + 9] ?? '') && onlyWhitespaceBeforeOnLine(sql, i)) {
        let j = i + 9
        while (j < length && (sql[j] === ' ' || sql[j] === '\t')) j += 1
        let k = j
        while (k < length && sql[k] !== '\n' && sql[k] !== '\r') k += 1
        if (k === length && !final) break
        this.delimiter = sql.slice(j, k).trim() || ';'
        i = k
        this.textStart = k
        continue
      }

      if (c === "'" || c === '"' || c === '`') {
        this.quote = c
        this.hasBody = true
        i += 1
        continue
      }

      const isSpace = c === ' ' || c === '\t' || c === '\n' || c === '\r'

      if (!this.hasBody && !isSpace && !this.inCompound && this.delimiter === ';' && COMPOUND_CREATE_START.test(sql.slice(i, i + 320))) {
        this.inCompound = true
        this.depth = 0
      }

      if (this.inCompound) {
        const keyword = matchBlockKeyword(sql, i)
        if (keyword) {
          if (keyword === 'BEGIN' || this.depth > 0) this.depth += 1
          this.hasBody = true
          i += keyword.length
          continue
        }
        const endLength = compoundEndLength(sql, i)
        if (endLength > 0) {
          if (this.depth > 0) this.depth -= 1
          this.hasBody = true
          i += endLength
          continue
        }
      }

      const delimiter = this.delimiter
      if (c === delimiter[0] && sql.startsWith(delimiter, i) && (!this.inCompound || this.depth === 0)) {
        out.push(this.emit(i, i + delimiter.length))
        i += delimiter.length
        continue
      }

      if (!isSpace) this.hasBody = true
      i += 1
    }

    this.i = i
    // 丢弃已切分完的前缀，流式导入时只保留当前语句
    if (!final && this.textStart > 0) {
      this.buf = this.buf.slice(this.textStart)
      this.base += this.textStart
      this.i -= this.textStart
      this.textStart = 0
    }
    return out
  }
}

export const splitSqlSegments = (sql: string): SqlStatementSegment[] => {
  const scanner = new SqlStatementScanner()
  return [...scanner.feed(sql), ...scanner.finish()]
}

/** 可执行语句文本（去掉空语句和纯注释） */
export const splitSqlStatements = (sql: string): string[] =>
  splitSqlSegments(sql).filter((s) => !s.empty && s.text).map((s) => s.text)

/** 光标所在语句；光标位于分隔符之后、空行或注释上时取前一条 */
export const findStatementAt = (sql: string, offset: number): string => {
  const segments = splitSqlSegments(sql)
  if (!segments.length) return ''
  let index = segments.findIndex((seg) => offset <= seg.next)
  if (index < 0) index = segments.length - 1
  for (; index >= 0; index -= 1) {
    const seg = segments[index]
    if (!seg.empty && seg.text) return seg.text
  }
  return ''
}
