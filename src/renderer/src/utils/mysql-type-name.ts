const TYPE_NAMES: Record<number, string> = {
  0: 'decimal', 1: 'tinyint', 2: 'smallint', 3: 'int', 4: 'float', 5: 'double', 6: 'null', 7: 'timestamp',
  8: 'bigint', 9: 'mediumint', 10: 'date', 11: 'time', 12: 'datetime', 13: 'year', 14: 'date', 15: 'varchar',
  16: 'bit', 17: 'timestamp', 18: 'datetime', 19: 'time', 245: 'json', 246: 'decimal', 247: 'enum', 248: 'set',
  249: 'tinyblob', 250: 'mediumblob', 251: 'longblob', 252: 'blob', 253: 'varchar', 254: 'char', 255: 'geometry',
}

export function mysqlTypeName(type: string | number | undefined): string {
  if (type === undefined || type === '') return ''
  const code = Number(type)
  if (Number.isInteger(code) && String(code) === String(type).trim()) return TYPE_NAMES[code] ?? ''
  return String(type).toLowerCase()
}
