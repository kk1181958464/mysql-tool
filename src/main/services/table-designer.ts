import type { TableDesign, TableDiff, ColumnDesign, IndexDesign, ForeignKeyDesign } from '../../shared/types/table-design'
import { quoteId } from '../utils/sql'

function colDef(c: ColumnDesign): string {
  let s = `${quoteId(c.name)} ${c.type}`
  if (c.length) s += `(${c.length}${c.decimals ? `,${c.decimals}` : ''})`
  if (c.unsigned) s += ' UNSIGNED'
  if (c.zerofill) s += ' ZEROFILL'
  s += c.nullable ? ' NULL' : ' NOT NULL'
  if (c.autoIncrement) s += ' AUTO_INCREMENT'
  else if (c.defaultValue !== '') s += ` DEFAULT ${c.defaultValue}`
  if (c.onUpdateCurrentTimestamp) s += ' ON UPDATE CURRENT_TIMESTAMP'
  if (c.comment) s += ` COMMENT '${c.comment.replace(/'/g, "\\'")}'`
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
  if (idx.method) s += ` USING ${idx.method}`
  if (idx.comment) s += ` COMMENT '${idx.comment.replace(/'/g, "\\'")}'`
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
  if (design.comment) sql += ` COMMENT='${design.comment.replace(/'/g, "\\'")}'`
  return sql + ';'
}

export function generateAlterTableSQL(tableName: string, diff: TableDiff, newDesign: TableDesign): string {
  const stmts: string[] = []
  // 兼容处理：如果 diff 结构不完整，返回空
  if (!diff) return ''
  if (diff.dropColumns) {
    for (const col of diff.dropColumns) stmts.push(`DROP COLUMN ${quoteId(col)}`)
  }
  if (diff.addColumns) {
    for (const col of diff.addColumns) {
      const colIndex = newDesign.columns.findIndex(c => c.name === col.name)
      if (colIndex === 0) {
        stmts.push(`ADD COLUMN ${colDef(col)} FIRST`)
      } else if (colIndex > 0) {
        const prevCol = newDesign.columns[colIndex - 1]
        stmts.push(`ADD COLUMN ${colDef(col)} AFTER ${quoteId(prevCol.name)}`)
      } else {
        stmts.push(`ADD COLUMN ${colDef(col)}`)
      }
    }
  }
  if (diff.modifyColumns) {
    for (const m of diff.modifyColumns) {
      const colIndex = newDesign.columns.findIndex(c => c.name === m.new.name)
      if (colIndex === 0) {
        stmts.push(`CHANGE COLUMN ${quoteId(m.old)} ${colDef(m.new)} FIRST`)
      } else if (colIndex > 0) {
        const prevCol = newDesign.columns[colIndex - 1]
        stmts.push(`CHANGE COLUMN ${quoteId(m.old)} ${colDef(m.new)} AFTER ${quoteId(prevCol.name)}`)
      } else {
        stmts.push(`CHANGE COLUMN ${quoteId(m.old)} ${colDef(m.new)}`)
      }
    }
  }
  for (const idx of diff.dropIndexes || []) stmts.push(`DROP INDEX ${quoteId(idx)}`)
  for (const idx of diff.addIndexes || []) stmts.push(`ADD ${indexDef(idx)}`)
  for (const fk of diff.dropForeignKeys || []) stmts.push(`DROP FOREIGN KEY ${quoteId(fk)}`)
  for (const fk of diff.addForeignKeys || []) stmts.push(`ADD ${fkDef(fk)}`)
  const opts = diff.changeOptions
  if (opts?.engine) stmts.push(`ENGINE=${opts.engine}`)
  if (opts?.charset) stmts.push(`DEFAULT CHARSET=${opts.charset}`)
  if (opts?.collation) stmts.push(`COLLATE=${opts.collation}`)
  if (opts?.comment) stmts.push(`COMMENT='${opts.comment.replace(/'/g, "\\'")}'`)
  if (!stmts.length) return ''
  return `ALTER TABLE ${quoteId(tableName)}\n  ${stmts.join(',\n  ')};`
}

export function generateDropTableSQL(db: string, table: string): string {
  return `DROP TABLE ${quoteId(db)}.${quoteId(table)};`
}

export function diffTables(oldDesign: TableDesign, newDesign: TableDesign): TableDiff {
  const diff: TableDiff = { addColumns: [], modifyColumns: [], dropColumns: [], addIndexes: [], dropIndexes: [], addForeignKeys: [], dropForeignKeys: [], changeOptions: {} }
  const oldColMap = new Map(oldDesign.columns.map(c => [c.name, c]))
  const newColMap = new Map(newDesign.columns.map(c => [c.name, c]))

  for (const [name] of oldColMap) {
    if (!newColMap.has(name)) diff.dropColumns.push(name)
  }
  for (const [name, col] of newColMap) {
    if (!oldColMap.has(name)) diff.addColumns.push(col)
    else {
      const oldCol = oldColMap.get(name)
      if (JSON.stringify(oldCol) !== JSON.stringify(col)) {
        diff.modifyColumns.push({ old: name, new: col })
      } else {
        // 检查字段顺序是否变化
        const oldIndex = oldDesign.columns.findIndex(c => c.name === name)
        const newIndex = newDesign.columns.findIndex(c => c.name === name)
        if (oldIndex !== newIndex) {
          diff.modifyColumns.push({ old: name, new: col })
        }
      }
    }
  }

  const oldIdxNames = new Set(oldDesign.indexes.map(i => i.name))
  const newIdxNames = new Set(newDesign.indexes.map(i => i.name))
  for (const name of oldIdxNames) { if (!newIdxNames.has(name)) diff.dropIndexes.push(name) }
  for (const idx of newDesign.indexes) { if (!oldIdxNames.has(idx.name)) diff.addIndexes.push(idx) }

  const oldFkNames = new Set(oldDesign.foreignKeys.map(f => f.name))
  const newFkNames = new Set(newDesign.foreignKeys.map(f => f.name))
  for (const name of oldFkNames) { if (!newFkNames.has(name)) diff.dropForeignKeys.push(name) }
  for (const fk of newDesign.foreignKeys) { if (!oldFkNames.has(fk.name)) diff.addForeignKeys.push(fk) }

  if (oldDesign.engine !== newDesign.engine) diff.changeOptions.engine = newDesign.engine
  if (oldDesign.charset !== newDesign.charset) diff.changeOptions.charset = newDesign.charset
  if (oldDesign.collation !== newDesign.collation) diff.changeOptions.collation = newDesign.collation
  if (oldDesign.comment !== newDesign.comment) diff.changeOptions.comment = newDesign.comment

  return diff
}
