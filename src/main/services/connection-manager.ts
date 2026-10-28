import { formatErrorMessage } from '../../shared/error-message'
import mysql from 'mysql2/promise'
import { readFileSync } from 'fs'
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
  HEARTBEAT_CONCURRENCY_MIN,
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
const endpoints = new Map<string, { host: string; port: number }>()
const reconnecting = new Map<string, Promise<void>>()
const disconnectGenerations = new Map<string, number>()

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
  let timeoutTimer: NodeJS.Timeout | null = null
  let timedOut = false
  const work = ensureConnection(id).then(async (conn) => {
    if (timedOut) {
      conn.destroy()
      return
    }
    try {
      await conn.query('SELECT 1')
      conn.release()
    } catch (err) {
      conn.destroy()
      throw err
    }
  })
  work.catch(() => {})

  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          timedOut = true
          reject(new Error(`heartbeat timeout after ${heartbeatQueryTimeoutMs}ms (${id})`))
        }, heartbeatQueryTimeoutMs)
      }),
    ])
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
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

function readPem(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined
  if (value.includes('-----BEGIN')) return value
  try {
    return readFileSync(value, 'utf-8')
  } catch (err) {
    throw new Error(`无法读取${label}文件：${value}（${(err as Error).message}）`)
  }
}

function buildConnectionOptions(config: ConnectionConfig, overrideHost?: string, overridePort?: number): mysql.ConnectionOptions {
  const connectTimeout = Math.max(1000, Math.min(Math.trunc(Number(config.connectTimeout) || 10000), 300000))
  const timezone = /^(?:local|Z|[+-]\d{2}:\d{2})$/.test(config.timezone || '') ? config.timezone : 'local'
  const opts: mysql.ConnectionOptions = {
    host: overrideHost || config.host,
    port: overridePort || config.port,
    user: config.user,
    password: config.password,
    database: config.databaseName || undefined,
    charset: config.charset,
    timezone,
    connectTimeout,
    enableKeepAlive: true,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    typeCast: function (field: any, next: any) {
      if (field.type === 'DATETIME' || field.type === 'DATE' || field.type === 'TIMESTAMP' || field.type === 'NEWDATE') {
        return field.string()
      }
      return next()
    },
  }
  if (config.sslEnabled) {
    opts.ssl = {
      ca: readPem(config.sslCa, 'CA 证书'),
      cert: readPem(config.sslCert, '客户端证书'),
      key: readPem(config.sslKey, '客户端密钥'),
      rejectUnauthorized: config.sslMode === 'VERIFY_CA' || config.sslMode === 'VERIFY_IDENTITY',
    }
  }
  return opts
}

function buildPoolOptions(config: ConnectionConfig, overrideHost?: string, overridePort?: number): mysql.PoolOptions {
  const connectionLimit = Math.max(1, Math.min(Math.trunc(Number(config.poolMax) || 10), 100))
  const idleTimeout = Math.max(1000, Math.min(Math.trunc(Number(config.idleTimeout) || 60000), 3600000))
  return {
    ...buildConnectionOptions(config, overrideHost, overridePort),
    connectionLimit,
    maxIdle: Math.min(2, connectionLimit),
    idleTimeout,
    waitForConnections: true,
  }
}

export function getScriptConnectionOptions(id: string, database?: string): mysql.ConnectionOptions {
  const config = connectionConfigs.get(id)
  const endpoint = endpoints.get(id)
  if (!config || !endpoint || !pools.has(id)) throw new Error('连接已断开，请重新连接后再试')
  const opts = buildConnectionOptions(config, endpoint.host, endpoint.port)
  return { ...opts, database: database || opts.database, multipleStatements: true }
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
  let tunnel: { localPort: number; close: () => void } | null = null
  let pool: mysql.Pool | null = null
  let conn: mysql.PoolConnection | null = null

  try {
    let host = config.host
    let port = config.port

    if (config.sshEnabled) {
      tunnel = await createTunnel(config)
      host = '127.0.0.1'
      port = tunnel.localPort
    }

    pool = mysql.createPool(buildPoolOptions(config, host, port))

    // 监听连接池异常，自动清理残留资源防止内存泄漏
    ;(pool as any).on('error', (err: Error) => {
      logger.warn(`[connection-manager] Pool error for ${config.id}: ${err.message}`)
    })

    conn = await pool.getConnection()
    let version = ''
    try {
      const [rows] = await conn.query('SELECT VERSION() as version')
      version = (rows as Record<string, string>[])[0]?.version || ''
    } finally {
      conn.release()
      conn = null
    }

    const previousPool = pools.get(config.id)
    const previousTunnel = tunnels.get(config.id)
    pools.set(config.id, pool)
    if (tunnel) {
      tunnels.set(config.id, tunnel)
    } else {
      tunnels.delete(config.id)
    }
    endpoints.set(config.id, { host, port })
    connectionConfigs.set(config.id, config)
    if (previousPool && previousPool !== pool) previousPool.end().catch(() => {})
    if (previousTunnel && previousTunnel !== tunnel) {
      try { previousTunnel.close() } catch { /* 旧隧道已关闭 */ }
    }
    ensureHeartbeatSchedulerState()

    pool = null
    tunnel = null

    return { id: config.id, connected: true, serverVersion: version, currentDatabase: config.databaseName }
  } catch (err: any) {
    if (conn) {
      try { conn.destroy() } catch { /* 连接初始化失败，忽略清理异常 */ }
    }
    if (pool) {
      try { await pool.end() } catch { /* 连接池初始化失败，忽略清理异常 */ }
    }
    if (tunnel) {
      try { tunnel.close() } catch { /* SSH 隧道初始化失败，忽略清理异常 */ }
    }
    logger.error('[connection.connect.failed]', {
      id: config.id,
      name: config.name,
      elapsedMs: Date.now() - startedAt,
      error: err.message,
    })
    return { id: config.id, connected: false, error: formatErrorMessage(err, '连接失败') }
  }
}

async function closeResources(id: string): Promise<void> {
  const pool = pools.get(id)
  const tunnel = tunnels.get(id)
  pools.delete(id)
  tunnels.delete(id)
  endpoints.delete(id)
  try {
    if (pool) await pool.end()
  } catch (err) {
    logger.warn(`[connection-manager] pool end failed for ${id}: ${(err as Error).message}`)
  } finally {
    if (tunnel) {
      try { tunnel.close() } catch { /* 隧道已关闭 */ }
    }
  }
}

export async function disconnect(id: string): Promise<void> {
  disconnectGenerations.set(id, (disconnectGenerations.get(id) ?? 0) + 1)
  await closeResources(id)
  connectionConfigs.delete(id)
  ensureHeartbeatSchedulerState()
}

export function getPool(id: string): mysql.Pool {
  const pool = pools.get(id)
  if (!pool) throw new Error('连接已断开，请重新连接后再试')
  return pool
}

export function getActiveConnectionIds(): string[] {
  return Array.from(pools.keys())
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

    await reconnect(id, err)
    conn = await getConnection(id)
    return conn
  }
}

function reconnect(id: string, cause: unknown): Promise<void> {
  const existing = reconnecting.get(id)
  if (existing) return existing

  const generation = disconnectGenerations.get(id) ?? 0
  const task = (async () => {
    const config = getSavedConfig(id)
    if (!config) {
      throw createConnectionError('连接配置不存在，请重新连接', 'CONNECTION_CONFIG_NOT_FOUND', cause)
    }
    const status = await connect(config)
    if ((disconnectGenerations.get(id) ?? 0) !== generation) {
      await closeResources(id)
      throw createConnectionError('连接已断开，请重新连接后再试', 'CONNECTION_CLOSED', cause)
    }
    if (!status.connected) {
      throw createConnectionError(status.error || '重新连接失败', 'CONNECTION_RECONNECT_FAILED', cause)
    }
  })().finally(() => reconnecting.delete(id))

  reconnecting.set(id, task)
  return task
}

export async function testConnection(config: ConnectionConfig): Promise<ConnectionStatus> {
  let tunnel: { localPort: number; close: () => void } | null = null
  let conn: mysql.Connection | null = null
  try {
    let host = config.host
    let port = config.port
    if (config.sshEnabled) {
      tunnel = await createTunnel(config)
      host = '127.0.0.1'
      port = tunnel.localPort
    }
    conn = await mysql.createConnection(buildConnectionOptions(config, host, port))
    const [rows] = await conn.query('SELECT VERSION() as version')
    const version = (rows as Record<string, string>[])[0]?.version || ''
    return { id: config.id, connected: true, serverVersion: version }
  } catch (err: any) {
    return { id: config.id, connected: false, error: formatErrorMessage(err, '连接失败') }
  } finally {
    if (conn) {
      try { await conn.end() } catch { /* 测试连接已失效，忽略清理异常 */ }
    }
    if (tunnel) {
      try { tunnel.close() } catch { /* SSH 测试隧道已失效，忽略清理异常 */ }
    }
  }
}

export async function disconnectAll(): Promise<void> {
  stopHeartbeatScheduler('disconnect all')
  for (const id of Array.from(pools.keys())) {
    await disconnect(id)
  }
}
