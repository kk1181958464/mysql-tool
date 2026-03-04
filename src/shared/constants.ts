export const APP_NAME = 'MySQL连接工具'
export const DEFAULT_PORT = 3306
export const DEFAULT_SSH_PORT = 22
export const DEFAULT_CHARSET = 'utf8mb4'
export const DEFAULT_TIMEZONE = '+00:00'
export const DEFAULT_POOL_MIN = 1
export const DEFAULT_POOL_MAX = 10
export const DEFAULT_CONNECT_TIMEOUT = 10000
export const DEFAULT_IDLE_TIMEOUT = 60000
export const PAGE_SIZE = 1000
export const MAX_RESULT_ROWS = 100000

// Table pagination
export const TABLE_ROWS_PER_PAGE_SETTING_KEY = 'rowsPerPage'
export const TABLE_ROWS_PER_PAGE_DEFAULT = 100
export const TABLE_ROWS_PER_PAGE_MIN = 10
export const TABLE_ROWS_PER_PAGE_MAX = 500

export function normalizeTableRowsPerPage(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return TABLE_ROWS_PER_PAGE_DEFAULT
  const rounded = Math.round(value)
  return Math.min(TABLE_ROWS_PER_PAGE_MAX, Math.max(TABLE_ROWS_PER_PAGE_MIN, rounded))
}

// Pagination mode
export const PAGINATION_MODE_SETTING_KEY = 'paginationMode'
export type PaginationMode = 'auto' | 'cursor' | 'offset'
export const PAGINATION_MODE_DEFAULT: PaginationMode = 'auto'

export function normalizePaginationMode(raw: unknown): PaginationMode {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'cursor' || value === 'offset' || value === 'auto') {
    return value
  }
  return PAGINATION_MODE_DEFAULT
}

// Heartbeat
export const HEARTBEAT_SETTING_KEY = 'heartbeatIntervalSeconds'
export const HEARTBEAT_DEFAULT_SECONDS = 20
export const HEARTBEAT_MIN_SECONDS = 5
export const HEARTBEAT_MAX_SECONDS = 120

export const HEARTBEAT_TIMEOUT_SETTING_KEY = 'heartbeatQueryTimeoutMs'
export const HEARTBEAT_TIMEOUT_DEFAULT_MS = 3000
export const HEARTBEAT_TIMEOUT_MIN_MS = 500
export const HEARTBEAT_TIMEOUT_MAX_MS = 15000

export const HEARTBEAT_CONCURRENCY_SETTING_KEY = 'heartbeatMaxConcurrency'
export const HEARTBEAT_CONCURRENCY_DEFAULT = 4
export const HEARTBEAT_CONCURRENCY_MIN = 1
export const HEARTBEAT_CONCURRENCY_MAX = 16

export const HEARTBEAT_AUTOTUNE_SETTING_KEY = 'heartbeatAutoTuneEnabled'
export const HEARTBEAT_AUTOTUNE_DEFAULT = true

export function normalizeHeartbeatSeconds(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_DEFAULT_SECONDS
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_MAX_SECONDS, Math.max(HEARTBEAT_MIN_SECONDS, rounded))
}

export function normalizeHeartbeatTimeoutMs(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_TIMEOUT_DEFAULT_MS
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_TIMEOUT_MAX_MS, Math.max(HEARTBEAT_TIMEOUT_MIN_MS, rounded))
}

export function normalizeHeartbeatConcurrency(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_CONCURRENCY_DEFAULT
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_CONCURRENCY_MAX, Math.max(HEARTBEAT_CONCURRENCY_MIN, rounded))
}

export function normalizeHeartbeatAutoTuneEnabled(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false
  return HEARTBEAT_AUTOTUNE_DEFAULT
}
