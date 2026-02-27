import * as fs from 'fs'
import { once } from 'events'
import { mkdir, readFile, writeFile } from 'fs/promises'
import * as path from 'path'
import { parse as parseStream } from 'csv-parse'
import { parse as parseSync } from 'csv-parse/sync'
import { stringify as stringifyStream } from 'csv-stringify'
import { stringify as stringifySync } from 'csv-stringify/sync'
import { finished } from 'stream/promises'
import * as XLSX from 'xlsx'
import * as connectionManager from './connection-manager'

type Primitive = string | number | boolean | bigint | null | undefined
type SqlValue = Primitive | Date | Buffer | Record<string, unknown> | unknown[]
type RowRecord = Record<string, SqlValue>

type ExportSqlOptions = {
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
}

const IMPORT_BATCH_SIZE = 500
const EXPORT_BATCH_SIZE = 1000

function formatExportTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function toSqlLiteral(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL'
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${formatExportTime(v)}'`

  const raw = (typeof v === 'object') ? JSON.stringify(v) : String(v)
  const s = raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u0000/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u0008/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\u001a/g, '\\Z')
  return `'${s}'`
}

function extractTableFromSelectSql(sql: string): string | null {
  const normalized = sql.trim().replace(/\s+/g, ' ')
  const match = normalized.match(/^SELECT\s+\*\s+FROM\s+`?([\w$]+)`?(?:\s+|;|$)/i)
  return match?.[1] || null
}

async function writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  if (!stream.write(chunk, 'utf-8')) {
    await once(stream, 'drain')
  }
}

async function closeStream(stream: fs.WriteStream): Promise<void> {
  stream.end()
  await finished(stream)
}

async function queryInBatches(
  connId: string,
  db: string,
  table: string,
  batchSize: number,
  onBatch: (rows: RowRecord[], offset: number) => Promise<void>
): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    let offset = 0
    while (true) {
      const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT ${batchSize} OFFSET ${offset}`)
      const batch = rows as RowRecord[]
      if (!batch.length) break
      await onBatch(batch, offset)
      offset += batch.length
      if (batch.length < batchSize) break
    }
  } finally {
    conn.release()
  }
}

export async function previewImport(filePath: string): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalRows: number }> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') {
    const content = await readFile(filePath, 'utf-8')
    const records = parseSync(content, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
    return { columns: records.length ? Object.keys(records[0]) : [], rows: records.slice(0, 100), totalRows: records.length }
  }
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows: rows.slice(0, 100), totalRows: rows.length }
}

async function insertRowsBatch(conn: any, table: string, rows: RowRecord[]): Promise<number> {
  if (!rows.length) return 0
  const cols = Object.keys(rows[0])
  const colStr = cols.map(c => `\`${c}\``).join(', ')
  const placeholder = `(${cols.map(() => '?').join(', ')})`
  const placeholders = rows.map(() => placeholder).join(', ')
  const values = rows.flatMap(r => cols.map(c => r[c] ?? null))
  await conn.query(`INSERT INTO \`${table}\` (${colStr}) VALUES ${placeholders}`, values)
  return rows.length
}

async function bulkInsert(connId: string, db: string, table: string, rows: RowRecord[]): Promise<number> {
  if (!rows.length) return 0
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    let imported = 0
    for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
      imported += await insertRowsBatch(conn, table, rows.slice(i, i + IMPORT_BATCH_SIZE))
    }
    return imported
  } finally {
    conn.release()
  }
}

export async function importCSV(connId: string, db: string, table: string, filePath: string, _options?: unknown): Promise<{ imported: number }> {
  const conn = await connectionManager.getConnection(connId)
  const input = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const parser = parseStream({ columns: true, skip_empty_lines: true, bom: true })

  input.pipe(parser)

  try {
    await conn.query(`USE \`${db}\``)

    let imported = 0
    let batch: RowRecord[] = []

    for await (const row of parser as AsyncIterable<RowRecord>) {
      batch.push(row)
      if (batch.length >= IMPORT_BATCH_SIZE) {
        imported += await insertRowsBatch(conn, table, batch)
        batch = []
      }
    }

    if (batch.length > 0) {
      imported += await insertRowsBatch(conn, table, batch)
    }

    return { imported }
  } finally {
    input.destroy()
    conn.release()
  }
}

export async function importExcel(connId: string, db: string, table: string, filePath: string, _options?: unknown): Promise<{ imported: number }> {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<RowRecord>(sheet)
  const imported = await bulkInsert(connId, db, table, rows)
  return { imported }
}

export async function exportToCSV(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)

  if (table) {
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })
    const csv = stringifyStream({ header: true })
    csv.pipe(out)

    try {
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        for (const row of rows) {
          if (!csv.write(row)) {
            await once(csv, 'drain')
          }
        }
      })
      csv.end()
      await finished(out)
    } catch (e) {
      csv.destroy()
      out.destroy()
      throw e
    }
    return
  }

  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    const [rows] = await conn.query(sql)
    const csv = stringifySync(rows as RowRecord[], { header: true })
    await writeFile(filePath, csv, 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToJSON(connId: string, db: string, sql: string, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const table = extractTableFromSelectSql(sql)

  if (table) {
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })
    try {
      await writeChunk(out, '[\n')
      let isFirst = true
      await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
        for (const row of rows) {
          const line = `${isFirst ? '' : ',\n'}${JSON.stringify(row)}`
          await writeChunk(out, line)
          isFirst = false
        }
      })
      await writeChunk(out, '\n]\n')
      await closeStream(out)
    } catch (e) {
      out.destroy()
      throw e
    }
    return
  }

  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    const [rows] = await conn.query(sql)
    await writeFile(filePath, JSON.stringify(rows, null, 2), 'utf-8')
  } finally {
    conn.release()
  }
}

export async function exportToSQL(connId: string, db: string, tables: string[], filePath: string, options?: ExportSqlOptions): Promise<void> {
  const conn = await connectionManager.getConnection(connId)

  try {
    await conn.query(`USE \`${db}\``)
    await mkdir(path.dirname(filePath), { recursive: true })
    const out = fs.createWriteStream(filePath, { encoding: 'utf-8' })

    try {
      await writeChunk(out, 'SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n')

      const dropTable = options?.dropTable !== false
      const createTable = options?.createTable !== false
      const includeData = options?.includeData !== false
      const insertStyle: 'single' | 'multi' | 'ignore' | 'replace' = options?.insertStyle || 'single'

      const insertHead = insertStyle === 'ignore'
        ? 'INSERT IGNORE INTO'
        : insertStyle === 'replace'
          ? 'REPLACE INTO'
          : 'INSERT INTO'

      for (const table of tables) {
        if (createTable) {
          const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
          const ddl = (ddlRows as Record<string, string>[])[0]?.['Create Table']
          if (ddl) {
            let ddlBlock = `-- ----------------------------\n-- Table structure for \`${table}\`\n-- ----------------------------\n`
            if (dropTable) ddlBlock += `DROP TABLE IF EXISTS \`${table}\`;\n`
            ddlBlock += `${ddl};\n\n`
            await writeChunk(out, ddlBlock)
          }
        }

        if (!includeData) continue

        let wroteHeader = false
        await queryInBatches(connId, db, table, EXPORT_BATCH_SIZE, async (rows) => {
          if (!rows.length) return

          const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ')

          if (!wroteHeader) {
            const header = `-- ----------------------------\n-- Records of \`${table}\`\n-- ----------------------------\n`
            await writeChunk(out, header)
            wroteHeader = true
          }

          if (insertStyle === 'multi') {
            await writeChunk(out, `${insertHead} \`${table}\` (${cols}) VALUES\n`)
            for (let i = 0; i < rows.length; i += 1) {
              const row = rows[i]
              const prefix = i === 0 ? '' : ',\n'
              const values = Object.values(row).map(v => toSqlLiteral(v)).join(', ')
              await writeChunk(out, `${prefix}(${values})`)
            }
            await writeChunk(out, ';\n')
            return
          }

          for (const row of rows) {
            const vals = Object.values(row).map(v => toSqlLiteral(v)).join(', ')
            await writeChunk(out, `${insertHead} \`${table}\` (${cols}) VALUES (${vals});\n`)
          }
        })

        if (wroteHeader) {
          await writeChunk(out, '\n')
        }
      }

      await writeChunk(out, 'SET FOREIGN_KEY_CHECKS = 1;\n')
      await closeStream(out)
    } catch (e) {
      out.destroy()
      throw e
    }
  } finally {
    conn.release()
  }
}

export async function exportStructure(connId: string, db: string, tables: string[], filePath: string): Promise<void> {
  const conn = await connectionManager.getConnection(connId)
  try {
    await conn.query(`USE \`${db}\``)
    await mkdir(path.dirname(filePath), { recursive: true })

    let sql = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n`

    for (const table of tables) {
      const [ddlRows] = await conn.query(`SHOW CREATE TABLE \`${table}\``)
      const ddl = (ddlRows as Record<string, string>[])[0]?.['Create Table'] || (ddlRows as Record<string, string>[])[0]?.['Create View']
      if (!ddl) continue
      sql += `-- ----------------------------\n-- Table structure for \`${table}\`\n-- ----------------------------\n`
      sql += `DROP TABLE IF EXISTS \`${table}\`;\n${ddl};\n\n`
    }

    sql += 'SET FOREIGN_KEY_CHECKS = 1;\n'
    await writeFile(filePath, sql, 'utf-8')
  } finally {
    conn.release()
  }
}
