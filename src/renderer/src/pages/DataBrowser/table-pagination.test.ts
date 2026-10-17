import { describe, expect, it } from 'vitest'
import { buildKeysetPredicate, compareDirection, parseSort } from './table-pagination'

describe('sorted keyset pagination', () => {
  it('parses a single quoted sort column', () => {
    expect(parseSort('`created_at` DESC')).toEqual({ column: 'created_at', direction: 'DESC' })
    expect(parseSort('created_at DESC')).toBeNull()
  })

  it('flips the comparison when paging backward', () => {
    expect(compareDirection('ASC', 'next')).toBe('>')
    expect(compareDirection('DESC', 'next')).toBe('<')
    expect(compareDirection('DESC', 'prev')).toBe('>')
  })

  it('keeps the primary key as a tie breaker for sorted pages', () => {
    expect(buildKeysetPredicate({ column: 'name', direction: 'ASC' }, 'id', 'ada', 10, '>')).toBe(
      "((`name` > 'ada') OR (`name` = 'ada' AND `id` > 10))"
    )
    expect(buildKeysetPredicate({ column: 'na`me', direction: 'ASC' }, 'id', 'ada', 10, '>')).toContain('`na``me`')
  })

  it('pages past null sort values without dropping them', () => {
    expect(buildKeysetPredicate({ column: 'name', direction: 'ASC' }, 'id', null, 4, '>')).toBe(
      '(`name` IS NOT NULL OR (`name` IS NULL AND `id` > 4))'
    )
  })
})
