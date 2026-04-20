import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Table, Input, Space, Button, DateTimePicker, Modal, Tag } from '../../components/ui'
import { PlusOutlined, DeleteOutlined, FilterOutlined, SaveOutlined, MoreOutlined } from '@ant-design/icons'
import { api } from '../../utils/ipc'
import type { QueryResult } from '../../../../shared/types/query'
import type { ColumnDetail } from '../../../../shared/types/metadata'
import { DataExport } from './DataExport'
import { FilterModal, type FilterMode, type SimpleFilterCondition, type SimpleFilterGroup, type SimpleFilterNode } from './FilterModal'
import { useAppStore } from '../../stores/app.store'
import { useDatabaseStore } from '../../stores/database.store'
import { useTabStore } from '../../stores/tab.store'
import type { PaginationMode } from '../../../../shared/constants'
import tableTransformWorker from '../../workers/table-transform.worker?worker'

interface Props {
  tabId: string
  connectionId: string
  database: string
  table: string
}

interface KeysetCursor {
  firstPk: unknown
  lastPk: unknown
}

type SimpleFilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith' | 'endsWith' | 'like' | 'notLike' | 'between' | 'notBetween' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL'

type EffectivePagination = 'keyset' | 'offset'

type SimpleFilterField = keyof Omit<SimpleFilterCondition, 'id' | 'type'>

const PAGINATION_MODE_LABEL: Record<PaginationMode, string> = {
  auto: '自动',
  cursor: '游标',
  offset: '偏移',
}

// duck typing 检测 Date（IPC序列化后 instanceof 可能失效）
const isDateValue = (val: unknown): val is Date =>
  val !== null && val !== undefined && typeof (val as any).getTime === 'function'

const pad2 = (n: number) => n.toString().padStart(2, '0')

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const fmtDT = (d: Date) =>
  `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`

const fmtValue = (val: unknown, isDateOnly = false): string => {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') {
    // 已经是格式化字符串（来自 pendingChanges），直接返回
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val
  }
  if (isDateValue(val)) return isDateOnly ? fmtDate(val) : fmtDT(val)
  const s = String(val)
  if (/^[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d/.test(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return isDateOnly ? fmtDate(d) : fmtDT(d)
  }
  return s
}

const quoteSqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`

const isNumericType = (type: string) => /int|decimal|float|double|numeric|real|bit|serial/i.test(type)
const isDateLikeType = (type: string) => /date|time|year|timestamp|datetime/i.test(type)

const quoteSqlList = (value: string, options?: { treatAsNumeric?: boolean }): string => {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (options?.treatAsNumeric && /^-?\d+(\.\d+)?$/.test(item)) {
        return item
      }
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
  const columnType = getColumnType(column)
  const treatListAsNumeric = isNumericType(columnType)
  if (!column || !operator) return ''
  if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
    return `\`${column}\` ${operator}`
  }
  if (operator === 'contains') {
    if (!value) return ''
    return `\`${column}\` LIKE ${quoteSqlString(`%${value}%`)}`
  }
  if (operator === 'startsWith') {
    if (!value) return ''
    return `\`${column}\` LIKE ${quoteSqlString(`${value}%`)}`
  }
  if (operator === 'endsWith') {
    if (!value) return ''
    return `\`${column}\` LIKE ${quoteSqlString(`%${value}`)}`
  }
  if (operator === 'like') {
    if (!value) return ''
    return `\`${column}\` LIKE ${quoteSqlString(value)}`
  }
  if (operator === 'notLike') {
    if (!value) return ''
    return `\`${column}\` NOT LIKE ${quoteSqlString(value)}`
  }
  if (operator === 'between') {
    if (!value || !secondValue) return ''
    return `\`${column}\` BETWEEN ${quoteSqlString(value)} AND ${quoteSqlString(secondValue)}`
  }
  if (operator === 'notBetween') {
    if (!value || !secondValue) return ''
    return `\`${column}\` NOT BETWEEN ${quoteSqlString(value)} AND ${quoteSqlString(secondValue)}`
  }
  if (operator === 'IN' || operator === 'NOT IN') {
    const list = quoteSqlList(value, { treatAsNumeric: treatListAsNumeric })
    if (!list) return ''
    return `\`${column}\` ${operator} (${list})`
  }
  if (!value) return ''
  return `\`${column}\` ${operator} ${quoteSqlString(value)}`
}

const buildSimpleFilterWhere = (
  group: SimpleFilterGroup,
  getColumnType: (columnName: string) => string,
): string => {
  const parts = group.children
    .map((node) => {
      if (node.type === 'group') {
        return buildSimpleFilterWhere(node, getColumnType)
      }
      return buildConditionSql(node, getColumnType)
    })
    .filter(Boolean)

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `(${parts.join(` ${group.join} `)})`
}

const createFilterId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const getDefaultSimpleFilter = (): SimpleFilterCondition => ({
  id: createFilterId(),
  type: 'condition',
  column: '',
  operator: 'contains',
  value: '',
  secondValue: '',
})

const getDefaultSimpleFilterGroup = (): SimpleFilterGroup => ({
  id: createFilterId(),
  type: 'group',
  join: 'AND',
  children: [getDefaultSimpleFilter()],
})

const cloneSimpleFilterNode = (node: SimpleFilterNode): SimpleFilterNode => {
  if (node.type === 'group') {
    return {
      ...node,
      children: node.children.map((child) => cloneSimpleFilterNode(child)),
    }
  }
  return { ...node }
}

const cloneSimpleFilterGroup = (group: SimpleFilterGroup): SimpleFilterGroup => ({
  ...group,
  children: group.children.map((child) => cloneSimpleFilterNode(child)),
})

const ensureGroupHasChildren = (group: SimpleFilterGroup): SimpleFilterGroup => {
  if (group.children.length > 0) return group
  return { ...group, children: [getDefaultSimpleFilter()] }
}

const updateGroupInTree = (
  group: SimpleFilterGroup,
  groupId: string,
  updater: (target: SimpleFilterGroup) => SimpleFilterGroup,
): SimpleFilterGroup => {
  if (group.id === groupId) {
    return ensureGroupHasChildren(updater(group))
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.type !== 'group') return child
      return updateGroupInTree(child, groupId, updater)
    }),
  }
}

const updateConditionInTree = (
  group: SimpleFilterGroup,
  conditionId: string,
  updater: (target: SimpleFilterCondition) => SimpleFilterCondition,
): SimpleFilterGroup => ({
  ...group,
  children: group.children.map((child) => {
    if (child.type === 'group') {
      return updateConditionInTree(child, conditionId, updater)
    }
    return child.id === conditionId ? updater(child) : child
  }),
})

const removeNodeFromTree = (group: SimpleFilterGroup, nodeId: string, isRoot = true): SimpleFilterGroup => {
  const nextChildren = group.children
    .filter((child) => child.id !== nodeId)
    .map((child) => {
      if (child.type !== 'group') return child
      return removeNodeFromTree(child, nodeId, false)
    })

  if (isRoot && nextChildren.length === 0) {
    return { ...group, children: [getDefaultSimpleFilter()] }
  }

  return { ...group, children: nextChildren }
}

const moveNodeInGroup = (
  group: SimpleFilterGroup,
  groupId: string,
  fromIndex: number,
  toIndex: number,
): SimpleFilterGroup => {
  if (group.id === groupId) {
    const nextChildren = [...group.children]
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= nextChildren.length || toIndex >= nextChildren.length || fromIndex === toIndex) {
      return group
    }
    const [moved] = nextChildren.splice(fromIndex, 1)
    nextChildren.splice(toIndex, 0, moved)
    return { ...group, children: nextChildren }
  }

  return {
    ...group,
    children: group.children.map((child) => {
      if (child.type !== 'group') return child
      return moveNodeInGroup(child, groupId, fromIndex, toIndex)
    }),
  }
}

const describeSimpleFilterNode = (node: SimpleFilterNode): string => {
  if (node.type === 'group') {
    const parts = node.children.map((child) => describeSimpleFilterNode(child)).filter(Boolean)
    if (parts.length === 0) return ''
    if (parts.length === 1) return parts[0]
    return `(${parts.join(` ${node.join} `)})`
  }

  const column = node.column?.trim() || '未选字段'
  const operator = node.operator || '未选操作符'
  const value = node.value?.trim() || ''
  const secondValue = node.secondValue?.trim() || ''

  if (operator === 'IS NULL' || operator === 'IS NOT NULL') {
    return `${column} ${operator}`
  }
  if (operator === 'between' || operator === 'notBetween') {
    return value && secondValue ? `${column} ${operator} ${value} ~ ${secondValue}` : `${column} ${operator}`
  }
  if (operator === 'IN' || operator === 'NOT IN') {
    return value ? `${column} ${operator} [${value}]` : `${column} ${operator}`
  }
  return value ? `${column} ${operator} ${value}` : `${column} ${operator}`
}

const valIsDate = (val: unknown): boolean => {
  if (isDateValue(val)) return true
  if (typeof val === 'string' && (/^[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d/.test(val) || /^\d{4}-\d{2}-\d{2}/.test(val))) return true
  return false
}
// SQL 转义
const escSQL = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

// 常量 style 提取到模块级，避免每次渲染创建新引用
const cellStyle: React.CSSProperties = {
  cursor: 'text', display: 'block', minHeight: 20, padding: '1px 2px',
  transition: 'background-color 0.1s ease, box-shadow 0.1s ease',
}
const cellStyleSelected: React.CSSProperties = {
  ...cellStyle,
  background: 'var(--accent-bg)',
  boxShadow: 'inset 2px 0 0 var(--accent)',
}
const cellStyleUpdated: React.CSSProperties = {
  ...cellStyle,
  background: 'rgba(250, 204, 21, 0.18)',
}
const cellStyleSelectedUpdated: React.CSSProperties = {
  ...cellStyleSelected,
  boxShadow: 'inset 2px 0 0 var(--accent), inset 0 0 0 1px rgba(250, 204, 21, 0.8)',
}
const nullStyle: React.CSSProperties = { color: 'var(--text-muted)', fontStyle: 'italic' }
const editingCellStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-primary)', padding: '1px 2px', minHeight: 20,
}
const editInputStyle: React.CSSProperties = {
  width: '100%', padding: '2px 4px', border: '1px solid var(--accent)',
  borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12,
  outline: 'none', fontFamily: 'Consolas, Monaco, monospace',
}
const placeholderStyle: React.CSSProperties = { color: 'var(--text-muted)' }
const TABLEDATA_VIRTUAL_THRESHOLD = 400
const TABLEDATA_WORKER_THRESHOLD = 2000

// 保存错误尽量“人话化”
const normalizeIpcErrorMessage = (raw: unknown): string => {
  if (!raw) return ''
  const msg = String((raw as any).message ?? raw)
  return msg
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

// 可编辑单元格 - Navicat 风格
const EditableCell: React.FC<{
  value: unknown
  colType?: string
  isSelected: boolean
  isFocused: boolean
  isRecentlyUpdated: boolean
  onSelect: (shiftKey: boolean) => void
  onSave: (newValue: unknown) => void
  onDirtyChange: (isDirty: boolean) => void
  onContextMenu: (e: React.MouseEvent) => void
}> = React.memo(({ value, colType = '', isSelected, isFocused, isRecentlyUpdated, onSelect, onSave, onDirtyChange, onContextMenu }) => {
  const [editing, setEditing] = useState(false)
  const lowerType = colType.toLowerCase()
  const mysqlTypeCode = Number(lowerType)
  const isMysqlDateCode = Number.isFinite(mysqlTypeCode) && [7, 10, 12].includes(mysqlTypeCode)
  const isDateOnly = lowerType === 'date' || lowerType === '10'
  const isDT = isDateOnly || isMysqlDateCode || valIsDate(value) || lowerType.includes('datetime') || lowerType.includes('timestamp')
  const [inputValue, setInputValue] = useState('')
  const [anchorRect, setAnchorRect] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  const displayValue = fmtValue(value, isDateOnly)

  const enterEditing = useCallback(() => {
    window.dispatchEvent(new Event('app:close-context-menus'))
    document.dispatchEvent(new Event('app:close-context-menus'))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (cellRef.current) {
      const r = cellRef.current.getBoundingClientRect()
      setAnchorRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
    setEditing(true)
  }, [])

  const commitText = useCallback((val: string) => {
    const trimmed = val.trim()
    const newVal = trimmed === '' ? null : trimmed
    if (newVal !== displayValue && !(value === null && newVal === null)) {
      onSave(newVal)
    }
    onDirtyChange(false)
    setEditing(false)
  }, [value, displayValue, onSave, onDirtyChange])

  const commitDatePicker = useCallback((val: string) => {
    if (val !== displayValue) {
      onSave(val)
    }
    onDirtyChange(false)
    setEditing(false)
  }, [displayValue, onSave, onDirtyChange])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitText(inputValue) }
    if (e.key === 'Escape') {
      onDirtyChange(false)
      setEditing(false)
    }
  }

  useEffect(() => {
    if (!editing) {
      onDirtyChange(false)
      return
    }
    const trimmed = inputValue.trim()
    const nextValue = trimmed === '' ? null : trimmed
    const dirty = nextValue !== displayValue && !(value === null && nextValue === null)
    onDirtyChange(dirty)
  }, [editing, inputValue, displayValue, value, onDirtyChange])

  // 选中状态下，按键直接输入（替换值）— 仅 focused 单元格
  useEffect(() => {
    if (!isFocused || editing) return
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length === 1) {
        e.preventDefault()
        enterEditing()
        setInputValue(isDT ? '' : e.key)
      } else if (e.key === 'F2' || e.key === 'Enter') {
        e.preventDefault()
        enterEditing()
        setInputValue(isDT ? displayValue : (value === null ? '' : String(value)))
      } else if (e.key === 'Delete') {
        e.preventDefault()
        onSave(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isFocused, editing, value, isDT, displayValue, onSave])

  if (editing) {
    if (isDT) {
      return (
        <div ref={cellRef} style={editingCellStyle}>
          {displayValue || <span style={placeholderStyle}>选择日期...</span>}
          <DateTimePicker
            value={displayValue || undefined}
            dateOnly={isDateOnly}
            anchorRect={anchorRect || undefined}
            onConfirm={commitDatePicker}
            onCancel={() => {
              onDirtyChange(false)
              setEditing(false)
            }}
          />
        </div>
      )
    }
    return (
      <input
        type="text"
        autoFocus
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={() => commitText(inputValue)}
        onKeyDown={handleKeyDown}
        style={editInputStyle}
      />
    )
  }

  const displayStyle = isSelected
    ? (isRecentlyUpdated ? cellStyleSelectedUpdated : cellStyleSelected)
    : (isRecentlyUpdated ? cellStyleUpdated : cellStyle)

  return (
    <div
      ref={cellRef}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey) }}
      onDoubleClick={() => {
        window.dispatchEvent(new Event('app:close-context-menus'))
        enterEditing()
        setInputValue(isDT ? displayValue : (value === null ? '' : String(value)))
      }}
      onContextMenu={onContextMenu}
      style={displayStyle}
    >
      {value === null ? <span style={nullStyle}>NULL</span> : displayValue}
    </div>
  )
}, (prev, next) => prev.value === next.value && prev.isSelected === next.isSelected && prev.isFocused === next.isFocused && prev.colType === next.colType && prev.isRecentlyUpdated === next.isRecentlyUpdated)

export const TableData: React.FC<Props> = ({ tabId, connectionId, database, table }) => {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const rowsPerPage = useAppStore((s) => s.rowsPerPage)
  const paginationMode = useAppStore((s) => s.paginationMode)
  const { loadColumns, columns: columnCache } = useDatabaseStore()
  const setDataDirty = useTabStore((s) => s.setDataDirty)
  const [jumpPage, setJumpPage] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('simple')
  const [simpleFilterTree, setSimpleFilterTree] = useState<SimpleFilterGroup>(getDefaultSimpleFilterGroup())
  const [appliedSimpleFilterTree, setAppliedSimpleFilterTree] = useState<SimpleFilterGroup>(getDefaultSimpleFilterGroup())
  const [whereInput, setWhereInput] = useState('')
  const [where, setWhere] = useState('')
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false)
  const [draftFilterMode, setDraftFilterMode] = useState<FilterMode>('simple')
  const [draftSimpleFilterTree, setDraftSimpleFilterTree] = useState<SimpleFilterGroup>(getDefaultSimpleFilterGroup())
  const [draftWhereInput, setDraftWhereInput] = useState('')
  const [orderBy, setOrderBy] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const selectedRowKeyList = useMemo(() => Array.from(selectedRowKeys), [selectedRowKeys])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const lastCheckedRef = useRef<string | null>(null)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const anchorCellRef = useRef<{ rowKey: string; colName: string } | null>(null)
  const [newRows, setNewRows] = useState<Record<string, unknown>[]>([])
  const newRowCounter = useRef(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState('')
  const [saveErrorModalOpen, setSaveErrorModalOpen] = useState(false)
  const [saveErrorText, setSaveErrorText] = useState('')
  const [pendingChanges, setPendingChanges] = useState<Map<string, Record<string, unknown>>>(new Map())
  const [editingDirtyCells, setEditingDirtyCells] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [recentlyUpdatedCells, setRecentlyUpdatedCells] = useState<Set<string>>(new Set())
  const [headerContextMenu, setHeaderContextMenu] = useState<{ x: number; y: number; colName: string } | null>(null)
  const clearUpdatedTimerRef = useRef<number | null>(null)
  const [cellContextMenu, setCellContextMenu] = useState<{ x: number; y: number; rowKey: string; colName: string; record: Record<string, unknown> } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const countCacheRef = useRef<Map<string, { count: number; ts: number }>>(new Map())
  const [cursor, setCursor] = useState<KeysetCursor | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [lastQueryMode, setLastQueryMode] = useState<EffectivePagination>('offset')
  const [paginationFallbackHint, setPaginationFallbackHint] = useState('')
  const [transformedBaseRows, setTransformedBaseRows] = useState<Array<Record<string, unknown>>>([])
  const [pendingPaginationHint, setPendingPaginationHint] = useState('')
  const fetchRequestIdRef = useRef(0)
  const transformJobIdRef = useRef(0)

  const columnCacheKey = useMemo(
    () => `${connectionId}:${database}:${table}`,
    [connectionId, database, table]
  )

  const columnDetailsByName = useMemo(() => {
    const map = new Map<string, ColumnDetail>()
    ;((columnCache[columnCacheKey] || []) as ColumnDetail[]).forEach((c) => map.set(c.name, c))
    return map
  }, [columnCache, columnCacheKey])

  const simpleFilterColumnOptions = useMemo(
    () => (result?.columns || []).map((col) => ({ value: col.name, label: col.name })),
    [result?.columns]
  )

  const getFilterColumnType = useCallback((columnName: string) => {
    const column = result?.columns.find((item) => item.name === columnName)
    return column?.type || columnDetailsByName.get(columnName)?.dataType || ''
  }, [result?.columns, columnDetailsByName])

  const effectiveWhere = useMemo(
    () => filterMode === 'simple' ? buildSimpleFilterWhere(appliedSimpleFilterTree, getFilterColumnType) : where,
    [filterMode, appliedSimpleFilterTree, getFilterColumnType, where]
  )

  const filterSummary = useMemo(
    () => filterMode === 'simple' ? describeSimpleFilterNode(appliedSimpleFilterTree) : (where.trim() ? `高级 WHERE: ${where.trim()}` : ''),
    [filterMode, appliedSimpleFilterTree, where]
  )

  const countCacheKey = useMemo(
    () => `${connectionId}|${database}|${table}|${effectiveWhere.trim()}`,
    [connectionId, database, table, effectiveWhere]
  )

  useEffect(() => {
    if (paginationMode !== 'auto') {
      setPendingPaginationHint('')
      return
    }

    if (!result) {
      setPendingPaginationHint('分页模式判定中...')
      return
    }

    setPendingPaginationHint('')
  }, [paginationMode, result, connectionId, database, table])

  const fetchData = useCallback(async (
    action: 'reset' | 'next' | 'prev' = 'reset',
    forceRefreshCount = false,
    fallbackPage?: number,
    showLoading = true,
    explicitOrderBy?: string,
  ) => {
    if (!connectionId || !database || !table) return
    const requestId = ++fetchRequestIdRef.current
    if (showLoading) {
      setLoading(true)
    }
    setError('')
    try {
      const pkColumn = result?.columns.find((c) => c.primaryKey)?.name
      const activeOrderBy = explicitOrderBy ?? orderBy
      const canUseKeyset = Boolean(pkColumn && !activeOrderBy)
      const wantsKeyset = paginationMode === 'cursor' || paginationMode === 'auto'

      let effectiveMode: EffectivePagination = wantsKeyset && canUseKeyset ? 'keyset' : 'offset'
      const isInitialAutoProbe = paginationMode === 'auto' && action === 'reset' && !result
      let fallbackHint = ''

      if (effectiveMode === 'offset') {
        if (activeOrderBy) {
          fallbackHint = '当前存在排序条件，已回退为偏移分页'
        } else if (!pkColumn && !isInitialAutoProbe) {
          fallbackHint = '当前表缺少主键，已回退为偏移分页'
        }
      }

      if (action === 'reset' && typeof fallbackPage === 'number' && fallbackPage > 1) {
        effectiveMode = 'offset'
      }

      const whereParts: string[] = []
      if (effectiveWhere.trim()) whereParts.push(`(${effectiveWhere})`)

      let sql = `SELECT * FROM \`${table}\``

      if (effectiveMode === 'keyset' && action !== 'reset' && cursor && pkColumn) {
        const op = action === 'next' ? '>' : '<'
        const anchor = action === 'next' ? cursor.lastPk : cursor.firstPk
        whereParts.push(`\`${pkColumn}\` ${op} ${escSQL(anchor)}`)
      }

      if (whereParts.length > 0) {
        sql += ` WHERE ${whereParts.join(' AND ')}`
      }

      if (effectiveMode === 'keyset' && pkColumn) {
        sql += ` ORDER BY \`${pkColumn}\` ${action === 'prev' ? 'DESC' : 'ASC'}`
      } else if (activeOrderBy) {
        sql += ` ORDER BY ${activeOrderBy}`
      }

      if (effectiveMode === 'offset') {
        const pageValue = fallbackPage ?? page
        const offset = (pageValue - 1) * rowsPerPage
        sql += ` LIMIT ${rowsPerPage} OFFSET ${offset}`
      } else {
        sql += ` LIMIT ${rowsPerPage}`
      }

      let countSql = `SELECT COUNT(*) as cnt FROM \`${table}\``
      if (effectiveWhere.trim()) countSql += ` WHERE ${effectiveWhere}`

      const cache = countCacheRef.current
      const cachedCount = !forceRefreshCount ? cache.get(countCacheKey) : undefined

      const [res, countValue] = await Promise.all([
        api.query.execute(connectionId, sql, database),
        cachedCount
          ? Promise.resolve(cachedCount.count)
          : api.query.execute(connectionId, countSql, database).then((countRes) => {
            const count = Number(countRes.rows[0]?.cnt ?? 0)
            cache.set(countCacheKey, { count, ts: Date.now() })
            return count
          })
      ])

      if (requestId !== fetchRequestIdRef.current) return

      if (effectiveMode === 'keyset' && action === 'prev') {
        res.rows = [...res.rows].reverse()
      }

      const pkAfterQuery = res.columns.find((c) => c.primaryKey)?.name
      const rows = res.rows || []
      const canUseKeysetAfterQuery = Boolean(wantsKeyset && !activeOrderBy && pkAfterQuery)
      const resolvedMode: EffectivePagination = canUseKeysetAfterQuery ? 'keyset' : 'offset'
      let resolvedFallbackHint = fallbackHint

      if (resolvedMode === 'offset') {
        if (activeOrderBy) {
          resolvedFallbackHint = '当前存在排序条件，已回退为偏移分页'
        } else if (!pkAfterQuery && !isInitialAutoProbe) {
          resolvedFallbackHint = '当前表缺少主键，已回退为偏移分页'
        } else if (isInitialAutoProbe) {
          resolvedFallbackHint = ''
        }
      } else {
        resolvedFallbackHint = ''
      }

      if (resolvedMode === 'keyset' && pkAfterQuery && rows.length > 0) {
        setCursor({
          firstPk: rows[0][pkAfterQuery],
          lastPk: rows[rows.length - 1][pkAfterQuery]
        })
      } else {
        setCursor(null)
      }

      setHasNextPage(rows.length === rowsPerPage)
      setLastQueryMode(resolvedMode)
      setPaginationFallbackHint(resolvedFallbackHint)
      if (resolvedMode === 'offset' || action === 'reset') {
        const nextPage = fallbackPage ?? (action === 'reset' ? 1 : page)
        setPage(nextPage)
        setJumpPage(String(nextPage))
      }
      setResult(res)
      setTotalCount(countValue)
    } catch (e: any) {
      if (requestId !== fetchRequestIdRef.current) return
      setError(e.message || '查询失败')
    } finally {
      if (showLoading && requestId === fetchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [connectionId, database, table, rowsPerPage, effectiveWhere, orderBy, countCacheKey, paginationMode, page, cursor, result])

  useEffect(() => {
    if (!connectionId || !database || !table) return
    loadColumns(connectionId, database, table).catch(() => {})
  }, [connectionId, database, table, loadColumns])

  useEffect(() => {
    if (paginationMode === 'auto' && !result) {
      setPage(1)
      setJumpPage('')
      setCursor(null)
      setHasNextPage(false)
      setPaginationFallbackHint('')
      fetchData('reset')
      return
    }

    setPage(1)
    setJumpPage('')
    setCursor(null)
    setHasNextPage(false)
    setPaginationFallbackHint('')
    fetchData('reset')
  }, [connectionId, database, table, effectiveWhere, rowsPerPage, paginationMode])

  const pk = result?.columns.find((c) => c.primaryKey)
  const pkCol = pk?.name || '_rowIndex'
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage))
  const hasUnsavedChanges = pendingChanges.size > 0 || newRows.length > 0 || editingDirtyCells.size > 0

  useEffect(() => {
    setDataDirty(tabId, hasUnsavedChanges)
  }, [setDataDirty, tabId, hasUnsavedChanges])

  useEffect(() => {
    return () => {
      setDataDirty(tabId, false)
    }
  }, [setDataDirty, tabId])

  const getRowKey = useCallback((record: Record<string, unknown>) => {
    return String(record._newKey ?? record[pkCol] ?? record._rowIndex)
  }, [pkCol])

  const baseRowsWithIndex = useMemo(
    () => (result?.rows.map((row, index) => ({ ...row, _rowIndex: index })) || []),
    [result?.rows]
  )

  useEffect(() => {
    if (!baseRowsWithIndex.length) {
      setTransformedBaseRows([])
      return
    }

    if (baseRowsWithIndex.length < TABLEDATA_WORKER_THRESHOLD) {
      setTransformedBaseRows(baseRowsWithIndex)
      return
    }

    const worker = new tableTransformWorker()
    const nextJobId = transformJobIdRef.current + 1
    transformJobIdRef.current = nextJobId
    const jobId = `table-data-${nextJobId}`

    worker.onmessage = (event: MessageEvent<{ id: string; rows: Array<Record<string, unknown>> }>) => {
      if (event.data.id !== jobId) return
      setTransformedBaseRows(event.data.rows)
      worker.terminate()
    }

    worker.postMessage({ id: jobId, rows: baseRowsWithIndex })

    return () => {
      worker.terminate()
    }
  }, [baseRowsWithIndex])

  const normalizedBaseRows = useMemo(
    () => (transformedBaseRows.length ? transformedBaseRows : baseRowsWithIndex),
    [transformedBaseRows, baseRowsWithIndex]
  )

  const tableDataSource = useMemo(
    () => [...normalizedBaseRows, ...newRows],
    [normalizedBaseRows, newRows]
  )

  const rowsByKey = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>()
    tableDataSource.forEach((row) => map.set(getRowKey(row), row))
    return map
  }, [tableDataSource, getRowKey])

  const allRowKeys = useMemo(
    () => tableDataSource.map((row) => getRowKey(row)),
    [tableDataSource, getRowKey]
  )

  useEffect(() => {
    setDraftFilterMode(filterMode)
    setDraftSimpleFilterTree(cloneSimpleFilterGroup(simpleFilterTree))
    setDraftWhereInput(whereInput)
  }, [filterMode, simpleFilterTree, whereInput])

  useEffect(() => {
    return () => {
      if (clearUpdatedTimerRef.current !== null) {
        window.clearTimeout(clearUpdatedTimerRef.current)
      }
    }
  }, [])

  const markCellsRecentlyUpdated = useCallback((cells: Iterable<string>) => {
    const updates = Array.from(cells)
    if (updates.length === 0) return
    setRecentlyUpdatedCells(new Set(updates))
    if (clearUpdatedTimerRef.current !== null) {
      window.clearTimeout(clearUpdatedTimerRef.current)
    }
    clearUpdatedTimerRef.current = window.setTimeout(() => {
      setRecentlyUpdatedCells(new Set())
      clearUpdatedTimerRef.current = null
    }, 260)
  }, [])


  const handleColumnSelect = useCallback((colName: string) => {
    if (!result?.columns || allRowKeys.length === 0) return
    const colExists = result.columns.some((c) => c.name === colName)
    if (!colExists) return
    const next = new Set<string>()
    allRowKeys.forEach((rowKey) => next.add(`${rowKey}:${colName}`))
    setSelectedCells(next)
    anchorCellRef.current = { rowKey: allRowKeys[0], colName }
  }, [result?.columns, allRowKeys])

  const clearAllSelections = useCallback(() => {
    setSelectedCells(new Set())
    setSelectedRowKeys(new Set())
    anchorCellRef.current = null
  }, [])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    // 排除表格内容、滚动容器（滚动条点击）等
    if (target.closest('.ui-table td, .ui-table th, .ui-table-scroll, .ui-btn, .ui-input, input, textarea, select, a, [role="button"], .context-menu, .ui-modal')) return
    clearAllSelections()
    setHeaderContextMenu(null)
    setCellContextMenu(null)
  }, [clearAllSelections])

  const invalidateCountCache = useCallback(() => {
    countCacheRef.current.delete(countCacheKey)
  }, [countCacheKey])

  const applyWhereFilter = useCallback((nextFilterMode: FilterMode, nextSimpleFilterTree: SimpleFilterGroup, nextWhereInput: string) => {
    setPage(1)
    setJumpPage('1')
    setCursor(null)
    setFilterMode(nextFilterMode)
    if (nextFilterMode === 'advanced') {
      const trimmedWhere = nextWhereInput.trim()
      setWhereInput(trimmedWhere)
      setWhere(trimmedWhere)
      return
    }
    const clonedTree = cloneSimpleFilterGroup(nextSimpleFilterTree)
    setSimpleFilterTree(clonedTree)
    setAppliedSimpleFilterTree(clonedTree)
  }, [])

  const handleSimpleFilterChange = useCallback((id: string, field: SimpleFilterField, value: string) => {
    setDraftSimpleFilterTree((prev) => updateConditionInTree(prev, id, (target) => ({ ...target, [field]: value })))
  }, [])

  const getOperatorOptions = useCallback((columnName: string) => {
    const type = getFilterColumnType(columnName)
    const nullOptions = [
      { value: 'IS NULL', label: '为空' },
      { value: 'IS NOT NULL', label: '不为空' },
    ]
    const equalityOptions = [
      { value: '=', label: '=' },
      { value: '!=', label: '!=' },
    ]

    if (isNumericType(type) || isDateLikeType(type)) {
      return [
        // 常用
        ...equalityOptions,
        { value: '>', label: '>' },
        { value: '>=', label: '>=' },
        { value: '<', label: '<' },
        { value: '<=', label: '<=' },
        { value: 'between', label: '介于' },
        { value: 'IN', label: '在列表中' },
        // 不常用
        { value: 'notBetween', label: '不在区间' },
        { value: 'NOT IN', label: '不在列表中' },
        ...nullOptions,
      ]
    }

    return [
      // 常用
      { value: 'contains', label: '包含' },
      { value: 'startsWith', label: '开头是' },
      { value: 'endsWith', label: '结尾是' },
      ...equalityOptions,
      { value: 'like', label: '匹配(LIKE)' },
      { value: 'IN', label: '在列表中' },
      // 不常用
      { value: 'notLike', label: '不匹配(NOT LIKE)' },
      { value: 'NOT IN', label: '不在列表中' },
      ...nullOptions,
    ]
  }, [getFilterColumnType])

  const handleFilterColumnChange = useCallback((id: string, column: string) => {
    setDraftSimpleFilterTree((prev) => updateConditionInTree(prev, id, (target) => {
      const nextOperator = getOperatorOptions(column)[0]?.value as string || 'contains'
      return { ...target, column, operator: nextOperator, value: '', secondValue: '' }
    }))
  }, [getOperatorOptions])

  const syncFilterDraftFromApplied = useCallback(() => {
    setDraftFilterMode(filterMode)
    setDraftSimpleFilterTree(cloneSimpleFilterGroup(simpleFilterTree))
    setDraftWhereInput(whereInput)
  }, [filterMode, simpleFilterTree, whereInput])

  const openFilterModal = useCallback(() => {
    syncFilterDraftFromApplied()
    setIsFilterModalOpen(true)
  }, [syncFilterDraftFromApplied])

  const closeFilterModal = useCallback(() => {
    setIsFilterModalOpen(false)
  }, [])

  const handleDraftFilterModeChange = useCallback((mode: FilterMode) => {
    setDraftFilterMode(mode)
  }, [])

  const handleGroupJoinChange = useCallback((groupId: string, join: 'AND' | 'OR') => {
    setDraftSimpleFilterTree((prev) => updateGroupInTree(prev, groupId, (target) => ({ ...target, join })))
  }, [])

  const handleApplyFilterModal = useCallback(() => {
    applyWhereFilter(draftFilterMode, draftSimpleFilterTree, draftWhereInput)
    setIsFilterModalOpen(false)
  }, [applyWhereFilter, draftFilterMode, draftSimpleFilterTree, draftWhereInput])

  const handleAddSimpleFilter = useCallback((groupId: string) => {
    setDraftSimpleFilterTree((prev) => updateGroupInTree(prev, groupId, (target) => ({
      ...target,
      children: [...target.children, getDefaultSimpleFilter()],
    })))
  }, [])

  const handleAddSimpleFilterGroup = useCallback((groupId: string) => {
    setDraftSimpleFilterTree((prev) => updateGroupInTree(prev, groupId, (target) => ({
      ...target,
      children: [...target.children, getDefaultSimpleFilterGroup()],
    })))
  }, [])

  const handleRemoveSimpleFilterNode = useCallback((nodeId: string) => {
    setDraftSimpleFilterTree((prev) => removeNodeFromTree(prev, nodeId))
  }, [])

  const handleMoveFilterNode = useCallback((groupId: string, fromIndex: number, toIndex: number) => {
    setDraftSimpleFilterTree((prev) => moveNodeInGroup(prev, groupId, fromIndex, toIndex))
  }, [])

  const openDeleteConfirm = useCallback((targetKeys: string[]) => {
    if (targetKeys.length === 0 || deleteBusy || deleteConfirmOpen) return
    setSelectedRowKeys(new Set(targetKeys))
    setDeleteConfirmOpen(true)
  }, [deleteBusy, deleteConfirmOpen])

  const handleDelete = useCallback(async () => {
    if (selectedRowKeyList.length === 0 || deleteBusy) return
    setDeleteBusy(true)
    try {
      const newKeys = selectedRowKeyList.filter(k => k.startsWith('_new_'))
      const dbKeys = selectedRowKeyList.filter(k => !k.startsWith('_new_'))
      if (newKeys.length > 0) {
        setNewRows(prev => prev.filter(r => !newKeys.includes(String(r._newKey))))
      }
      if (dbKeys.length > 0 && pk) {
        await api.data.batchDelete(
          connectionId,
          database,
          table,
          dbKeys.map((key) => ({ [pk.name]: key }))
        )
        invalidateCountCache()
        await fetchData('reset', true)
      }
      setSelectedRowKeys(new Set())
      setDeleteConfirmOpen(false)
    } catch (e: any) {
      setError(e.message || '删除失败')
    } finally {
      setDeleteBusy(false)
    }
  }, [selectedRowKeyList, deleteBusy, pk, connectionId, database, table, invalidateCountCache, fetchData])

  const handleEditingDirtyChange = useCallback((rowKey: string, colName: string, isDirty: boolean) => {
    const cellKey = `${rowKey}:${colName}`
    setEditingDirtyCells((prev) => {
      const hasCell = prev.has(cellKey)
      if (isDirty && hasCell) return prev
      if (!isDirty && !hasCell) return prev
      const next = new Set(prev)
      if (isDirty) next.add(cellKey)
      else next.delete(cellKey)
      return next
    })
  }, [])

  const handleCellChange = useCallback((rowKey: unknown, colName: string, newValue: unknown) => {
    const key = String(rowKey)
    setEditingDirtyCells((prev) => {
      const cellKey = `${key}:${colName}`
      if (!prev.has(cellKey)) return prev
      const next = new Set(prev)
      next.delete(cellKey)
      return next
    })
    // 新增行直接改 newRows 数据
    if (key.startsWith('_new_')) {
      setNewRows(prev => prev.map(r => r._newKey === key ? { ...r, [colName]: newValue } : r))
      return
    }
    if (!pk) return
    setPendingChanges(prev => {
      const next = new Map(prev)
      const existing = next.get(key) || {}
      existing[colName] = newValue
      next.set(key, existing)
      return next
    })
  }, [pk])

  // 单元格选中：支持 Shift 矩形范围多选
  const handleCellSelect = useCallback((rowKey: string, colName: string, shiftKey: boolean) => {
    const key = `${rowKey}:${colName}`
    if (shiftKey && anchorCellRef.current && result?.columns) {
      const anchor = anchorCellRef.current
      const colNames = result.columns.map(c => c.name)
      const colStart = Math.min(colNames.indexOf(anchor.colName), colNames.indexOf(colName))
      const colEnd = Math.max(colNames.indexOf(anchor.colName), colNames.indexOf(colName))
      const rowStart = Math.min(allRowKeys.indexOf(anchor.rowKey), allRowKeys.indexOf(rowKey))
      const rowEnd = Math.max(allRowKeys.indexOf(anchor.rowKey), allRowKeys.indexOf(rowKey))
      if (colStart >= 0 && rowStart >= 0) {
        const next = new Set<string>()
        for (let r = rowStart; r <= rowEnd; r++) {
          for (let c = colStart; c <= colEnd; c++) {
            next.add(`${allRowKeys[r]}:${colNames[c]}`)
          }
        }
        setSelectedCells(next)
        return
      }
    }
    anchorCellRef.current = { rowKey, colName }
    setSelectedCells(new Set([key]))
  }, [result?.columns, allRowKeys])

  const applyPendingChangesToResult = useCallback((changes: Map<string, Record<string, unknown>>) => {
    if (!pk || changes.size === 0) return
    setResult((prev) => {
      if (!prev) return prev
      const nextRows = prev.rows.map((row) => {
        const rowKey = String(row[pk.name])
        const rowChanges = changes.get(rowKey)
        if (!rowChanges) return row
        return { ...row, ...rowChanges }
      })
      return { ...prev, rows: nextRows }
    })
  }, [pk])

  // 更新后静默二次校准：拿到触发器/默认值等服务端回写
  const revalidateRowsAfterSave = useCallback(async (changedRowKeys: string[]) => {
    if (!pk || changedRowKeys.length === 0 || !connectionId || !database || !table) return
    const uniqueKeys = Array.from(new Set(changedRowKeys.filter(Boolean)))
    if (uniqueKeys.length === 0) return
    const whereClause = uniqueKeys.map((k) => `\`${pk.name}\` = ${escSQL(k)}`).join(' OR ')
    const sql = `SELECT * FROM \`${table}\` WHERE ${whereClause}`
    try {
      const res = await api.query.execute(connectionId, sql, database)
      if (!res.rows?.length) return
      const rowMap = new Map<string, Record<string, unknown>>()
      res.rows.forEach((row) => rowMap.set(String(row[pk.name]), row))
      setResult((prev) => {
        if (!prev) return prev
        const nextRows = prev.rows.map((row) => {
          const key = String(row[pk.name])
          return rowMap.get(key) ?? row
        })
        return { ...prev, rows: nextRows }
      })
    } catch {
      // 静默校准失败不阻断主链路
    }
  }, [pk, connectionId, database, table])

  const handleSaveChanges = useCallback(async () => {
    if (isSaving) return
    const cols = result?.columns || []
    const hasUpdates = pk && pendingChanges.size > 0
    const hasInserts = newRows.length > 0
    if (!hasUpdates && !hasInserts) return

    setIsSaving(true)
    try {
      // 保存修改行：直接本地合并，避免整表刷新闪烁
      if (hasUpdates) {
        const changedKeys = Array.from(pendingChanges.keys())
        const updateItems = changedKeys.map((rowKey) => ({
          data: pendingChanges.get(rowKey) || {},
          where: { [pk!.name]: rowKey }
        }))
        await api.data.batchUpdate(connectionId, database, table, updateItems)
        applyPendingChangesToResult(pendingChanges)
        setPendingChanges(new Map())
        void revalidateRowsAfterSave(changedKeys)
      }
      // 保存新增行：需要拿到数据库真实主键，静默刷新一次
      if (hasInserts) {
        const rows = newRows.map((row) => {
          const data: Record<string, unknown> = {}
          for (const col of cols) {
            if (col.autoIncrement) continue
            data[col.name] = row[col.name] ?? null
          }
          return data
        })
        if (rows.length > 0) {
          await api.data.batchInsert(connectionId, database, table, rows)
        }
        setNewRows([])
      }
      setEditingDirtyCells(new Set())
      invalidateCountCache()
      if (hasInserts) {
        await fetchData('reset', true, undefined, false)
      }
    } catch (e: any) {
      const cleaned = normalizeIpcErrorMessage(e)
      setError(cleaned || '保存失败')
      setSaveErrorText(cleaned || '保存失败')
      setSaveErrorModalOpen(true)
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, pk, pendingChanges, newRows, result?.columns, connectionId, database, table, fetchData, invalidateCountCache, applyPendingChangesToResult, revalidateRowsAfterSave])

  const handleSaveChangesRef = useRef(handleSaveChanges)

  useEffect(() => {
    handleSaveChangesRef.current = handleSaveChanges
  }, [handleSaveChanges])

  const flushEditingAndSave = useCallback(() => {
    const active = document.activeElement as HTMLElement | null
    const inTableData = !!(active && rootRef.current?.contains(active))
    const isEditingInput = !!(active && inTableData && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable))

    if (isEditingInput) {
      active.blur()
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          void handleSaveChangesRef.current()
        })
      })
      return
    }

    void handleSaveChangesRef.current()
  }, [])

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        flushEditingAndSave()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [flushEditingAndSave])

  // Delete：勾选行删除（走与删除按钮一致的确认流程）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return
      if (selectedRowKeyList.length === 0 || deleteConfirmOpen) return
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        const inputType = (active as HTMLInputElement).type
        const isTypingInput = tag === 'TEXTAREA' || active.isContentEditable || (tag === 'INPUT' && inputType !== 'checkbox')
        if (isTypingInput) return
      }
      e.preventDefault()
      openDeleteConfirm(selectedRowKeyList)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedRowKeyList, deleteConfirmOpen, openDeleteConfirm])

  // 选区数字键批量改值（列头整列与 Shift 矩形多选共用）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedCells.size <= 1) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      if (!/^[0-9]$/.test(e.key)) return
      e.preventDefault()
      const nextValue = e.key
      selectedCells.forEach((cellKey) => {
        const splitAt = cellKey.indexOf(':')
        if (splitAt <= 0) return
        const rowKey = cellKey.slice(0, splitAt)
        const colName = cellKey.slice(splitAt + 1)
        if (!colName) return
        handleCellChange(rowKey, colName, nextValue)
      })
      markCellsRecentlyUpdated(selectedCells)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedCells, handleCellChange, markCellsRecentlyUpdated])

  // 关闭右键菜单
  useEffect(() => {
    const close = () => setCellContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [])

  // 关闭字段排序菜单（点击空白/滚动）
  useEffect(() => {
    if (!headerContextMenu) return
    const closeOnClick = (evt: MouseEvent) => {
      const target = evt.target as HTMLElement | null
      if (!target) return
      if (target.closest('.context-menu') || target.closest('.header-menu-btn')) return
      setHeaderContextMenu(null)
    }
    const closeOnScroll = () => setHeaderContextMenu(null)
    document.addEventListener('click', closeOnClick, true)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('click', closeOnClick, true)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [headerContextMenu])

  // 全局空白点击：取消选中与关闭菜单
  useEffect(() => {
    const onPointerDown = (evt: PointerEvent) => {
      const target = evt.target as HTMLElement | null
      if (!target) return
      // 排除表格内容、滚动容器（滚动条点击）等
      if (target.closest('.ui-table td, .ui-table th, .ui-table-scroll, .context-menu, .ui-modal, .header-menu-btn, .ui-btn, .ui-input, input, textarea, select, a, [role="button"]')) return
      clearAllSelections()
      setHeaderContextMenu(null)
      setCellContextMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [clearAllSelections])

  // SQL 生成
  const generateInsertSQL = (record: Record<string, unknown>) => {
    const cols = result?.columns.map(c => c.name) || Object.keys(record).filter(k => k !== '_rowIndex')
    const vals = cols.map(c => escSQL(record[c]))
    return `INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`) VALUES (${vals.join(', ')});`
  }

  const generateUpdateSQL = (record: Record<string, unknown>) => {
    const cols = result?.columns.map(c => c.name) || Object.keys(record).filter(k => k !== '_rowIndex')
    const sets = cols.map(c => `\`${c}\` = ${escSQL(record[c])}`).join(', ')
    const whereClause = pk ? `\`${pk.name}\` = ${escSQL(record[pk.name])}` : '1=1'
    return `UPDATE \`${table}\` SET ${sets} WHERE ${whereClause};`
  }

  const handleCellContextMenu = (e: React.MouseEvent, rowKey: string, colName: string, record: Record<string, unknown>) => {
    e.preventDefault()
    e.stopPropagation()
    const menuH = 220
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setCellContextMenu({ x: e.clientX, y, rowKey, colName, record })
  }

  const handleContextAction = async (action: string) => {
    if (!cellContextMenu) return
    const { rowKey, colName, record } = cellContextMenu
    setCellContextMenu(null)

    // 若勾选了多行，则按多行执行；否则按当前右键行执行
    const selectedKeys = selectedRowKeyList.length > 0 ? selectedRowKeyList : [rowKey]

    switch (action) {
      case 'copyInsert': {
        const sql = selectedKeys
          .map(k => rowsByKey.get(k))
          .filter(Boolean)
          .map(r => generateInsertSQL(r!))
          .join('\n')
        await navigator.clipboard.writeText(sql)
        break
      }
      case 'copyUpdate': {
        const sql = selectedKeys
          .map(k => rowsByKey.get(k))
          .filter(Boolean)
          .map(r => generateUpdateSQL(r!))
          .join('\n')
        await navigator.clipboard.writeText(sql)
        break
      }
      case 'setEmpty':
        for (const k of selectedKeys) handleCellChange(k, colName, '')
        break
      case 'setNull':
        for (const k of selectedKeys) handleCellChange(k, colName, null)
        break
      case 'deleteRow': {
        openDeleteConfirm(selectedKeys)
        break
      }
    }
  }

  const handleToolbarDelete = useCallback(() => {
    openDeleteConfirm(selectedRowKeyList)
  }, [openDeleteConfirm, selectedRowKeyList])

  // Ctrl/Cmd + A：数据详情页全选所有复选框行（用于批量删除/导出）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      const root = rootRef.current
      if (!root || root.offsetParent === null) return
      if (allRowKeys.length === 0) return
      e.preventDefault()
      setSelectedRowKeys(new Set(allRowKeys))
      setSelectedCells(new Set())
      lastCheckedRef.current = allRowKeys[allRowKeys.length - 1] || null
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [allRowKeys])

  // checkbox 列 + 数据列
  const allChecked = useMemo(
    () => allRowKeys.length > 0 && allRowKeys.every((k) => selectedRowKeys.has(k)),
    [allRowKeys, selectedRowKeys]
  )

  const checkboxCol = useMemo(() => ({
    key: '_checkbox',
    title: (
      <input
        type="checkbox"
        checked={allChecked}
        onChange={() => {
          if (allChecked) setSelectedRowKeys(new Set())
          else setSelectedRowKeys(new Set(allRowKeys))
        }}
      />
    ),
    dataIndex: '_checkbox' as string,
    width: 40,
    render: (_: unknown, record: Record<string, unknown>) => {
      const rk = getRowKey(record)
      return (
        <input
          type="checkbox"
          checked={selectedRowKeys.has(rk)}
          onClick={(e) => {
            const nativeEvent = e.nativeEvent as MouseEvent
            setSelectedRowKeys(prev => {
              const next = new Set(prev)
              if (nativeEvent.shiftKey && lastCheckedRef.current) {
                const from = allRowKeys.indexOf(lastCheckedRef.current)
                const to = allRowKeys.indexOf(rk)
                if (from >= 0 && to >= 0) {
                  const [start, end] = from < to ? [from, to] : [to, from]
                  for (let i = start; i <= end; i++) next.add(allRowKeys[i])
                }
              } else {
                next.has(rk) ? next.delete(rk) : next.add(rk)
              }
              return next
            })
            lastCheckedRef.current = rk
          }}
          onChange={() => {}}
        />
      )
    },
  }), [allChecked, allRowKeys, getRowKey, selectedRowKeys])

  const handleHeaderMenuAction = useCallback((action: 'asc' | 'desc' | 'clear') => {
    if (!headerContextMenu) return
    const colName = headerContextMenu.colName
    const nextOrderBy = action === 'asc'
      ? `\`${colName}\` ASC`
      : action === 'desc'
        ? `\`${colName}\` DESC`
        : ''

    setOrderBy(nextOrderBy)
    setHeaderContextMenu(null)
    setPage(1)
    setCursor(null)
    fetchData('reset', false, 1, true, nextOrderBy)
  }, [headerContextMenu, fetchData])

  const dataCols = useMemo(() => result?.columns.map((col) => {
    const columnComment = columnDetailsByName.get(col.name)?.comment?.trim() || ''
    return {
      key: col.name,
      title: (
        <div
          onClick={(e) => {
            e.stopPropagation()
            handleColumnSelect(col.name)
          }}
          title={columnComment ? `${col.name} - ${columnComment}` : col.name}
          style={{ cursor: 'pointer', lineHeight: 1.2 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>{col.name}</div>
            <button
              type="button"
              className="header-menu-btn"
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                setHeaderContextMenu((prev) => {
                  if (prev?.colName === col.name) return null
                  return { x: rect.left, y: rect.bottom + 4, colName: col.name }
                })
              }}
              title="排序选项"
            >
              <MoreOutlined />
            </button>
          </div>
          {columnComment && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 180,
              }}
              title={columnComment}
            >
              {columnComment}
            </div>
          )}
        </div>
      ),
      dataIndex: col.name,
      ellipsis: true,
      width: 170,
      render: (v: unknown, record: Record<string, unknown>) => {
        const rk = getRowKey(record)
        const pending = pendingChanges.get(rk)
        const cellValue = pending && col.name in pending ? pending[col.name] : v
        const cellKey = `${rk}:${col.name}`
        const isSel = selectedCells.has(cellKey)
        const isFoc = selectedCells.size === 1 && isSel
        const isRecentlyUpdated = recentlyUpdatedCells.has(cellKey)
        return (
          <EditableCell
            value={cellValue}
            colType={col.type}
            isSelected={isSel}
            isFocused={isFoc}
            isRecentlyUpdated={isRecentlyUpdated}
            onSelect={(shiftKey) => handleCellSelect(rk, col.name, shiftKey)}
            onSave={(newVal) => handleCellChange(rk, col.name, newVal)}
            onDirtyChange={(isDirty) => handleEditingDirtyChange(rk, col.name, isDirty)}
            onContextMenu={(e) => handleCellContextMenu(e, rk, col.name, record)}
          />
        )
      },
    }
  }) || [], [result?.columns, pendingChanges, selectedCells, recentlyUpdatedCells, columnDetailsByName, handleCellChange, handleCellSelect, handleColumnSelect, handleEditingDirtyChange])

  const columns = useMemo(() => [checkboxCol, ...dataCols], [checkboxCol, dataCols])
  const isKeysetMode = lastQueryMode === 'keyset'
  const configuredModeLabel = PAGINATION_MODE_LABEL[paginationMode]
  const effectiveModeLabel = lastQueryMode === 'keyset' ? '游标' : '偏移'

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px' }}>
      <Space style={{ marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" style={{ height: 28, padding: '0 12px' }} onClick={openFilterModal}>
          <FilterOutlined /> {effectiveWhere ? '编辑筛选' : '筛选'}
        </Button>
        {effectiveWhere ? (
          <Tag color="primary" title={effectiveWhere}>当前条件：{filterSummary || effectiveWhere}</Tag>
        ) : (
          <Tag>未筛选</Tag>
        )}
        <Button size="small" style={{ height: 28, padding: '0 12px' }} disabled={newRows.length > 0} onClick={() => {
          newRowCounter.current += 1
          const emptyRow: Record<string, unknown> = { _newKey: `_new_${newRowCounter.current}` }
          for (const col of (result?.columns || [])) {
            emptyRow[col.name] = col.autoIncrement ? null : null
          }
          setNewRows(prev => [...prev, emptyRow])
        }}>
          <PlusOutlined /> 新增
        </Button>
        <Button
          size="small"
          type="danger"
          disabled={selectedRowKeyList.length === 0 || deleteBusy}
          onClick={handleToolbarDelete}
        >
          <DeleteOutlined /> 删除({selectedRowKeyList.length})
        </Button>
        {(hasUnsavedChanges || isSaving) && (
          <Button
            size="small"
            type="primary"
            loading={isSaving}
            disabled={isSaving}
            onClick={flushEditingAndSave}
            style={{ minWidth: 132, transition: 'opacity 0.2s ease, transform 0.2s ease', opacity: isSaving ? 0.9 : 1 }}
          >
            <SaveOutlined /> {isSaving ? '保存中...' : `保存修改 (${pendingChanges.size + newRows.length + editingDirtyCells.size})`}
          </Button>
        )}
        {newRows.length === 0 && <Button size="small" style={{ height: 28, padding: '0 12px' }} onClick={() => setExportOpen(true)}>导出</Button>}
      </Space>

      {error && <div style={{ color: 'var(--color-red)', marginBottom: 8 }}>{error}</div>}

      <FilterModal
        open={isFilterModalOpen}
        filterMode={draftFilterMode}
        simpleFilterTree={draftSimpleFilterTree}
        whereInput={draftWhereInput}
        effectiveWhere={effectiveWhere}
        columnOptions={simpleFilterColumnOptions}
        onClose={closeFilterModal}
        onApply={handleApplyFilterModal}
        onFilterModeChange={handleDraftFilterModeChange}
        onGroupJoinChange={handleGroupJoinChange}
        onConditionColumnChange={handleFilterColumnChange}
        onConditionChange={handleSimpleFilterChange}
        onAddCondition={handleAddSimpleFilter}
        onAddGroup={handleAddSimpleFilterGroup}
        onRemoveNode={handleRemoveSimpleFilterNode}
        onMoveNode={handleMoveFilterNode}
        onWhereInputChange={setDraftWhereInput}
        getOperatorOptions={getOperatorOptions}
      />

      <Modal
        open={saveErrorModalOpen}
        title={'保存失败'}
        onClose={() => setSaveErrorModalOpen(false)}
        onOk={() => setSaveErrorModalOpen(false)}
        okText="知道了"
        cancelText=""
        footer={(
          <Button variant="primary" onClick={() => setSaveErrorModalOpen(false)}>
            知道了
          </Button>
        )}
        width={560}
      >
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
          {saveErrorText}
        </div>
      </Modal>

      <div style={{ flex: 1, minHeight: 0 }} onClick={handleCanvasClick}>
        <Table
          size="small"
          loading={loading}
          dataSource={tableDataSource}
          columns={columns}
          rowKey={getRowKey}
          onRow={(record: Record<string, unknown>) => {
            const rk = getRowKey(record)
            const isSelected = selectedRowKeys.has(rk)
            const isNew = !!record._newKey
            let style: React.CSSProperties | undefined
            if (isSelected && isNew) {
              style = { background: 'rgba(114, 104, 232, 0.15)' }
            } else if (isSelected) {
              style = { background: 'rgba(114, 104, 232, 0.12)' }
            } else if (isNew) {
              style = { background: 'rgba(34,197,94,0.12)' }
            }
            return { style }
          }}
          scroll={{ x: 'max-content' }}
          virtual={{
            enabled: tableDataSource.length >= TABLEDATA_VIRTUAL_THRESHOLD,
            rowHeight: 34,
            overscan: 8,
            threshold: TABLEDATA_VIRTUAL_THRESHOLD,
          }}
          resizable
        />
      </div>

      <div style={{ padding: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          共 {totalCount} 行
          {isKeysetMode ? `，当前第 ${page} 页（游标翻页）` : `，共 ${totalPages} 页`}
          {`，配置模式：${configuredModeLabel}，实际模式：${effectiveModeLabel}`}
          {(pendingPaginationHint || paginationFallbackHint) && <span style={{ color: 'var(--warning, #f59e0b)' }}>（{pendingPaginationHint || paginationFallbackHint}）</span>}
          {(hasUnsavedChanges || isSaving) && <span style={{ color: 'var(--accent)' }}>| 未保存: {pendingChanges.size + newRows.length + editingDirtyCells.size} 行 (Ctrl+S)</span>}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="ui-btn ui-btn-default"
            disabled={loading || page <= 1}
            onClick={() => {
              if (loading || page <= 1) return
              setPage((prev) => Math.max(1, prev - 1))
              const prevPage = Math.max(1, page - 1)
              if (prevPage === 1) {
                setCursor(null)
                fetchData('reset', false, 1)
              } else {
                fetchData(isKeysetMode ? 'prev' : 'reset', false, prevPage)
              }
            }}
          >
            上一页
          </button>
          <span>{isKeysetMode ? page : `${page} / ${totalPages}`}</span>
          <button
            className="ui-btn ui-btn-default"
            disabled={loading || (isKeysetMode ? !hasNextPage : page >= totalPages)}
            onClick={() => {
              if (loading || (isKeysetMode ? !hasNextPage : page >= totalPages)) return
              const nextPage = page + 1
              setPage(nextPage)
              fetchData(isKeysetMode ? 'next' : 'reset', false, nextPage)
            }}
          >
            下一页
          </button>
          {isKeysetMode ? (
            <span style={{ color: 'var(--text-muted)' }}>游标分页不支持跳转页码</span>
          ) : (
            <>
              <span style={{ color: 'var(--text-muted)' }}>跳转到</span>
              <Input
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const n = Number(jumpPage)
                    if (!Number.isFinite(n) || n < 1) return
                    const targetPage = Math.min(totalPages, n)
                    setPage(targetPage)
                    setCursor(null)
                    fetchData('reset', false, targetPage)
                  }
                }}
                style={{ width: 64 }}
                placeholder="页码"
              />
              <button
                className="ui-btn ui-btn-default"
                onClick={() => {
                  const n = Number(jumpPage)
                  if (!Number.isFinite(n) || n < 1) return
                  const targetPage = Math.min(totalPages, n)
                  setPage(targetPage)
                  setCursor(null)
                  fetchData('reset', false, targetPage)
                }}
              >
                跳转
              </button>
            </>
          )}
        </div>
      </div>

      <Modal
        open={deleteConfirmOpen}
        title="确认删除"
        width={420}
        onClose={() => !deleteBusy && setDeleteConfirmOpen(false)}
        footer={(
          <>
            <Button variant="default" disabled={deleteBusy} onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
            <Button variant="danger" loading={deleteBusy} onClick={handleDelete}>确认删除</Button>
          </>
        )}
      >
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          确定删除已勾选的 <b>{selectedRowKeyList.length}</b> 行数据吗？此操作不可撤销。
        </div>
      </Modal>

      {headerContextMenu && (
        <div
          className="context-menu"
          style={{ left: headerContextMenu.x, top: headerContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('asc')}>升序排序</div>
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('desc')}>降序排序</div>
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('clear')}>移除所有排序</div>
        </div>
      )}

      {/* 单元格右键菜单 */}
      {cellContextMenu && (() => {
        const count = selectedRowKeyList.length > 0 ? selectedRowKeyList.length : 1
        const suffix = count > 1 ? `(${count})` : ''
        return (
        <div
          className="context-menu"
          style={{ left: cellContextMenu.x, top: cellContextMenu.y }}
          onClick={() => setCellContextMenu(null)}
        >
          <div className="context-menu-item" onClick={() => handleContextAction('copyInsert')}>复制为 INSERT{suffix}</div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyUpdate')}>复制为 UPDATE{suffix}</div>
          {count <= 1 && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <div className="context-menu-item" onClick={() => handleContextAction('setEmpty')}>设为空字符串</div>
              <div className="context-menu-item" onClick={() => handleContextAction('setNull')}>设为 NULL</div>
            </>
          )}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <div className="context-menu-item danger" onClick={() => handleContextAction('deleteRow')}><DeleteOutlined /> 删除行{suffix}</div>
        </div>
        )
      })()}

      <DataExport
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        connectionId={connectionId}
        database={database}
        table={table}
        initialWhere={effectiveWhere}
      />
    </div>
  )
}
