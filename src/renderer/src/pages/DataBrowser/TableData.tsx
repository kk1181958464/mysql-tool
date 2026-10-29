import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Table, Input, Button, DateTimePicker, Modal, Toast, toast, Alert, Select, Tooltip } from '../../components/ui'
import { PlusOutlined, DeleteOutlined, FilterOutlined, SaveOutlined, MoreOutlined, SearchOutlined, CloseOutlined, ExportOutlined, CodeOutlined, ProfileOutlined, UndoOutlined, CopyOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { api } from '../../utils/ipc'
import type { QueryResult } from '../../../../shared/types/query'
import type { ColumnDetail } from '../../../../shared/types/metadata'
import { DataExport } from './DataExport'
import { FilterModal, type FilterMode, type SimpleFilterGroup } from './FilterModal'
import { useAppStore } from '../../stores/app.store'
import { useDatabaseStore } from '../../stores/database.store'
import { useTabStore } from '../../stores/tab.store'
import type { PaginationMode } from '../../../../shared/constants'
import tableTransformWorker from '../../workers/table-transform.worker?worker'
import { buildKeysetPredicate, compareDirection, escSQL, parseSort, quoteId } from './table-pagination'
import {
  buildSimpleFilterWhere,
  cloneSimpleFilterGroup,
  describeSimpleFilterNode,
  getDefaultSimpleFilter,
  getDefaultSimpleFilterGroup,
  isDateLikeType,
  moveNodeInGroup,
  removeNodeFromTree,
  updateConditionInTree,
  updateGroupInTree,
  type SimpleFilterField,
} from './table-filter'
import { parseClipboardGrid } from './table-clipboard'
import { RowDetailPanel } from './RowDetailPanel'
import { ColumnPicker } from './ColumnPicker'
import { ErrorNotice } from '../../components/ErrorNotice'
import { formatErrorSummary, getErrorMessage } from '../../utils/error-info'

interface Props {
  tabId: string
  connectionId: string
  database: string
  table: string
  refreshVersion?: number
}

interface KeysetCursor {
  firstPk: unknown
  lastPk: unknown
  firstSort?: unknown
  lastSort?: unknown
}

type EffectivePagination = 'keyset' | 'offset'

const PAGINATION_MODE_LABEL: Record<PaginationMode, string> = {
  auto: '自动',
  cursor: '游标',
  offset: '偏移',
}

const singlePrimaryKey = (columns?: Array<{ name: string; primaryKey?: boolean }>): string | undefined => {
  const keys = columns?.filter((c) => c.primaryKey) ?? []
  return keys.length === 1 ? keys[0].name : undefined
}

// duck typing 检测 Date（IPC序列化后 instanceof 可能失效）
const isDateValue = (val: unknown): val is Date =>
  val !== null && val !== undefined && typeof (val as any).getTime === 'function'

const pad2 = (n: number) => n.toString().padStart(2, '0')

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

const fmtDT = (d: Date) =>
  `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`

const MAX_CELL_DISPLAY_LENGTH = 500

const isBinaryValue = (val: unknown): val is Uint8Array =>
  val instanceof Uint8Array || (typeof val === 'object' && val !== null && (val as { type?: string }).type === 'Buffer' && Array.isArray((val as { data?: unknown }).data))

const binaryLength = (val: Uint8Array | { data: unknown[] }) => (val instanceof Uint8Array ? val.length : val.data.length)

const fmtValue = (val: unknown, isDateOnly = false): string => {
  if (val === null || val === undefined) return ''
  if (isBinaryValue(val)) return `(BLOB ${binaryLength(val as Uint8Array).toLocaleString()} 字节)`
  // mysql2 may return JSON columns as objects. String(object) produces
  // "[object Object]", which hides the actual value in the data grid.
  if (typeof val === 'object' && !isDateValue(val)) {
    try {
      return JSON.stringify(val)
    } catch {
      return String(val)
    }
  }
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

const isNumericType = (type: string) => /int|decimal|float|double|numeric|real|bit|serial/i.test(type)

const isElementVisible = (el: HTMLElement | null): boolean => {
  if (!el) return false
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
}

// SQL 转义
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
  background: 'color-mix(in srgb, var(--warning) 18%, transparent)',
  animation: 'cell-flash 900ms var(--ease-out)',
}
const cellStyleSelectedUpdated: React.CSSProperties = {
  ...cellStyleSelected,
  boxShadow: 'inset 2px 0 0 var(--accent), inset 0 0 0 1px color-mix(in srgb, var(--warning) 80%, transparent)',
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

const toCellKey = (rowKey: string, colName: string) => JSON.stringify([rowKey, colName])
const toCellDomId = (rowKey: string, colName: string) => encodeURIComponent(toCellKey(rowKey, colName))

const parseCellKey = (cellKey: string): { rowKey: string; colName: string } | null => {
  try {
    const parsed = JSON.parse(cellKey)
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [rowKey, colName] = parsed.map(String)
      if (rowKey && colName) return { rowKey, colName }
    }
  } catch {
    // Keep compatibility with selections created by the old row:column key format.
  }
  const splitAt = cellKey.indexOf(':')
  if (splitAt <= 0) return null
  const rowKey = cellKey.slice(0, splitAt)
  const colName = cellKey.slice(splitAt + 1)
  if (!rowKey || !colName) return null
  return { rowKey, colName }
}

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'))

// 可编辑单元格 - Navicat 风格
const EditableCell: React.FC<{
  value: unknown
  colType?: string
  cellDomId: string
  isSelected: boolean
  isFocused: boolean
  isRecentlyUpdated: boolean
  onSelect: (shiftKey: boolean) => void
  onSave: (newValue: unknown) => void
  onDirtyChange: (isDirty: boolean) => void
  onContextMenu: (e: React.MouseEvent) => void
}> = React.memo(({ value, colType = '', cellDomId, isSelected, isFocused, isRecentlyUpdated, onSelect, onSave, onDirtyChange, onContextMenu }) => {
  const [editing, setEditing] = useState(false)
  const lowerType = colType.toLowerCase()
  const mysqlTypeCode = Number(lowerType)
  const isMysqlDateCode = Number.isFinite(mysqlTypeCode) && [7, 10, 12].includes(mysqlTypeCode)
  const isDateOnly = lowerType === 'date' || lowerType === '10'
  const isDT = isDateOnly || isMysqlDateCode || lowerType.includes('datetime') || lowerType.includes('timestamp')
  const [inputValue, setInputValue] = useState('')
  const initialInputRef = useRef('')
  const [anchorRect, setAnchorRect] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  const displayValue = useMemo(() => fmtValue(value, isDateOnly), [value, isDateOnly])
  const isBinary = isBinaryValue(value)
  const shownValue = displayValue.length > MAX_CELL_DISPLAY_LENGTH ? `${displayValue.slice(0, MAX_CELL_DISPLAY_LENGTH)}…` : displayValue

  const enterEditing = useCallback(() => {
    if (isBinary) return
    window.dispatchEvent(new Event('app:close-context-menus'))
    document.dispatchEvent(new Event('app:close-context-menus'))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    if (cellRef.current) {
      const r = cellRef.current.getBoundingClientRect()
      setAnchorRect({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
    setEditing(true)
  }, [isBinary])

  const isInputChanged = useCallback((val: string) => {
    if (val === initialInputRef.current) return false
    if (value === null && val === '') return false
    return val !== displayValue
  }, [value, displayValue])

  const commitText = useCallback((val: string) => {
    if (isInputChanged(val)) onSave(val)
    onDirtyChange(false)
    setEditing(false)
  }, [isInputChanged, onSave, onDirtyChange])

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
    onDirtyChange(isInputChanged(inputValue))
  }, [editing, inputValue, isInputChanged, onDirtyChange])

  // 选中状态下，按键直接输入（替换值）— 仅 focused 单元格
  useEffect(() => {
    if (!isFocused || editing) return
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return
      if (cellRef.current && cellRef.current.offsetParent === null) return
      if (isBinary && e.key !== 'Delete') return
      if (document.querySelector('.ui-modal-overlay')) return
      if (e.key.length === 1) {
        e.preventDefault()
        enterEditing()
        initialInputRef.current = isDT ? '' : (value === null ? '' : displayValue)
        setInputValue(isDT ? '' : e.key)
      } else if (e.key === 'F2' || e.key === 'Enter') {
        e.preventDefault()
        enterEditing()
        initialInputRef.current = isDT ? displayValue : (value === null ? '' : displayValue)
        setInputValue(initialInputRef.current)
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
      data-cell-id={cellDomId}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey) }}
      onDoubleClick={() => {
        window.dispatchEvent(new Event('app:close-context-menus'))
        enterEditing()
        initialInputRef.current = isDT ? displayValue : (value === null ? '' : displayValue)
        setInputValue(initialInputRef.current)
      }}
      onContextMenu={onContextMenu}
      style={displayStyle}
    >
      {value === null ? <span style={nullStyle}>NULL</span> : shownValue}
    </div>
  )
}, (prev, next) => prev.value === next.value && prev.cellDomId === next.cellDomId && prev.isSelected === next.isSelected && prev.isFocused === next.isFocused && prev.colType === next.colType && prev.isRecentlyUpdated === next.isRecentlyUpdated)

export const TableData: React.FC<Props> = ({ tabId, connectionId, database, table, refreshVersion = 0 }) => {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const defaultRowsPerPage = useAppStore((s) => s.rowsPerPage)
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage)
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
  const [countSource, setCountSource] = useState<'unknown' | 'estimate' | 'exact'>('unknown')
  const [countLoading, setCountLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
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
  const countCacheRef = useRef<Map<string, { count: number; ts: number; source: 'estimate' | 'exact' }>>(new Map())
  const countRequestIdRef = useRef(0)
  const [cursor, setCursor] = useState<KeysetCursor | null>(null)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [lastQueryMode, setLastQueryMode] = useState<EffectivePagination>('offset')
  const [paginationFallbackHint, setPaginationFallbackHint] = useState('')
  const [transformedBaseRows, setTransformedBaseRows] = useState<Array<Record<string, unknown>>>([])
  const [pendingPaginationHint, setPendingPaginationHint] = useState('')
  const [visibleColumnNames, setVisibleColumnNames] = useState<Set<string>>(new Set())
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [lastSql, setLastSql] = useState('')
  const [sqlOpen, setSqlOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRowKey, setDetailRowKey] = useState<string | null>(null)
  const addQueryTab = useTabStore((s) => s.addQueryTab)
  const knownColumnNamesRef = useRef<Set<string>>(new Set())
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

  useEffect(() => {
    knownColumnNamesRef.current = new Set()
    setVisibleColumnNames(new Set())
    setSearchInput('')
    setSearch('')
    setDetailRowKey(null)
  }, [connectionId, database, table])

  useEffect(() => {
    const names = (result?.columns || []).map((column) => column.name)
    if (!names.length) return
    setVisibleColumnNames((previous) => {
      const known = knownColumnNamesRef.current
      const next = new Set([...previous].filter((name) => names.includes(name)))
      for (const name of names) {
        if (!known.has(name)) next.add(name)
      }
      knownColumnNamesRef.current = new Set(names)
      return next
    })
  }, [result?.columns])

  const simpleFilterColumnOptions = useMemo(
    () => (result?.columns || []).map((col) => ({ value: col.name, label: col.name })),
    [result?.columns]
  )

  const getFilterColumnType = useCallback((columnName: string) => {
    const column = result?.columns.find((item) => item.name === columnName)
    return column?.type || columnDetailsByName.get(columnName)?.dataType || ''
  }, [result?.columns, columnDetailsByName])

  const filterWhere = useMemo(
    () => filterMode === 'simple' ? buildSimpleFilterWhere(appliedSimpleFilterTree, getFilterColumnType) : where,
    [filterMode, appliedSimpleFilterTree, getFilterColumnType, where]
  )

  // 快速搜索：文本类字段 LIKE，数字关键字额外匹配数值字段
  const searchWhere = useMemo(() => {
    const keyword = search.trim()
    if (!keyword || !result?.columns.length) return ''
    const typeOf = (name: string) => columnDetailsByName.get(name)?.dataType || ''
    const like = escSQL(`%${keyword.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
    const parts: string[] = []
    for (const col of result.columns) {
      const type = typeOf(col.name)
      if (/char|text|enum|set|json/i.test(type)) parts.push(`${quoteId(col.name)} LIKE ${like}`)
      else if (/^-?\d+(\.\d+)?$/.test(keyword) && isNumericType(type)) parts.push(`${quoteId(col.name)} = ${keyword}`)
    }
    return parts.length ? parts.join(' OR ') : '1 = 0'
  }, [search, result?.columns, columnDetailsByName])

  const effectiveWhere = useMemo(
    () => [filterWhere, searchWhere].filter((p) => p.trim()).map((p) => (filterWhere && searchWhere ? `(${p})` : p)).join(' AND '),
    [filterWhere, searchWhere]
  )

  const filterSummary = useMemo(
    () => filterMode === 'simple' ? describeSimpleFilterNode(appliedSimpleFilterTree) : (where.trim() ? `高级 WHERE: ${where.trim()}` : ''),
    [filterMode, appliedSimpleFilterTree, where]
  )

  const sortSummary = useMemo(() => {
    const match = orderBy.match(/^`?([^`]+)`?\s+(ASC|DESC)$/i)
    if (!match) return ''
    return `${match[1]} ${match[2].toUpperCase() === 'DESC' ? '降序' : '升序'}`
  }, [orderBy])

  const countCacheKey = useMemo(
    () => `${connectionId}|${database}|${table}|${effectiveWhere.trim()}`,
    [connectionId, database, table, effectiveWhere]
  )

  useEffect(() => {
    fetchRequestIdRef.current += 1
    const emptyFilter = getDefaultSimpleFilterGroup()

    setResult(null)
    setLoading(false)
    setPage(1)
    setJumpPage('')
    setFilterMode('simple')
    setSimpleFilterTree(emptyFilter)
    setAppliedSimpleFilterTree(cloneSimpleFilterGroup(emptyFilter))
    setWhereInput('')
    setWhere('')
    setIsFilterModalOpen(false)
    setDraftFilterMode('simple')
    setDraftSimpleFilterTree(cloneSimpleFilterGroup(emptyFilter))
    setDraftWhereInput('')
    setOrderBy('')
    setRowsPerPage(defaultRowsPerPage)
    setLastSql('')
    setSelectedRowKeys(new Set())
    setDeleteConfirmOpen(false)
    setDeleteBusy(false)
    lastCheckedRef.current = null
    setSelectedCells(new Set())
    anchorCellRef.current = null
    setNewRows([])
    newRowCounter.current = 0
    setExportOpen(false)
    setTotalCount(0)
    setCountSource('unknown')
    setCountLoading(false)
    setError('')
    setSuccessMessage('')
    setSaveErrorModalOpen(false)
    setSaveErrorText('')
    setPendingChanges(new Map())
    setEditingDirtyCells(new Set())
    setIsSaving(false)
    setRecentlyUpdatedCells(new Set())
    setHeaderContextMenu(null)
    setCellContextMenu(null)
    setCursor(null)
    setHasNextPage(false)
    setLastQueryMode('offset')
    setPaginationFallbackHint('')
    setTransformedBaseRows([])
    setPendingPaginationHint('')
    countCacheRef.current.clear()
    if (clearUpdatedTimerRef.current !== null) {
      window.clearTimeout(clearUpdatedTimerRef.current)
      clearUpdatedTimerRef.current = null
    }
    setDataDirty(tabId, false)
  }, [connectionId, database, table, setDataDirty, tabId])

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

  useEffect(() => {
    if (!successMessage) return
    const timer = window.setTimeout(() => setSuccessMessage(''), 3500)
    return () => window.clearTimeout(timer)
  }, [successMessage])

  const applyCachedCount = useCallback((cached: { count: number; source: 'estimate' | 'exact' } | undefined, pageRows: number, pageValue: number) => {
    if (cached?.source === 'exact' || (cached && effectiveWhere.trim())) {
      setTotalCount(cached.count)
      setCountSource(cached.source)
      return
    }
    const minimumKnownRows = (pageValue - 1) * rowsPerPage + pageRows
    setTotalCount((prev) => Math.max(cached?.count ?? 0, prev, minimumKnownRows))
    setCountSource(cached ? 'estimate' : 'unknown')
  }, [effectiveWhere, rowsPerPage])

  const loadEstimatedCount = useCallback(async (requestId: number) => {
    if (!connectionId || !database || !table || effectiveWhere.trim()) return
    try {
      const tables = await api.meta.tables(connectionId, database)
      if (requestId !== fetchRequestIdRef.current) return
      const matched = tables.find((item) => item.name === table)
      if (!matched || matched.type === 'VIEW') return
      const estimate = Number(matched.rows)
      if (!Number.isFinite(estimate) || estimate < 0) return
      const cache = countCacheRef.current
      const cached = cache.get(countCacheKey)
      if (cached?.source === 'exact') return
      cache.set(countCacheKey, { count: estimate, ts: Date.now(), source: 'estimate' })
      setTotalCount((prev) => Math.max(prev, estimate))
      setCountSource('estimate')
    } catch {
      // 估算行数只用于页脚提示，失败时保留已加载的当前页。
    }
  }, [connectionId, database, table, effectiveWhere, countCacheKey])

  const countRows = useCallback(async () => {
    if (!connectionId || !database || !table || countLoading) return
    const requestId = ++countRequestIdRef.current
    const fetchId = fetchRequestIdRef.current
    setCountLoading(true)
    try {
      let countSql = `SELECT COUNT(*) as cnt FROM ${quoteId(table)}`
      if (effectiveWhere.trim()) countSql += ` WHERE ${effectiveWhere}`
      const countRes = await api.query.execute(connectionId, countSql, database)
      if (requestId !== countRequestIdRef.current || fetchId !== fetchRequestIdRef.current) return
      const count = Number(countRes.rows[0]?.cnt ?? 0)
      countCacheRef.current.set(countCacheKey, { count, ts: Date.now(), source: 'exact' })
      setTotalCount(count)
      setCountSource('exact')
    } catch (countError) {
      if (requestId !== countRequestIdRef.current) return
      console.warn('[TableData] count query failed', {
        connectionId,
        database,
        table,
        error: countError instanceof Error ? countError.message : String(countError),
      })
      setError(getErrorMessage(countError, '统计行数失败'))
    } finally {
      if (requestId === countRequestIdRef.current) setCountLoading(false)
    }
  }, [connectionId, database, table, effectiveWhere, countCacheKey, countLoading])

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
      const pkColumn = singlePrimaryKey(result?.columns)
      const activeOrderBy = explicitOrderBy ?? orderBy
      const sort = parseSort(activeOrderBy)
      const canUseKeyset = Boolean(pkColumn && (!activeOrderBy || sort))
      const wantsKeyset = paginationMode === 'cursor' || paginationMode === 'auto'

      let effectiveMode: EffectivePagination = wantsKeyset && canUseKeyset ? 'keyset' : 'offset'
      const isInitialAutoProbe = paginationMode === 'auto' && action === 'reset' && !result
      let fallbackHint = ''

      if (effectiveMode === 'offset') {
        if (activeOrderBy && !sort) {
          fallbackHint = '当前排序无法走游标，已回退为偏移分页'
        } else if (!pkColumn && !isInitialAutoProbe) {
          fallbackHint = '当前表缺少主键，已回退为偏移分页'
        }
      }

      if (action === 'reset' && typeof fallbackPage === 'number' && fallbackPage > 1) {
        effectiveMode = 'offset'
        fallbackHint = '跳转页码使用偏移分页'
      }

      const whereParts: string[] = []
      if (effectiveWhere.trim()) whereParts.push(`(${effectiveWhere})`)

      let sql = `SELECT * FROM ${quoteId(table)}`

      if (effectiveMode === 'keyset' && action !== 'reset' && cursor && pkColumn) {
        const direction = sort?.direction ?? 'ASC'
        const op = compareDirection(direction, action === 'prev' ? 'prev' : 'next')
        const anchorPk = action === 'next' ? cursor.lastPk : cursor.firstPk
        const anchorSort = action === 'next' ? cursor.lastSort : cursor.firstSort
        whereParts.push(buildKeysetPredicate(sort, pkColumn, anchorSort, anchorPk, op))
      }

      if (whereParts.length > 0) {
        sql += ` WHERE ${whereParts.join(' AND ')}`
      }

      if (effectiveMode === 'keyset' && pkColumn) {
        const direction = sort?.direction ?? 'ASC'
        const queryDirection = action === 'prev' ? (direction === 'ASC' ? 'DESC' : 'ASC') : direction
        const orderParts = sort && sort.column !== pkColumn
          ? [`${quoteId(sort.column)} ${queryDirection}`, `${quoteId(pkColumn)} ${queryDirection}`]
          : [`${quoteId(pkColumn)} ${queryDirection}`]
        sql += ` ORDER BY ${orderParts.join(', ')}`
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

      const cache = countCacheRef.current
      if (forceRefreshCount) {
        cache.delete(countCacheKey)
        setCountSource('unknown')
      }
      const cachedCount = cache.get(countCacheKey)

      const res = await api.query.execute(connectionId, sql, database)

      if (requestId !== fetchRequestIdRef.current) return
      setLastSql(sql)

      if (effectiveMode === 'keyset' && action === 'prev') {
        res.rows = [...res.rows].reverse()
      }

      const pkAfterQuery = singlePrimaryKey(res.columns)
      const rows = res.rows || []
      const canUseKeysetAfterQuery = Boolean(wantsKeyset && pkAfterQuery && (!activeOrderBy || sort) && !(action === 'reset' && typeof fallbackPage === 'number' && fallbackPage > 1))
      const resolvedMode: EffectivePagination = canUseKeysetAfterQuery ? 'keyset' : 'offset'
      let resolvedFallbackHint = fallbackHint

      if (resolvedMode === 'offset') {
        if (action === 'reset' && typeof fallbackPage === 'number' && fallbackPage > 1) {
          resolvedFallbackHint = '跳转页码使用偏移分页'
        } else if (activeOrderBy && !sort) {
          resolvedFallbackHint = '当前排序无法走游标，已回退为偏移分页'
        } else if (!pkAfterQuery && !isInitialAutoProbe) {
          resolvedFallbackHint = '当前表缺少主键，已回退为偏移分页'
        } else if (isInitialAutoProbe) {
          resolvedFallbackHint = ''
        }
      } else {
        resolvedFallbackHint = ''
      }

      if (resolvedMode === 'keyset' && pkAfterQuery && rows.length > 0) {
        const sortColumn = sort?.column
        setCursor({
          firstPk: rows[0][pkAfterQuery],
          lastPk: rows[rows.length - 1][pkAfterQuery],
          firstSort: sortColumn ? rows[0][sortColumn] : undefined,
          lastSort: sortColumn ? rows[rows.length - 1][sortColumn] : undefined,
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
      const pageValue = fallbackPage ?? (action === 'reset' ? 1 : page)
      applyCachedCount(cachedCount, rows.length, pageValue)
      if (!cachedCount || cachedCount.source !== 'exact') {
        void loadEstimatedCount(requestId)
      }
    } catch (e: any) {
      if (requestId !== fetchRequestIdRef.current) return
      setError(getErrorMessage(e, '查询失败'))
    } finally {
      if (showLoading && requestId === fetchRequestIdRef.current) {
        setLoading(false)
      }
    }
  }, [connectionId, database, table, rowsPerPage, effectiveWhere, orderBy, countCacheKey, paginationMode, page, cursor, result, applyCachedCount, loadEstimatedCount])

  useEffect(() => {
    if (!connectionId || !database || !table) return
    loadColumns(connectionId, database, table).catch((e) => setError(getErrorMessage(e, '加载字段信息失败')))
  }, [connectionId, database, table, loadColumns])

  const lastRefreshVersionRef = useRef(refreshVersion)

  useEffect(() => {
    if (refreshVersion === lastRefreshVersionRef.current) return
    lastRefreshVersionRef.current = refreshVersion
    // LRU 淘汰：超过 50 条目时清空最旧
    const cache = countCacheRef.current
    if (cache.size > 50) {
      cache.delete(cache.keys().next().value!)
    }
    cache.delete(countCacheKey)
    fetchData('reset', true, page)
  }, [refreshVersion, countCacheKey, fetchData, page])

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

  const pkCols = useMemo(() => result?.columns.filter((c) => c.primaryKey) ?? [], [result?.columns])
  const pk = pkCols[0]
  const pkNamesKey = pkCols.map((c) => c.name).join('\u0000')
  const rowKeyOf = useCallback((row: Record<string, unknown>) => (
    pkCols.length === 1 ? String(row[pkCols[0].name]) : JSON.stringify(pkCols.map((c) => row[c.name] ?? null))
  ), [pkNamesKey])
  const whereFromKey = useCallback((key: string): Record<string, unknown> => {
    if (pkCols.length === 1) return { [pkCols[0].name]: key }
    const values = JSON.parse(key) as unknown[]
    return Object.fromEntries(pkCols.map((c, index) => [c.name, values[index]]))
  }, [pkNamesKey])
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
    if (record._newKey !== undefined) return String(record._newKey)
    return pkCols.length ? rowKeyOf(record) : String(record._rowIndex)
  }, [pkCols.length, rowKeyOf])

  const baseRowsWithIndex = useMemo(
    () => (result?.rows.map((row, index) => ({ ...row, _rowIndex: index })) || []),
    [result?.rows]
  )

  useEffect(() => {
    setTransformedBaseRows([])
    if (!baseRowsWithIndex.length) return

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
    allRowKeys.forEach((rowKey) => next.add(toCellKey(rowKey, colName)))
    setSelectedCells(next)
    anchorCellRef.current = { rowKey: allRowKeys[0], colName }
  }, [result?.columns, allRowKeys])

  const clearAllSelections = useCallback(() => {
    setSelectedCells(new Set())
    setSelectedRowKeys(new Set())
    anchorCellRef.current = null
  }, [])

  const shouldHandlePanelKeyboardEvent = useCallback((event: Event, options?: { allowSelection?: boolean; allowDirty?: boolean }) => {
    const root = rootRef.current
    if (!root || !isElementVisible(root)) return false
    const target = event.target instanceof HTMLElement ? event.target : null
    const active = document.activeElement as HTMLElement | null
    const targetIsPage = !target || target === document.body || target === document.documentElement
    const activeIsPage = !active || active === document.body || active === document.documentElement

    if (target && !targetIsPage && root.contains(target)) return true
    if (active && !activeIsPage && root.contains(active)) return true
    if (options?.allowSelection && (selectedCells.size > 0 || selectedRowKeys.size > 0)) return true
    if (options?.allowDirty && hasUnsavedChanges) return true
    return false
  }, [hasUnsavedChanges, selectedCells.size, selectedRowKeys.size])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target
    if (!(target instanceof Element)) return
    // 排除表格内容、滚动容器（滚动条点击）等
    if (target.closest('.ui-table td, .ui-table th, .ui-table-scroll, .ui-btn, .ui-input, input, textarea, select, a, [role="button"], .context-menu, .ui-modal')) return
    clearAllSelections()
    setHeaderContextMenu(null)
    setCellContextMenu(null)
  }, [clearAllSelections])

  const invalidateCountCache = useCallback(() => {
    const cache = countCacheRef.current
    if (cache.size > 50) {
      cache.delete(cache.keys().next().value!)
    }
    cache.delete(countCacheKey)
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
      { value: '>', label: '>' },
      { value: '>=', label: '>=' },
      { value: '<', label: '<' },
      { value: '<=', label: '<=' },
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

  const handleClearFilter = useCallback(() => {
    const emptyGroup = getDefaultSimpleFilterGroup()
    setPage(1)
    setJumpPage('1')
    setCursor(null)
    setFilterMode('simple')
    setSimpleFilterTree(emptyGroup)
    setAppliedSimpleFilterTree(emptyGroup)
    setDraftFilterMode('simple')
    setDraftSimpleFilterTree(cloneSimpleFilterGroup(emptyGroup))
    setWhereInput('')
    setWhere('')
    setDraftWhereInput('')
  }, [])

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
      if (dbKeys.length > 0 && !pk) {
        throw new Error('该表没有主键，无法安全定位要删除的行，请使用 SQL 删除')
      }
      if (dbKeys.length > 0 && pk) {
        await api.data.batchDelete(
          connectionId,
          database,
          table,
          dbKeys.map(whereFromKey)
        )
        invalidateCountCache()
        await fetchData('reset', true)
      }
      setSelectedRowKeys(new Set())
      setDeleteConfirmOpen(false)
    } catch (e: any) {
      setError(getErrorMessage(e, '删除失败'))
    } finally {
      setDeleteBusy(false)
    }
  }, [selectedRowKeyList, deleteBusy, pk, whereFromKey, connectionId, database, table, invalidateCountCache, fetchData])

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
    setSuccessMessage('')
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
    if (!pk) {
      setError('该表没有主键，无法直接编辑已有数据，请使用 SQL 修改')
      return
    }
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
    const key = toCellKey(rowKey, colName)
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
            next.add(toCellKey(allRowKeys[r], colNames[c]))
          }
        }
        setSelectedCells(next)
        return
      }
    }
    anchorCellRef.current = { rowKey, colName }
    setSelectedCells(new Set([key]))
    setDetailRowKey(rowKey)
  }, [result?.columns, allRowKeys])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!result?.columns?.length || allRowKeys.length === 0 || selectedCells.size === 0) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      const root = rootRef.current
      if (!root || !isElementVisible(root)) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('.ui-modal, .context-menu')) return
      const activeIsPage = active === document.body || active === document.documentElement
      const targetIsPage = target === document.body || target === document.documentElement
      if (active && !activeIsPage && !root.contains(active)) return
      if (target && !targetIsPage && !root.contains(target)) return

      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.length === 0) return

      const colNames = result.columns.map((c) => c.name)
      const selected = Array.from(selectedCells)
        .map(parseCellKey)
        .filter((cell): cell is { rowKey: string; colName: string } => !!cell)
        .map((cell) => ({
          ...cell,
          rowIndex: allRowKeys.indexOf(cell.rowKey),
          colIndex: colNames.indexOf(cell.colName),
        }))
        .filter((cell) => cell.rowIndex >= 0 && cell.colIndex >= 0)

      if (selected.length === 0) return

      const clipboardRows = parseClipboardGrid(text)
      if (clipboardRows.length === 0) return

      e.preventDefault()

      const updatedCells = new Set<string>()
      const applyCell = (rowKey: string, colName: string, value: string) => {
        handleCellChange(rowKey, colName, value === '' ? null : value)
        updatedCells.add(toCellKey(rowKey, colName))
      }

      if (clipboardRows.length === 1 && clipboardRows[0].length === 1 && selected.length > 1) {
        const value = clipboardRows[0][0]
        selected.forEach((cell) => applyCell(cell.rowKey, cell.colName, value))
      } else {
        const startRow = Math.min(...selected.map((cell) => cell.rowIndex))
        const startCol = Math.min(...selected.map((cell) => cell.colIndex))
        clipboardRows.forEach((clipboardRow, rowOffset) => {
          const rowKey = allRowKeys[startRow + rowOffset]
          if (!rowKey) return
          clipboardRow.forEach((value, colOffset) => {
            const colName = colNames[startCol + colOffset]
            if (!colName) return
            applyCell(rowKey, colName, value)
          })
        })
      }

      if (updatedCells.size === 0) return
      setSelectedCells(updatedCells)
      const firstCellKey = updatedCells.values().next().value as string | undefined
      const first = firstCellKey ? parseCellKey(firstCellKey) : null
      if (first) anchorCellRef.current = first
      markCellsRecentlyUpdated(updatedCells)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [result?.columns, allRowKeys, selectedCells, handleCellChange, markCellsRecentlyUpdated])

  const applyPendingChangesToResult = useCallback((changes: Map<string, Record<string, unknown>>) => {
    if (!pk || changes.size === 0) return
    setResult((prev) => {
      if (!prev) return prev
      const nextRows = prev.rows.map((row) => {
        const rowKey = rowKeyOf(row)
        const rowChanges = changes.get(rowKey)
        if (!rowChanges) return row
        return { ...row, ...rowChanges }
      })
      return { ...prev, rows: nextRows }
    })
  }, [pk, rowKeyOf])

  // 更新后静默二次校准：拿到触发器/默认值等服务端回写
  const revalidateRowsAfterSave = useCallback(async (changedRowKeys: string[]) => {
    if (!pk || changedRowKeys.length === 0 || !connectionId || !database || !table) return
    const uniqueKeys = Array.from(new Set(changedRowKeys.filter(Boolean)))
    if (uniqueKeys.length === 0) return
    const whereClause = uniqueKeys
      .map((k) => `(${Object.entries(whereFromKey(k)).map(([name, value]) => `${quoteId(name)} = ${escSQL(value)}`).join(' AND ')})`)
      .join(' OR ')
    const sql = `SELECT * FROM ${quoteId(table)} WHERE ${whereClause}`
    try {
      const res = await api.query.execute(connectionId, sql, database)
      if (!res.rows?.length) return
      const rowMap = new Map<string, Record<string, unknown>>()
      res.rows.forEach((row) => rowMap.set(rowKeyOf(row), row))
      setResult((prev) => {
        if (!prev) return prev
        const nextRows = prev.rows.map((row) => {
          const key = rowKeyOf(row)
          return rowMap.get(key) ?? row
        })
        return { ...prev, rows: nextRows }
      })
    } catch (revalidateError) {
      console.warn('[TableData] row revalidation after save failed', {
        connectionId,
        database,
        table,
        error: revalidateError instanceof Error ? revalidateError.message : String(revalidateError),
      })
    }
  }, [pk, whereFromKey, rowKeyOf, connectionId, database, table])

  const handleSaveChanges = useCallback(async () => {
    if (isSaving) return
    const cols = result?.columns || []
    const hasUpdates = pk && pendingChanges.size > 0
    const hasInserts = newRows.length > 0
    if (!hasUpdates && !hasInserts) return

    setIsSaving(true)
    setSuccessMessage('')
    const updatedCount = pendingChanges.size
    const insertedCount = newRows.length
    try {
      // 保存修改行：直接本地合并，避免整表刷新闪烁
      if (hasUpdates) {
        const submitted = new Map(Array.from(pendingChanges, ([key, data]) => [key, { ...data }]))
        const changedKeys = Array.from(submitted.keys())
        const updateItems = changedKeys.map((rowKey) => ({
          data: submitted.get(rowKey) || {},
          where: whereFromKey(rowKey),
        }))
        const updateResult = await api.data.batchUpdate(connectionId, database, table, updateItems)
        applyPendingChangesToResult(submitted)
        setPendingChanges((prev) => {
          const next = new Map(prev)
          for (const [key, data] of submitted) {
            const current = next.get(key)
            if (!current) continue
            const remaining = Object.fromEntries(Object.entries(current).filter(([col, value]) => data[col] !== value))
            if (Object.keys(remaining).length) next.set(key, remaining)
            else next.delete(key)
          }
          return next
        })
        void revalidateRowsAfterSave(changedKeys)
        const matched = Number((updateResult as { affectedRows?: number } | undefined)?.affectedRows ?? updateItems.length)
        if (matched < updateItems.length) {
          toast.warning(`有 ${updateItems.length - matched} 行未找到匹配记录，可能已被其他人修改或删除`)
        }
      }
      // 保存新增行：需要拿到数据库真实主键，静默刷新一次
      if (hasInserts) {
        const submittedRows = newRows
        for (const row of submittedRows) {
          const data: Record<string, unknown> = {}
          for (const col of cols) {
            if (row[col.name] === undefined) continue
            data[col.name] = row[col.name]
          }
          if (Object.keys(data).length > 0) {
            await api.data.insert(connectionId, database, table, data)
          } else {
            await api.query.execute(connectionId, `INSERT INTO ${quoteId(table)} () VALUES ()`, database)
          }
        }
        const submittedKeys = new Set(submittedRows.map((row) => row._newKey))
        setNewRows((prev) => prev.filter((row) => !submittedKeys.has(row._newKey)))
      }
      setEditingDirtyCells(new Set())
      invalidateCountCache()
      if (hasInserts) {
        await fetchData('reset', true, undefined, false)
      }
      const savedParts = [
        updatedCount > 0 ? `更新 ${updatedCount} 行` : '',
        insertedCount > 0 ? `新增 ${insertedCount} 行` : '',
      ].filter(Boolean)
      setSuccessMessage(savedParts.length ? `保存成功：${savedParts.join('，')}` : '保存成功')
    } catch (e: any) {
      setSaveErrorText(getErrorMessage(e, '保存失败'))
      setSaveErrorModalOpen(true)
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, pk, whereFromKey, pendingChanges, newRows, result?.columns, connectionId, database, table, fetchData, invalidateCountCache, applyPendingChangesToResult, revalidateRowsAfterSave])

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

  // 键盘快捷键合并处理器 — 5→1 全局监听器
  const keyboardHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {})

  keyboardHandlerRef.current = (e: KeyboardEvent) => {
    // 1) Ctrl+S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      if (shouldHandlePanelKeyboardEvent(e, { allowDirty: true })) {
        e.preventDefault()
        flushEditingAndSave()
      }
      return
    }

    // Ctrl+C 复制选中单元格（TSV，可直接粘贴到表格软件）
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !e.shiftKey) {
      if (selectedCells.size === 0 && selectedRowKeys.size === 0) return
      if (!shouldHandlePanelKeyboardEvent(e, { allowSelection: true })) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      if (window.getSelection()?.toString()) return
      e.preventDefault()
      void copySelection()
      return
    }

    // 2) Ctrl+A 全选所有复选框行
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      if (!shouldHandlePanelKeyboardEvent(e, { allowSelection: true })) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      const root = rootRef.current
      if (!root || root.offsetParent === null) return
      if (allRowKeys.length === 0) return
      e.preventDefault()
      setSelectedRowKeys(new Set(allRowKeys))
      setSelectedCells(new Set())
      lastCheckedRef.current = allRowKeys[allRowKeys.length - 1] || null
      return
    }

    // 3) Delete — 删除勾选行
    if (e.key === 'Delete') {
      if (selectedRowKeyList.length === 0 || deleteConfirmOpen) return
      if (!shouldHandlePanelKeyboardEvent(e, { allowSelection: true })) return
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        const inputType = (active as HTMLInputElement).type
        const isTypingInput = tag === 'TEXTAREA' || active.isContentEditable || (tag === 'INPUT' && inputType !== 'checkbox')
        if (isTypingInput) return
      }
      e.preventDefault()
      openDeleteConfirm(selectedRowKeyList)
      return
    }

    // 4) 数字键批量改值（多选单元格时）
    if (selectedCells.size > 1 && /^[0-9]$/.test(e.key)) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!shouldHandlePanelKeyboardEvent(e, { allowSelection: true })) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      e.preventDefault()
      const nextValue = e.key
      selectedCells.forEach((cellKey) => {
        const cell = parseCellKey(cellKey)
        if (!cell) return
        handleCellChange(cell.rowKey, cell.colName, nextValue)
      })
      markCellsRecentlyUpdated(selectedCells)
      return
    }

    // 5) 方向键单格导航
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!shouldHandlePanelKeyboardEvent(e, { allowSelection: true })) return
      if (!result?.columns?.length || allRowKeys.length === 0 || selectedCells.size === 0) return
      const active = document.activeElement as HTMLElement | null
      if (active) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return
      }

      const colNames = result.columns.map((c) => c.name)
      const pickCell = (): { rowKey: string; colName: string } | null => {
        const anchor = anchorCellRef.current
        if (anchor && allRowKeys.includes(anchor.rowKey) && colNames.includes(anchor.colName)) {
          return anchor
        }
        const first = selectedCells.values().next().value as string | undefined
        if (!first) return null
        const parsed = parseCellKey(first)
        if (!parsed) return null
        if (!allRowKeys.includes(parsed.rowKey) || !colNames.includes(parsed.colName)) return null
        return parsed
      }

      const current = pickCell()
      if (!current) return

      const rowIndex = allRowKeys.indexOf(current.rowKey)
      const colIndex = colNames.indexOf(current.colName)
      if (rowIndex < 0 || colIndex < 0) return

      let nextRowIndex = rowIndex
      let nextColIndex = colIndex
      if (e.key === 'ArrowUp') nextRowIndex = Math.max(0, rowIndex - 1)
      if (e.key === 'ArrowDown') nextRowIndex = Math.min(allRowKeys.length - 1, rowIndex + 1)
      if (e.key === 'ArrowLeft') nextColIndex = Math.max(0, colIndex - 1)
      if (e.key === 'ArrowRight') nextColIndex = Math.min(colNames.length - 1, colIndex + 1)

      if (nextRowIndex === rowIndex && nextColIndex === colIndex) return
      e.preventDefault()

      const nextRowKey = allRowKeys[nextRowIndex]
      const nextColName = colNames[nextColIndex]
      const nextCellKey = toCellKey(nextRowKey, nextColName)
      const nextCellDomId = toCellDomId(nextRowKey, nextColName)

      anchorCellRef.current = { rowKey: nextRowKey, colName: nextColName }
      setSelectedCells(new Set([nextCellKey]))
      setDetailRowKey(nextRowKey)

      window.requestAnimationFrame(() => {
        const target = rootRef.current?.querySelector(`[data-cell-id="${nextCellDomId}"]`) as HTMLElement | null
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardHandlerRef.current(e)
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

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
      const target = evt.target
      if (!(target instanceof Element)) return
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
      const target = evt.target
      if (!(target instanceof Element)) return
      // 排除表格内容、滚动容器（滚动条点击）等
      const root = rootRef.current
      if (!root || !isElementVisible(root)) return
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
    return `INSERT INTO ${quoteId(table)} (${cols.map(quoteId).join(', ')}) VALUES (${vals.join(', ')});`
  }

  const generateUpdateSQL = (record: Record<string, unknown>) => {
    const cols = result?.columns.map(c => c.name) || Object.keys(record).filter(k => k !== '_rowIndex')
    const sets = cols.map(c => `${quoteId(c)} = ${escSQL(record[c])}`).join(', ')
    const whereCols = pkCols.length ? pkCols.map((c) => c.name) : cols
    const whereClause = whereCols
      .map((c) => (record[c] === null || record[c] === undefined ? `${quoteId(c)} IS NULL` : `${quoteId(c)} = ${escSQL(record[c])}`))
      .join(' AND ')
    return `UPDATE ${quoteId(table)} SET ${sets} WHERE ${whereClause}${pkCols.length ? '' : ' LIMIT 1'};`
  }

  useEffect(() => {
    const close = () => {
      setCellContextMenu(null)
      setHeaderContextMenu(null)
    }
    window.addEventListener('app:close-context-menus', close)
    return () => window.removeEventListener('app:close-context-menus', close)
  }, [])

  const handleCellContextMenu = (e: React.MouseEvent, rowKey: string, colName: string, record: Record<string, unknown>) => {
    e.preventDefault()
    e.stopPropagation()
    const menuH = 430
    const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuH - 8))
    setCellContextMenu({ x: e.clientX, y, rowKey, colName, record })
  }

  const copySql = async (sql: string, rowCount: number, kind: string) => {
    if (!sql) {
      toast.warning('没有可复制的行')
      return
    }
    try {
      await window.api.clipboard.writeText(sql)
      toast.success(`已复制 ${rowCount} 行 ${kind} 语句`)
    } catch (e) {
      toast.error(formatErrorSummary(e, '复制失败'))
    }
  }

  const visibleColumnList = useMemo(
    () => (result?.columns || []).filter((c) => visibleColumnNames.has(c.name)),
    [result?.columns, visibleColumnNames]
  )

  const currentValue = useCallback((rowKey: string, colName: string) => {
    const pending = pendingChanges.get(rowKey)
    if (pending && colName in pending) return pending[colName]
    return rowsByKey.get(rowKey)?.[colName]
  }, [pendingChanges, rowsByKey])

  const textOf = useCallback((value: unknown, colName: string) => {
    if (value === null || value === undefined) return ''
    const type = columnDetailsByName.get(colName)?.dataType?.toLowerCase() || ''
    return fmtValue(value, type === 'date')
  }, [columnDetailsByName])

  const writeClipboard = async (text: string, message: string) => {
    try {
      await window.api.clipboard.writeText(text)
      toast.success(message)
    } catch (e) {
      toast.error(formatErrorSummary(e, '复制失败'))
    }
  }

  const rowsAsTsv = (keys: string[], withHeader: boolean) => {
    const cols = visibleColumnList.map((c) => c.name)
    const clean = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const lines = keys.map((k) => cols.map((c) => clean(textOf(currentValue(k, c), c))).join('\t'))
    return (withHeader ? [cols.join('\t'), ...lines] : lines).join('\n')
  }

  const copySelection = async () => {
    if (selectedRowKeys.size > 0 && selectedCells.size === 0) {
      const keys = allRowKeys.filter((k) => selectedRowKeys.has(k))
      await writeClipboard(rowsAsTsv(keys, false), `已复制 ${keys.length} 行`)
      return
    }
    const cells = Array.from(selectedCells).map(parseCellKey).filter((c): c is { rowKey: string; colName: string } => !!c)
    if (!cells.length) return
    const colOrder = visibleColumnList.map((c) => c.name)
    const rows = allRowKeys.filter((k) => cells.some((c) => c.rowKey === k))
    const cols = colOrder.filter((n) => cells.some((c) => c.colName === n))
    const picked = new Set(cells.map((c) => toCellKey(c.rowKey, c.colName)))
    const text = rows.map((r) => cols.map((c) => (picked.has(toCellKey(r, c)) ? textOf(currentValue(r, c), c) : '')).join('\t')).join('\n')
    await writeClipboard(text, cells.length === 1 ? '已复制' : `已复制 ${cells.length} 个单元格`)
  }

  // 在简单筛选树中追加一个条件；高级模式下追加到 WHERE
  const addQuickFilter = (colName: string, mode: 'eq' | 'neq' | 'notNull', value: unknown) => {
    const isNull = value === null || value === undefined
    const operator = mode === 'eq' ? (isNull ? 'IS NULL' : '=') : mode === 'neq' ? (isNull ? 'IS NOT NULL' : '!=') : 'IS NOT NULL'
    const literalValue = operator.startsWith('IS') ? '' : textOf(value, colName)
    if (filterMode === 'advanced') {
      const clause = `${quoteId(colName)} ${operator}${operator.startsWith('IS') ? '' : ` ${escSQL(literalValue)}`}`
      const next = where.trim() ? `(${where.trim()}) AND ${clause}` : clause
      applyWhereFilter('advanced', simpleFilterTree, next)
      return
    }
    const condition = { ...getDefaultSimpleFilter(), column: colName, operator, value: literalValue }
    const base = cloneSimpleFilterGroup(appliedSimpleFilterTree)
    const meaningful = base.children.filter((c) => c.type === 'group' || c.column)
    const nextTree: SimpleFilterGroup = base.join === 'AND'
      ? { ...base, children: [...meaningful, condition] }
      : { ...getDefaultSimpleFilterGroup(), children: meaningful.length ? [{ ...base, children: meaningful }, condition] : [condition] }
    applyWhereFilter('simple', nextTree, whereInput)
  }

  const cloneRow = (record: Record<string, unknown>) => {
    if (newRows.length > 0) {
      toast.warning('请先保存或放弃当前新增的行')
      return
    }
    newRowCounter.current += 1
    const key = `_new_${newRowCounter.current}`
    const sourceKey = getRowKey(record)
    const copy: Record<string, unknown> = { _newKey: key }
    for (const col of result?.columns || []) {
      if (columnDetailsByName.get(col.name)?.autoIncrement || col.autoIncrement) continue
      const v = currentValue(sourceKey, col.name)
      if (v !== undefined && !isBinaryValue(v)) copy[col.name] = isDateValue(v) ? textOf(v, col.name) : v
    }
    setNewRows((prev) => [...prev, copy])
    setDetailRowKey(key)
  }

  const discardChanges = () => {
    setPendingChanges(new Map())
    setNewRows([])
    setEditingDirtyCells(new Set())
    setSelectedCells(new Set())
    toast.info('已放弃未保存的修改')
  }

  const hideColumn = (colName: string) => {
    setVisibleColumnNames((prev) => {
      const next = new Set(prev)
      next.delete(colName)
      return next
    })
  }

  const handleContextAction = async (action: string) => {
    if (!cellContextMenu) return
    const { rowKey, colName, record } = cellContextMenu
    setCellContextMenu(null)

    // 若勾选了多行，则按多行执行；否则按当前右键行执行
    const selectedKeys = selectedRowKeyList.length > 0 ? selectedRowKeyList : [rowKey]
    const value = currentValue(rowKey, colName)

    switch (action) {
      case 'copyValue':
        if (selectedCells.size > 1 && selectedCells.has(toCellKey(rowKey, colName))) await copySelection()
        else await writeClipboard(textOf(value, colName), '已复制')
        break
      case 'copyColumnName':
        await writeClipboard(colName, `已复制字段名 ${colName}`)
        break
      case 'copyTsv':
        await writeClipboard(rowsAsTsv(selectedKeys, true), `已复制 ${selectedKeys.length} 行（含表头）`)
        break
      case 'copyJson': {
        const rows = selectedKeys.map((k) => Object.fromEntries(visibleColumnList.map((c) => {
          const v = currentValue(k, c.name)
          return [c.name, v === null || v === undefined ? null : typeof v === 'number' ? v : textOf(v, c.name)]
        })))
        await writeClipboard(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2), `已复制 ${rows.length} 行 JSON`)
        break
      }
      case 'filterEq':
        addQuickFilter(colName, 'eq', value)
        break
      case 'filterNeq':
        addQuickFilter(colName, 'neq', value)
        break
      case 'detail':
        setDetailRowKey(rowKey)
        setDetailOpen(true)
        break
      case 'clone':
        cloneRow(record)
        break
      case 'hideColumn':
        hideColumn(colName)
        break
      case 'copyInsert': {
        const rows = selectedKeys.map(k => rowsByKey.get(k)).filter(Boolean)
        await copySql(rows.map(r => generateInsertSQL(r!)).join('\n'), rows.length, 'INSERT')
        break
      }
      case 'copyUpdate': {
        const rows = selectedKeys.map(k => rowsByKey.get(k)).filter(Boolean)
        await copySql(rows.map(r => generateUpdateSQL(r!)).join('\n'), rows.length, 'UPDATE')
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

  const handleHeaderMenuAction = (action: 'asc' | 'desc' | 'clear' | 'hide' | 'copyName' | 'notNull') => {
    if (!headerContextMenu) return
    const colName = headerContextMenu.colName
    if (action === 'hide' || action === 'copyName' || action === 'notNull') {
      setHeaderContextMenu(null)
      if (action === 'hide') hideColumn(colName)
      else if (action === 'copyName') void writeClipboard(colName, `已复制字段名 ${colName}`)
      else addQuickFilter(colName, 'notNull', null)
      return
    }
    const nextOrderBy = action === 'asc'
      ? `${quoteId(colName)} ASC`
      : action === 'desc'
        ? `${quoteId(colName)} DESC`
        : ''

    setOrderBy(nextOrderBy)
    setHeaderContextMenu(null)
    setPage(1)
    setCursor(null)
    fetchData('reset', false, 1, true, nextOrderBy)
  }

  const dataCols = useMemo(() => {
    const filtered = (result?.columns || []).filter((col) => visibleColumnNames.has(col.name))

    return filtered.map((col) => {
      const columnComment = columnDetailsByName.get(col.name)?.comment?.trim() || ''
      const isSorted = orderBy.startsWith(`${quoteId(col.name)} `)
      const sortDirection = isSorted && /\bDESC$/i.test(orderBy) ? 'DESC' : isSorted ? 'ASC' : ''
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
            {sortDirection && (
              <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                {sortDirection === 'DESC' ? '↓' : '↑'}
              </span>
            )}
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
        const cellKey = toCellKey(rk, col.name)
        const isSel = selectedCells.has(cellKey)
        const isFoc = selectedCells.size === 1 && isSel
        const isRecentlyUpdated = recentlyUpdatedCells.has(cellKey)
        return (
          <EditableCell
            value={cellValue}
            colType={col.type}
            cellDomId={toCellDomId(rk, col.name)}
            isSelected={isSel}
            isFocused={isFoc && selectedRowKeyList.length === 0}
            isRecentlyUpdated={isRecentlyUpdated}
            onSelect={(shiftKey) => handleCellSelect(rk, col.name, shiftKey)}
            onSave={(newVal) => handleCellChange(rk, col.name, newVal)}
            onDirtyChange={(isDirty) => handleEditingDirtyChange(rk, col.name, isDirty)}
            onContextMenu={(e) => handleCellContextMenu(e, rk, col.name, record)}
          />
        )
      },
    }
    })
  }, [result?.columns, pendingChanges, selectedCells, recentlyUpdatedCells, columnDetailsByName, orderBy, handleCellChange, handleCellSelect, handleColumnSelect, handleEditingDirtyChange, visibleColumnNames, selectedRowKeyList.length])

  const columns = useMemo(() => [checkboxCol, ...dataCols], [checkboxCol, dataCols])
  const isKeysetMode = lastQueryMode === 'keyset'
  const configuredModeLabel = PAGINATION_MODE_LABEL[paginationMode]
  const effectiveModeLabel = lastQueryMode === 'keyset' ? '游标' : '偏移'
  const columnComments = useMemo(
    () => new Map(Array.from(columnDetailsByName, ([name, detail]) => [name, detail.comment?.trim() || ''])),
    [columnDetailsByName]
  )
  const changeCount = pendingChanges.size + newRows.length + editingDirtyCells.size
  const detailRecord = detailRowKey ? rowsByKey.get(detailRowKey) ?? null : null
  const detailIndex = detailRowKey ? allRowKeys.indexOf(detailRowKey) : -1
  const detailEditable = Boolean(pk) || Boolean(detailRecord?._newKey)
  const detailLabel = !detailRecord ? '' : detailRecord._newKey ? '新增行' : pkCols.length
    ? pkCols.map((c) => `${c.name} = ${textOf(detailRecord[c.name], c.name)}`).join(', ')
    : `第 ${detailIndex + 1} 行`
  const pageSizeOptions = Array.from(new Set([50, 100, 200, 500, 1000, defaultRowsPerPage]))
    .sort((a, b) => a - b)
    .map((n) => ({ value: n, label: `${n} 条/页` }))
  const nextDisabled = loading || (isKeysetMode || countSource !== 'exact' ? !hasNextPage : page >= totalPages)

  const addEmptyRow = () => {
    newRowCounter.current += 1
    const key = `_new_${newRowCounter.current}`
    setNewRows((prev) => [...prev, { _newKey: key }])
    setDetailRowKey(key)
  }

  const clearSearch = () => {
    setSearchInput('')
    setSearch('')
  }

  const clearSort = () => {
    setOrderBy('')
    setPage(1)
    setCursor(null)
    fetchData('reset', false, 1, true, '')
  }

  const goPrev = () => {
    if (loading || page <= 1) return
    const prevPage = page - 1
    setPage(prevPage)
    if (prevPage === 1) {
      setCursor(null)
      fetchData('reset', false, 1)
    } else {
      fetchData(isKeysetMode ? 'prev' : 'reset', false, prevPage)
    }
  }

  const goNext = () => {
    if (nextDisabled) return
    const nextPage = page + 1
    setPage(nextPage)
    fetchData(isKeysetMode ? 'next' : 'reset', false, nextPage)
  }

  const jumpTo = () => {
    const n = Number(jumpPage)
    if (!Number.isFinite(n) || n < 1) { setJumpPage(String(page)); return }
    const targetPage = countSource === 'exact' ? Math.min(totalPages, n) : n
    if (targetPage === page) return
    setPage(targetPage)
    setCursor(null)
    fetchData('reset', false, targetPage)
  }

  return (
    <div ref={rootRef} className="db-data">
      <div className="db-toolbar">
        <Button size="small" icon={<FilterOutlined />} className={filterWhere ? 'db-btn-active' : ''} onClick={openFilterModal}>筛选</Button>
        {result && result.columns.length > 0 && (
          <ColumnPicker columns={result.columns} comments={columnComments} visible={visibleColumnNames} onChange={setVisibleColumnNames} />
        )}
        <span className="db-toolbar-sep" />
        <Button size="small" icon={<PlusOutlined />} disabled={newRows.length > 0} onClick={addEmptyRow}>新增</Button>
        <Button size="small" icon={<ExportOutlined />} disabled={newRows.length > 0} onClick={() => setExportOpen(true)}>导出</Button>
        <Tooltip title="查看当前页执行的 SQL" placement="bottom">
          <Button size="small" variant="text" icon={<CodeOutlined />} disabled={!lastSql} onClick={() => setSqlOpen(true)}>SQL</Button>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <div className={`db-search ${search ? 'active' : ''}`}>
          <SearchOutlined />
          <input
            value={searchInput}
            placeholder="搜索文本字段，回车确认"
            spellCheck={false}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(searchInput.trim())
              if (e.key === 'Escape') clearSearch()
            }}
          />
          {searchInput && <button type="button" title="清除" onClick={clearSearch}><CloseOutlined /></button>}
        </div>
        <Tooltip title={detailOpen ? '隐藏行详情' : '显示行详情'} placement="bottom">
          <Button size="small" variant="text" icon={<ProfileOutlined />} className={detailOpen ? 'db-btn-active' : ''} onClick={() => setDetailOpen((v) => !v)}>详情</Button>
        </Tooltip>
      </div>

      {(filterWhere || search || sortSummary) && (
        <div className="db-chips">
          {filterWhere && (
            <span className="db-chip" title={filterWhere}>
              <FilterOutlined />
              <button type="button" className="db-chip-label" onClick={openFilterModal}>{filterSummary || filterWhere}</button>
              <button type="button" className="db-chip-x" title="移除筛选" onClick={handleClearFilter}><CloseOutlined /></button>
            </span>
          )}
          {search && (
            <span className="db-chip">
              <SearchOutlined />
              <span className="db-chip-label">包含“{search}”</span>
              <button type="button" className="db-chip-x" title="清除搜索" onClick={clearSearch}><CloseOutlined /></button>
            </span>
          )}
          {sortSummary && (
            <span className="db-chip" title={orderBy}>
              <span className="db-chip-label">排序：{sortSummary}</span>
              <button type="button" className="db-chip-x" title="移除排序" onClick={clearSort}><CloseOutlined /></button>
            </span>
          )}
          {[filterWhere, search, sortSummary].filter(Boolean).length > 1 && (
            <button type="button" className="db-link" onClick={() => { handleClearFilter(); clearSearch(); if (sortSummary) clearSort() }}>全部清除</button>
          )}
        </div>
      )}

      {error && <ErrorNotice key={error} error={error} fallbackTitle="操作失败" onClose={() => setError('')} className="db-notice" />}
      {result && result.columns.length > 0 && !pk && (
        <Alert type="warning" message="该表没有主键，已有数据为只读；可以新增行，修改或删除请使用 SQL。" className="db-notice" />
      )}
      <Toast open={!error && Boolean(successMessage)} message={successMessage} type="success" />

      <FilterModal
        open={isFilterModalOpen}
        filterMode={draftFilterMode}
        simpleFilterTree={draftSimpleFilterTree}
        whereInput={draftWhereInput}
        effectiveWhere={filterWhere}
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
        <div>
          {saveErrorText && <ErrorNotice error={saveErrorText} fallbackTitle="保存失败" />}
        </div>
      </Modal>

      <div className="db-main">
        <div className="db-table-wrap" onClick={handleCanvasClick}>
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
              const isDetail = detailOpen && rk === detailRowKey
              let style: React.CSSProperties | undefined
              if (isSelected && isNew) {
                style = { background: 'color-mix(in srgb, var(--accent) 16%, var(--success-bg))' }
              } else if (isSelected) {
                style = { background: 'color-mix(in srgb, var(--accent) 13%, transparent)' }
              } else if (isNew) {
                style = { background: 'var(--success-bg)', animation: 'row-insert var(--dur-slow) var(--ease-out)' }
              } else if (isDetail) {
                style = { background: 'color-mix(in srgb, var(--accent) 6%, transparent)' }
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

          {(changeCount > 0 || isSaving || selectedRowKeyList.length > 0) && (
            <div className="db-actionbar">
              {selectedRowKeyList.length > 0 && (
                <>
                  <span className="db-actionbar-text">已选 <b>{selectedRowKeyList.length}</b> 行</span>
                  <Button size="small" variant="text" icon={<CopyOutlined />} onClick={() => void writeClipboard(rowsAsTsv(allRowKeys.filter((k) => selectedRowKeys.has(k)), true), `已复制 ${selectedRowKeyList.length} 行`)}>复制</Button>
                  <Button size="small" variant="text" className="danger-text-btn" icon={<DeleteOutlined />} disabled={deleteBusy} onClick={handleToolbarDelete}>删除</Button>
                  <button type="button" className="db-actionbar-x" title="取消选择" onClick={() => setSelectedRowKeys(new Set())}><CloseOutlined /></button>
                </>
              )}
              {selectedRowKeyList.length > 0 && (changeCount > 0 || isSaving) && <span className="db-actionbar-sep" />}
              {(changeCount > 0 || isSaving) && (
                <>
                  <span className="db-actionbar-dot" />
                  <span className="db-actionbar-text"><b>{changeCount}</b> 处未保存</span>
                  <Button size="small" variant="text" icon={<UndoOutlined />} disabled={isSaving} onClick={discardChanges}>放弃</Button>
                  <Button size="small" type="primary" icon={<SaveOutlined />} loading={isSaving} disabled={isSaving} onClick={flushEditingAndSave}>
                    {isSaving ? '保存中…' : '保存'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {detailOpen && result && (
          <RowDetailPanel
            record={detailRecord}
            rowLabel={detailLabel}
            columns={result.columns}
            details={columnDetailsByName}
            pending={detailRowKey ? pendingChanges.get(detailRowKey) : undefined}
            editable={detailEditable}
            formatValue={textOf}
            isBinary={isBinaryValue}
            hasPrev={detailIndex > 0}
            hasNext={detailIndex >= 0 && detailIndex < allRowKeys.length - 1}
            onPrev={() => detailIndex > 0 && setDetailRowKey(allRowKeys[detailIndex - 1])}
            onNext={() => detailIndex < allRowKeys.length - 1 && setDetailRowKey(allRowKeys[detailIndex + 1])}
            onChange={(colName, value) => {
              if (!detailRowKey) return
              handleCellChange(detailRowKey, colName, value)
              markCellsRecentlyUpdated([toCellKey(detailRowKey, colName)])
            }}
            onClose={() => setDetailOpen(false)}
          />
        )}
      </div>

      <div className="db-footer">
        <div className="db-footer-info">
          <span title={`分页方式：${effectiveModeLabel}（设置为${configuredModeLabel}）${paginationFallbackHint ? `，${paginationFallbackHint}` : ''}`}>
            {countSource === 'exact' ? '共 ' : '约 '}<strong>{totalCount.toLocaleString()}</strong> 行
          </span>
          {countSource !== 'exact' && (
            <button type="button" className="db-link" disabled={loading || countLoading} onClick={() => { void countRows() }}>
              {countLoading ? '统计中…' : '精确统计'}
            </button>
          )}
          {result && (
            <>
              <span className="db-footer-sep" />
              <span>本页 {result.rows.length} 行</span>
              <span className="db-footer-sep" />
              <span>{result.executionTime} ms</span>
            </>
          )}
          {pendingPaginationHint && <span className="db-footer-hint">{pendingPaginationHint}</span>}
        </div>
        <div className="db-footer-pager">
          <Select size="small" value={rowsPerPage} options={pageSizeOptions} onChange={(v) => setRowsPerPage(Number(v))} style={{ width: 104 }} />
          <Button size="small" variant="text" icon={<LeftOutlined />} disabled={loading || page <= 1} onClick={goPrev} />
          {isKeysetMode ? (
            <span className="db-footer-page">第 {page} 页</span>
          ) : (
            <span className="db-footer-page">
              <input
                className="db-page-input"
                value={jumpPage}
                title="输入页码后回车跳转"
                onChange={(e) => setJumpPage(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') jumpTo() }}
                onBlur={() => setJumpPage(String(page))}
              />
              {countSource === 'exact' && <span>/ {totalPages}</span>}
            </span>
          )}
          <Button size="small" variant="text" icon={<RightOutlined />} disabled={nextDisabled} onClick={goNext} />
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
          {orderBy && <div className="context-menu-item" onClick={() => handleHeaderMenuAction('clear')}>移除排序</div>}
          <div className="context-menu-divider" />
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('notNull')}>只看非空值</div>
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('copyName')}>复制字段名</div>
          <div className="context-menu-item" onClick={() => handleHeaderMenuAction('hide')}>隐藏此列</div>
        </div>
      )}

      {/* 单元格右键菜单 */}
      {cellContextMenu && (() => {
        const count = selectedRowKeyList.length > 0 ? selectedRowKeyList.length : 1
        const suffix = count > 1 ? ` (${count} 行)` : ''
        const value = currentValue(cellContextMenu.rowKey, cellContextMenu.colName)
        const isNullValue = value === null || value === undefined
        const preview = isNullValue ? 'NULL' : textOf(value, cellContextMenu.colName)
        const shortValue = preview.length > 18 ? `${preview.slice(0, 18)}…` : preview
        const multiCells = selectedCells.size > 1 && selectedCells.has(toCellKey(cellContextMenu.rowKey, cellContextMenu.colName))
        const isNewRow = cellContextMenu.rowKey.startsWith('_new_')
        return (
        <div
          className="context-menu"
          style={{ left: cellContextMenu.x, top: cellContextMenu.y }}
          onClick={() => setCellContextMenu(null)}
        >
          <div className="context-menu-item" onClick={() => handleContextAction('copyValue')}>{multiCells ? `复制 ${selectedCells.size} 个单元格` : '复制值'}<span className="context-menu-shortcut">Ctrl+C</span></div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyColumnName')}>复制字段名</div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyJson')}>复制为 JSON{suffix}</div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyTsv')}>复制为 TSV{suffix}</div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyInsert')}>复制为 INSERT{suffix}</div>
          <div className="context-menu-item" onClick={() => handleContextAction('copyUpdate')}>复制为 UPDATE{suffix}</div>
          {!isNewRow && (
            <>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={() => handleContextAction('filterEq')}>{isNullValue ? '筛选为 NULL 的行' : `筛选 = ${shortValue}`}</div>
              <div className="context-menu-item" onClick={() => handleContextAction('filterNeq')}>{isNullValue ? '排除 NULL' : `排除 ${shortValue}`}</div>
            </>
          )}
          <div className="context-menu-divider" />
          {count <= 1 && <div className="context-menu-item" onClick={() => handleContextAction('detail')}>查看行详情</div>}
          {count <= 1 && <div className="context-menu-item" onClick={() => handleContextAction('clone')}>复制为新行</div>}
          {count <= 1 && (pk || isNewRow) && (
            <>
              <div className="context-menu-item" onClick={() => handleContextAction('setEmpty')}>设为空字符串</div>
              <div className="context-menu-item" onClick={() => handleContextAction('setNull')}>设为 NULL</div>
            </>
          )}
          <div className="context-menu-item" onClick={() => handleContextAction('hideColumn')}>隐藏此列</div>
          <div className="context-menu-divider" />
          <div className="context-menu-item danger" onClick={() => handleContextAction('deleteRow')}><DeleteOutlined /> 删除行{suffix}</div>
        </div>
        )
      })()}

      <Modal
        open={sqlOpen}
        title="当前页 SQL"
        width={640}
        onClose={() => setSqlOpen(false)}
        footer={(
          <>
            <Button variant="default" icon={<CopyOutlined />} onClick={() => void writeClipboard(lastSql, 'SQL 已复制')}>复制</Button>
            <Button variant="primary" icon={<CodeOutlined />} onClick={() => { addQueryTab(connectionId, database, `${lastSql};`); setSqlOpen(false) }}>在查询中打开</Button>
          </>
        )}
      >
        <pre className="db-sql-preview">{lastSql}</pre>
        <div className="db-sql-hint">分页方式：{effectiveModeLabel}{paginationFallbackHint ? `（${paginationFallbackHint}）` : ''}</div>
      </Modal>

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
