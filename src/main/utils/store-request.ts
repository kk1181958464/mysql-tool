import type { QueryHistoryItem, Snippet } from '../../shared/types/query'
import {
  HEARTBEAT_AUTOTUNE_SETTING_KEY, HEARTBEAT_CONCURRENCY_SETTING_KEY, HEARTBEAT_SETTING_KEY,
  HEARTBEAT_TIMEOUT_SETTING_KEY, PAGINATION_MODE_SETTING_KEY, TABLE_ROWS_PER_PAGE_SETTING_KEY,
} from '../../shared/constants'
import { validateConnectionId, validateSql } from './query-request'

const SETTINGS = new Set([HEARTBEAT_SETTING_KEY, HEARTBEAT_TIMEOUT_SETTING_KEY, HEARTBEAT_CONCURRENCY_SETTING_KEY, HEARTBEAT_AUTOTUNE_SETTING_KEY, TABLE_ROWS_PER_PAGE_SETTING_KEY, PAGINATION_MODE_SETTING_KEY, 'db-remarks'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function string(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error(`${label}无效`)
  return value
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}无效`)
  return value
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

export function validateHistoryPage(limit: unknown, offset: unknown): { limit: number; offset: number } {
  const validLimit = limit === undefined ? 100 : number(limit, '历史记录页大小', 1, 500)
  const validOffset = offset === undefined ? 0 : number(offset, '历史记录偏移', 0, 5000)
  if (!Number.isInteger(validLimit) || !Number.isInteger(validOffset)) throw new Error('历史记录分页必须是整数')
  return { limit: validLimit, offset: validOffset }
}

export function validateHistoryItem(value: unknown): Omit<QueryHistoryItem, 'id'> {
  const v = object(value, '查询历史')
  return {
    connectionId: validateConnectionId(v.connectionId), databaseName: string(v.databaseName, '数据库名', 64, true),
    sqlText: validateSql(v.sqlText), executionTimeMs: number(v.executionTimeMs, '执行时间', 0, 24 * 60 * 60 * 1000),
    rowCount: number(v.rowCount, '结果行数', 0, Number.MAX_SAFE_INTEGER), isSuccess: boolean(v.isSuccess, '成功状态'),
    errorMessage: string(v.errorMessage, '错误信息', 2000, true), isSlow: boolean(v.isSlow, '慢查询状态'),
    createdAt: string(v.createdAt, '创建时间', 64),
  }
}

export function validateSnippet(value: unknown): Snippet {
  const v = object(value, '代码片段')
  return {
    id: string(v.id, '代码片段 ID', 128), name: string(v.name, '代码片段名称', 256),
    category: string(v.category, '代码片段分类', 128, true), sqlText: validateSql(v.sqlText),
    description: string(v.description, '代码片段描述', 2000, true),
    createdAt: v.createdAt === undefined ? new Date().toISOString() : string(v.createdAt, '创建时间', 64),
  }
}

export function validateSettingKey(value: unknown): string {
  if (typeof value !== 'string' || !SETTINGS.has(value)) throw new Error('不支持的设置项')
  return value
}

export function validateSettingValue(key: string, value: unknown): string {
  return string(value, '设置值', key === 'db-remarks' ? 1024 * 1024 : 128, true)
}

export function validateOptionalFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return string(value, '筛选词', 256, true)
}
