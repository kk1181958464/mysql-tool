import { useState, useRef, useCallback, useMemo } from 'react'
import { Table, Tooltip, Input } from './ui'

interface DataGridProps {
  columns: { name: string; type: string }[]
  rows: Record<string, unknown>[]
  loading?: boolean
  total?: number
  page?: number
  pageSize?: number
  onPageChange?: (page: number, pageSize: number) => void
  onSort?: (field: string, order: 'ascend' | 'descend' | null) => void
  editable?: boolean
  onCellEdit?: (rowIndex: number, field: string, value: unknown) => void
}

export default function DataGrid({
  columns,
  rows,
  loading,
  total,
  page = 1,
  pageSize = 100,
  onPageChange,
  editable,
  onCellEdit,
}: DataGridProps) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = useCallback((rowIndex: number, field: string, value: unknown) => {
    if (!editable) return
    setEditingCell({ row: rowIndex, col: field })
    setEditValue(value === null ? '' : String(value))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [editable])

  const commitEdit = useCallback(() => {
    if (editingCell && onCellEdit) {
      onCellEdit(editingCell.row, editingCell.col, editValue || null)
    }
    setEditingCell(null)
  }, [editingCell, editValue, onCellEdit])

  const cancelEdit = useCallback(() => setEditingCell(null), [])

  const tableColumns = useMemo(() => {
    return columns.map((col) => ({
      key: col.name,
      title: <Tooltip title={col.type}>{col.name}</Tooltip>,
      dataIndex: col.name,
      width: 150,
      ellipsis: true,
      render: (value: unknown, _record: Record<string, unknown>, index: number) => {
        if (editingCell?.row === index && editingCell?.col === col.name) {
          return (
            <input
              ref={inputRef}
              className="ui-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              onBlur={commitEdit}
              style={{ padding: '0 4px', height: 24, width: '100%' }}
            />
          )
        }
        if (value === null || value === undefined) {
          return <span className="null-value">(NULL)</span>
        }
        return String(value)
      },
    }))
  }, [columns, editingCell, editValue, commitEdit, cancelEdit])

  return (
    <Table
      columns={tableColumns}
      dataSource={rows}
      rowKey={(_, i) => String(i)}
      loading={loading}
      size="small"
      scroll={{ x: 'max-content', y: 'calc(100vh - 250px)' }}
      pagination={total != null ? { page, pageSize, total, onChange: (p) => onPageChange?.(p, pageSize) } : false}
      onRow={(record, index) => ({
        onDoubleClick: () => {
          const firstCol = columns[0]?.name
          if (firstCol) handleDoubleClick(index, firstCol, record[firstCol])
        },
      })}
    />
  )
}
