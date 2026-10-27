import { describe, expect, it } from 'vitest'
import { describeError, getErrorMessage } from './error-info'

describe('describeError', () => {
  it.each([
    ['SSH 认证失败：密码或用户名不正确 (All configured authentication methods failed)', 'SSH 认证失败'],
    ["Access denied for user 'root'@'1.2.3.4' (using password: YES) [ER_ACCESS_DENIED_ERROR 1045]", '用户名或密码错误'],
    ['connect ECONNREFUSED 127.0.0.1:3306', '连接被拒绝'],
    ['connect ETIMEDOUT', '连接超时'],
    ['getaddrinfo ENOTFOUND db.example', '找不到主机'],
    ["Unknown database 'shop'", '数据库不存在'],
    ["You have an error in your SQL syntax near 'FORM t' [ER_PARSE_ERROR 1064]", 'SQL 语法错误'],
    ["Duplicate entry '1' for key 'PRIMARY' [ER_DUP_ENTRY 1062]", '数据重复'],
    ["Table 'shop.x' doesn't exist [ER_NO_SUCH_TABLE 1146]", '表不存在'],
    ['连接已断开，请重新连接后再试', '连接已断开'],
  ])('maps %s', (message, title) => {
    const info = describeError(message)
    expect(info.title).toBe(title)
    expect(info.detail).toBe(message)
  })

  it('extracts mysql code and errno', () => {
    const info = describeError('bad [ER_PARSE_ERROR 1064]')
    expect(info.code).toBe('ER_PARSE_ERROR')
    expect(info.errno).toBe(1064)
  })

  it('points at the syntax error location', () => {
    const info = describeError("You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'FORM orders' at line 1 [ER_PARSE_ERROR 1064]")
    expect(info.hint).toBe('第 1 行附近有误：FORM orders')
    expect(describeError("error in your SQL syntax; ... near '' at line 3 [ER_PARSE_ERROR 1064]").hint).toContain('第 3 行语句不完整')
  })

  it('matches by errno even when the message is unfamiliar', () => {
    expect(describeError('something odd [ER_SOME_NEW_NAME 1062]').title).toBe('数据重复')
  })

  it('falls back to a truncated first line for unknown errors', () => {
    const info = describeError(`weird failure ${'x'.repeat(200)}\nsecond line`, '连接失败')
    expect(info.title).toBe('连接失败')
    expect(info.hint.length).toBeLessThanOrEqual(161)
    expect(info.hint).not.toContain('second line')
  })
})

describe('getErrorMessage', () => {
  it('never returns [object Object]', () => {
    expect(getErrorMessage({ foo: 1 })).toBe('操作失败')
    expect(getErrorMessage(new Error("Error invoking remote method 'a': Error: x"))).toBe('x')
  })
})
