export type FilterMode = 'simple' | 'advanced'
export type SimpleFilterJoin = 'AND' | 'OR'
export type SimpleFilterNode = SimpleFilterGroup | SimpleFilterCondition

export interface SimpleFilterCondition {
  id: string
  type: 'condition'
  column: string
  operator: string
  value: string
  secondValue?: string
}

export interface SimpleFilterGroup {
  id: string
  type: 'group'
  join: SimpleFilterJoin
  children: SimpleFilterNode[]
}
import { quoteId } from './table-pagination'

type SimpleFilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'like' | 'notLike' | 'between' | 'notBetween' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL'

const quoteSqlString = (value: string): string => `'${value
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\u0000/g, '\\0')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '\\r')
  .replace(/\u001a/g, '\\Z')}'`

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

const isMeaningfulNode = (node: SimpleFilterNode) => node.type === 'group' || Boolean(node.column)

/** 整理条件树：去掉空条件和空括号、展开只剩一项的括号；用户建立的括号一律保留 */
export const normalizeFilterTree = (group: SimpleFilterGroup): SimpleFilterGroup => {
  const children: SimpleFilterNode[] = []
  for (const child of group.children) {
    if (!isMeaningfulNode(child)) continue
    if (child.type === 'condition') { children.push(child); continue }
    const inner = normalizeFilterTree(child)
    if (inner.children.length === 0) continue
    children.push(inner.children.length === 1 ? inner.children[0] : inner)
  }
  return { ...group, children }
}

const mapTree = (group: SimpleFilterGroup, fn: (node: SimpleFilterNode, parent: SimpleFilterGroup) => SimpleFilterNode[]): SimpleFilterGroup => ({
  ...group,
  children: group.children.flatMap((child) => fn(child.type === 'group' ? mapTree(child, fn) : child, group)),
})

export const addConditionToGroup = (tree: SimpleFilterGroup, groupId: string, condition: SimpleFilterCondition): SimpleFilterGroup => {
  if (tree.id === groupId) return normalizeFilterTree({ ...tree, children: [...tree.children, condition] })
  return normalizeFilterTree(mapTree(tree, (node) => (node.type === 'group' && node.id === groupId ? [{ ...node, children: [...node.children, condition] }] : [node])))
}

export const replaceFilterNode = (tree: SimpleFilterGroup, id: string, next: SimpleFilterNode): SimpleFilterGroup =>
  normalizeFilterTree(mapTree(tree, (node) => (node.id === id ? [next] : [node])))

export const removeFilterNode = (tree: SimpleFilterGroup, id: string): SimpleFilterGroup =>
  normalizeFilterTree(mapTree(tree, (node) => (node.id === id ? [] : [node])))

/** 把某个条件和新条件一起放进括号，括号内使用与所在层相反的 且/或 */
export const wrapFilterNode = (tree: SimpleFilterGroup, id: string, condition: SimpleFilterCondition): SimpleFilterGroup =>
  normalizeFilterTree(mapTree(tree, (node, parent) => (node.id === id
    ? [{ id: createFilterId(), type: 'group', join: parent.join === 'AND' ? 'OR' : 'AND', children: [node, condition] }]
    : [node])))

export const toggleGroupJoin = (tree: SimpleFilterGroup, groupId: string): SimpleFilterGroup => {
  const flip = (g: SimpleFilterGroup): SimpleFilterGroup => ({ ...g, join: g.join === 'AND' ? 'OR' : 'AND' })
  if (tree.id === groupId) return normalizeFilterTree(flip(tree))
  return normalizeFilterTree(mapTree(tree, (node) => (node.type === 'group' && node.id === groupId ? [flip(node)] : [node])))
}

/**
 * 以指定的 且/或 向某一层追加条件。与该层现有连接不同且已有多项时，
 * 先把该层整体加括号，再在括号外与新条件组合，例如 (A 且 B) 或 C。
 */
export const appendConditionWithJoin = (
  tree: SimpleFilterGroup,
  groupId: string,
  condition: SimpleFilterCondition,
  join: SimpleFilterJoin,
): SimpleFilterGroup => {
  const extend = (group: SimpleFilterGroup): SimpleFilterGroup => {
    const items = group.children.filter(isMeaningfulNode)
    if (items.length < 2 || group.join === join) return { ...group, join, children: [...items, condition] }
    // 外层沿用原 id，后续在这一层继续添加时落在括号外
    return { id: group.id, type: 'group', join, children: [{ ...group, id: createFilterId() }, condition] }
  }
  if (tree.id === groupId) return normalizeFilterTree(extend(tree))
  return normalizeFilterTree(mapTree(tree, (node) => (node.type === 'group' && node.id === groupId ? [extend(node)] : [node])))
}

/** 找到同时包含所有 id 的那一层；不在同一层时返回 null */
export const findCommonParent = (tree: SimpleFilterGroup, ids: string[]): SimpleFilterGroup | null => {
  if (ids.length && ids.every((id) => tree.children.some((c) => c.id === id))) return tree
  for (const child of tree.children) {
    if (child.type !== 'group') continue
    const found = findCommonParent(child, ids)
    if (found) return found
  }
  return null
}

/** 把同一层的若干项放进一个新括号（括号内沿用该层的 且/或，含义不变），位置取第一项 */
export const groupFilterNodes = (tree: SimpleFilterGroup, ids: string[]): SimpleFilterGroup => {
  const parent = findCommonParent(tree, ids)
  if (!parent || ids.length < 2) return tree
  const picked = new Set(ids)
  const wrap = (group: SimpleFilterGroup): SimpleFilterGroup => {
    const members = group.children.filter((c) => picked.has(c.id))
    const bracket: SimpleFilterGroup = { id: createFilterId(), type: 'group', join: group.join, children: members }
    const children: SimpleFilterNode[] = []
    let placed = false
    for (const child of group.children) {
      if (!picked.has(child.id)) { children.push(child); continue }
      if (!placed) { children.push(bracket); placed = true }
    }
    return { ...group, children }
  }
  if (parent.id === tree.id) return normalizeFilterTree(wrap(tree))
  return normalizeFilterTree(mapTree(tree, (node) => (node.type === 'group' && node.id === parent.id ? [wrap(node)] : [node])))
}

/** 去掉括号，把括号内的项放回上一层原位置 */
export const ungroupFilterNode = (tree: SimpleFilterGroup, groupId: string): SimpleFilterGroup =>
  normalizeFilterTree(mapTree(tree, (node) => (node.type === 'group' && node.id === groupId ? node.children : [node])))
