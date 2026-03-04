import './ui.css'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

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

interface TableVirtualConfig {
  enabled: boolean
  rowHeight: number
  overscan?: number
  threshold?: number
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
  virtual?: TableVirtualConfig
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
  virtual,
}: TableProps<T>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const latestScrollTopRef = useRef(0)
  const latestViewportHeightRef = useRef(0)

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

  const virtualOverscan = Math.max(0, virtual?.overscan ?? 6)
  const virtualThreshold = Math.max(0, virtual?.threshold ?? 200)
  const virtualRowHeight = virtual?.rowHeight ?? 34
  const virtualEnabled = Boolean(
    virtual?.enabled
      && !loading
      && dataSource.length > virtualThreshold
      && virtualRowHeight > 0
  )

  useEffect(() => {
    if (!virtualEnabled || !scrollRef.current) return

    const el = scrollRef.current
    const updateViewport = () => {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      const rawScrollTop = el.scrollTop
      const nextScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, maxScrollTop - rawScrollTop <= 1 ? maxScrollTop : Math.round(rawScrollTop))
      )
      const nextViewportHeight = el.clientHeight
      latestScrollTopRef.current = nextScrollTop
      latestViewportHeightRef.current = nextViewportHeight
      setScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop))
      setViewportHeight((prev) => (prev === nextViewportHeight ? prev : nextViewportHeight))
    }

    updateViewport()

    const onScroll = () => {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      const rawScrollTop = el.scrollTop
      latestScrollTopRef.current = Math.max(
        0,
        Math.min(maxScrollTop, maxScrollTop - rawScrollTop <= 1 ? maxScrollTop : Math.round(rawScrollTop))
      )
      latestViewportHeightRef.current = el.clientHeight
      if (rafIdRef.current !== null) return

      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null
        const nextScrollTop = latestScrollTopRef.current
        const nextViewportHeight = latestViewportHeightRef.current
        setScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop))
        setViewportHeight((prev) => (prev === nextViewportHeight ? prev : nextViewportHeight))
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })

    const observer = new ResizeObserver(() => {
      const nextViewportHeight = el.clientHeight
      latestViewportHeightRef.current = nextViewportHeight
      setViewportHeight((prev) => (prev === nextViewportHeight ? prev : nextViewportHeight))
    })
    observer.observe(el)

    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [virtualEnabled])

  useEffect(() => {
    if (!virtualEnabled || !scrollRef.current) return
    const el = scrollRef.current

    const handleWheel = (event: WheelEvent) => {
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      const currentScrollTop = el.scrollTop
      const atTop = currentScrollTop <= 0
      const atBottom = currentScrollTop >= maxScrollTop - 1
      const scrollingUp = event.deltaY < 0
      const scrollingDown = event.deltaY > 0

      if ((atTop && scrollingUp) || (atBottom && scrollingDown)) {
        event.preventDefault()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [virtualEnabled])

  const virtualWindow = useMemo(() => {
    if (!virtualEnabled) {
      return {
        start: 0,
        end: dataSource.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      }
    }

    const normalizedScrollTop = Math.max(0, Math.round(scrollTop))
    const visibleCount = Math.max(1, Math.ceil((viewportHeight || virtualRowHeight) / virtualRowHeight))
    const start = Math.max(0, Math.floor(normalizedScrollTop / virtualRowHeight) - virtualOverscan)
    const end = Math.min(dataSource.length, start + visibleCount + virtualOverscan * 2)

    return {
      start,
      end,
      topSpacerHeight: Math.max(0, Math.round(start * virtualRowHeight)),
      bottomSpacerHeight: Math.max(0, Math.round((dataSource.length - end) * virtualRowHeight)),
    }
  }, [virtualEnabled, dataSource.length, viewportHeight, scrollTop, virtualOverscan, virtualRowHeight])

  const renderRows = virtualEnabled
    ? dataSource.slice(virtualWindow.start, virtualWindow.end)
    : dataSource

  return (
    <div className={`ui-table-wrapper ui-table-${size} ${className}`} style={style}>
      <div className={`ui-table-scroll ${virtualEnabled ? 'ui-table-scroll-virtual' : ''}`} ref={scrollRef}>
        <table className={`ui-table ${virtualEnabled ? 'ui-table-virtual-enabled' : ''}`}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: getColWidth(col), minWidth: getColWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ position: 'sticky', top: 0 }}>
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
              <tr className="ui-table-loading-row" aria-hidden>
                <td colSpan={columns.length}>
                  <div className="ui-table-skeleton-line" />
                </td>
              </tr>
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
              <>
                {virtualEnabled && virtualWindow.topSpacerHeight > 0 && (
                  <tr className="ui-table-virtual-spacer" aria-hidden>
                    <td colSpan={columns.length} style={{ height: virtualWindow.topSpacerHeight }} />
                  </tr>
                )}
                {renderRows.map((record, index) => {
                  const actualIndex = virtualEnabled ? virtualWindow.start + index : index
                  return (
                    <tr key={getRowKey(record, actualIndex)} {...onRow?.(record, actualIndex)}>
                      {columns.map((col) => (
                        <td key={col.key} className={col.ellipsis ? 'ellipsis' : ''}>
                          {col.render ? col.render(getValue(record, col), record, actualIndex) : getValue(record, col)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {virtualEnabled && virtualWindow.bottomSpacerHeight > 0 && (
                  <tr className="ui-table-virtual-spacer" aria-hidden>
                    <td colSpan={columns.length} style={{ height: virtualWindow.bottomSpacerHeight }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="ui-table-loading-overlay">
            <div className="ui-table-loading-content">
              <div className="ui-spin-dot" />
              <div style={{ marginTop: 8 }}>加载中...</div>
            </div>
          </div>
        )}
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
