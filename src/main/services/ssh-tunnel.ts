import { Client, type ConnectConfig, utils as sshUtils } from 'ssh2'
import * as net from 'net'
import { readFile } from 'fs/promises'
import { createHash } from 'crypto'
import type { ConnectionConfig } from '../../shared/types/connection'
import * as logger from '../utils/logger'

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

export async function createTunnel(config: ConnectionConfig): Promise<{ localPort: number; close: () => void }> {
  const localPort = await findFreePort()
  const sshClient = new Client()

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

  sshClient.on('close', (hadError) => {
    logger.warn(`[ssh-tunnel] SSH connection closed (hadError=${hadError})`)
  })

  const server = net.createServer((sock) => {
    sshClient.forwardOut('127.0.0.1', localPort, config.host, config.port, (err, stream) => {
      if (err) { sock.destroy(); return }
      sock.pipe(stream).pipe(sock)
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      sshClient.on('ready', () => {
        server.listen(localPort, '127.0.0.1', () => {
          resolve()
        })
      })
      sshClient.on('error', (err: any) => {
        // 连接失败时，把 ssh2 debug 片段写入日志，方便定位 auth/算法协商问题
        const debugTail = debugLines.slice(-20)
        logger.error('[ssh-tunnel] SSH error', { message: err?.message, debugTail })

        if (String(err?.message || '') === 'All configured authentication methods failed') {
          const hint = config.sshPrivateKey
            ? '（请确认：1) 选择的是私钥而非公钥；2) 私钥对应的公钥已写入服务器 ~/.ssh/authorized_keys；3) 服务器允许该用户使用 publickey 登录）'
            : ''

          const debugText = debugTail.length
            ? `\n\nssh2 调试尾段（最后 ${debugTail.length} 行）:\n${debugTail.join('\n')}`
            : '\n\nssh2 调试尾段：无（可能未触发 debug 回调）'

          const wrapped = new Error(`SSH 认证失败: ${err.message}${hint}${debugText}`)
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
