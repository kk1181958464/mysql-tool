import type { TableDesign, TableDiff, ColumnDesign, IndexDesign, ForeignKeyDesign } from '../../shared/types/table-design'

function colDef(c: ColumnDesign): string {
  let s = `\`${c.name}\` ${c.type}`
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
  const cols = idx.columns.map(c => `\`${c.name}\`${c.length ? `(${c.length})` : ''} ${c.order}`).join(', ')
  let s = ''
  if (idx.type === 'UNIQUE') s = `UNIQUE INDEX \`${idx.name}\``
  else if (idx.type === 'FULLTEXT') s = `FULLTEXT INDEX \`${idx.name}\``
  else if (idx.type === 'SPATIAL') s = `SPATIAL INDEX \`${idx.name}\``
  else s = `INDEX \`${idx.name}\``
  s += ` (${cols})`
  if (idx.method) s += ` USING ${idx.method}`
  if (idx.comment) s += ` COMMENT '${idx.comment.replace(/'/g, "\\'")}'`
  return s
}

function fkDef(fk: ForeignKeyDesign): string {
  const cols = fk.columns.map(c => `\`${c}\``).join(', ')
  const refCols = fk.referencedColumns.map(c => `\`${c}\``).join(', ')
  return `CONSTRAINT \`${fk.name}\` FOREIGN KEY (${cols}) REFERENCES \`${fk.referencedTable}\` (${refCols}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`
}

export function generateCreateTableSQL(design: TableDesign): string {
  const parts: string[] = []
  for (const c of design.columns) parts.push('  ' + colDef(c))
  const pks = design.columns.filter(c => c.primaryKey).map(c => `\`${c.name}\``)
  if (pks.length) parts.push(`  PRIMARY KEY (${pks.join(', ')})`)
  for (const idx of design.indexes) parts.push('  ' + indexDef(idx))
  for (const fk of design.foreignKeys) parts.push('  ' + fkDef(fk))

  let sql = `CREATE TABLE \`${design.name}\` (\n${parts.join(',\n')}\n)`
  if (design.engine) sql += ` ENGINE=${design.engine}`
  if (design.charset) sql += ` DEFAULT CHARSET=${design.charset}`
  if (design.collation) sql += ` COLLATE=${design.collation}`
  if (design.comment) sql += ` COMMENT='${design.comment.replace(/'/g, "\\'")}'`
  return sql + ';'
}

export function generateAlterTableSQL(tableName: string, diff: TableDiff): string {
  const stmts: string[] = []
  // 兼容处理：如果 diff 结构不完整，返回空
  if (!diff.dropColumns || !diff.addColumns) return ''
  for (const col of diff.dropColumns) stmts.push(`DROP COLUMN \`${col}\``)
  for (const col of diff.addColumns) stmts.push(`ADD COLUMN ${colDef(col)}`)
  for (const m of diff.modifyColumns || []) stmts.push(`CHANGE COLUMN \`${m.old}\` ${colDef(m.new)}`)
  for (const idx of diff.dropIndexes || []) stmts.push(`DROP INDEX \`${idx}\``)
  for (const idx of diff.addIndexes || []) stmts.push(`ADD ${indexDef(idx)}`)
  for (const fk of diff.dropForeignKeys || []) stmts.push(`DROP FOREIGN KEY \`${fk}\``)
  for (const fk of diff.addForeignKeys || []) stmts.push(`ADD ${fkDef(fk)}`)
  const opts = diff.changeOptions
  if (opts?.engine) stmts.push(`ENGINE=${opts.engine}`)
  if (opts?.charset) stmts.push(`DEFAULT CHARSET=${opts.charset}`)
  if (opts?.collation) stmts.push(`COLLATE=${opts.collation}`)
  if (opts?.comment) stmts.push(`COMMENT='${opts.comment.replace(/'/g, "\\'")}'`)
  if (!stmts.length) return ''
  return `ALTER TABLE \`${tableName}\`\n  ${stmts.join(',\n  ')};`
}

export function generateDropTableSQL(db: string, table: string): string {
  return `DROP TABLE \`${db}\`.\`${table}\`;`
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
    else if (JSON.stringify(oldColMap.get(name)) !== JSON.stringify(col)) diff.modifyColumns.push({ old: name, new: col })
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
