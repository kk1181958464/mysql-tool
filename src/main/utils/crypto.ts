import { safeStorage } from 'electron'

const FALLBACK_PREFIX = 'b64:'

export function encryptPassword(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  return FALLBACK_PREFIX + Buffer.from(plain, 'utf-8').toString('base64')
}

export function decryptPassword(encrypted: string): string {
  if (!encrypted) return ''
  if (encrypted.startsWith(FALLBACK_PREFIX)) {
    return Buffer.from(encrypted.slice(FALLBACK_PREFIX.length), 'base64').toString('utf-8')
  }
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  // 兼容旧版明文存储
  return encrypted
}
