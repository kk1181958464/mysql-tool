import type { SimpleFilterCondition, SimpleFilterGroup, SimpleFilterNode } from './FilterModal'
import { quoteId } from './table-pagination'

type SimpleFilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'like' | 'notLike' | 'between' | 'notBetween' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL'

export type SimpleFilterField = keyof Omit<SimpleFilterCondition, 'id' | 'type'>

const quoteSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

const isNumericType = (type: string) => /int|decimal|float|double|numeric|real|bit|serial/i.test(type)

export const isDateLikeType = (type: string) => /date|time|year|timestamp|datetime/i.test(type)

const quoteSqlList = (value: string, options?: { treatAsNumeric?: boolean }): string => {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (options?.treatAsNumeric && /^-?\d+(\.\d+)?$/.test(item)) return item
      return quoteSqlString(item)
    })
    .join(', ')
}

const buildConditionSql = (
  filter: SimpleFilterCondition,
  getColumnType: (columnName: string) => string,
): string => {
  const column = filter.column.trim()
  const operator = filter.operator.trim() as SimpleFilterOperator
  const value = filter.value.trim()
  const secondValue = filter.secondValue?.trim() || ''
  if (!column || !operator) return ''
  if (operator === 'IS NULL' || operator === 'IS NOT NULL') return `${quoteId(column)} ${operator}`
  if (operator === 'contains') return value ? `${quoteId(column)} LIKE ${quoteSqlString(`%${value}%`)}` : ''
  if (operator === 'startsWith') return value ? `${quoteId(column)} LIKE ${quoteSqlString(`${value}%`)}` : ''
  if (operator === 'endsWith') return value ? `${quoteId(column)} LIKE ${quoteSqlString(`%${value}`)}` : ''
  if (operator === 'like') return value ? `${quoteId(column)} LIKE ${quoteSqlString(value)}` : ''
  if (operator === 'notLike') return value ? `${quoteId(column)} NOT LIKE ${quoteSqlString(value)}` : ''
  if (operator === 'between') {
    return value && secondValue ? `${quoteId(column)} BETWEEN ${quoteSqlString(value)} AND ${quoteSqlString(secondValue)}` : ''
  }
  if (operator === 'notBetween') {
    return value && secondValue ? `${quoteId(column)} NOT BETWEEN ${quoteSqlString(value)} AND ${quoteSqlString(secondValue)}` : ''
  }
  if (operator === 'IN' || operator === 'NOT IN') {
    const list = quoteSqlList(value, { treatAsNumeric: isNumericType(getColumnType(column)) })
    return list ? `${quoteId(column)} ${operator} (${list})` : ''
  }
  return value ? `${quoteId(column)} ${operator} ${quoteSqlString(value)}` : ''
}

export const buildSimpleFilterWhere = (
  group: SimpleFilterGroup,
  getColumnType: (columnName: string) => string,
): string => {
  const parts = group.children
    .map((node) => node.type === 'group' ? buildSimpleFilterWhere(node, getColumnType) : buildConditionSql(node, getColumnType))
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `(${parts.join(` ${group.join} `)})`
}

const createFilterId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const getDefaultSimpleFilter = (): SimpleFilterCondition => ({
  id: createFilterId(),
  type: 'condition',
  column: '',
  operator: 'contains',
  value: '',
  secondValue: '',
})

export const getDefaultSimpleFilterGroup = (): SimpleFilterGroup => ({
  id: createFilterId(),
  type: 'group',
  join: 'AND',
  children: [getDefaultSimpleFilter()],
})

const cloneSimpleFilterNode = (node: SimpleFilterNode): SimpleFilterNode => {
  if (node.type === 'group') return { ...node, children: node.children.map(cloneSimpleFilterNode) }
  return { ...node }
}

export const cloneSimpleFilterGroup = (group: SimpleFilterGroup): SimpleFilterGroup => ({
  ...group,
  children: group.children.map(cloneSimpleFilterNode),
})

const ensureGroupHasChildren = (group: SimpleFilterGroup): SimpleFilterGroup => {
  return group.children.length > 0 ? group : { ...group, children: [getDefaultSimpleFilter()] }
}

export const updateGroupInTree = (
  group: SimpleFilterGroup,
  groupId: string,
  updater: (target: SimpleFilterGroup) => SimpleFilterGroup,
): SimpleFilterGroup => {
  if (group.id === groupId) return ensureGroupHasChildren(updater(group))
  return {
    ...group,
    children: group.children.map((child) => child.type === 'group' ? updateGroupInTree(child, groupId, updater) : child),
  }
}

export const updateConditionInTree = (
  group: SimpleFilterGroup,
  conditionId: string,
  updater: (target: SimpleFilterCondition) => SimpleFilterCondition,
): SimpleFilterGroup => ({
  ...group,
  children: group.children.map((child) => {
    if (child.type === 'group') return updateConditionInTree(child, conditionId, updater)
    return child.id === conditionId ? updater(child) : child
  }),
})

export const removeNodeFromTree = (group: SimpleFilterGroup, nodeId: string, isRoot = true): SimpleFilterGroup => {
  const nextChildren = group.children
    .filter((child) => child.id !== nodeId)
    .map((child) => child.type === 'group' ? removeNodeFromTree(child, nodeId, false) : child)
  if (isRoot && nextChildren.length === 0) return { ...group, children: [getDefaultSimpleFilter()] }
  return { ...group, children: nextChildren }
}

export const moveNodeInGroup = (
  group: SimpleFilterGroup,
  groupId: string,
  fromIndex: number,
  toIndex: number,
): SimpleFilterGroup => {
  if (group.id === groupId) {
    const nextChildren = [...group.children]
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= nextChildren.length || toIndex >= nextChildren.length || fromIndex === toIndex) return group
    const [moved] = nextChildren.splice(fromIndex, 1)
    nextChildren.splice(toIndex, 0, moved)
    return { ...group, children: nextChildren }
  }
  return {
    ...group,
    children: group.children.map((child) => child.type === 'group' ? moveNodeInGroup(child, groupId, fromIndex, toIndex) : child),
  }
}

export const describeSimpleFilterNode = (node: SimpleFilterNode): string => {
  if (node.type === 'group') {
    const parts = node.children.map(describeSimpleFilterNode).filter(Boolean)
    if (parts.length === 0) return ''
    if (parts.length === 1) return parts[0]
    return `(${parts.join(` ${node.join} `)})`
  }
  const column = node.column?.trim() || '未选字段'
  const operator = node.operator || '未选操作符'
  const value = node.value?.trim() || ''
  const secondValue = node.secondValue?.trim() || ''
  if (operator === 'IS NULL' || operator === 'IS NOT NULL') return `${column} ${operator}`
  if (operator === 'between' || operator === 'notBetween') {
    return value && secondValue ? `${column} ${operator} ${value} ~ ${secondValue}` : `${column} ${operator}`
  }
  if (operator === 'IN' || operator === 'NOT IN') return value ? `${column} ${operator} [${value}]` : `${column} ${operator}`
  return value ? `${column} ${operator} ${value}` : `${column} ${operator}`
}
