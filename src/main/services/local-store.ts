import Database from 'better-sqlite3'
import { app } from 'electron'
import * as path from 'path'
import * as logger from '../utils/logger'
import { encryptPassword, decryptPassword } from '../utils/crypto'
import type { ConnectionConfig, ConnectionSavePayload } from '../../shared/types/connection'
import type { QueryHistoryItem, Snippet } from '../../shared/types/query'
import type { BackupRecord, BackupSchedule } from '../../shared/types/table-design'

let db: Database.Database

export function init() {
  const dbPath = path.join(app.getPath('userData'), 'mysql-tool.db')
  logger.info(`Initializing local store at ${dbPath}`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  createTables()
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      groupName TEXT DEFAULT '',
      color TEXT DEFAULT '',
      host TEXT NOT NULL,
      port INTEGER DEFAULT 3306,
      user TEXT NOT NULL,
      password TEXT DEFAULT '',
      databaseName TEXT DEFAULT '',
      charset TEXT DEFAULT 'utf8mb4',
      timezone TEXT DEFAULT '+00:00',
      poolMin INTEGER DEFAULT 1,
      poolMax INTEGER DEFAULT 10,
      connectTimeout INTEGER DEFAULT 10000,
      idleTimeout INTEGER DEFAULT 60000,
      sslEnabled INTEGER DEFAULT 0,
      sslCa TEXT DEFAULT '',
      sslCert TEXT DEFAULT '',
      sslKey TEXT DEFAULT '',
      sslMode TEXT DEFAULT 'DISABLED',
      sshEnabled INTEGER DEFAULT 0,
      sshHost TEXT DEFAULT '',
      sshPort INTEGER DEFAULT 22,
      sshUser TEXT DEFAULT '',
      sshPassword TEXT DEFAULT '',
      sshPrivateKey TEXT DEFAULT '',
      sshPassphrase TEXT DEFAULT '',
      sortOrder INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId TEXT NOT NULL,
      databaseName TEXT DEFAULT '',
      sqlText TEXT NOT NULL,
      executionTimeMs INTEGER DEFAULT 0,
      rowCount INTEGER DEFAULT 0,
      isSuccess INTEGER DEFAULT 1,
      errorMessage TEXT DEFAULT '',
      isSlow INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      sqlText TEXT NOT NULL,
      description TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      connectionId TEXT NOT NULL,
      databaseName TEXT DEFAULT '',
      backupType TEXT DEFAULT 'full',
      filePath TEXT NOT NULL,
      fileSize INTEGER DEFAULT 0,
      isCompressed INTEGER DEFAULT 0,
      isEncrypted INTEGER DEFAULT 0,
      status TEXT DEFAULT 'running',
      createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS backup_schedules (
      id TEXT PRIMARY KEY,
      connectionId TEXT NOT NULL,
      databaseName TEXT DEFAULT '',
      cronExpression TEXT NOT NULL,
      backupType TEXT DEFAULT 'full',
      compress INTEGER DEFAULT 0,
      retentionDays INTEGER DEFAULT 30,
      isActive INTEGER DEFAULT 1,
      lastRun TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `)
}

function boolToInt(v: boolean): number { return v ? 1 : 0 }
function intToBool(v: number): boolean { return v === 1 }

function rowToConnection(row: any): ConnectionConfig {
  return {
    ...row,
    password: decryptPassword(row.password),
    sshPassword: decryptPassword(row.sshPassword),
    sshPassphrase: decryptPassword(row.sshPassphrase),
    sslEnabled: intToBool(row.sslEnabled),
    sshEnabled: intToBool(row.sshEnabled),
  }
}

export const connections = {
  getAll(): ConnectionConfig[] {
    return db.prepare('SELECT * FROM connections ORDER BY sortOrder, name').all().map(rowToConnection)
  },
  getById(id: string): ConnectionConfig | undefined {
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as any
    return row ? rowToConnection(row) : undefined
  },
  save(conn: ConnectionSavePayload) {
    const now = new Date().toISOString()
    const stmt = db.prepare(`
      INSERT INTO connections (id,name,groupName,color,host,port,user,password,databaseName,charset,timezone,poolMin,poolMax,connectTimeout,idleTimeout,sslEnabled,sslCa,sslCert,sslKey,sslMode,sshEnabled,sshHost,sshPort,sshUser,sshPassword,sshPrivateKey,sshPassphrase,sortOrder,createdAt,updatedAt)
      VALUES (@id,@name,@groupName,@color,@host,@port,@user,@password,@databaseName,@charset,@timezone,@poolMin,@poolMax,@connectTimeout,@idleTimeout,@sslEnabled,@sslCa,@sslCert,@sslKey,@sslMode,@sshEnabled,@sshHost,@sshPort,@sshUser,@sshPassword,@sshPrivateKey,@sshPassphrase,@sortOrder,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=@name,groupName=@groupName,color=@color,host=@host,port=@port,user=@user,password=@password,databaseName=@databaseName,charset=@charset,timezone=@timezone,poolMin=@poolMin,poolMax=@poolMax,connectTimeout=@connectTimeout,idleTimeout=@idleTimeout,sslEnabled=@sslEnabled,sslCa=@sslCa,sslCert=@sslCert,sslKey=@sslKey,sslMode=@sslMode,sshEnabled=@sshEnabled,sshHost=@sshHost,sshPort=@sshPort,sshUser=@sshUser,sshPassword=@sshPassword,sshPrivateKey=@sshPrivateKey,sshPassphrase=@sshPassphrase,sortOrder=@sortOrder,updatedAt=@updatedAt
    `)
    stmt.run({
      ...conn,
      password: encryptPassword(conn.password),
      sshPassword: encryptPassword(conn.sshPassword),
      sshPassphrase: encryptPassword(conn.sshPassphrase),
      sslEnabled: boolToInt(conn.sslEnabled),
      sshEnabled: boolToInt(conn.sshEnabled),
      createdAt: now,
      updatedAt: now,
    })
  },
  delete(id: string) {
    db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  },
}

export const queryHistory = {
  getByConnection(connectionId: string, limit = 100): QueryHistoryItem[] {
    return db.prepare('SELECT * FROM query_history WHERE connectionId = ? ORDER BY id DESC LIMIT ?')
      .all(connectionId, limit)
      .map((r: any) => ({ ...r, isSuccess: intToBool(r.isSuccess), isSlow: intToBool(r.isSlow) }))
  },
  save(item: Omit<QueryHistoryItem, 'id'>) {
    db.prepare(`INSERT INTO query_history (connectionId,databaseName,sqlText,executionTimeMs,rowCount,isSuccess,errorMessage,isSlow,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(item.connectionId, item.databaseName, item.sqlText, item.executionTimeMs, item.rowCount, boolToInt(item.isSuccess), item.errorMessage, boolToInt(item.isSlow), item.createdAt || new Date().toISOString())
  },
  clearByConnection(connectionId: string) {
    db.prepare('DELETE FROM query_history WHERE connectionId = ?').run(connectionId)
  },
}

export const snippets = {
  getAll(): Snippet[] {
    return db.prepare('SELECT * FROM snippets ORDER BY name').all() as Snippet[]
  },
  save(s: Snippet) {
    db.prepare(`INSERT INTO snippets (id,name,category,sqlText,description,createdAt) VALUES (@id,@name,@category,@sqlText,@description,@createdAt) ON CONFLICT(id) DO UPDATE SET name=@name,category=@category,sqlText=@sqlText,description=@description`)
      .run({ ...s, createdAt: s.createdAt || new Date().toISOString() })
  },
  delete(id: string) {
    db.prepare('DELETE FROM snippets WHERE id = ?').run(id)
  },
}

export const settings = {
  get(key: string): string | null {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row ? row.value : null
  },
  set(key: string, value: string) {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?').run(key, value, value)
  },
}

export const backupRecords = {
  getByConnection(connectionId: string): BackupRecord[] {
    return db.prepare('SELECT * FROM backup_records WHERE connectionId = ? ORDER BY createdAt DESC')
      .all(connectionId)
      .map((r: any) => ({ ...r, isCompressed: intToBool(r.isCompressed), isEncrypted: intToBool(r.isEncrypted) }))
  },
  save(r: BackupRecord) {
    db.prepare(`INSERT INTO backup_records (id,connectionId,databaseName,backupType,filePath,fileSize,isCompressed,isEncrypted,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fileSize=?,status=?`)
      .run(r.id, r.connectionId, r.databaseName, r.backupType, r.filePath, r.fileSize, boolToInt(r.isCompressed), boolToInt(r.isEncrypted), r.status, r.createdAt, r.fileSize, r.status)
  },
  delete(id: string) {
    db.prepare('DELETE FROM backup_records WHERE id = ?').run(id)
  },
}

export const backupSchedules = {
  getByConnection(connectionId: string): BackupSchedule[] {
    return db.prepare('SELECT * FROM backup_schedules WHERE connectionId = ? ORDER BY createdAt DESC')
      .all(connectionId)
      .map((r: any) => ({ ...r, compress: intToBool(r.compress), isActive: intToBool(r.isActive) }))
  },
  save(s: BackupSchedule) {
    db.prepare(`INSERT INTO backup_schedules (id,connectionId,databaseName,cronExpression,backupType,compress,retentionDays,isActive,lastRun,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cronExpression=?,backupType=?,compress=?,retentionDays=?,isActive=?,lastRun=?`)
      .run(s.id, s.connectionId, s.databaseName, s.cronExpression, s.backupType, boolToInt(s.compress), s.retentionDays, boolToInt(s.isActive), s.lastRun, s.createdAt || new Date().toISOString(), s.cronExpression, s.backupType, boolToInt(s.compress), s.retentionDays, boolToInt(s.isActive), s.lastRun)
  },
  delete(id: string) {
    db.prepare('DELETE FROM backup_schedules WHERE id = ?').run(id)
  },
  updateLastRun(id: string, lastRun: string) {
    db.prepare('UPDATE backup_schedules SET lastRun = ? WHERE id = ?').run(lastRun, id)
  },
}
