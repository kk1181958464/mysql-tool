import { describe, expect, it } from 'vitest'
import { validateHistoryItem, validateHistoryPage, validateOptionalFilter, validateSettingKey, validateSettingValue, validateSnippet } from './store-request'

describe('store request validation', () => {
  it('validates history pagination', () => {
    expect(validateHistoryPage(undefined, undefined)).toEqual({ limit: 100, offset: 0 })
    expect(validateHistoryPage(500, 5000)).toEqual({ limit: 500, offset: 5000 })
    expect(() => validateHistoryPage(501, 0)).toThrow()
    expect(() => validateHistoryPage(10.5, 0)).toThrow()
  })

  it('validates query history item types', () => {
    const item = { connectionId: 'c1', databaseName: 'app', sqlText: 'SELECT 1', executionTimeMs: 10, rowCount: 1, isSuccess: true, errorMessage: '', isSlow: false, createdAt: new Date().toISOString() }
    expect(validateHistoryItem(item)).toEqual(item)
    expect(() => validateHistoryItem({ ...item, isSuccess: 1 })).toThrow()
    expect(() => validateHistoryItem({ ...item, executionTimeMs: -1 })).toThrow()
  })

  it('validates snippets and removes unknown fields', () => {
    const snippet = validateSnippet({ id: 's1', name: 'Query', category: '', sqlText: 'SELECT 1', description: '', createdAt: '2026-01-01', injected: true })
    expect(snippet).not.toHaveProperty('injected')
    expect(() => validateSnippet({ ...snippet, sqlText: '' })).toThrow()
  })

  it('restricts settings to known keys and value sizes', () => {
    expect(validateSettingKey('db-remarks')).toBe('db-remarks')
    expect(validateSettingValue('rowsPerPage', '100')).toBe('100')
    expect(() => validateSettingKey('arbitrary-key')).toThrow()
    expect(() => validateSettingValue('rowsPerPage', 'x'.repeat(129))).toThrow()
  })

  it('limits optional performance filters', () => {
    expect(validateOptionalFilter(undefined)).toBeUndefined()
    expect(validateOptionalFilter('Threads')).toBe('Threads')
    expect(() => validateOptionalFilter('x'.repeat(257))).toThrow()
  })
})
