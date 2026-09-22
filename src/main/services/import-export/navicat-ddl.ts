/** SQL dump headings and lossless SHOW CREATE TABLE output. */

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

export function formatNavicatDDL(ddl: string): string {
  // Preserve server-generated SQL: regex rewriting can corrupt quoted comments,
  // defaults, partition definitions and table options.
  const sql = ddl.trim()
  return sql.endsWith(';') ? sql : `${sql};`
}
