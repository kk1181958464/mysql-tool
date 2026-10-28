import { describe, expect, it } from 'vitest'
import { columnDefaultToSql, parseColumnType } from './column-type'

describe('parseColumnType', () => {
  it.each([
    ['decimal(10,2) unsigned', { type: 'DECIMAL', length: '10', decimals: '2', unsigned: true, zerofill: false }],
    ['int', { type: 'INT', length: '', decimals: '', unsigned: false, zerofill: false }],
    ['int(11) unsigned zerofill', { type: 'INT', length: '11', decimals: '', unsigned: true, zerofill: true }],
    ["enum('a','b,c')", { type: 'ENUM', length: "'a','b,c'", decimals: '', unsigned: false, zerofill: false }],
    ['datetime(6)', { type: 'DATETIME', length: '6', decimals: '', unsigned: false, zerofill: false }],
  ])('parses %s', (input, expected) => {
    expect(parseColumnType(input)).toEqual(expected)
  })
})

describe('columnDefaultToSql', () => {
  it('quotes string defaults and keeps expressions', () => {
    expect(columnDefaultToSql("it's", 'varchar', '')).toBe("'it\\'s'")
    expect(columnDefaultToSql('CURRENT_TIMESTAMP', 'datetime', 'DEFAULT_GENERATED')).toBe('CURRENT_TIMESTAMP')
    expect(columnDefaultToSql('0', 'int', '')).toBe('0')
    expect(columnDefaultToSql('12', 'varchar', '')).toBe("'12'")
    expect(columnDefaultToSql(null, 'int', '')).toBe('')
  })
})
