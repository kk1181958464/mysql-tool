import { describe, expect, it } from 'vitest'
import { applyResultRowLimit, DEFAULT_RESULT_ROW_LIMIT } from './sql-result-limit'

describe('applyResultRowLimit', () => {
  it('adds the default limit to a SELECT and preserves leading comments', () => {
    expect(applyResultRowLimit('  /* report */ SELECT * FROM users;', { enabled: true })).toEqual({
      sql: '/* report */ SELECT * FROM users LIMIT 5000',
      limited: true,
      limit: DEFAULT_RESULT_ROW_LIMIT,
    })
  })

  it('limits a CTE whose top-level statement is SELECT', () => {
    const result = applyResultRowLimit('WITH recent AS (SELECT * FROM logs LIMIT 10) SELECT * FROM recent', { enabled: true, maxRows: 250 })
    expect(result.sql).toBe('WITH recent AS (SELECT * FROM logs LIMIT 10) SELECT * FROM recent LIMIT 250')
    expect(result.limited).toBe(true)
  })

  it.each([
    'SELECT * FROM users LIMIT 20',
    'SELECT * FROM users FOR UPDATE',
    'SELECT * FROM users LOCK IN SHARE MODE',
    'SELECT * INTO OUTFILE \'data.csv\' FROM users',
    'SELECT 1; SELECT 2',
    'UPDATE users SET active = 1',
  ])('does not change an ineligible statement: %s', (sql) => {
    expect(applyResultRowLimit(sql, { enabled: true }).sql).toBe(sql)
  })

  it('does not treat keywords inside strings or comments as top-level clauses', () => {
    const sql = "SELECT 'LIMIT 1' AS text /* FOR UPDATE; */ FROM messages"
    expect(applyResultRowLimit(sql, { enabled: true, maxRows: 10 })).toMatchObject({
      sql: `${sql} LIMIT 10`,
      limited: true,
    })
  })

  it.each([
    [0, 1],
    [-5, 1],
    [12.8, 12],
    [999999, 100000],
    [Number.NaN, DEFAULT_RESULT_ROW_LIMIT],
  ])('normalizes maxRows %s to %s', (maxRows, expected) => {
    expect(applyResultRowLimit('SELECT 1', { enabled: true, maxRows }).limit).toBe(expected)
  })

  it('leaves SQL unchanged when limiting is disabled', () => {
    expect(applyResultRowLimit('SELECT * FROM users')).toEqual({
      sql: 'SELECT * FROM users',
      limited: false,
      limit: DEFAULT_RESULT_ROW_LIMIT,
    })
  })
})
