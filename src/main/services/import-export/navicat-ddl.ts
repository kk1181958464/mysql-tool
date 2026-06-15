/**
 * Navicat DDL 规则重写引擎
 *
 * 基于 SHOW CREATE TABLE 输出做轻量规则重写，覆盖 Navicat 样例差异。
 * 目标：尽量逐字符对齐 Navicat dump 格式。
 */
import { quoteId } from '../../utils/sql'

/** 正则转义 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 判断是否为数值列类型 */
export function isNumericColumnType(type: string): boolean {
  const t = type.toLowerCase()
  return t.startsWith('int')
    || t.startsWith('tinyint')
    || t.startsWith('smallint')
    || t.startsWith('mediumint')
    || t.startsWith('bigint')
    || t.startsWith('float')
    || t.startsWith('double')
    || t.startsWith('decimal')
    || t.startsWith('numeric')
    || t.startsWith('bit')
}

export function formatTableStructureTitle(name: string): string {
  return `-- Table structure for ${name}`
}

export function formatRecordsTitle(name: string): string {
  return `-- Records of ${name}`
}

export function formatObjectTitle(type: string, name: string): string {
  return `-- ${type} structure for ${name}`
}

/**
 * 将 SHOW CREATE TABLE 的原始 DDL 转换为 Navicat 兼容格式。
 * 逐行完成：CREATE TABLE 行格式、列定义补全、索引关键字、表选项重排等。
 */
export function formatNavicatDDL(
  table: string,
  ddl: string,
  defaultCharset?: string,
  defaultCollate?: string,
  autoIncrement?: number | null,
): string {
  let s = ddl.trim()

  // --- 先从 DDL 尾行提取表默认 charset/collate（供列展开用） ---
  const tailMatch = s.match(/\)\s*(.+?)$/s)
  const tailStr = tailMatch ? tailMatch[1] : ''
  const tblCharset = defaultCharset || (() => {
    const m = tailStr.match(/DEFAULT\s+CHARSET=(\w+)/i) || tailStr.match(/CHARACTER\s+SET\s*=?\s*(\w+)/i)
    return m ? m[1] : 'utf8mb4'
  })()
  const tblCollate = defaultCollate || (() => {
    const m = tailStr.match(/COLLATE\s*=?\s*(\w+)/i)
    return m ? m[1] : `${tblCharset}_general_ci`
  })()

  // 字符串类型正则
  const charTypeRe = /^(varchar|char|tinytext|text|mediumtext|longtext|enum|set)\b/i

  const escapeNavicatComment = (text: string): string => {
    let t = String(text)
    t = t.replace(/([^\\])"/g, '$1\\"')
    t = t.replace(/^"/g, '\\"')
    return t
  }

  // 1) CREATE TABLE 行：双空格 + "  ("
  s = s.replace(new RegExp(`^CREATE\\s+TABLE\\s+${escapeRegExp(quoteId(table))}\\s*\\(`, 'm'), `CREATE TABLE ${quoteId(table)}  (`)

  // 2) 行内规则：decimal(10,2) -> decimal(10, 2)
  s = s.replace(/decimal\((\d+),(\d+)\)/gi, 'decimal($1, $2)')

  // 3) unsigned -> UNSIGNED
  s = s.replace(/\bunsigned\b/g, 'UNSIGNED')

  // 4) KEY -> INDEX（含 FULLTEXT/UNIQUE）
  s = s.replace(/^(\s{2})FULLTEXT KEY\b/gm, '$1FULLTEXT INDEX')
  s = s.replace(/^(\s{2})UNIQUE KEY\b/gm, '$1UNIQUE INDEX')
  s = s.replace(/^(\s{2})KEY\b/gm, '$1INDEX')

  // 5) WITH PARSER：展开条件注释
  s = s.replace(/\/\*!\d+\s+WITH PARSER\s+(`[^`]+`)\s*\*\//g, 'WITH PARSER $1')

  // 6) INDEX 行：去索引名和括号间多余空格
  s = s.replace(/^(\s{2}(?:INDEX|UNIQUE INDEX|FULLTEXT INDEX)\s+`[^`]+`)\s+\(/gm, '$1(')

  // 7) 逐行规则
  const lines = s.split(/\r?\n/)
  const outLines: string[] = []
  for (const line of lines) {
    let l = line

    const isColumnLine = /^\s{2}`[^`]+`\s+\w+/.test(l) && !/^\s{2}(PRIMARY|INDEX|UNIQUE|FULLTEXT|CONSTRAINT|KEY)\b/i.test(l)

    if (isColumnLine) {
      const colTypeMatch = l.match(/^\s+`[^`]+`\s+(\w+(?:\([^)]*\))?)/i)
      const colType = colTypeMatch ? colTypeMatch[1] : ''
      const baseType = colType.replace(/\(.*\)/, '').toLowerCase()

      l = l.replace(/\bCOMMENT\s+'([^']*)'/i, (_m, text: string) => `COMMENT '${escapeNavicatComment(text)}'`)

      if (isNumericColumnType(baseType)) {
        l = l.replace(/\bDEFAULT\s+'(-?\d+(?:\.\d+)?)'/gi, 'DEFAULT $1')
      }

      if (baseType === 'json') {
        l = l.replace(/\s+DEFAULT\s+NULL\b/gi, '')
      }

      if (charTypeRe.test(baseType)) {
        if (!/\bCHARACTER\s+SET\b/i.test(l)) {
          const existingCollateMatch = l.match(/\bCOLLATE\s+(\w+)/i)
          if (existingCollateMatch) {
            const col = existingCollateMatch[1]
            const cs = String(col).split('_')[0]
            l = l.replace(/\bCOLLATE\s+(\w+)/i, `CHARACTER SET ${cs} COLLATE $1`)
          } else {
            const insertPos = l.search(/\s+(NOT\s+NULL|NULL|DEFAULT|COMMENT|AUTO_INCREMENT)/i)
            const trailingComma = l.trimEnd().endsWith(',')
            if (insertPos > 0) {
              l = l.substring(0, insertPos) + ` CHARACTER SET ${tblCharset} COLLATE ${tblCollate}` + l.substring(insertPos)
            } else if (trailingComma) {
              l = l.trimEnd().slice(0, -1) + ` CHARACTER SET ${tblCharset} COLLATE ${tblCollate},`
            }
          }
        }
      }

      if (!/\bNOT\s+NULL\b/i.test(l) && !/\bAUTO_INCREMENT\b/i.test(l)) {
        const withoutDefault = l.replace(/DEFAULT\s+NULL/gi, 'DEFAULT_PLACEHOLDER')
        if (!/\bNULL\b/i.test(withoutDefault)) {
          if (/\bDEFAULT\b/i.test(l)) {
            l = l.replace(/(\s)(DEFAULT\b)/i, '$1NULL $2')
          } else if (/\bCOMMENT\b/i.test(l)) {
            l = l.replace(/(\s)(COMMENT\b)/i, '$1NULL $2')
          } else {
            const trimmed = l.trimEnd()
            if (trimmed.endsWith(',')) {
              l = trimmed.slice(0, -1) + ' NULL,'
            } else {
              l = trimmed + ' NULL'
            }
          }
        }
      }
    }

    const isPrimaryKeyLine = /^\s{2}PRIMARY KEY\b/i.test(l)
    const isNormalIndexLine = /^\s{2}(?:INDEX|UNIQUE INDEX)\b/i.test(l)
    const isFullTextIndexLine = /^\s{2}FULLTEXT INDEX\b/i.test(l)
    if ((isPrimaryKeyLine || isNormalIndexLine) && !isFullTextIndexLine && !/\bUSING\s+\w+\b/i.test(l)) {
      const trimmed = l.trimEnd()
      const hasComma = trimmed.endsWith(',')
      const base = hasComma ? trimmed.slice(0, -1) : trimmed
      l = base + ' USING BTREE' + (hasComma ? ',' : '')
    }

    outLines.push(l)
  }
  s = outLines.join('\n')

  // 清理行尾空白
  s = s.replace(/[ \t]+$/gm, '')

  // 8) 尾行 table options：解析所有键值对，按 Navicat 顺序输出
  const optionsTailMatch = s.match(/\)\s*([^)]+)$/s)
  if (optionsTailMatch) {
    const rawTail = optionsTailMatch[1].replace(/;\s*$/, '').trim()
    const opts: Record<string, string> = {}

    const engineM = rawTail.match(/ENGINE\s*=\s*(\w+)/i)
    if (engineM) opts['ENGINE'] = engineM[1]

    const autoIncM = rawTail.match(/AUTO_INCREMENT\s*=\s*(\d+)/i)
    if (autoIncM) opts['AUTO_INCREMENT'] = autoIncM[1]

    const charsetM = rawTail.match(/(?:DEFAULT\s+)?CHARSET\s*=\s*(\w+)/i) || rawTail.match(/CHARACTER\s+SET\s*=\s*(\w+)/i)
    if (charsetM) opts['CHARACTER SET'] = charsetM[1]

    if (!opts['CHARACTER SET']) {
      const charset2M = rawTail.match(/DEFAULT\s+CHARSET\s*=\s*(\w+)/i) || rawTail.match(/DEFAULT\s+CHARSET\s+(\w+)/i) || rawTail.match(/CHARSET\s*=\s*(\w+)/i)
      if (charset2M) opts['CHARACTER SET'] = charset2M[1]
    }

    const collateM = rawTail.match(/COLLATE\s*=\s*(\w+)/i)
    if (collateM) opts['COLLATE'] = collateM[1]

    if (!opts['AUTO_INCREMENT'] && autoIncrement !== null && autoIncrement !== undefined && Number.isFinite(autoIncrement)) {
      opts['AUTO_INCREMENT'] = String(autoIncrement)
    }
    if (!opts['COLLATE'] && opts['CHARACTER SET']) {
      opts['COLLATE'] = `${opts['CHARACTER SET']}_general_ci`
    }

    const commentM = rawTail.match(/COMMENT\s*=\s*'([^']*)'/i)
    if (commentM) opts['COMMENT'] = escapeNavicatComment(commentM[1])

    const rowFmtM = rawTail.match(/ROW_FORMAT\s*=\s*(\w+)/i)
    if (rowFmtM) opts['ROW_FORMAT'] = rowFmtM[1]

    const newParts: string[] = [')']
    if (opts['ENGINE']) newParts.push(`ENGINE = ${opts['ENGINE']}`)
    if (opts['AUTO_INCREMENT']) newParts.push(`AUTO_INCREMENT = ${opts['AUTO_INCREMENT']}`)
    if (opts['CHARACTER SET']) newParts.push(`CHARACTER SET = ${opts['CHARACTER SET']}`)
    if (opts['COLLATE']) newParts.push(`COLLATE = ${opts['COLLATE']}`)
    if (opts['COMMENT'] !== undefined) newParts.push(`COMMENT = '${opts['COMMENT']}'`)
    if (opts['ROW_FORMAT']) newParts.push(`ROW_FORMAT = ${opts['ROW_FORMAT']}`)

    const newTail = newParts.join(' ') + ';'
    s = s.replace(/\)\s*[^)]+$/s, newTail)
  }

  return s
}
