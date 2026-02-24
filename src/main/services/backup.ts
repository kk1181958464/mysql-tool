import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { promisify } from 'util'
import * as connectionManager from './connection-manager'
import * as metadata from './metadata'
import * as localStore from './local-store'
import * as logger from '../utils/logger'
import type { BackupConfig, BackupRecord } from '../../shared/types/table-design'

const gzip = promisify(zlib.gzip)

export async function createBackup(config: BackupConfig): Promise<BackupRecord> {
  const record: BackupRecord = {
    id: config.id,
    connectionId: config.connectionId,
    databaseName: config.databaseName,
    backupType: config.backupType,
    filePath: config.filePath,
    fileSize: 0,
    isCompressed: config.compress,
    isEncrypted: false,
    status: 'running',
    createdAt: new Date().toISOString(),
  }
  localStore.backupRecords.save(record)

  try {
    const conn = await connectionManager.getConnection(config.connectionId)
    let sql = ''
    try {
      await conn.query(`USE \`${config.databaseName}\``)
      const [tableRows] = await conn.query(`SHOW TABLES FROM \`${config.databaseName}\``)
      const tables = (tableRows as any[]).map(r => Object.values(r)[0] as string)

      sql += `-- Backup of ${config.databaseName}\n-- Date: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`

      for (const table of tables) {
        if (config.backupType !== 'data') {
          const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${config.databaseName}\`.\`${table}\``)
          const ddl = (ddlRows as any[])[0]?.['Create Table']
          if (ddl) sql += `DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`
        }
        if (config.backupType !== 'structure') {
          const [rows] = await conn.query(`SELECT * FROM \`${config.databaseName}\`.\`${table}\``)
          const dataRows = rows as any[]
          if (dataRows.length) {
            const cols = Object.keys(dataRows[0]).map(c => `\`${c}\``).join(', ')
            for (let i = 0; i < dataRows.length; i += 1000) {
              const batch = dataRows.slice(i, i + 1000)
              const values = batch.map(r => {
                const vals = Object.values(r).map(v => {
                  if (v === null) return 'NULL'
                  if (typeof v === 'number') return String(v)
                  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`
                  return `'${String(v).replace(/'/g, "\\'").replace(/\\/g, '\\\\')}'`
                })
                return `(${vals.join(', ')})`
              }).join(',\n')
              sql += `INSERT INTO \`${table}\` (${cols}) VALUES\n${values};\n\n`
            }
          }
        }
      }
      sql += 'SET FOREIGN_KEY_CHECKS=1;\n'
    } finally {
      conn.release()
    }

    let data: Buffer | string = sql
    if (config.compress) {
      data = await gzip(Buffer.from(sql, 'utf-8'))
    }
    fs.mkdirSync(path.dirname(config.filePath), { recursive: true })
    fs.writeFileSync(config.filePath, data)

    record.fileSize = fs.statSync(config.filePath).size
    record.status = 'completed'
    localStore.backupRecords.save(record)
    logger.info(`Backup completed: ${config.filePath}`)
    return record
  } catch (err: any) {
    record.status = 'failed'
    localStore.backupRecords.save(record)
    throw err
  }
}

export async function restoreBackup(connId: string, filePath: string): Promise<void> {
  let content: string
  const raw = fs.readFileSync(filePath)
  if (filePath.endsWith('.gz')) {
    const gunzip = promisify(zlib.gunzip)
    content = (await gunzip(raw)).toString('utf-8')
  } else {
    content = raw.toString('utf-8')
  }

  const conn = await connectionManager.getConnection(connId)
  try {
    const statements = content.split(/;\s*\n/).filter(s => s.trim())
    for (const stmt of statements) {
      if (stmt.trim()) await conn.query(stmt)
    }
    logger.info(`Restore completed from ${filePath}`)
  } finally {
    conn.release()
  }
}

export async function listBackups(connId: string): Promise<BackupRecord[]> {
  return localStore.backupRecords.getByConnection(connId)
}
