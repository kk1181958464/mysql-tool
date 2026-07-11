import { describe, expect, it } from 'vitest'
import { validateTableDesign, validateTableDiff } from './table-design-request'

const column = (name = 'id') => ({ name, type: 'INT', length: '11', decimals: '', nullable: false, defaultValue: '', autoIncrement: true, primaryKey: true, unique: false, comment: '', unsigned: true, zerofill: false, onUpdateCurrentTimestamp: false })
const design = () => ({ name: 'users', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '', columns: [column()], indexes: [], foreignKeys: [] })

describe('table design validation', () => {
  it('accepts a valid table design', () => {
    expect(validateTableDesign(design())).toEqual(design())
  })

  it.each([
    { engine: 'EVIL ENGINE' },
    { columns: [{ ...column(), type: 'INT); DROP TABLE users; --' }] },
    { columns: [{ ...column(), defaultValue: '0; DROP TABLE users' }] },
    { charset: 'utf8mb4; DROP' },
    { columns: [column('id'), column('id')] },
  ])('rejects unsafe or invalid designs: %j', (override) => {
    expect(() => validateTableDesign({ ...design(), ...override })).toThrow()
  })

  it('rejects indexes that reference missing columns', () => {
    expect(() => validateTableDesign({ ...design(), indexes: [{ name: 'idx', type: 'INDEX', method: 'BTREE', columns: [{ name: 'missing', order: 'ASC' }], comment: '' }] })).toThrow()
  })

  it('rejects mismatched foreign key columns', () => {
    expect(() => validateTableDesign({ ...design(), foreignKeys: [{ name: 'fk', columns: ['id'], referencedTable: 'roles', referencedColumns: [], onUpdate: 'CASCADE', onDelete: 'RESTRICT' }] })).toThrow()
  })

  it('takes changed table options from the validated design', () => {
    const valid = validateTableDesign(design())
    const diff = validateTableDiff({ addColumns: [], modifyColumns: [], dropColumns: [], addIndexes: [], dropIndexes: [], addForeignKeys: [], dropForeignKeys: [], changeOptions: { engine: 'injected' } }, valid)
    expect(diff.changeOptions.engine).toBe('InnoDB')
  })
})
