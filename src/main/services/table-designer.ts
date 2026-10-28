import type { TableDesign, TableDiff, ColumnDesign, IndexDesign, ForeignKeyDesign } from '../../shared/types/table-design'
import { isTextualColumnType, parseColumnType, quoteSqlLiteral } from '../../shared/column-type'
import { quoteId } from '../utils/sql'

const LENGTH_TYPES = new Set([
  'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'BIT',
  'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC',
  'DATETIME', 'TIMESTAMP', 'TIME',
])

const SCALE_TYPES = new Set(['DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'])
const LIST_TYPES = new Set(['ENUM', 'SET'])

function typeSql(c: ColumnDesign): string {
  const type = c.type.toUpperCase()
  const length = c.length.trim()
  const decimals = c.decimals.trim()
  if (c.columnType) {
    const original = parseColumnType(c.columnType)
    if (original.type === type && original.length === length && original.decimals === decimals
      && original.unsigned === c.unsigned && original.zerofill === c.zerofill) {
      return c.columnType
    }
  }
  let s = type
  if (LIST_TYPES.has(type)) {
    s += `(${length})`
  } else if (length && LENGTH_TYPES.has(type)) {
    s += `(${length}${decimals && SCALE_TYPES.has(type) ? `,${decimals}` : ''})`
  }
  if (c.unsigned) s += ' UNSIGNED'
  if (c.zerofill) s += ' ZEROFILL'
  return s
}

function colDef(c: ColumnDesign): string {
  let s = `${quoteId(c.name)} ${typeSql(c)}`
  if (c.collation && isTextualColumnType(c.type)) s += ` COLLATE ${c.collation}`
  s += c.nullable ? ' NULL' : ' NOT NULL'
  if (c.autoIncrement) s += ' AUTO_INCREMENT'
  else if (c.defaultValue !== '') s += ` DEFAULT ${c.defaultValue}`
  if (c.onUpdateCurrentTimestamp) s += ' ON UPDATE CURRENT_TIMESTAMP'
  if (c.comment) s += ` COMMENT ${quoteSqlLiteral(c.comment)}`
  return s
}

function indexDef(idx: IndexDesign): string {
  const cols = idx.columns.map(c => `${quoteId(c.name)}${c.length ? `(${c.length})` : ''} ${c.order}`).join(', ')
  let s = ''
  if (idx.type === 'UNIQUE') s = `UNIQUE INDEX ${quoteId(idx.name)}`
  else if (idx.type === 'FULLTEXT') s = `FULLTEXT INDEX ${quoteId(idx.name)}`
  else if (idx.type === 'SPATIAL') s = `SPATIAL INDEX ${quoteId(idx.name)}`
  else s = `INDEX ${quoteId(idx.name)}`
  s += ` (${cols})`
  if (idx.method && idx.type !== 'FULLTEXT' && idx.type !== 'SPATIAL') s += ` USING ${idx.method}`
  if (idx.comment) s += ` COMMENT ${quoteSqlLiteral(idx.comment)}`
  return s
}

function fkDef(fk: ForeignKeyDesign): string {
  const cols = fk.columns.map(c => quoteId(c)).join(', ')
  const refCols = fk.referencedColumns.map(c => quoteId(c)).join(', ')
  return `CONSTRAINT ${quoteId(fk.name)} FOREIGN KEY (${cols}) REFERENCES ${quoteId(fk.referencedTable)} (${refCols}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`
}

export function generateCreateTableSQL(design: TableDesign): string {
  const parts: string[] = []
  for (const c of design.columns) parts.push('  ' + colDef(c))
  const pks = design.columns.filter(c => c.primaryKey).map(c => quoteId(c.name))
  if (pks.length) parts.push(`  PRIMARY KEY (${pks.join(', ')})`)
  for (const idx of design.indexes) parts.push('  ' + indexDef(idx))
  for (const fk of design.foreignKeys) parts.push('  ' + fkDef(fk))

  let sql = `CREATE TABLE ${quoteId(design.name)} (\n${parts.join(',\n')}\n)`
  if (design.engine) sql += ` ENGINE=${design.engine}`
  if (design.charset) sql += ` DEFAULT CHARSET=${design.charset}`
  if (design.collation) sql += ` COLLATE=${design.collation}`
  if (design.comment) sql += ` COMMENT=${quoteSqlLiteral(design.comment)}`
  return sql + ';'
}

function positionClause(name: string, design: TableDesign): string {
  const index = design.columns.findIndex(c => c.name === name)
  if (index === 0) return ' FIRST'
  if (index > 0) return ` AFTER ${quoteId(design.columns[index - 1].name)}`
  return ''
}

export function generateAlterTableSQL(tableName: string, diff: TableDiff, newDesign: TableDesign): string {
  if (!diff) return ''
  const stmts: string[] = []
  const pk = diff.primaryKey
  for (const fk of diff.dropForeignKeys || []) stmts.push(`DROP FOREIGN KEY ${quoteId(fk)}`)
  for (const idx of diff.dropIndexes || []) stmts.push(`DROP INDEX ${quoteId(idx)}`)
  if (pk?.dropExisting) stmts.push('DROP PRIMARY KEY')
  for (const col of diff.dropColumns || []) stmts.push(`DROP COLUMN ${quoteId(col)}`)
  for (const m of diff.modifyColumns || []) {
    stmts.push(`CHANGE COLUMN ${quoteId(m.old)} ${colDef(m.new)}${m.moved ? positionClause(m.new.name, newDesign) : ''}`)
  }
  for (const col of diff.addColumns || []) stmts.push(`ADD COLUMN ${colDef(col)}${positionClause(col.name, newDesign)}`)
  if (pk?.columns.length) stmts.push(`ADD PRIMARY KEY (${pk.columns.map(c => quoteId(c)).join(', ')})`)
  for (const idx of diff.addIndexes || []) stmts.push(`ADD ${indexDef(idx)}`)
  for (const fk of diff.addForeignKeys || []) stmts.push(`ADD ${fkDef(fk)}`)
  const opts = diff.changeOptions || {}
  if (opts.engine) stmts.push(`ENGINE=${opts.engine}`)
  if (opts.charset) stmts.push(`DEFAULT CHARSET=${opts.charset}`)
  if (opts.collation) stmts.push(`COLLATE=${opts.collation}`)
  if (opts.comment !== undefined) stmts.push(`COMMENT=${quoteSqlLiteral(opts.comment)}`)
  if (newDesign.name !== tableName) stmts.push(`RENAME TO ${quoteId(newDesign.name)}`)
  if (!stmts.length) return ''
  return `ALTER TABLE ${quoteId(tableName)}\n  ${stmts.join(',\n  ')};`
}

export function generateDropTableSQL(db: string, table: string): string {
  return `DROP TABLE ${quoteId(db)}.${quoteId(table)};`
}

const columnKey = (c: ColumnDesign) => c.originalName || c.name

function definitionOf(c: ColumnDesign): string {
  const { originalName: _originalName, primaryKey: _primaryKey, unique: _unique, ...rest } = c
  return JSON.stringify(rest)
}

function sameContent<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function diffTables(oldDesign: TableDesign, newDesign: TableDesign): TableDiff {
  const diff: TableDiff = { addColumns: [], modifyColumns: [], dropColumns: [], addIndexes: [], dropIndexes: [], addForeignKeys: [], dropForeignKeys: [], changeOptions: {} }
  const oldByName = new Map(oldDesign.columns.map(c => [c.name, c]))
  const keptKeys = new Set(newDesign.columns.map(columnKey).filter(key => oldByName.has(key)))

  for (const col of oldDesign.columns) {
    if (!keptKeys.has(col.name)) diff.dropColumns.push(col.name)
  }

  const oldOrder = oldDesign.columns.map(c => c.name).filter(name => keptKeys.has(name))
  const newOrder = newDesign.columns.map(columnKey).filter(key => keptKeys.has(key))
  const predecessor = (order: string[], key: string) => order[order.indexOf(key) - 1] ?? null

  for (const col of newDesign.columns) {
    const key = columnKey(col)
    const oldCol = oldByName.get(key)
    if (!oldCol || !keptKeys.has(key)) {
      diff.addColumns.push(col)
      continue
    }
    const moved = predecessor(oldOrder, key) !== predecessor(newOrder, key)
    if (moved || oldCol.name !== col.name || definitionOf({ ...oldCol, originalName: undefined }) !== definitionOf(col)) {
      diff.modifyColumns.push({ old: oldCol.name, new: col, moved })
    }
  }

  const oldPk = oldDesign.columns.filter(c => c.primaryKey).map(columnKey)
  const newPk = newDesign.columns.filter(c => c.primaryKey).map(columnKey)
  if (!sameContent(oldPk, newPk)) {
    diff.primaryKey = { dropExisting: oldPk.length > 0, columns: newDesign.columns.filter(c => c.primaryKey).map(c => c.name) }
  }

  const oldIdx = new Map(oldDesign.indexes.map(i => [i.name, i]))
  const newIdx = new Map(newDesign.indexes.map(i => [i.name, i]))
  for (const [name, idx] of oldIdx) {
    const next = newIdx.get(name)
    if (!next || !sameContent(idx, next)) diff.dropIndexes.push(name)
  }
  for (const [name, idx] of newIdx) {
    const prev = oldIdx.get(name)
    if (!prev || !sameContent(prev, idx)) diff.addIndexes.push(idx)
  }

  const oldFk = new Map(oldDesign.foreignKeys.map(f => [f.name, f]))
  const newFk = new Map(newDesign.foreignKeys.map(f => [f.name, f]))
  for (const [name, fk] of oldFk) {
    const next = newFk.get(name)
    if (!next || !sameContent(fk, next)) diff.dropForeignKeys.push(name)
  }
  for (const [name, fk] of newFk) {
    const prev = oldFk.get(name)
    if (!prev || !sameContent(prev, fk)) diff.addForeignKeys.push(fk)
  }

  if (oldDesign.engine !== newDesign.engine) diff.changeOptions.engine = newDesign.engine
  if (oldDesign.charset !== newDesign.charset) diff.changeOptions.charset = newDesign.charset
  if (oldDesign.collation !== newDesign.collation) diff.changeOptions.collation = newDesign.collation
  if (oldDesign.comment !== newDesign.comment) diff.changeOptions.comment = newDesign.comment

  return diff
}
