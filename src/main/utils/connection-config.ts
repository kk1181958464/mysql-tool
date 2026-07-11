import type { ConnectionConfig, ConnectionSavePayload } from '../../shared/types/connection'

const SSL_MODES = new Set<ConnectionSavePayload['sslMode']>(['DISABLED', 'REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY'])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接配置必须是对象')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, maxLength: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (required && !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maxLength) throw new Error(`${label}长度不能超过 ${maxLength} 个字符`)
  return value
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}范围为 ${min}-${max}`)
  }
  return value
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

export function validateConnectionConfig(value: unknown): ConnectionConfig {
  const input = record(value)
  const timezone = text(input.timezone, '时区', 16, true)
  if (!/^(?:local|Z|[+-]\d{2}:\d{2})$/.test(timezone)) throw new Error('时区格式应为 local、Z 或 ±HH:MM')

  const sslMode = text(input.sslMode, 'SSL 模式', 32, true) as ConnectionSavePayload['sslMode']
  if (!SSL_MODES.has(sslMode)) throw new Error(`不支持的 SSL 模式: ${sslMode}`)

  const sshEnabled = bool(input.sshEnabled, 'SSH 开关')
  const sshHost = text(input.sshHost, 'SSH 主机', 255, sshEnabled)
  const sshUser = text(input.sshUser, 'SSH 用户名', 128, sshEnabled)

  const now = new Date().toISOString()
  return {
    id: text(input.id, '连接 ID', 128, true),
    name: text(input.name, '连接名称', 128, true),
    groupName: text(input.groupName, '分组名称', 128),
    color: text(input.color, '颜色', 32),
    host: text(input.host, 'MySQL 主机', 255, true),
    port: integer(input.port, 'MySQL 端口', 1, 65535),
    user: text(input.user, 'MySQL 用户名', 128),
    password: text(input.password, 'MySQL 密码', 65536),
    databaseName: text(input.databaseName, '数据库名', 64),
    charset: text(input.charset, '字符集', 64, true),
    timezone,
    poolMin: integer(input.poolMin, '最小连接数', 0, 100),
    poolMax: integer(input.poolMax, '最大连接数', 1, 100),
    connectTimeout: integer(input.connectTimeout, '连接超时', 1000, 300000),
    idleTimeout: integer(input.idleTimeout, '空闲超时', 1000, 3600000),
    sslEnabled: bool(input.sslEnabled, 'SSL 开关'),
    sslCa: text(input.sslCa, 'CA 证书', 1024 * 1024),
    sslCert: text(input.sslCert, '客户端证书', 1024 * 1024),
    sslKey: text(input.sslKey, '客户端密钥', 1024 * 1024),
    sslMode,
    sshEnabled,
    sshHost,
    sshPort: integer(input.sshPort, 'SSH 端口', 1, 65535),
    sshUser,
    sshPassword: text(input.sshPassword, 'SSH 密码', 65536),
    sshPrivateKey: text(input.sshPrivateKey, 'SSH 私钥', 1024 * 1024),
    sshPassphrase: text(input.sshPassphrase, 'SSH 私钥密码', 65536),
    sortOrder: integer(input.sortOrder, '排序值', -1000000, 1000000),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  }
}

export function validateConnectionId(value: unknown): string {
  return text(value, '连接 ID', 128, true)
}
