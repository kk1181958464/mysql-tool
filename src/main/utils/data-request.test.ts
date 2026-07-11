import { describe, expect, it } from 'vitest'
import { validateDataRecord, validateRecordBatch, validateUpdateBatch } from './data-request'

describe('data request validation', () => {
  it('accepts records and preserves values', () => {
    expect(validateDataRecord({ id: 1, '用户 名': null }, '数据')).toEqual({ id: 1, '用户 名': null })
  })

  it.each([null, [], {}, 'text'])('rejects invalid or empty records: %j', (value) => {
    expect(() => validateDataRecord(value, '数据')).toThrow()
  })

  it('rejects invalid field names', () => {
    expect(() => validateDataRecord({ '': 1 }, '数据')).toThrow('字段名不能为空')
    expect(() => validateDataRecord({ ['x'.repeat(65)]: 1 }, '数据')).toThrow()
  })

  it('limits batch size', () => {
    expect(() => validateRecordBatch(new Array(5001).fill({ id: 1 }), '批量插入')).toThrow()
  })

  it('validates update data and WHERE records', () => {
    expect(validateUpdateBatch([{ data: { name: 'new' }, where: { id: 1 } }])).toEqual([
      { data: { name: 'new' }, where: { id: 1 } },
    ])
    expect(() => validateUpdateBatch([{ data: {}, where: { id: 1 } }])).toThrow()
    expect(() => validateUpdateBatch([{ data: { name: 'new' }, where: {} }])).toThrow()
  })
})
