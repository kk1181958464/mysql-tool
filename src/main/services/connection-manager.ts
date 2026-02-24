import mysql from 'mysql2/promise'
import type { ConnectionConfig, ConnectionStatus } from '../../shared/types/connection'
import { createTunnel } from './ssh-tunnel'
import * as logger from '../utils/logger'

const pools = new Map<string, mysql.Pool>()
const tunnels = new Map<string, { close: () => void }>()

function buildPoolOptions(config: ConnectionConfig, overrideHost?: string, overridePort?: number): mysql.PoolOptions {
  const opts: mysql.PoolOptions = {
    host: overrideHost || config.host,
    port: overridePort || config.port,
    user: config.user,
    password: config.password,
    database: config.databaseName || undefined,
    charset: config.charset,
    timezone: 'local',
    connectTimeout: config.connectTimeout,
    connectionLimit: config.poolMax,
    waitForConnections: true,
    enableKeepAlive: true,
    typeCast: function (field: any, next: any) {
      if (field.type === 'DATETIME' || field.type === 'DATE' || field.type === 'TIMESTAMP' || field.type === 'NEWDATE') {
        return field.string()
      }
      return next()
    },
  }
  if (config.sslEnabled) {
    opts.ssl = {
      ca: config.sslCa || undefined,
      cert: config.sslCert || undefined,
      key: config.sslKey || undefined,
      rejectUnauthorized: config.sslMode === 'VERIFY_CA' || config.sslMode === 'VERIFY_IDENTITY',
    }
  }
  return opts
}

export async function connect(config: ConnectionConfig): Promise<ConnectionStatus> {
  try {
    let host = config.host
    let port = config.port

    if (config.sshEnabled) {
      const tunnel = await createTunnel(config)
      tunnels.set(config.id, tunnel)
      host = '127.0.0.1'
      port = tunnel.localPort
    }

    const pool = mysql.createPool(buildPoolOptions(config, host, port))
    const conn = await pool.getConnection()
    const [rows] = await conn.query('SELECT VERSION() as version')
    const version = (rows as any[])[0]?.version || ''
    conn.release()

    pools.set(config.id, pool)
    logger.info(`Connected to ${config.name} (${version})`)
    return { id: config.id, connected: true, serverVersion: version, currentDatabase: config.databaseName }
  } catch (err: any) {
    logger.error(`Connection failed for ${config.name}: ${err.message}`)
    return { id: config.id, connected: false, error: err.message }
  }
}

export async function disconnect(id: string): Promise<void> {
  const pool = pools.get(id)
  if (pool) {
    await pool.end()
    pools.delete(id)
  }
  const tunnel = tunnels.get(id)
  if (tunnel) {
    tunnel.close()
    tunnels.delete(id)
  }
  logger.info(`Disconnected ${id}`)
}

export function getPool(id: string): mysql.Pool {
  const pool = pools.get(id)
  if (!pool) throw new Error(`No active connection for id: ${id}`)
  return pool
}

export async function getConnection(id: string): Promise<mysql.PoolConnection> {
  return getPool(id).getConnection()
}

export async function testConnection(config: ConnectionConfig): Promise<ConnectionStatus> {
  let tunnel: { localPort: number; close: () => void } | null = null
  try {
    let host = config.host
    let port = config.port
    if (config.sshEnabled) {
      tunnel = await createTunnel(config)
      host = '127.0.0.1'
      port = tunnel.localPort
    }
    const conn = await mysql.createConnection(buildPoolOptions(config, host, port))
    const [rows] = await conn.query('SELECT VERSION() as version')
    const version = (rows as any[])[0]?.version || ''
    await conn.end()
    return { id: config.id, connected: true, serverVersion: version }
  } catch (err: any) {
    return { id: config.id, connected: false, error: err.message }
  } finally {
    tunnel?.close()
  }
}

export async function disconnectAll(): Promise<void> {
  for (const id of pools.keys()) {
    await disconnect(id)
  }
}
