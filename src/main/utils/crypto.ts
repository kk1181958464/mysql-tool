import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { homedir, hostname } from 'node:os'

/**
 * 降级加密前缀标识：
 * - 'b64:'  — 旧版 Base64（仅解密兼容，不再用于新加密）
 * - 'aes:'  — AES-256-GCM 降级加密
 */
const LEGACY_PREFIX = 'b64:'
const AES_PREFIX = 'aes:'

/**
 * 从机器特征派生一个固定的 256-bit 密钥。
 * 不是完美方案（本地攻击者可重建），但远优于裸 Base64。
 */
function deriveFallbackKey(): Buffer {
  const material = `mysql-tool::${hostname()}::${homedir()}::fallback-key`
  return createHash('sha256').update(material).digest()
}

function aesEncrypt(plain: string): string {
  const key = deriveFallbackKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // 格式: iv(12) + tag(16) + ciphertext
  return AES_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function aesDecrypt(data: string): string {
  const key = deriveFallbackKey()
  const buf = Buffer.from(data.slice(AES_PREFIX.length), 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const encrypted = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function encryptPassword(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  // 降级：AES-256-GCM（取代旧版裸 Base64）
  console.warn('[crypto] safeStorage 不可用，使用 AES-256-GCM 降级加密')
  return aesEncrypt(plain)
}

export function decryptPassword(encrypted: string): string {
  if (!encrypted) return ''
  // 新版 AES-256-GCM 降级加密
  if (encrypted.startsWith(AES_PREFIX)) {
    return aesDecrypt(encrypted)
  }
  // 旧版 Base64 降级（向后兼容，仅解密）
  if (encrypted.startsWith(LEGACY_PREFIX)) {
    return Buffer.from(encrypted.slice(LEGACY_PREFIX.length), 'base64').toString('utf-8')
  }
  // safeStorage 加密的数据
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }
  // 兼容旧版明文存储
  return encrypted
}
