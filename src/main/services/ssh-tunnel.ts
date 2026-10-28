import { Client, type ConnectConfig, utils as sshUtils } from 'ssh2'
import * as net from 'net'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import type { ConnectionConfig } from '../../shared/types/connection'
import * as logger from '../utils/logger'

export async function createTunnel(config: ConnectionConfig): Promise<{ localPort: number; close: () => void }> {
  const sshClient = new Client()
  let localPort = 0

  const debugLines: string[] = []
  const pushDebug = (msg: string) => {
    const line = String(msg || '').trimEnd()
    if (!line) return
    debugLines.push(line)
    // 避免无限增长：只保留最后 N 行调试信息
    if (debugLines.length > 200) debugLines.shift()

    // 仅开发模式输出 ssh2 debug，生产环境不刷屏
    if (process.env.VITE_DEV_SERVER_URL) {
      logger.debug(`[ssh2] ${line}`)
    }
  }

  const sshHost = String(config.sshHost || '').trim()
  const sshUser = String(config.sshUser || '').trim()
  const sshPort = config.sshPort || 22

  if (!sshHost) {
    throw new Error('SSH 主机不能为空')
  }
  if (!sshUser) {
    throw new Error('SSH 用户名不能为空')
  }

  const authConfig: ConnectConfig & { debug?: (msg: string) => void } = {
    host: sshHost,
    port: sshPort,
    username: sshUser,
    debug: pushDebug,
  }

  logger.info(`[ssh-tunnel] SSH target: ${sshUser}@${sshHost}:${sshPort}`)

  if (config.sshPrivateKey) {
    // 常见误用：选中了 *.pub 公钥文件 / 粘贴了公钥内容
    if (config.sshPrivateKey.toLowerCase().endsWith('.pub')) {
      throw new Error('SSH 私钥文件选择错误：你选中了 .pub 公钥文件，请选择私钥（通常无扩展名，如 id_ed25519 / id_rsa）')
    }
    if (config.sshPrivateKey.toLowerCase().endsWith('.ppk')) {
      throw new Error('SSH 私钥格式不支持：检测到 .ppk（PuTTY）格式，请转换为 OpenSSH 私钥（BEGIN OPENSSH PRIVATE KEY / BEGIN RSA PRIVATE KEY）后再试')
    }

    try {
      // 支持：私钥内容 / 私钥文件路径
      const keyContent = config.sshPrivateKey.includes('BEGIN')
        ? config.sshPrivateKey
        : await readFile(config.sshPrivateKey, 'utf-8')

      const trimmed = keyContent.trimStart()
      if (trimmed.startsWith('ssh-') || trimmed.startsWith('ecdsa-')) {
        throw new Error('SSH 私钥内容疑似为公钥（以 ssh- 开头）。请选取私钥文件（通常无扩展名），而不是 *.pub 公钥')
      }

      // 打印 key 指纹（SHA256），用于对照 XShell/ssh-keygen 输出，避免“拿错钥”
      try {
        const parsed = sshUtils.parseKey(keyContent, config.sshPassphrase)
        const keys = Array.isArray(parsed) ? parsed : [parsed]
        const fps: string[] = []
        for (const k of keys) {
          if ((k as any)?.type && (k as any)?.getPublicSSH) {
            const pub = Buffer.from((k as any).getPublicSSH())
            const fp = createHash('sha256').update(pub).digest('base64')
            fps.push(`${(k as any).type} SHA256:${fp}`)
          }
        }
        if (fps.length) {
          logger.info(`[ssh-tunnel] Using private key fingerprints: ${fps.join(', ')}`)
        }
      } catch (e) {
        logger.warn('[ssh-tunnel] Failed to parse private key for fingerprint', e)
      }

      authConfig.privateKey = keyContent
    } catch (e) {
      logger.warn('[ssh-tunnel] Failed to read/parse private key', e)
      throw e
    }

    if (config.sshPassphrase) authConfig.passphrase = config.sshPassphrase
  } else {
    authConfig.password = config.sshPassword
  }

  ;(sshClient as any).on('close', (hadError: boolean) => {
    logger.warn(`[ssh-tunnel] SSH connection closed (hadError=${hadError})`)
  })

  const server = net.createServer((sock) => {
    sock.on('error', (err) => logger.warn(`[ssh-tunnel] local socket error: ${err.message}`))
    sshClient.forwardOut('127.0.0.1', localPort, config.host, config.port, (err, stream) => {
      if (err) { sock.destroy(); return }
      stream.on('error', (streamErr: Error) => {
        logger.warn(`[ssh-tunnel] forward stream error: ${streamErr.message}`)
        sock.destroy()
      })
      sock.on('close', () => stream.destroy())
      stream.on('close', () => sock.destroy())
      sock.pipe(stream).pipe(sock)
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      sshClient.on('ready', () => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          localPort = (server.address() as net.AddressInfo).port
          server.off('error', reject)
          server.on('error', (err) => logger.warn(`[ssh-tunnel] local server error: ${err.message}`))
          resolve()
        })
      })
      sshClient.on('error', (err: any) => {
        // 连接失败时，把 ssh2 debug 片段写入日志，方便定位 auth/算法协商问题
        const debugTail = debugLines.slice(-20)
        logger.error('[ssh-tunnel] SSH error', { message: err?.message, debugTail })

        if (String(err?.message || '') === 'All configured authentication methods failed') {
          const wrapped = new Error(`SSH 认证失败：${config.sshPrivateKey ? '私钥' : '密码'}或用户名不正确 (${err.message})`)
          ;(wrapped as Error & { cause?: unknown }).cause = err
          reject(wrapped)
          return
        }

        reject(err)
      })
      sshClient.connect(authConfig)
    })
  } catch (e) {
    try { server.close() } catch {}
    try { sshClient.end() } catch {}
    throw e
  }

  return {
    localPort,
    close: () => {
      server.close()
      sshClient.end()
    },
  }
}
