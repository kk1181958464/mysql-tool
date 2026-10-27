import { describe, expect, it } from 'vitest'
import { formatErrorMessage, parseErrorCode, stripIpcErrorPrefix } from './error-message'

describe('stripIpcErrorPrefix', () => {
  it('removes the Electron invoke prefix and error names', () => {
    expect(stripIpcErrorPrefix("Error invoking remote method 'query:execute': Error: bad sql")).toBe('bad sql')
    expect(stripIpcErrorPrefix("Error invoking remote method 'x': TypeError: boom")).toBe('boom')
    expect(stripIpcErrorPrefix('plain')).toBe('plain')
  })
})

describe('formatErrorMessage', () => {
  it('appends mysql code and errno', () => {
    const err = Object.assign(new Error("Duplicate entry '1' for key 'PRIMARY'"), { code: 'ER_DUP_ENTRY', errno: 1062 })
    expect(formatErrorMessage(err)).toBe("Duplicate entry '1' for key 'PRIMARY' [ER_DUP_ENTRY 1062]")
  })

  it('does not append codes twice or for non-mysql codes', () => {
    expect(formatErrorMessage(new Error('x [ER_PARSE_ERROR 1064]'))).toBe('x [ER_PARSE_ERROR 1064]')
    expect(formatErrorMessage(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', errno: -4078 }))).toBe('connect ECONNREFUSED')
  })

  it('handles non-error values', () => {
    expect(formatErrorMessage(undefined)).toBe('操作失败')
    expect(formatErrorMessage({})).toBe('操作失败')
    expect(formatErrorMessage('Error: oops')).toBe('oops')
  })

  it('round-trips through parseErrorCode', () => {
    expect(parseErrorCode('bad [ER_PARSE_ERROR 1064]')).toEqual({ message: 'bad', code: 'ER_PARSE_ERROR', errno: 1064 })
    expect(parseErrorCode('plain')).toEqual({ message: 'plain' })
  })
})
