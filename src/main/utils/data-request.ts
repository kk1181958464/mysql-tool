import { validateIdentifier } from './query-request'

const MAX_RECORD_COLUMNS = 512
const MAX_BATCH_ITEMS = 5000

export function validateDataRecord(value: unknown, label: string, allowEmpty = false): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  const entries = Object.entries(value as Record<string, unknown>)
  if (!allowEmpty && entries.length === 0) throw new Error(`${label}不能为空`)
  if (entries.length > MAX_RECORD_COLUMNS) throw new Error(`${label}最多包含 ${MAX_RECORD_COLUMNS} 个字段`)
  return Object.fromEntries(entries.map(([key, item]) => [validateIdentifier(key, '字段名'), item]))
}

export function validateRecordBatch(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  if (value.length > MAX_BATCH_ITEMS) throw new Error(`${label}最多包含 ${MAX_BATCH_ITEMS} 项`)
  return value.map((item, index) => validateDataRecord(item, `${label}第 ${index + 1} 项`))
}

export function validateUpdateBatch(value: unknown): Array<{ data: Record<string, unknown>; where: Record<string, unknown> }> {
  if (!Array.isArray(value)) throw new Error('批量更新参数必须是数组')
  if (value.length > MAX_BATCH_ITEMS) throw new Error(`批量更新最多包含 ${MAX_BATCH_ITEMS} 项`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`批量更新第 ${index + 1} 项必须是对象`)
    const input = item as Record<string, unknown>
    return {
      data: validateDataRecord(input.data, `批量更新第 ${index + 1} 项数据`),
      where: validateDataRecord(input.where, `批量更新第 ${index + 1} 项 WHERE 条件`),
    }
  })
}
