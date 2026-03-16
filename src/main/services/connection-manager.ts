import mysql from 'mysql2/promise'
import type { ConnectionConfig, ConnectionStatus } from '../../shared/types/connection'
import { createTunnel } from './ssh-tunnel'
import * as localStore from './local-store'
import * as logger from '../utils/logger'
import {
  HEARTBEAT_SETTING_KEY,
  HEARTBEAT_DEFAULT_SECONDS,
  HEARTBEAT_TIMEOUT_SETTING_KEY,
  HEARTBEAT_TIMEOUT_DEFAULT_MS,
  HEARTBEAT_CONCURRENCY_SETTING_KEY,
  HEARTBEAT_CONCURRENCY_DEFAULT,
  HEARTBEAT_AUTOTUNE_SETTING_KEY,
  HEARTBEAT_AUTOTUNE_DEFAULT,
  normalizeHeartbeatSeconds,
  normalizeHeartbeatTimeoutMs,
  normalizeHeartbeatConcurrency,
  normalizeHeartbeatAutoTuneEnabled,
} from '../../shared/constants'

const pools = new Map<string, mysql.Pool>()
const tunnels = new Map<string, { close: () => void }>()
const connectionConfigs = new Map<string, ConnectionConfig>()

let heartbeatIntervalSeconds = HEARTBEAT_DEFAULT_SECONDS
let heartbeatTimer: NodeJS.Timeout | null = null
let heartbeatRunning = false
let heartbeatMaxConcurrency = HEARTBEAT_CONCURRENCY_DEFAULT
let heartbeatQueryTimeoutMs = HEARTBEAT_TIMEOUT_DEFAULT_MS
let heartbeatAutoTuneEnabled = HEARTBEAT_AUTOTUNE_DEFAULT
let heartbeatBaseConcurrency = HEARTBEAT_CONCURRENCY_DEFAULT
let heartbeatBaseTimeoutMs = HEARTBEAT_TIMEOUT_DEFAULT_MS
let heartbeatStableTicks = 0

type ConnectionLikeError = Error & { code?: string; errno?: number }

type HeartbeatBatchStats = {
  checked: number
  failed: number
  timeouts: number
}

function reportHeartbeatMetric(_name: string, _value: number, _tags?: Record<string, unknown>): void {}

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

}

function stopHeartbeatScheduler(reason: string): void {
  if (!heartbeatTimer) return
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

async function runHeartbeatForConnection(id: string): Promise<void> {
  const conn = await ensureConnection(id)
  let timeoutTimer: NodeJS.Timeout | null = null

  try {
    await Promise.race([
      conn.query('SELECT 1').then(() => undefined),
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error(`heartbeat timeout after ${heartbeatQueryTimeoutMs}ms (${id})`))
        }, heartbeatQueryTimeoutMs)
      }),
    ])

  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
    }
    conn.release()
  }
}

async function runHeartbeatInBatches(ids: string[]): Promise<HeartbeatBatchStats> {
  const stats: HeartbeatBatchStats = { checked: 0, failed: 0, timeouts: 0 }

  for (let i = 0; i < ids.length; i += heartbeatMaxConcurrency) {
    const batch = ids.slice(i, i + heartbeatMaxConcurrency)
    const batchResults = await Promise.allSettled(
      batch.map(async (id) => {
        try {
          await runHeartbeatForConnection(id)
          return { id, ok: true as const }
        } catch (err: any) {
          return { id, ok: false as const, err }
        }
      })
    )

    for (const result of batchResults) {
      stats.checked += 1
      if (result.status === 'fulfilled') {
        if (!result.value.ok) {
          stats.failed += 1
          const message = String(result.value.err?.message || result.value.err || '')
          if (message.includes('heartbeat timeout')) {
            stats.timeouts += 1
          }
        }
      } else {
        stats.failed += 1
        const message = String(result.reason?.message || result.reason || '')
        if (message.includes('heartbeat timeout')) {
          stats.timeouts += 1
        }
      }
    }
  }

  return stats
}

function applyHeartbeatAutoTune(stats: HeartbeatBatchStats): void {
  if (!heartbeatAutoTuneEnabled || stats.checked === 0) return

  const failureRate = stats.failed / stats.checked
  const timeoutRate = stats.timeouts / stats.checked

  if (stats.timeouts > 0 || failureRate >= 0.4 || timeoutRate >= 0.25) {
    const prevConcurrency = heartbeatMaxConcurrency
    const prevTimeout = heartbeatQueryTimeoutMs

    heartbeatMaxConcurrency = normalizeHeartbeatConcurrency(Math.max(HEARTBEAT_CONCURRENCY_MIN, Math.floor(heartbeatMaxConcurrency / 2)))
    heartbeatQueryTimeoutMs = normalizeHeartbeatTimeoutMs(Math.round(heartbeatQueryTimeoutMs * 1.25))
    heartbeatStableTicks = 0

    if (prevConcurrency !== heartbeatMaxConcurrency || prevTimeout !== heartbeatQueryTimeoutMs) {
      reportHeartbeatMetric('heartbeat.autotune.adjust', 1, {
        reason: 'degrade',
        failed: stats.failed,
        timeouts: stats.timeouts,
        checked: stats.checked,
        concurrencyBefore: prevConcurrency,
        concurrencyAfter: heartbeatMaxConcurrency,
        timeoutBefore: prevTimeout,
        timeoutAfter: heartbeatQueryTimeoutMs,
      })
    }
    return
  }

  if (stats.failed === 0 && stats.timeouts === 0) {
    heartbeatStableTicks += 1
    if (heartbeatStableTicks >= 3) {
      const prevConcurrency = heartbeatMaxConcurrency
      const prevTimeout = heartbeatQueryTimeoutMs

      heartbeatMaxConcurrency = normalizeHeartbeatConcurrency(Math.min(heartbeatBaseConcurrency, heartbeatMaxConcurrency + 1))
      heartbeatQueryTimeoutMs = normalizeHeartbeatTimeoutMs(
        heartbeatQueryTimeoutMs > heartbeatBaseTimeoutMs
          ? Math.max(heartbeatBaseTimeoutMs, heartbeatQueryTimeoutMs - 500)
          : heartbeatQueryTimeoutMs
      )
      heartbeatStableTicks = 0

      if (prevConcurrency !== heartbeatMaxConcurrency || prevTimeout !== heartbeatQueryTimeoutMs) {
        reportHeartbeatMetric('heartbeat.autotune.adjust', 1, {
          reason: 'recover',
          checked: stats.checked,
          concurrencyBefore: prevConcurrency,
          concurrencyAfter: heartbeatMaxConcurrency,
          timeoutBefore: prevTimeout,
          timeoutAfter: heartbeatQueryTimeoutMs,
        })
      }
    }
  } else {
    heartbeatStableTicks = 0
  }
}

async function runHeartbeatTick(): Promise<void> {
  if (heartbeatRunning) {
    return
  }

  if (pools.size === 0) {
    stopHeartbeatScheduler('no active connections')
    return
  }

  heartbeatRunning = true
  const tickStart = performance.now()
  const tickTs = Date.now()

  try {
    const ids = Array.from(pools.keys())
    const stats = await runHeartbeatInBatches(ids)
    applyHeartbeatAutoTune(stats)
    const elapsed = performance.now() - tickStart


    reportHeartbeatMetric('heartbeat.tick_ms', elapsed, {
      checked: stats.checked,
      failed: stats.failed,
      timeouts: stats.timeouts,
      intervalSec: heartbeatIntervalSeconds,
      concurrency: heartbeatMaxConcurrency,
      timeoutMs: heartbeatQueryTimeoutMs,
      autoTuneEnabled: heartbeatAutoTuneEnabled,
    })  } finally {
    heartbeatRunning = false
  }
}

function restartHeartbeatScheduler(reason: string): void {
  stopHeartbeatScheduler(`restart: ${reason}`)
  ensureHeartbeatSchedulerState()
}

export function initializeHeartbeatInterval(): void {
  const savedInterval = localStore.settings.get(HEARTBEAT_SETTING_KEY)
  heartbeatIntervalSeconds = normalizeHeartbeatSeconds(savedInterval)
  if (savedInterval === null || String(heartbeatIntervalSeconds) !== savedInterval) {
    localStore.settings.set(HEARTBEAT_SETTING_KEY, String(heartbeatIntervalSeconds))
  }

  const savedTimeout = localStore.settings.get(HEARTBEAT_TIMEOUT_SETTING_KEY)
  const normalizedTimeout = normalizeHeartbeatTimeoutMs(savedTimeout)
  const timeoutSafetyFloorMs = 1000
  heartbeatQueryTimeoutMs = Math.max(timeoutSafetyFloorMs, normalizedTimeout)
  if (savedTimeout === null || String(heartbeatQueryTimeoutMs) !== savedTimeout) {
    localStore.settings.set(HEARTBEAT_TIMEOUT_SETTING_KEY, String(heartbeatQueryTimeoutMs))
  }

  const savedConcurrency = localStore.settings.get(HEARTBEAT_CONCURRENCY_SETTING_KEY)
  heartbeatMaxConcurrency = normalizeHeartbeatConcurrency(savedConcurrency)
  if (savedConcurrency === null || String(heartbeatMaxConcurrency) !== savedConcurrency) {
    localStore.settings.set(HEARTBEAT_CONCURRENCY_SETTING_KEY, String(heartbeatMaxConcurrency))
  }

  const savedAutoTuneEnabled = localStore.settings.get(HEARTBEAT_AUTOTUNE_SETTING_KEY)
  heartbeatAutoTuneEnabled = normalizeHeartbeatAutoTuneEnabled(savedAutoTuneEnabled)
  if (savedAutoTuneEnabled === null || String(heartbeatAutoTuneEnabled) !== String(savedAutoTuneEnabled)) {
    localStore.settings.set(HEARTBEAT_AUTOTUNE_SETTING_KEY, String(heartbeatAutoTuneEnabled))
  }

  heartbeatBaseConcurrency = heartbeatMaxConcurrency
  heartbeatBaseTimeoutMs = heartbeatQueryTimeoutMs
  heartbeatStableTicks = 0

  ensureHeartbeatSchedulerState()
}

export function updateHeartbeatInterval(seconds: number): number {
  const normalized = normalizeHeartbeatSeconds(seconds)
  heartbeatIntervalSeconds = normalized
  restartHeartbeatScheduler('interval updated')
  return normalized
}

export function updateHeartbeatTimeoutMs(timeoutMs: number): number {
  const normalized = normalizeHeartbeatTimeoutMs(timeoutMs)
  const timeoutSafetyFloorMs = 1000
  heartbeatQueryTimeoutMs = Math.max(timeoutSafetyFloorMs, normalized)
  heartbeatBaseTimeoutMs = heartbeatQueryTimeoutMs
  heartbeatStableTicks = 0
  restartHeartbeatScheduler('timeout updated')
  return heartbeatQueryTimeoutMs
}

export function updateHeartbeatConcurrency(concurrency: number): number {
  const normalized = normalizeHeartbeatConcurrency(concurrency)
  heartbeatMaxConcurrency = normalized
  heartbeatBaseConcurrency = normalized
  heartbeatStableTicks = 0
  restartHeartbeatScheduler('concurrency updated')
  return normalized
}

export function updateHeartbeatAutoTuneEnabled(enabled: boolean): boolean {
  heartbeatAutoTuneEnabled = normalizeHeartbeatAutoTuneEnabled(enabled)
  heartbeatStableTicks = 0
  if (!heartbeatAutoTuneEnabled) {
    heartbeatMaxConcurrency = heartbeatBaseConcurrency
    heartbeatQueryTimeoutMs = heartbeatBaseTimeoutMs
  }
  restartHeartbeatScheduler('auto-tune updated')
  return heartbeatAutoTuneEnabled
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
    multipleStatements: true,
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
    ;(err as Error & { cause?: unknown }).cause = cause
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
  const startedAt = Date.now()
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

    // 监听连接池异常，自动清理残留资源防止内存泄漏
    pool.on('error', (err) => {
      logger.warn(`[connection-manager] Pool error for ${config.id}: ${err.message}`)
    })

    const conn = await pool.getConnection()
    const [rows] = await conn.query('SELECT VERSION() as version')
    const version = (rows as Record<string, string>[])[0]?.version || ''
    conn.release()

    pools.set(config.id, pool)
    connectionConfigs.set(config.id, config)
    ensureHeartbeatSchedulerState()

    return { id: config.id, connected: true, serverVersion: version, currentDatabase: config.databaseName }
  } catch (err: any) {
    logger.error('[connection.connect.failed]', {
      id: config.id,
      name: config.name,
      elapsedMs: Date.now() - startedAt,
      error: err.message,
    })
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

}

export function getPool(id: string): mysql.Pool {
  const pool = pools.get(id)
  if (!pool) throw new Error(`No active connection for id: ${id}`)
  return pool
}

export function getConnectionConfig(id: string): ConnectionConfig | undefined {
  return connectionConfigs.get(id) || getSavedConfig(id) || undefined
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
    try { conn.destroy() } catch { /* 连接已断开，忽略 */ }

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
    const version = (rows as Record<string, string>[])[0]?.version || ''
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
