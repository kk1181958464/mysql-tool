import './ui.css'
import { useState, useRef, useCallback } from 'react'

interface Column<T> {
  key: string
  title: React.ReactNode
  dataIndex?: string
  width?: number | string
  render?: (value: any, record: T, index: number) => React.ReactNode
  sorter?: boolean | ((a: T, b: T) => number)
  ellipsis?: boolean
  resizable?: boolean
}

interface TableProps<T> {
  columns: Column<T>[]
  dataSource: T[]
  rowKey?: string | ((record: T) => string)
  loading?: boolean
  size?: 'small' | 'medium' | 'large'
  onRow?: (record: T, index: number) => React.HTMLAttributes<HTMLTableRowElement>
  className?: string
  style?: React.CSSProperties
  scroll?: { x?: number | string; y?: number | string }
  pagination?: false | { page: number; pageSize: number; total: number; onChange: (page: number) => void }
  resizable?: boolean
}

export function Table<T extends Record<string, any>>({
  columns,
  dataSource,
  rowKey = 'id',
  loading,
  size = 'medium',
  onRow,
  className = '',
  style,
  scroll,
  pagination,
  resizable = false,
}: TableProps<T>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent, colKey: string, currentWidth: number) => {
    e.preventDefault()
    resizing.current = { key: colKey, startX: e.clientX, startWidth: currentWidth }

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const diff = e.clientX - resizing.current.startX
      const newWidth = Math.max(50, resizing.current.startWidth + diff)
      setColWidths(prev => ({ ...prev, [resizing.current!.key]: newWidth }))
    }

    const handleMouseUp = () => {
      resizing.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  const getRowKey = (record: T, index: number) => {
    if (typeof rowKey === 'function') return rowKey(record)
    return record[rowKey] ?? index
  }

  const getValue = (record: T, col: Column<T>) => {
    if (col.dataIndex) return record[col.dataIndex]
    return undefined
  }

  const getColWidth = (col: Column<T>) => {
    if (colWidths[col.key]) return colWidths[col.key]
    if (typeof col.width === 'number') return col.width
    return col.width
  }

  return (
    <div className={`ui-table-wrapper ui-table-${size} ${className}`} style={style}>
      <div className="ui-table-scroll">
        <table className="ui-table">
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: getColWidth(col), minWidth: getColWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ position: 'relative' }}>
                  {col.title}
                  {resizable && (
                    <span
                      className="ui-table-resize-handle"
                      onMouseDown={(e) => handleMouseDown(e, col.key, colWidths[col.key] || (typeof col.width === 'number' ? col.width : 150))}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="ui-table-loading"><div className="ui-spin-dot" style={{ margin: '0 auto' }} /><div style={{ marginTop: 8 }}>加载中...</div></td></tr>
            ) : dataSource.length === 0 ? (
              <tr><td colSpan={columns.length} className="ui-table-empty">
                <div className="ui-table-empty-icon">
                  <svg width="64" height="48" viewBox="0 0 64 48" fill="none">
                    <ellipse cx="32" cy="44" rx="32" ry="4" fill="currentColor" opacity="0.08"/>
                    <rect x="12" y="8" width="40" height="30" rx="4" stroke="currentColor" opacity="0.15" strokeWidth="1.5" fill="none"/>
                    <line x1="12" y1="16" x2="52" y2="16" stroke="currentColor" opacity="0.1" strokeWidth="1.5"/>
                    <rect x="18" y="21" width="12" height="2" rx="1" fill="currentColor" opacity="0.12"/>
                    <rect x="18" y="27" width="20" height="2" rx="1" fill="currentColor" opacity="0.08"/>
                    <rect x="18" y="33" width="8" height="2" rx="1" fill="currentColor" opacity="0.06"/>
                  </svg>
                </div>
                <div className="ui-table-empty-text">暂无数据</div>
                <div className="ui-table-empty-hint">当前没有可显示的记录</div>
              </td></tr>
            ) : (
              dataSource.map((record, index) => (
                <tr key={getRowKey(record, index)} {...onRow?.(record, index)}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.ellipsis ? 'ellipsis' : ''}>
                      {col.render ? col.render(getValue(record, col), record, index) : getValue(record, col)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && pagination !== false && (
        <div className="ui-table-pagination">
          <span>共 {pagination.total} 条</span>
          <div className="ui-pagination">
            <button disabled={pagination.page <= 1} onClick={() => pagination.onChange(pagination.page - 1)}>上一页</button>
            <span>{pagination.page} / {Math.ceil(pagination.total / pagination.pageSize)}</span>
            <button disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)} onClick={() => pagination.onChange(pagination.page + 1)}>下一页</button>
          </div>
        </div>
      )}
    </div>
  )
}
