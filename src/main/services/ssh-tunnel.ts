import { Client, type ConnectConfig } from 'ssh2'
import * as net from 'net'
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

  const authConfig: ConnectConfig = {
    host: config.sshHost,
    port: config.sshPort || 22,
    username: config.sshUser,
  }
  if (config.sshPrivateKey) {
    authConfig.privateKey = config.sshPrivateKey
    if (config.sshPassphrase) authConfig.passphrase = config.sshPassphrase
  } else {
    authConfig.password = config.sshPassword
  }

  const server = net.createServer((sock) => {
    sshClient.forwardOut('127.0.0.1', localPort, config.host, config.port, (err, stream) => {
      if (err) { sock.destroy(); return }
      sock.pipe(stream).pipe(sock)
    })
  })

  await new Promise<void>((resolve, reject) => {
    sshClient.on('ready', () => {
      server.listen(localPort, '127.0.0.1', () => {
        resolve()
      })
    })
    sshClient.on('error', reject)
    sshClient.connect(authConfig)
  })

  return {
    localPort,
    close: () => {
      server.close()
      sshClient.end()
    },
  }
}
