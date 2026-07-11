import { describe, expect, it } from 'vitest'
import { validateConnectionConfig, validateConnectionId } from './connection-config'

const validConfig = () => ({
  id: 'conn-1', name: 'Local', groupName: '', color: '#3b82f6', host: '127.0.0.1', port: 3306,
  user: 'root', password: '', databaseName: '', charset: 'utf8mb4', timezone: '+08:00', poolMin: 1,
  poolMax: 10, connectTimeout: 10000, idleTimeout: 60000, sslEnabled: false, sslCa: '', sslCert: '',
  sslKey: '', sslMode: 'DISABLED', sshEnabled: false, sshHost: '', sshPort: 22, sshUser: '',
  sshPassword: '', sshPrivateKey: '', sshPassphrase: '', sortOrder: 0,
})

describe('validateConnectionConfig', () => {
  it('accepts and returns known connection fields', () => {
    const result = validateConnectionConfig({ ...validConfig(), injected: 'ignored', createdAt: 'old' })
    expect(result).toMatchObject({ ...validConfig(), createdAt: 'old' })
    expect(result.updatedAt).toEqual(expect.any(String))
    expect(result).not.toHaveProperty('injected')
  })

  it.each([
    ['invalid port', { port: 0 }],
    ['invalid pool size', { poolMax: 101 }],
    ['invalid timezone', { timezone: 'Asia/Shanghai' }],
    ['invalid SSL mode', { sslMode: 'OPTIONAL' }],
    ['wrong boolean type', { sslEnabled: 'true' }],
  ])('rejects %s', (_label, override) => {
    expect(() => validateConnectionConfig({ ...validConfig(), ...override })).toThrow()
  })

  it('requires SSH endpoint fields when SSH is enabled', () => {
    expect(() => validateConnectionConfig({ ...validConfig(), sshEnabled: true })).toThrow('SSH 主机不能为空')
  })
})

describe('validateConnectionId', () => {
  it('rejects empty and non-string IDs', () => {
    expect(() => validateConnectionId('')).toThrow()
    expect(() => validateConnectionId(123)).toThrow()
  })
})
