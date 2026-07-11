import { validateIdentifier } from './query-request'

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值`)
  return value
}

export function validateImportOptions(value: unknown): { taskId?: string; batchSize?: number; ignoreErrors?: boolean; truncate?: boolean; atomic?: boolean; columnMapping?: Record<string, string>; delimiter?: string; quote?: string; columns?: boolean; sheetName?: string } {
  const input = object(value, '导入选项')
  let batchSize: number | undefined
  if (input.batchSize !== undefined) {
    if (typeof input.batchSize !== 'number' || !Number.isInteger(input.batchSize) || input.batchSize < 100 || input.batchSize > 10000) {
      throw new Error('导入批量大小范围为 100-10000')
    }
    batchSize = input.batchSize
  }
  let columnMapping: Record<string, string> | undefined
  if (input.columnMapping !== undefined) {
    const mapping = object(input.columnMapping, '列映射')
    if (Object.keys(mapping).length > 10000) throw new Error('列映射不能超过 10000 项')
    columnMapping = Object.fromEntries(Object.entries(mapping).map(([source, target]) => {
      if (!source.trim() || source.length > 255) throw new Error('源列名无效')
      if (target === '') return [source, '']
      return [source, validateIdentifier(target, '目标列名')]
    }))
    const targets = Object.values(columnMapping).filter(Boolean)
    if (new Set(targets).size !== targets.length) throw new Error('多个源列不能映射到同一个目标列')
  }
  const ignoreErrors = optionalBoolean(input.ignoreErrors, '忽略错误选项')
  const atomic = optionalBoolean(input.atomic, '事务导入选项')
  if (ignoreErrors && atomic) throw new Error('事务导入不能同时忽略错误')
  const delimiter = input.delimiter === undefined ? undefined : String(input.delimiter)
  const quote = input.quote === undefined ? undefined : String(input.quote)
  if (delimiter !== undefined && delimiter.length !== 1) throw new Error('CSV 分隔符必须是单个字符')
  if (quote !== undefined && quote.length !== 1) throw new Error('CSV 引号符必须是单个字符')
  return {
    taskId: input.taskId === undefined ? undefined : validateIdentifier(input.taskId, '任务 ID'),
    batchSize,
    ignoreErrors,
    truncate: optionalBoolean(input.truncate, '清空表选项'),
    atomic,
    columnMapping,
    delimiter,
    quote,
    columns: optionalBoolean(input.columns, 'CSV 表头选项'),
    sheetName: input.sheetName === undefined ? undefined : validateIdentifier(input.sheetName, '工作表名'),
  }
}

export function validateTableList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('表列表必须是数组且不能超过 10000 项')
  const tables = value.map((item) => validateIdentifier(item, '表名'))
  if (new Set(tables).size !== tables.length) throw new Error('表列表不能包含重复项')
  return tables
}

export function validateExportOptions(value: unknown): {
  taskId?: string
  tables?: string[]
  dropTable?: boolean
  createTable?: boolean
  includeData?: boolean
  insertStyle?: 'single' | 'multi' | 'ignore' | 'replace'
  sheetName?: string
  delimiter?: string
  quote?: string
  headers?: boolean
  pretty?: boolean
  arrayMode?: boolean
  consistentSnapshot?: boolean
} {
  const input = object(value, '导出选项')
  let insertStyle: 'single' | 'multi' | 'ignore' | 'replace' | undefined
  if (input.insertStyle !== undefined) {
    if (!['single', 'multi', 'ignore', 'replace'].includes(String(input.insertStyle))) throw new Error('INSERT 风格无效')
    insertStyle = input.insertStyle as typeof insertStyle
  }
  let sheetName: string | undefined
  if (input.sheetName !== undefined) {
    if (typeof input.sheetName !== 'string' || !input.sheetName.trim() || input.sheetName.length > 31 || /[\\/?*\[\]:]/.test(input.sheetName)) {
      throw new Error('Excel 工作表名称无效')
    }
    sheetName = input.sheetName
  }
  const delimiter = input.delimiter === undefined ? undefined : String(input.delimiter)
  if (delimiter !== undefined && delimiter.length !== 1) throw new Error('CSV 分隔符必须是单个字符')
  const quote = input.quote === undefined ? undefined : String(input.quote)
  if (quote !== undefined && quote.length !== 1) throw new Error('CSV 引号符必须是单个字符')
  return {
    taskId: input.taskId === undefined ? undefined : validateIdentifier(input.taskId, '任务 ID'),
    tables: input.tables === undefined ? undefined : validateTableList(input.tables),
    dropTable: optionalBoolean(input.dropTable, 'DROP TABLE 选项'),
    createTable: optionalBoolean(input.createTable, 'CREATE TABLE 选项'),
    includeData: optionalBoolean(input.includeData, '包含数据选项'),
    insertStyle,
    sheetName,
    delimiter,
    quote,
    headers: optionalBoolean(input.headers, 'CSV 表头选项'),
    pretty: optionalBoolean(input.pretty, 'JSON 格式化选项'),
    arrayMode: optionalBoolean(input.arrayMode, 'JSON 数组模式选项'),
    consistentSnapshot: optionalBoolean(input.consistentSnapshot, '一致性快照选项'),
  }
}

export function validateFilePathString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 32767 || value.includes('\0')) throw new Error('文件路径无效')
  return value
}
