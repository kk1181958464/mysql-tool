import { describe, expect, it } from 'vitest'
import { validateDatabase, validateIdentifier, validateMultiOptions, validateQueryOptions, validateSql } from './query-request'

describe('query request validation', () => {
  it('allows an empty database and non-empty SQL', () => {
    expect(validateDatabase(undefined)).toBe('')
    expect(validateSql('SELECT 1')).toBe('SELECT 1')
  })

  it('accepts valid MySQL identifiers and rejects empty or oversized ones', () => {
    expect(validateIdentifier('用户 表', '表名')).toBe('用户 表')
    expect(() => validateIdentifier('', '表名')).toThrow('表名不能为空')
    expect(() => validateIdentifier('x'.repeat(65), '表名')).toThrow()
  })

  it('rejects empty and oversized SQL', () => {
    expect(() => validateSql('   ')).toThrow('SQL不能为空')
    expect(() => validateSql('x'.repeat(2 * 1024 * 1024 + 1))).toThrow()
  })

  it('removes unknown query options', () => {
    expect(validateQueryOptions({ executionId: 'run-1', injected: true })).toEqual({ executionId: 'run-1' })
  })

  it('normalizes known multi-query options', () => {
    expect(validateMultiOptions({ stopOnError: true, maxResultRows: 5000, scriptMode: 'query', extra: 'ignored' })).toMatchObject({
      stopOnError: true,
      maxResultRows: 5000,
      scriptMode: 'query',
    })
  })

  it.each([
    { stopOnError: 1 },
    { maxResultRows: 0 },
    { maxResultRows: 100001 },
    { scriptMode: 'admin' },
    { executionId: '' },
  ])('rejects invalid multi-query options: %j', (options) => {
    expect(() => validateMultiOptions(options)).toThrow()
  })
})
