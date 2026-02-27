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

// Heartbeat
export const HEARTBEAT_SETTING_KEY = 'heartbeatIntervalSeconds'
export const HEARTBEAT_DEFAULT_SECONDS = 20
export const HEARTBEAT_MIN_SECONDS = 5
export const HEARTBEAT_MAX_SECONDS = 120

export function normalizeHeartbeatSeconds(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_DEFAULT_SECONDS
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_MAX_SECONDS, Math.max(HEARTBEAT_MIN_SECONDS, rounded))
}
