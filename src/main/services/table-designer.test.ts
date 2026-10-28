import { describe, expect, it } from 'vitest'
import { diffTables, generateAlterTableSQL } from './table-designer'
import type { ColumnDesign, TableDesign } from '../../shared/types/table-design'

const col = (name: string, overrides: Partial<ColumnDesign> = {}): ColumnDesign => ({
  name, originalName: name, type: 'INT', length: '', decimals: '', nullable: true, defaultValue: '',
  autoIncrement: false, primaryKey: false, unique: false, comment: '', unsigned: false, zerofill: false,
  onUpdateCurrentTimestamp: false, columnType: 'int', ...overrides,
})

const table = (columns: ColumnDesign[], overrides: Partial<TableDesign> = {}): TableDesign => ({
  name: 't', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '',
  columns, indexes: [], foreignKeys: [], ...overrides,
})

const alter = (before: TableDesign, after: TableDesign) => generateAlterTableSQL(before.name, diffTables(before, after), after)

describe('table designer diff', () => {
  it('renames a column with CHANGE COLUMN instead of drop + add', () => {
    const before = table([col('id'), col('old_name')])
    const after = table([col('id'), col('new_name', { originalName: 'old_name' })])
    const sql = alter(before, after)
    expect(sql).toContain('CHANGE COLUMN `old_name` `new_name`')
    expect(sql).not.toContain('DROP COLUMN')
  })

  it('keeps the exact original type of untouched columns', () => {
    const price = col('price', { type: 'DECIMAL', length: '10', decimals: '2', columnType: 'decimal(10,2)' })
    const before = table([price])
    const after = table([{ ...price, comment: '价格' }])
    expect(alter(before, after)).toContain('`price` decimal(10,2) NULL COMMENT')
  })

  it('only adds a column inserted in the middle without rewriting later columns', () => {
    const before = table([col('a'), col('b'), col('c')])
    const after = table([col('a'), col('x', { originalName: undefined }), col('b'), col('c')])
    const sql = alter(before, after)
    expect(sql).toContain('ADD COLUMN `x`')
    expect(sql).not.toContain('CHANGE COLUMN')
  })

  it('drops removed columns and indexes, and recreates changed indexes', () => {
    const before = table([col('a'), col('b')], { indexes: [{ name: 'i', type: 'INDEX', method: 'BTREE', columns: [{ name: 'a', order: 'ASC' }], comment: '' }] })
    const after = table([col('a')], { indexes: [{ name: 'i', type: 'INDEX', method: 'BTREE', columns: [{ name: 'a', order: 'DESC' }], comment: '' }] })
    const sql = alter(before, after)
    expect(sql).toContain('DROP COLUMN `b`')
    expect(sql).toContain('DROP INDEX `i`')
    expect(sql).toContain('ADD INDEX `i` (`a` DESC)')
  })

  it('clears a comment, renames the table and escapes backslashes', () => {
    const before = table([col('a')], { comment: 'old' })
    const after = table([col('a', { comment: 'x\\' })], { comment: '', name: 't2' })
    const sql = alter(before, after)
    expect(sql).toContain("COMMENT=''")
    expect(sql).toContain('RENAME TO `t2`')
    expect(sql).toContain("COMMENT 'x\\\\'")
  })

  it('adds a primary key without dropping a nonexistent one', () => {
    const before = table([col('id')])
    const after = table([col('id', { primaryKey: true })])
    const sql = alter(before, after)
    expect(sql).toContain('ADD PRIMARY KEY (`id`)')
    expect(sql).not.toContain('DROP PRIMARY KEY')
  })
})
