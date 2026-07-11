import type { ColumnDesign, ForeignKeyDesign, IndexDesign, TableDesign, TableDiff } from '../../shared/types/table-design'
import { validateIdentifier } from './query-request'

const COLUMN_TYPES = new Set(['INT','INTEGER','BIGINT','SMALLINT','TINYINT','MEDIUMINT','VARCHAR','CHAR','TEXT','MEDIUMTEXT','LONGTEXT','DECIMAL','NUMERIC','FLOAT','DOUBLE','DATE','DATETIME','TIMESTAMP','TIME','YEAR','BOOLEAN','BIT','JSON','BLOB','MEDIUMBLOB','LONGBLOB','BINARY','VARBINARY','ENUM','SET'])
const ENGINES = new Set(['InnoDB', 'MyISAM', 'MEMORY', 'CSV', 'ARCHIVE'])
const INDEX_TYPES = new Set(['INDEX', 'UNIQUE', 'FULLTEXT', 'SPATIAL'])
const INDEX_METHODS = new Set(['BTREE', 'HASH'])
const FK_ACTIONS = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, empty = true): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error(`${label}无效`)
  return value
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}必须是数组且不能超过 ${max} 项`)
  return value
}
function enumValue<T extends string>(value: unknown, allowed: Set<string>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`${label}无效`)
  return value as T
}

function column(value: unknown): ColumnDesign {
  const v = object(value, '字段')
  const defaultValue = text(v.defaultValue, '默认值', 1024)
  if (/;|--|#|\/\*/.test(defaultValue)) throw new Error('默认值包含不允许的 SQL 分隔符或注释')
  const length = text(v.length, '字段长度', 32)
  const decimals = text(v.decimals, '小数位数', 8)
  if (length && !/^\d+$/.test(length)) throw new Error('字段长度必须是整数')
  if (decimals && !/^\d+$/.test(decimals)) throw new Error('小数位数必须是整数')
  return {
    name: validateIdentifier(v.name, '字段名'), type: enumValue(v.type, COLUMN_TYPES, '字段类型'), length, decimals,
    nullable: bool(v.nullable, '可空选项'), defaultValue, autoIncrement: bool(v.autoIncrement, '自增选项'),
    primaryKey: bool(v.primaryKey, '主键选项'), unique: bool(v.unique, '唯一选项'), comment: text(v.comment, '字段注释', 1024),
    unsigned: bool(v.unsigned, '无符号选项'), zerofill: bool(v.zerofill, '零填充选项'),
    onUpdateCurrentTimestamp: bool(v.onUpdateCurrentTimestamp, '更新时间选项'),
  }
}

function index(value: unknown, columnNames: Set<string>): IndexDesign {
  const v = object(value, '索引')
  const columns = list(v.columns, '索引字段', 64).map((item) => {
    const c = object(item, '索引字段')
    const name = validateIdentifier(c.name, '索引字段名')
    if (!columnNames.has(name)) throw new Error(`索引引用了不存在的字段: ${name}`)
    const length = c.length === undefined ? undefined : Number(c.length)
    if (length !== undefined && (!Number.isInteger(length) || length < 1 || length > 65535)) throw new Error('索引长度无效')
    return { name, length, order: enumValue<'ASC' | 'DESC'>(c.order, new Set(['ASC', 'DESC']), '索引排序') }
  })
  if (!columns.length) throw new Error('索引必须包含字段')
  return { name: validateIdentifier(v.name, '索引名'), type: enumValue(v.type, INDEX_TYPES, '索引类型'), method: enumValue(v.method, INDEX_METHODS, '索引方法'), columns, comment: text(v.comment, '索引注释', 1024) }
}

function foreignKey(value: unknown, columnNames: Set<string>): ForeignKeyDesign {
  const v = object(value, '外键')
  const columns = list(v.columns, '外键字段', 64).map((name) => validateIdentifier(name, '外键字段名'))
  const referencedColumns = list(v.referencedColumns, '引用字段', 64).map((name) => validateIdentifier(name, '引用字段名'))
  if (!columns.length || columns.length !== referencedColumns.length) throw new Error('外键字段和引用字段数量必须一致且非空')
  for (const name of columns) if (!columnNames.has(name)) throw new Error(`外键引用了不存在的字段: ${name}`)
  return { name: validateIdentifier(v.name, '外键名'), columns, referencedTable: validateIdentifier(v.referencedTable, '引用表名'), referencedColumns, onUpdate: enumValue(v.onUpdate, FK_ACTIONS, 'ON UPDATE'), onDelete: enumValue(v.onDelete, FK_ACTIONS, 'ON DELETE') }
}

export function validateTableDesign(value: unknown): TableDesign {
  const v = object(value, '表设计')
  const columns = list(v.columns, '字段列表', 512).map(column)
  if (!columns.length) throw new Error('表至少需要一个字段')
  const names = new Set(columns.map((c) => c.name))
  if (names.size !== columns.length) throw new Error('字段名不能重复')
  const charset = text(v.charset, '字符集', 64, false)
  const collation = text(v.collation, '排序规则', 64, false)
  if (!/^[A-Za-z0-9_]+$/.test(charset) || !/^[A-Za-z0-9_]+$/.test(collation)) throw new Error('字符集或排序规则格式无效')
  return { name: validateIdentifier(v.name, '表名'), engine: enumValue(v.engine, ENGINES, '存储引擎'), charset, collation, comment: text(v.comment, '表注释', 2048), columns, indexes: list(v.indexes, '索引列表', 128).map((i) => index(i, names)), foreignKeys: list(v.foreignKeys, '外键列表', 128).map((f) => foreignKey(f, names)) }
}

export function validateTableDiff(value: unknown, design: TableDesign): TableDiff {
  const v = object(value, '表结构差异')
  const names = new Set(design.columns.map((c) => c.name))
  const ids = (key: string) => list(v[key] ?? [], key, 512).map((name) => validateIdentifier(name, key))
  const requestedOptions = object(v.changeOptions ?? {}, '表选项')
  const changeOptions: TableDiff['changeOptions'] = {}
  if (requestedOptions.engine !== undefined) changeOptions.engine = design.engine
  if (requestedOptions.charset !== undefined) changeOptions.charset = design.charset
  if (requestedOptions.collation !== undefined) changeOptions.collation = design.collation
  if (requestedOptions.comment !== undefined) changeOptions.comment = design.comment
  return {
    addColumns: list(v.addColumns ?? [], '新增字段', 512).map(column),
    modifyColumns: list(v.modifyColumns ?? [], '修改字段', 512).map((item) => { const m = object(item, '修改字段'); return { old: validateIdentifier(m.old, '原字段名'), new: column(m.new) } }),
    dropColumns: ids('删除字段'), addIndexes: list(v.addIndexes ?? [], '新增索引', 128).map((i) => index(i, names)), dropIndexes: ids('删除索引'),
    addForeignKeys: list(v.addForeignKeys ?? [], '新增外键', 128).map((f) => foreignKey(f, names)), dropForeignKeys: ids('删除外键'),
    changeOptions,
  }
}
