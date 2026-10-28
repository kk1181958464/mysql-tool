import { describe, expect, it } from 'vitest'
import { findCurrentStatement } from './current-statement'

const at = (sqlWithCursor: string) => {
  const offset = sqlWithCursor.indexOf('|')
  return findCurrentStatement(sqlWithCursor.replace('|', ''), offset)
}

describe('findCurrentStatement', () => {
  it('runs the statement just typed when the cursor sits after its semicolon', () => {
    expect(at('SELECT 1;| SELECT 2;')).toBe('SELECT 1')
  })

  it('never falls back to the whole script at the end of the file', () => {
    expect(at('DELETE FROM t;\nSELECT 1;\n|')).toBe('SELECT 1')
  })

  it('picks the statement containing the cursor', () => {
    expect(at('SELECT 1;\nSELECT |2;\nSELECT 3;')).toBe('SELECT 2')
  })

  it('ignores semicolons and quotes inside comments and strings', () => {
    expect(at("SELECT ';' AS a # it's a comment;\n, 2|")).toBe("SELECT ';' AS a # it's a comment;\n, 2")
    expect(at('SELECT 5--3 AS x;|')).toBe('SELECT 5--3 AS x')
  })

  it('returns empty for comment-only input', () => {
    expect(at('-- nothing here\n|')).toBe('')
  })
})
