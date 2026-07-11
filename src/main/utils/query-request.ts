import type { QueryExecuteOptions } from '../../shared/types/query'
import type { ExecuteMultiOptions } from '../services/sql-script-executor'

const MAX_SQL_LENGTH = 2 * 1024 * 1024
const MAX_SCRIPT_LENGTH = 64 * 1024 * 1024

function string(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`)
  if (!allowEmpty && !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maxLength) throw new Error(`${label}长度不能超过 ${maxLength} 个字符`)
  return value
}

function optionalExecutionId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return string(value, '执行 ID', 256)
}

function optionsRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('查询选项必须是对象')
  return value as Record<string, unknown>
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

export function validateConnectionId(value: unknown): string {
  return string(value, '连接 ID', 128)
}

export function validateDatabase(value: unknown): string {
  return string(value ?? '', '数据库名', 64, true)
}

export function validateIdentifier(value: unknown, label = '标识符'): string {
  return string(value, label, 64)
}

export function validateSql(value: unknown, script = false): string {
  return string(value, 'SQL', script ? MAX_SCRIPT_LENGTH : MAX_SQL_LENGTH)
}

export function validateQueryOptions(value: unknown): QueryExecuteOptions {
  const input = optionsRecord(value)
  return { executionId: optionalExecutionId(input.executionId) }
}

export function validateMultiOptions(value: unknown): ExecuteMultiOptions {
  const input = optionsRecord(value)
  let maxResultRows: number | undefined
  if (input.maxResultRows !== undefined) {
    if (typeof input.maxResultRows !== 'number' || !Number.isInteger(input.maxResultRows) || input.maxResultRows < 1 || input.maxResultRows > 100000) {
      throw new Error('最大结果行数范围为 1-100000')
    }
    maxResultRows = input.maxResultRows
  }

  let scriptMode: ExecuteMultiOptions['scriptMode']
  if (input.scriptMode !== undefined) {
    if (input.scriptMode !== 'query' && input.scriptMode !== 'import') throw new Error('脚本模式无效')
    scriptMode = input.scriptMode
  }

  return {
    optimizeInserts: optionalBoolean(input.optimizeInserts, '插入优化选项'),
    stopOnError: optionalBoolean(input.stopOnError, '遇错停止选项'),
    limitResultRows: optionalBoolean(input.limitResultRows, '结果限制选项'),
    maxResultRows,
    saveHistory: optionalBoolean(input.saveHistory, '历史记录选项'),
    scriptMode,
    executionId: optionalExecutionId(input.executionId),
  }
}

export function validateOptionalExecutionId(value: unknown): string | undefined {
  return optionalExecutionId(value)
}
