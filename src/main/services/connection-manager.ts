import mysql from 'mysql2/promise'
import type { ConnectionConfig, ConnectionStatus } from '../../shared/types/connection'
import { createTunnel } from './ssh-tunnel'
import * as localStore from './local-store'
import * as logger from '../utils/logger'

const pools = new Map<string, mysql.Pool>()
const tunnels = new Map<string, { close: () => void }>()
const connectionConfigs = new Map<string, ConnectionConfig>()

const HEARTBEAT_SETTING_KEY = 'heartbeatIntervalSeconds'
const HEARTBEAT_DEFAULT_SECONDS = 20
const HEARTBEAT_MIN_SECONDS = 5
const HEARTBEAT_MAX_SECONDS = 120

let heartbeatIntervalSeconds = HEARTBEAT_DEFAULT_SECONDS
let heartbeatTimer: NodeJS.Timeout | null = null
let heartbeatRunning = false

type ConnectionLikeError = Error & { code?: string; errno?: number }

function normalizeHeartbeatSeconds(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_DEFAULT_SECONDS
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_MAX_SECONDS, Math.max(HEARTBEAT_MIN_SECONDS, rounded))
}

function getHeartbeatTimerDelayMs(): number {
  return heartbeatIntervalSeconds * 1000
}

function ensureHeartbeatSchedulerState(): void {
  if (pools.size === 0) {
    stopHeartbeatScheduler('no active connections')
    return
  }

  if (heartbeatTimer) {
    return
  }

  heartbeatTimer = setInterval(() => {
    void runHeartbeatTick()
  }, getHeartbeatTimerDelayMs())

  logger.info(`[heartbeat] scheduler started (${heartbeatIntervalSeconds}s)`)
}

function stopHeartbeatScheduler(reason: string): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
  logger.info(`[heartbeat] scheduler stopped (${reason})`)
}

async function runHeartbeatTick(): Promise<void> {
  if (heartbeatRunning) {
    logger.debug('[heartbeat] previous tick still running, skipping this cycle')
    return
  }

  if (pools.size === 0) {
    stopHeartbeatScheduler('no active connections')
    return
  }

  heartbeatRunning = true
  try {
    for (const id of pools.keys()) {
      try {
        const conn = await ensureConnection(id)
        await conn.query('SELECT 1')
        conn.release()
        logger.debug(`[heartbeat] connection ${id} ok`)
      } catch (err: any) {
        logger.warn(`[heartbeat] connection ${id} check failed: ${err?.message || err}`)
      }
    }
  } finally {
    heartbeatRunning = false
  }
}

function restartHeartbeatScheduler(reason: string): void {
  stopHeartbeatScheduler(`restart: ${reason}`)
  ensureHeartbeatSchedulerState()
}

export function initializeHeartbeatInterval(): void {
  const saved = localStore.settings.get(HEARTBEAT_SETTING_KEY)
  heartbeatIntervalSeconds = normalizeHeartbeatSeconds(saved)

  if (saved === null || String(heartbeatIntervalSeconds) !== saved) {
    localStore.settings.set(HEARTBEAT_SETTING_KEY, String(heartbeatIntervalSeconds))
  }

  logger.info(`[heartbeat] initialized (${heartbeatIntervalSeconds}s)`)
  ensureHeartbeatSchedulerState()
}

export function updateHeartbeatInterval(seconds: number): number {
  const normalized = normalizeHeartbeatSeconds(seconds)
  heartbeatIntervalSeconds = normalized
  logger.info(`[heartbeat] interval updated to ${normalized}s`)
  restartHeartbeatScheduler('interval updated')
  return normalized
}

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

function createConnectionError(message: string, code: string, cause?: unknown): ConnectionLikeError {
  const err = new Error(message) as ConnectionLikeError
  err.code = code
  if (cause) {
    ;(err as any).cause = cause
  }
  return err
}

export function isConnectionLostError(err: unknown): boolean {
  const e = err as ConnectionLikeError | undefined
  const code = String(e?.code || '')
  const message = String(e?.message || '').toLowerCase()

  if (['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_SERVER_SHUTDOWN'].includes(code)) {
    return true
  }

  return message.includes('connection lost')
    || message.includes('server closed the connection')
    || message.includes('cannot enqueue query after fatal error')
    || message.includes('read econreset')
}

function getSavedConfig(id: string): ConnectionConfig | null {
  const cached = connectionConfigs.get(id)
  if (cached) return cached

  const stored = localStore.connections.getById(id)
  if (stored) {
    connectionConfigs.set(id, stored)
    return stored
  }

  return null
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
    connectionConfigs.set(config.id, config)
    ensureHeartbeatSchedulerState()

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
  connectionConfigs.delete(id)
  ensureHeartbeatSchedulerState()
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

export async function ensureConnection(id: string): Promise<mysql.PoolConnection> {
  let conn = await getConnection(id)
  try {
    await conn.query('SELECT 1')
    return conn
  } catch (err: any) {
    if (!isConnectionLostError(err)) {
      conn.release()
      throw err
    }

    logger.warn(`Connection lost detected for ${id}, recreating pool`)
    try { conn.destroy() } catch { conn.release() }

    const config = getSavedConfig(id)
    if (!config) {
      throw createConnectionError(`Connection config not found for id: ${id}`, 'CONNECTION_CONFIG_NOT_FOUND', err)
    }

    await disconnect(id)
    const status = await connect(config)
    if (!status.connected) {
      throw createConnectionError(status.error || 'Reconnect failed', 'CONNECTION_RECONNECT_FAILED', err)
    }

    conn = await getConnection(id)
    return conn
  }
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
  stopHeartbeatScheduler('disconnect all')
  for (const id of pools.keys()) {
    await disconnect(id)
  }
}
