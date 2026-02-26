import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Table, Input, Space, Button, Popconfirm, DateTimePicker } from '../../components/ui'
import { PlusOutlined, DeleteOutlined, FilterOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../../utils/ipc'
import type { QueryResult, ColumnInfo } from '../../../../shared/types/query'
import { DataExport } from './DataExport'

interface Props {
  connectionId: string
  database: string
  table: string
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

const toLocalInput = (val: unknown): string => {
  let d: Date | null = null
  if (isDateValue(val)) d = val
  else if (val) { d = new Date(String(val)); if (isNaN(d.getTime())) d = null }
  if (!d) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
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
  borderLeft: '2px solid transparent', transition: 'background-color 0.1s ease',
}
const cellStyleSelected: React.CSSProperties = {
  ...cellStyle,
  background: 'var(--accent-bg)',
  borderLeftColor: 'var(--accent)',
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

// 可编辑单元格 - Navicat 风格
const EditableCell: React.FC<{
  value: unknown
  colType?: string
  isSelected: boolean
  isFocused: boolean
  onSelect: (shiftKey: boolean) => void
  onSave: (newValue: unknown) => void
  onContextMenu: (e: React.MouseEvent) => void
}> = React.memo(({ value, colType = '', isSelected, isFocused, onSelect, onSave, onContextMenu }) => {
  const [editing, setEditing] = useState(false)
  const lowerType = colType.toLowerCase()
  const isDateOnly = lowerType === 'date'
  const isDT = isDateOnly || valIsDate(value) || lowerType.includes('datetime') || lowerType.includes('timestamp')
  const [inputValue, setInputValue] = useState('')
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  const displayValue = fmtValue(value, isDateOnly)

  const enterEditing = useCallback(() => {
    if (cellRef.current) {
      const r = cellRef.current.getBoundingClientRect()
      setAnchorRect({ left: r.left, top: r.top, bottom: r.bottom })
    }
    setEditing(true)
  }, [])

  const commitText = useCallback((val: string) => {
    const trimmed = val.trim()
    const newVal = trimmed === '' ? null : trimmed
    if (newVal !== displayValue && !(value === null && newVal === null)) {
      onSave(newVal)
    }
    setEditing(false)
  }, [value, displayValue, onSave])

  const commitDatePicker = useCallback((val: string) => {
    if (val !== displayValue) {
      onSave(val)
    }
    setEditing(false)
  }, [displayValue, onSave])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitText(inputValue) }
    if (e.key === 'Escape') { setEditing(false) }
  }

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
            onCancel={() => setEditing(false)}
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

  return (
    <div
      ref={cellRef}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey) }}
      onDoubleClick={() => {
        enterEditing()
        setInputValue(isDT ? displayValue : (value === null ? '' : String(value)))
      }}
      onContextMenu={onContextMenu}
      style={isSelected ? cellStyleSelected : cellStyle}
    >
      {value === null ? <span style={nullStyle}>NULL</span> : displayValue}
    </div>
  )
}, (prev, next) => prev.value === next.value && prev.isSelected === next.isSelected && prev.isFocused === next.isFocused && prev.colType === next.colType)

export const TableData: React.FC<Props> = ({ connectionId, database, table }) => {
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [jumpPage, setJumpPage] = useState('')
  const [where, setWhere] = useState('')
  const [orderBy] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const lastCheckedRef = useRef<string | null>(null)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const anchorCellRef = useRef<{ rowKey: string; colName: string } | null>(null)
  const [newRows, setNewRows] = useState<Record<string, unknown>[]>([])
  const newRowCounter = useRef(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState('')
  const [pendingChanges, setPendingChanges] = useState<Map<string, Record<string, unknown>>>(new Map())
  const [cellContextMenu, setCellContextMenu] = useState<{ x: number; y: number; rowKey: string; colName: string; record: Record<string, unknown> } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const fetchData = useCallback(async () => {
    if (!connectionId || !database || !table) return
    setLoading(true)
    setError('')
    try {
      const offset = (page - 1) * pageSize
      let sql = `SELECT * FROM \`${table}\``
      if (where.trim()) sql += ` WHERE ${where}`
      if (orderBy) sql += ` ORDER BY ${orderBy}`
      sql += ` LIMIT ${pageSize} OFFSET ${offset}`
      const res = await api.query.execute(connectionId, sql, database)
      setResult(res)

      let countSql = `SELECT COUNT(*) as cnt FROM \`${table}\``
      if (where.trim()) countSql += ` WHERE ${where}`
      const countRes = await api.query.execute(connectionId, countSql, database)
      setTotalCount(Number(countRes.rows[0]?.cnt ?? 0))
    } catch (e: any) {
      setError(e.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, table, page, pageSize, where, orderBy])

  useEffect(() => { fetchData() }, [fetchData])

  const pk = result?.columns.find((c) => c.primaryKey)
  const pkCol = pk?.name || '_rowIndex'
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const allRowKeys = [...(result?.rows.map((r, i) => String(r[pkCol] ?? i)) || []), ...newRows.map(r => String(r._newKey))]

  const handleDelete = async () => {
    if (selectedRowKeys.size === 0) return
    const newKeys = [...selectedRowKeys].filter(k => k.startsWith('_new_'))
    const dbKeys = [...selectedRowKeys].filter(k => !k.startsWith('_new_'))
    // 数据库行需要确认
    if (dbKeys.length > 0 && !window.confirm(`确定删除 ${dbKeys.length} 行数据？`)) return
    if (newKeys.length > 0) {
      setNewRows(prev => prev.filter(r => !newKeys.includes(String(r._newKey))))
    }
    if (dbKeys.length > 0 && pk) {
      try {
        for (const key of dbKeys) {
          await api.data.delete(connectionId, database, table, { [pk.name]: key })
        }
        fetchData()
      } catch (e: any) {
        setError(e.message || '删除失败')
      }
    }
    setSelectedRowKeys(new Set())
  }

  const handleCellChange = useCallback((rowKey: unknown, colName: string, newValue: unknown) => {
    const key = String(rowKey)
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

  const handleSaveChanges = useCallback(async () => {
    const hasUpdates = pk && pendingChanges.size > 0
    const hasInserts = newRows.length > 0
    if (!hasUpdates && !hasInserts) return
    setLoading(true)
    try {
      // 保存修改行
      if (hasUpdates) {
        for (const [rowKey, changes] of pendingChanges) {
          await api.data.update(connectionId, database, table, changes, { [pk!.name]: rowKey })
        }
        setPendingChanges(new Map())
      }
      // 保存新增行
      if (hasInserts) {
        const cols = result?.columns || []
        for (const row of newRows) {
          const data: Record<string, unknown> = {}
          for (const col of cols) {
            if (col.autoIncrement) continue
            data[col.name] = row[col.name] ?? null
          }
          await api.data.insert(connectionId, database, table, data)
        }
        setNewRows([])
      }
      fetchData()
    } catch (e: any) {
      setError(e.message || '保存失败')
    }
    setLoading(false)
  }, [pk, pendingChanges, newRows, result?.columns, connectionId, database, table, fetchData])

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveChanges()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleSaveChanges])

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
    const selectedKeys = selectedRowKeys.size > 0 ? [...selectedRowKeys] : [rowKey]
    const allRows = [...(result?.rows.map((r, i) => ({ ...r, _rowIndex: i })) || []), ...newRows]
    const rowsByKey = new Map<string, Record<string, unknown>>()
    allRows.forEach((r, i) => rowsByKey.set(String(r._newKey ?? r[pkCol] ?? i), r))

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
        const newKeys = selectedKeys.filter(k => k.startsWith('_new_'))
        const dbKeys = selectedKeys.filter(k => !k.startsWith('_new_'))
        if (newKeys.length > 0) {
          setNewRows(prev => prev.filter(r => !newKeys.includes(String(r._newKey))))
        }
        if (dbKeys.length > 0 && pk) {
          try {
            for (const key of dbKeys) {
              await api.data.delete(connectionId, database, table, { [pk.name]: key })
            }
            fetchData()
          } catch (e: any) { setError(e.message || '删除失败') }
        }
        setSelectedRowKeys(new Set())
        break
      }
    }
  }

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
  const allChecked = allRowKeys.length > 0 && allRowKeys.every(k => selectedRowKeys.has(k))

  const checkboxCol = {
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
    render: (_: unknown, record: Record<string, unknown>, index: number) => {
      const rk = String(record._newKey ?? record[pkCol] ?? index)
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
  }

  const dataCols = useMemo(() => result?.columns.map((col) => ({
    key: col.name,
    title: col.name,
    dataIndex: col.name,
    ellipsis: true,
    width: 150,
    render: (v: unknown, record: Record<string, unknown>, index: number) => {
      const rk = String(record._newKey ?? record[pkCol] ?? index)
      const pending = pendingChanges.get(rk)
      const cellValue = pending && col.name in pending ? pending[col.name] : v
      const isSel = selectedCells.has(`${rk}:${col.name}`)
      const isFoc = selectedCells.size === 1 && isSel
      return (
        <EditableCell
          value={cellValue}
          colType={col.type}
          isSelected={isSel}
          isFocused={isFoc}
          onSelect={(shiftKey) => handleCellSelect(rk, col.name, shiftKey)}
          onSave={(newVal) => handleCellChange(rk, col.name, newVal)}
          onContextMenu={(e) => handleCellContextMenu(e, rk, col.name, record)}
        />
      )
    },
  })) || [], [result?.columns, pkCol, pendingChanges, selectedCells, handleCellChange, handleCellSelect])

  const columns = [checkboxCol, ...dataCols]

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px' }}>
      <Space style={{ marginBottom: 8 }}>
        <Input
          prefix={<FilterOutlined />}
          placeholder="WHERE 条件..."
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (setPage(1), fetchData())}
          style={{ width: 300 }}
        />
        <Button size="small" disabled={newRows.length > 0} onClick={() => {
          newRowCounter.current += 1
          const emptyRow: Record<string, unknown> = { _newKey: `_new_${newRowCounter.current}` }
          for (const col of (result?.columns || [])) {
            emptyRow[col.name] = col.autoIncrement ? null : null
          }
          setNewRows(prev => [...prev, emptyRow])
        }}>
          <PlusOutlined /> 新增
        </Button>
        <Button size="small" type="danger" disabled={selectedRowKeys.size === 0} onClick={handleDelete}>
          <DeleteOutlined /> 删除({selectedRowKeys.size})
        </Button>
        {(pendingChanges.size > 0 || newRows.length > 0) && (
          <Button size="small" type="primary" onClick={handleSaveChanges}>
            <SaveOutlined /> 保存修改 ({pendingChanges.size + newRows.length})
          </Button>
        )}
        {newRows.length === 0 && <Button size="small" onClick={() => setExportOpen(true)}>导出</Button>}
      </Space>

      {error && <div style={{ color: 'var(--color-red)', marginBottom: 8 }}>{error}</div>}

      <div style={{ flex: 1, minHeight: 0 }} onClick={() => { setSelectedCells(new Set()); anchorCellRef.current = null }}>
        <Table
          size="small"
          loading={loading}
          dataSource={[...(result?.rows.map((r, i) => ({ ...r, _rowIndex: i })) || []), ...newRows]}
          columns={columns}
          rowKey={(r: Record<string, unknown>) => String(r._newKey ?? r[pkCol] ?? r._rowIndex)}
          onRow={(record: Record<string, unknown>) => ({
            style: record._newKey ? { background: 'rgba(34,197,94,0.12)' } : undefined,
          })}
          scroll={{ x: 'max-content' }}
          resizable
        />
      </div>

      <div style={{ padding: '8px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ color: 'var(--text-muted)' }}>共 {totalCount} 行，共 {totalPages} 页 {(pendingChanges.size > 0 || newRows.length > 0) && <span style={{ color: 'var(--accent)' }}>| 未保存: {pendingChanges.size + newRows.length} 行 (Ctrl+S)</span>}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="ui-btn ui-btn-default" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
          <span>{page} / {totalPages}</span>
          <button className="ui-btn ui-btn-default" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
          <span style={{ color: 'var(--text-muted)' }}>跳转到</span>
          <Input
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const n = Number(jumpPage)
                if (!Number.isFinite(n) || n < 1) return
                setPage(Math.min(totalPages, n))
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
              setPage(Math.min(totalPages, n))
            }}
          >
            跳转
          </button>
        </div>
      </div>

      {/* 单元格右键菜单 */}
      {cellContextMenu && (() => {
        const count = selectedRowKeys.size > 0 ? selectedRowKeys.size : 1
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

      <DataExport open={exportOpen} onClose={() => setExportOpen(false)} connectionId={connectionId} database={database} table={table} />
    </div>
  )
}
