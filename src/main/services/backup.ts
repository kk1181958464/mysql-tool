import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { randomUUID } from 'crypto'
import { promisify } from 'util'
import { finished } from 'stream/promises'
import * as localStore from './local-store'
import * as logger from '../utils/logger'
import * as importExport from './import-export'
import * as connectionManager from './connection-manager'
import { executeMultiStatementSql } from './sql-script-executor'
import { quoteId } from '../utils/sql'
import type {
  BackupConfig,
  BackupCreateRequest,
  BackupRecord,
  BackupRestoreOptions,
  BackupSchedule,
  BackupScheduleRequest,
} from '../../shared/types/table-design'

const gunzip = promisify(zlib.gunzip)
const SCHEDULE_POLL_INTERVAL_MS = 30 * 1000

let scheduleTimer: NodeJS.Timeout | null = null
const runningScheduleIds = new Set<string>()
const lastTriggerKeyBySchedule = new Map<string, string>()

type CronFields = {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  dayOfMonthAny: boolean
  month: Set<number>
  dayOfWeek: Set<number>
  dayOfWeekAny: boolean
}

function sanitizeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDateForFile(date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
}

function formatLastRun(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function getDefaultBackupDir(): string {
  return path.join(app.getPath('documents'), 'MySQLToolBackups')
}

function buildDefaultBackupFilePath(databaseName: string, backupType: BackupConfig['backupType'], compress: boolean, now = new Date()): string {
  const fileName = `${sanitizeFileName(databaseName)}_${backupType}_${formatLocalDateForFile(now)}.sql${compress ? '.gz' : ''}`
  return path.join(getDefaultBackupDir(), fileName)
}

function normalizeBackupFilePath(filePath: string | undefined, databaseName: string, backupType: BackupConfig['backupType'], compress: boolean): string {
  if (!filePath?.trim()) {
    return buildDefaultBackupFilePath(databaseName, backupType, compress)
  }

  const trimmed = filePath.trim()
  if (compress && !trimmed.toLowerCase().endsWith('.gz')) {
    return `${trimmed}.gz`
  }
  return trimmed
}

function toBackupConfig(request: BackupCreateRequest, databaseName: string): BackupConfig {
  return {
    id: request.id || randomUUID(),
    connectionId: request.connectionId,
    databaseName,
    backupType: request.backupType,
    filePath: normalizeBackupFilePath(
      request.filePath && ((request.databases?.length || 0) <= 1) ? request.filePath : undefined,
      databaseName,
      request.backupType,
      request.compress,
    ),
    compress: request.compress,
    encrypt: request.encrypt ?? false,
  }
}

function parseCronValue(token: string, min: number, max: number): Set<number> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('cron 字段不能为空')

  const values = new Set<number>()
  const parts = trimmed.split(',')

  for (const part of parts) {
    const segment = part.trim()
    if (!segment) continue

    const [rangePart, stepPart] = segment.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`无效的 cron 步长: ${segment}`)
    }

    const addValue = (value: number) => {
      if (value < min || value > max) {
        throw new Error(`cron 值超出范围: ${value}`)
      }
      values.add(value)
    }

    if (rangePart === '*') {
      for (let value = min; value <= max; value += step) addValue(value)
      continue
    }

    if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-')
      const start = Number(startRaw)
      const end = Number(endRaw)
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new Error(`无效的 cron 范围: ${segment}`)
      }
      for (let value = start; value <= end; value += step) addValue(value)
      continue
    }

    const value = Number(rangePart)
    if (!Number.isInteger(value)) {
      throw new Error(`无效的 cron 值: ${segment}`)
    }
    addValue(value)
  }

  return values
}

function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('cron 表达式必须是 5 段，例如 0 2 * * *')
  }

  return {
    minute: parseCronValue(parts[0], 0, 59),
    hour: parseCronValue(parts[1], 0, 23),
    dayOfMonth: parseCronValue(parts[2], 1, 31),
    dayOfMonthAny: parts[2] === '*',
    month: parseCronValue(parts[3], 1, 12),
    dayOfWeek: (() => {
      const set = parseCronValue(parts[4], 0, 7)
      if (set.has(7)) {
        set.delete(7)
        set.add(0)
      }
      return set
    })(),
    dayOfWeekAny: parts[4] === '*',
  }
}

function matchesCron(fields: CronFields, now: Date): boolean {
  const minuteMatch = fields.minute.has(now.getMinutes())
  const hourMatch = fields.hour.has(now.getHours())
  const monthMatch = fields.month.has(now.getMonth() + 1)
  const dayOfMonthMatch = fields.dayOfMonth.has(now.getDate())
  const dayOfWeekMatch = fields.dayOfWeek.has(now.getDay())

  let dayMatch = false
  if (fields.dayOfMonthAny && fields.dayOfWeekAny) {
    dayMatch = true
  } else if (fields.dayOfMonthAny) {
    dayMatch = dayOfWeekMatch
  } else if (fields.dayOfWeekAny) {
    dayMatch = dayOfMonthMatch
  } else {
    dayMatch = dayOfMonthMatch || dayOfWeekMatch
  }

  return minuteMatch && hourMatch && monthMatch && dayMatch
}

function getScheduleTriggerKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

async function ensureEmptyDatabase(connId: string, databaseName: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE ${quoteId(databaseName)}`)
    await conn.query('SET FOREIGN_KEY_CHECKS=0')

    const [eventRows] = await conn.query(
      'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?',
      [databaseName],
    )
    for (const event of rowsToNames(eventRows)) {
      await conn.query(`DROP EVENT IF EXISTS ${quoteId(event)}`)
    }

    const [triggerRows] = await conn.query(
      'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
      [databaseName],
    )
    for (const trigger of rowsToNames(triggerRows)) {
      await conn.query(`DROP TRIGGER IF EXISTS ${quoteId(trigger)}`)
    }

    const [viewRows] = await conn.query(
      'SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?',
      [databaseName],
    )
    for (const view of rowsToNames(viewRows)) {
      await conn.query(`DROP VIEW IF EXISTS ${quoteId(view)}`)
    }

    const [routineRows] = await conn.query(
      'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?',
      [databaseName],
    )
    for (const routine of routineRows as Array<Record<string, unknown>>) {
      const name = String(routine.name ?? '')
      const type = String(routine.type ?? '').toUpperCase()
      if (!name || (type !== 'PROCEDURE' && type !== 'FUNCTION')) continue
      await conn.query(`DROP ${type} IF EXISTS ${quoteId(name)}`)
    }

    const [tableRows] = await conn.query(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = "BASE TABLE"',
      [databaseName],
    )
    for (const table of rowsToNames(tableRows)) {
      await conn.query(`DROP TABLE IF EXISTS ${quoteId(table)}`)
    }
  } finally {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS=1')
    } catch {
      // ignore cleanup reset errors; the connection is about to be released
    }
    conn.release()
  }
}

function rowsToNames(rows: unknown): string[] {
  return (rows as Array<Record<string, unknown>>)
    .map((row) => String(row.name ?? Object.values(row)[0] ?? ''))
    .filter(Boolean)
}

async function ensureConnectionReady(connectionId: string): Promise<void> {
  try {
    connectionManager.getPool(connectionId)
    return
  } catch {
    const config = connectionManager.getConnectionConfig(connectionId)
    if (!config) {
      throw new Error(`连接配置不存在: ${connectionId}`)
    }
    const status = await connectionManager.connect(config)
    if (!status.connected) {
      throw new Error(status.error || '连接失败')
    }
  }
}

export async function createBackup(configOrRequest: BackupConfig | BackupCreateRequest): Promise<BackupRecord | BackupRecord[]> {
  const request = configOrRequest as BackupCreateRequest
  if (Array.isArray(request.databases) && request.databases.length > 0) {
    const records: BackupRecord[] = []
    for (const databaseName of request.databases) {
      const record = await createBackup(toBackupConfig(request, databaseName))
      records.push(record as BackupRecord)
    }
    return records
  }

  const config = 'databaseName' in request && request.databaseName
    ? toBackupConfig(request, request.databaseName)
    : configOrRequest as BackupConfig
  const record: BackupRecord = {
    id: config.id,
    connectionId: config.connectionId,
    databaseName: config.databaseName,
    backupType: config.backupType,
    filePath: config.filePath,
    fileSize: 0,
    isCompressed: config.compress,
    isEncrypted: Boolean(config.encrypt),
    status: 'running',
    createdAt: new Date().toISOString(),
  }

  localStore.backupRecords.save(record)

  try {
    await ensureConnectionReady(config.connectionId)
    await fs.promises.mkdir(path.dirname(config.filePath), { recursive: true })

    if (config.compress) {
      const out = fs.createWriteStream(config.filePath)
      const gzip = zlib.createGzip()
      gzip.pipe(out)
      let success = false
      try {
        await importExport.exportToSqlWritable(
          config.connectionId,
          config.databaseName,
          [],
          gzip,
          {
            dropTable: true,
            createTable: config.backupType !== 'data',
            includeData: config.backupType !== 'structure',
            insertStyle: 'single',
          },
        )
        await finished(out)
        success = true
      } finally {
        if (!success) {
          gzip.destroy()
          out.destroy()
        }
      }
    } else {
      await importExport.exportToSQL(
        config.connectionId,
        config.databaseName,
        [],
        config.filePath,
        {
          dropTable: true,
          createTable: config.backupType !== 'data',
          includeData: config.backupType !== 'structure',
          insertStyle: 'single',
        },
      )
    }

    const stat = await fs.promises.stat(config.filePath)
    record.fileSize = stat.size
    record.status = 'completed'
    localStore.backupRecords.save(record)
    logger.info(`[backup] completed: ${config.filePath}`)
    return record
  } catch (error) {
    record.status = 'failed'
    localStore.backupRecords.save(record)
    logger.error('[backup] create failed', error)
    throw error
  }
}

export async function restoreBackup(connId: string, filePath: string, options?: BackupRestoreOptions): Promise<void> {
  let content: string
  const raw = await fs.promises.readFile(filePath)
  if (filePath.endsWith('.gz')) {
    content = (await gunzip(raw)).toString('utf-8')
  } else {
    content = raw.toString('utf-8')
  }

  const targetDb = options?.createNew ? options.newDbName?.trim() : options?.targetDb?.trim()
  await ensureConnectionReady(connId)
  const conn = await connectionManager.getConnection(connId)
  try {
    if (targetDb) {
      if (options?.createNew) {
        await conn.query(`CREATE DATABASE IF NOT EXISTS ${quoteId(targetDb)}`)
      }
      await conn.query(`USE ${quoteId(targetDb)}`)
    }
  } finally {
    conn.release()
  }

  if (targetDb && options?.dropExisting) {
    await ensureEmptyDatabase(connId, targetDb)
  }

  await executeMultiStatementSql(connId, content, targetDb || undefined, { optimizeInserts: true, scriptMode: 'import' })
}

export async function listBackups(connId: string): Promise<BackupRecord[]> {
  return localStore.backupRecords.getByConnection(connId)
}

export async function handleScheduleRequest(request: BackupScheduleRequest): Promise<void | BackupSchedule[]> {
  switch (request.action) {
    case 'list':
      return localStore.backupSchedules.getByConnection(request.connectionId)
    case 'create': {
      const schedule = normalizeScheduleRequest(request, false)
      localStore.backupSchedules.save(schedule)
      restartScheduleRunner()
      return
    }
    case 'update': {
      const schedule = normalizeScheduleRequest(request, true)
      localStore.backupSchedules.save(schedule)
      restartScheduleRunner()
      return
    }
    case 'delete':
      if (!request.id) throw new Error('缺少定时备份 ID')
      localStore.backupSchedules.delete(request.id)
      runningScheduleIds.delete(request.id)
      lastTriggerKeyBySchedule.delete(request.id)
      restartScheduleRunner()
      return
    default:
      throw new Error(`不支持的定时备份操作: ${(request as BackupScheduleRequest).action}`)
  }
}

function normalizeScheduleRequest(request: BackupScheduleRequest, isUpdate: boolean): BackupSchedule {
  if (!request.connectionId) throw new Error('缺少连接 ID')
  if (!request.databaseName?.trim()) throw new Error('请选择数据库')
  if (!request.cronExpression?.trim()) throw new Error('cron 表达式不能为空')
  parseCronExpression(request.cronExpression)

  const existing = request.id ? localStore.backupSchedules.getByConnection(request.connectionId).find((item) => item.id === request.id) : undefined
  if (isUpdate && request.id && !existing) {
    throw new Error('定时备份不存在')
  }

  return {
    id: request.id || randomUUID(),
    connectionId: request.connectionId,
    databaseName: request.databaseName.trim(),
    cronExpression: request.cronExpression.trim(),
    backupType: request.backupType || existing?.backupType || 'full',
    compress: request.compress ?? existing?.compress ?? true,
    retentionDays: request.retentionDays ?? existing?.retentionDays ?? 30,
    isActive: request.isActive ?? existing?.isActive ?? true,
    lastRun: existing?.lastRun ?? null,
    createdAt: existing?.createdAt || new Date().toISOString(),
  }
}

async function executeSchedule(schedule: BackupSchedule): Promise<void> {
  if (runningScheduleIds.has(schedule.id)) return

  runningScheduleIds.add(schedule.id)
  try {
    const filePath = buildDefaultBackupFilePath(schedule.databaseName, schedule.backupType, schedule.compress)
    await createBackup({
      id: randomUUID(),
      connectionId: schedule.connectionId,
      databaseName: schedule.databaseName,
      backupType: schedule.backupType,
      filePath,
      compress: schedule.compress,
      encrypt: false,
    })

    const nowText = formatLastRun(new Date())
    localStore.backupSchedules.updateLastRun(schedule.id, nowText)
    pruneScheduleBackups(schedule)
      .catch((error) => logger.warn(`[backup] prune failed for schedule ${schedule.id}`, error))
  } catch (error) {
    logger.error(`[backup] schedule failed: ${schedule.id}`, error)
  } finally {
    runningScheduleIds.delete(schedule.id)
  }
}

async function pruneScheduleBackups(schedule: BackupSchedule): Promise<void> {
  if (!Number.isFinite(schedule.retentionDays) || schedule.retentionDays <= 0) return
  const cutoff = Date.now() - schedule.retentionDays * 24 * 60 * 60 * 1000
  const records = localStore.backupRecords
    .getByConnection(schedule.connectionId)
    .filter((item) => item.databaseName === schedule.databaseName)

  for (const record of records) {
    if (record.status !== 'completed') continue
    if (Date.parse(record.createdAt) >= cutoff) continue
    try {
      await fs.promises.unlink(record.filePath)
    } catch {
      // ignore missing files
    }
    localStore.backupRecords.delete(record.id)
  }
}

async function tickSchedules(): Promise<void> {
  const schedules = getAllSchedules().filter((item) => item.isActive)
  if (!schedules.length) return

  const now = new Date()
  const triggerKey = getScheduleTriggerKey(now)

  for (const schedule of schedules) {
    try {
      const cron = parseCronExpression(schedule.cronExpression)
      if (!matchesCron(cron, now)) continue
      if (lastTriggerKeyBySchedule.get(schedule.id) === triggerKey) continue
      lastTriggerKeyBySchedule.set(schedule.id, triggerKey)
      void executeSchedule(schedule)
    } catch (error) {
      logger.warn(`[backup] invalid schedule ${schedule.id}`, error)
    }
  }
}

function getAllSchedules(): BackupSchedule[] {
  return localStore.connections.getAll().flatMap((connection) => localStore.backupSchedules.getByConnection(connection.id))
}

function clearScheduleRunner(): void {
  if (!scheduleTimer) return
  clearInterval(scheduleTimer)
  scheduleTimer = null
}

function restartScheduleRunner(): void {
  clearScheduleRunner()
  startScheduleRunner()
}

export function startScheduleRunner(): void {
  if (scheduleTimer) return
  scheduleTimer = setInterval(() => {
    void tickSchedules()
  }, SCHEDULE_POLL_INTERVAL_MS)
  void tickSchedules()
}

export function stopScheduleRunner(): void {
  clearScheduleRunner()
}
