import type { ConnectionConfig } from '../../shared/types/connection'
import { SAVED_SECRET_PLACEHOLDER } from '../../shared/constants'

const ALWAYS_SECRET = ['password', 'sshPassword', 'sshPassphrase'] as const
const SECRET_WHEN_INLINE = ['sshPrivateKey', 'sslKey'] as const

const isInlineKey = (value: string) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)

export function maskConnectionSecrets(config: ConnectionConfig): ConnectionConfig {
  const masked = { ...config }
  for (const field of ALWAYS_SECRET) {
    if (masked[field]) masked[field] = SAVED_SECRET_PLACEHOLDER
  }
  for (const field of SECRET_WHEN_INLINE) {
    if (masked[field] && isInlineKey(masked[field])) masked[field] = SAVED_SECRET_PLACEHOLDER
  }
  return masked
}

export function resolveConnectionSecrets<T extends ConnectionConfig>(config: T, stored: ConnectionConfig | undefined): T {
  const resolved = { ...config }
  for (const field of [...ALWAYS_SECRET, ...SECRET_WHEN_INLINE]) {
    if (resolved[field] === SAVED_SECRET_PLACEHOLDER) resolved[field] = stored?.[field] ?? ''
  }
  return resolved
}
