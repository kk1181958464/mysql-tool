import { describe, expect, it } from 'vitest'
import { quoteId } from './sql'

describe('quoteId', () => {
  it('wraps MySQL identifiers in backticks', () => {
    expect(quoteId('users')).toBe('`users`')
    expect(quoteId('用户 表')).toBe('`用户 表`')
  })

  it('escapes embedded backticks', () => {
    expect(quoteId('users` WHERE 1=1 --')).toBe('`users`` WHERE 1=1 --`')
    expect(quoteId('a``b')).toBe('`a````b`')
  })
})
