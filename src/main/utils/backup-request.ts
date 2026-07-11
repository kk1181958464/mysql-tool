import type { BackupCreateRequest, BackupRestoreOptions, BackupScheduleRequest } from '../../shared/types/table-design'
import { validateFilePathString } from './import-export-request'
import { validateConnectionId, validateIdentifier } from './query-request'

const BACKUP_TYPES = new Set(['full', 'structure', 'data'])
const SCHEDULE_ACTIONS = new Set(['list', 'create', 'update', 'delete'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function bool(value: unknown, label: string, optional = false): boolean | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}
function backupType(value: unknown): 'full' | 'structure' | 'data' {
  if (typeof value !== 'string' || !BACKUP_TYPES.has(value)) throw new Error('备份类型无效')
  return value as 'full' | 'structure' | 'data'
}
function id(value: unknown, label: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error(`${label}无效`)
  return value
}

export function validateBackupCreateRequest(value: unknown): BackupCreateRequest {
  const v = object(value, '备份请求')
  let databases: string[] | undefined
  if (v.databases !== undefined) {
    if (!Array.isArray(v.databases) || v.databases.length < 1 || v.databases.length > 100) throw new Error('备份数据库列表必须包含 1-100 项')
    databases = v.databases.map((item) => validateIdentifier(item, '数据库名'))
    if (new Set(databases).size !== databases.length) throw new Error('备份数据库列表不能重复')
  }
  const databaseName = v.databaseName === undefined ? undefined : validateIdentifier(v.databaseName, '数据库名')
  if (!databases && !databaseName) throw new Error('请选择备份数据库')
  return {
    id: id(v.id, '备份 ID', true), connectionId: validateConnectionId(v.connectionId), databaseName, databases,
    backupType: backupType(v.backupType), filePath: v.filePath === undefined ? undefined : validateFilePathString(v.filePath),
    compress: bool(v.compress, '压缩选项')!, encrypt: bool(v.encrypt, '加密选项', true),
  }
}

export function validateBackupRestoreOptions(value: unknown): BackupRestoreOptions {
  const v = value === undefined ? {} : object(value, '恢复选项')
  const targetDb = v.targetDb === undefined || v.targetDb === '' ? undefined : validateIdentifier(v.targetDb, '目标数据库名')
  const newDbName = v.newDbName === undefined || v.newDbName === '' ? undefined : validateIdentifier(v.newDbName, '新数据库名')
  const createNew = bool(v.createNew, '新建数据库选项', true)
  if (createNew && !newDbName) throw new Error('新建数据库时必须提供数据库名')
  if (!createNew && !targetDb) throw new Error('请选择恢复目标数据库')
  return { targetDb, newDbName, createNew, dropExisting: bool(v.dropExisting, '清空目标选项', true) }
}

export function validateBackupScheduleRequest(value: unknown): BackupScheduleRequest {
  const v = object(value, '定时备份请求')
  if (typeof v.action !== 'string' || !SCHEDULE_ACTIONS.has(v.action)) throw new Error('定时备份操作无效')
  const action = v.action as BackupScheduleRequest['action']
  const connectionId = validateConnectionId(v.connectionId)
  if (action === 'list') return { action, connectionId }
  const scheduleId = id(v.id, '定时备份 ID', action === 'create')
  if (action === 'delete') return { action, connectionId, id: id(v.id, '定时备份 ID') }
  if (typeof v.cronExpression !== 'string' || !v.cronExpression.trim() || v.cronExpression.length > 128) throw new Error('cron 表达式无效')
  if (typeof v.retentionDays !== 'number' || !Number.isInteger(v.retentionDays) || v.retentionDays < 1 || v.retentionDays > 365) throw new Error('保留天数范围为 1-365')
  return {
    action, connectionId, id: scheduleId, databaseName: validateIdentifier(v.databaseName, '数据库名'),
    cronExpression: v.cronExpression.trim(), backupType: backupType(v.backupType), compress: bool(v.compress, '压缩选项'),
    retentionDays: v.retentionDays, isActive: bool(v.isActive, '启用选项'),
  }
}
