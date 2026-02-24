import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Table, Button, Space, Input, Modal } from '../../components/ui'
import {
  TableOutlined, AppstoreOutlined, ReloadOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, SearchOutlined, FolderOpenOutlined,
  FormOutlined, ClearOutlined, ExportOutlined, ImportOutlined
} from '@ant-design/icons'
import { useDatabaseStore } from '../../stores/database.store'
import { useTabStore } from '../../stores/tab.store'
import { api } from '../../utils/ipc'
import type { TableInfo } from '../../../../shared/types/metadata'

interface Props {
  connectionId: string
  database: string
}

type ViewMode = 'table' | 'card'

// 持久化视图模式
const VIEW_MODE_KEY = 'objects-view-mode'
const getStoredViewMode = (): ViewMode => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'table'
const setStoredViewMode = (mode: ViewMode) => localStorage.setItem(VIEW_MODE_KEY, mode)

export const ObjectsBrowser: React.FC<Props> = ({ connectionId, database }) => {
  const { tables, loadTables } = useDatabaseStore()
  const { addDataTab, addDesignTab } = useTabStore()
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [tableStatus, setTableStatus] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [contextMenu, setContextMenu] = useState<{ tableName: string; x: number; y: number } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [truncateConfirm, setTruncateConfirm] = useState<string | null>(null)
  const [renameModal, setRenameModal] = useState<{ tableName: string; newName: string } | null>(null)
  const [exportSql, setExportSql] = useState<{ tableName: string; sql: string; includeData?: boolean } | null>(null)
  const [operating, setOperating] = useState(false)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const lastClickedRef = useRef<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, fail: 0 })
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)
  const pendingImport = useRef<string | null>(null)

  const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('文件读取失败'))
    r.readAsText(file, 'utf-8')
  })

  const executeSqlContent = async (content: string) => {
    pendingImport.current = content
    setImporting(true)
  }

  // importing 变 true 后，下一个渲染周期浏览器已 paint 出遮罩，再执行导入
  useEffect(() => {
    if (!importing || !pendingImport.current) return
    const content = pendingImport.current
    setImportProgress({ current: 0, total: 0, fail: 0 })
    const unsub = api.onImportProgress((data) => setImportProgress(data))
    const run = async () => {
      try {
        await api.query.executeMulti(connectionId, content, database)
        setImportMsg('SQL 导入执行成功')
        handleRefresh()
      } catch (e: any) {
        setImportMsg('导入失败：' + (e.message || e))
      } finally {
        pendingImport.current = null
        setImporting(false)
        unsub()
      }
    }
    setTimeout(run, 50)
  }, [importing])

  const handleImportSql = async () => {
    const filePath = await api.dialog.openFile({ filters: [{ name: 'SQL Files', extensions: ['sql'] }] })
    if (!filePath) return
    try {
      const content = await api.dialog.readFile(filePath)
      await executeSqlContent(content)
    } catch (e: any) {
      setImportMsg(e.message || '导入失败')
    }
  }

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setDragOver(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false) } }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !file.name.endsWith('.sql')) return
    const content = await readFile(file)
    await executeSqlContent(content)
  }

  const cacheKey = `${connectionId}:${database}`
  const tableList = tables[cacheKey] || []

  useEffect(() => {
    if (!connectionId || !database) return
    loadTables(connectionId, database)
    loadTableStatus()
  }, [connectionId, database])

  const loadTableStatus = async () => {
    if (!connectionId || !database) return
    setLoading(true)
    setError('')
    try {
      const status = await api.meta.tableStatus(connectionId, database)
      setTableStatus(status || [])
    } catch (e: any) {
      console.error('loadTableStatus error:', e)
      setError(e.message || '加载失败')
    }
    setLoading(false)
  }

  const handleRefresh = () => {
    loadTables(connectionId, database)
    loadTableStatus()
    setSelectedTables(new Set())
  }

  const handleRowClick = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const isShift = e.shiftKey
    const isCtrl = e.ctrlKey || e.metaKey
    if (isShift) e.preventDefault()
    setSelectedTables(prev => {
      const next = new Set(prev)
      if (isShift && lastClickedRef.current) {
        const names = mergedTables.map(t => t.name)
        const from = names.indexOf(lastClickedRef.current)
        const to = names.indexOf(tableName)
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from]
          for (let i = start; i <= end; i++) next.add(names[i])
        }
      } else if (isCtrl) {
        next.has(tableName) ? next.delete(tableName) : next.add(tableName)
      } else {
        next.clear()
        next.add(tableName)
      }
      return next
    })
    lastClickedRef.current = tableName
  }

  const handleBatchDelete = async () => {
    setBatchDeleteConfirm(false)
    setOperating(true)
    try {
      for (const name of selectedTables) {
        await api.query.execute(connectionId, `DROP TABLE \`${database}\`.\`${name}\``)
      }
      setSelectedTables(new Set())
      handleRefresh()
    } catch (e: any) { alert(e.message || '批量删除失败') }
    setOperating(false)
  }

  const handleOpen = (tableName: string) => {
    addDataTab(connectionId, database, tableName)
  }

  const handleDesign = (tableName: string) => {
    addDesignTab(connectionId, database, tableName)
  }

  const handleNewTable = () => {
    addDesignTab(connectionId, database, null)
  }

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault()
    e.stopPropagation()
    // 右键时：若该行未选中，则单选它；若已选中，保持当前多选
    if (!selectedTables.has(tableName)) {
      setSelectedTables(new Set([tableName]))
    }
    const menuHeight = 280
    const y = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY
    setContextMenu({ tableName, x: e.clientX, y })
  }

  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    const handleScroll = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  // 点击非数据行区域清空选中
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('tbody tr, .obj-card, button, input, .context-menu, .ant-modal, [class*="modal"]')) return
      setSelectedTables(new Set())
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleMenuAction = async (action: string) => {
    if (!contextMenu) return
    const tableName = contextMenu.tableName
    const count = selectedTables.size
    setContextMenu(null)

    switch (action) {
      case 'open':
        for (const n of selectedTables) handleOpen(n)
        break
      case 'design':
        for (const n of selectedTables) handleDesign(n)
        break
      case 'rename': setRenameModal({ tableName, newName: tableName }); break
      case 'truncate':
        if (count > 1) {
          if (!window.confirm(`确定要清空选中的 ${count} 个表吗？此操作不可恢复！`)) return
          setOperating(true)
          try {
            for (const n of selectedTables) await api.query.execute(connectionId, `TRUNCATE TABLE \`${database}\`.\`${n}\``)
          } catch (e: any) { alert(e.message || '清空失败') }
          setOperating(false)
        } else {
          setTruncateConfirm(tableName)
        }
        break
      case 'drop':
        if (count > 1) {
          setBatchDeleteConfirm(true)
        } else {
          setDeleteConfirm(tableName)
        }
        break
      case 'exportStructure': {
        const names = [...selectedTables]
        const parts: string[] = []
        for (const n of names) {
          try {
            const ddl = await api.meta.tableDDL(connectionId, database, n)
            parts.push((typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || '')
          } catch (e: any) { alert(e.message || '导出失败'); return }
        }
        setExportSql({ tableName: names.length > 1 ? database : names[0], sql: parts.join('\n\n-- ----------------------------\n\n') })
        break
      }
      case 'exportAll': {
        const names = [...selectedTables]
        const parts: string[] = []
        for (const n of names) {
          try {
            const ddl = await api.meta.tableDDL(connectionId, database, n)
            parts.push((typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || '')
          } catch (e: any) { alert(e.message || '导出失败'); return }
        }
        setExportSql({ tableName: names.length > 1 ? database : names[0], sql: parts.join('\n\n-- ----------------------------\n\n'), includeData: true })
        break
      }
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setOperating(true)
    try {
      await api.query.execute(connectionId, `DROP TABLE \`${database}\`.\`${deleteConfirm}\``)
      handleRefresh()
      setDeleteConfirm(null)
    } catch (e: any) { alert(e.message || '删除失败') }
    setOperating(false)
  }

  const handleTruncate = async () => {
    if (!truncateConfirm) return
    setOperating(true)
    try {
      await api.query.execute(connectionId, `TRUNCATE TABLE \`${database}\`.\`${truncateConfirm}\``)
      setTruncateConfirm(null)
    } catch (e: any) { alert(e.message || '清空失败') }
    setOperating(false)
  }

  const handleRename = async () => {
    if (!renameModal || renameModal.newName === renameModal.tableName) return
    setOperating(true)
    try {
      await api.query.execute(connectionId, `RENAME TABLE \`${database}\`.\`${renameModal.tableName}\` TO \`${database}\`.\`${renameModal.newName}\``)
      handleRefresh()
      setRenameModal(null)
    } catch (e: any) { alert(e.message || '重命名失败') }
    setOperating(false)
  }

  const exportTableSql = async (tableName: string, includeData: boolean) => {
    try {
      const ddl = await api.meta.tableDDL(connectionId, database, tableName)
      let sql = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
      if (includeData) {
        const dataResult = await api.query.execute(connectionId, `SELECT * FROM \`${database}\`.\`${tableName}\``, database)
        if (dataResult.rows?.length) {
          const cols = Object.keys(dataResult.rows[0])
          const values = dataResult.rows.map((row: any) => {
            return '(' + cols.map((c: string) => {
              const v = row[c]
              if (v === null) return 'NULL'
              if (typeof v === 'number') return v
              return `'${String(v).replace(/'/g, "''")}'`
            }).join(', ') + ')'
          }).join(',\n')
          sql += `\n\nINSERT INTO \`${tableName}\` (\`${cols.join('`, `')}\`) VALUES\n${values};`
        }
      }
      setExportSql({ tableName, sql })
    } catch (e: any) { alert(e.message || '导出失败') }
  }

  const handleDownloadSql = async () => {
    if (!exportSql) return
    let fullSql = exportSql.sql
    if (exportSql.includeData) {
      const names = [...selectedTables]
      const parts: string[] = []
      for (const n of names) {
        try {
          const ddl = await api.meta.tableDDL(connectionId, database, n)
          let sql = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
          const dataResult = await api.query.execute(connectionId, `SELECT * FROM \`${database}\`.\`${n}\``, database)
          if (dataResult.rows?.length) {
            const cols = Object.keys(dataResult.rows[0])
            const values = dataResult.rows.map((row: any) =>
              '(' + cols.map((c: string) => { const v = row[c]; if (v === null) return 'NULL'; if (typeof v === 'number') return v; return `'${String(v).replace(/'/g, "''")}'` }).join(', ') + ')'
            ).join(',\n')
            sql += `\n\nINSERT INTO \`${n}\` (\`${cols.join('`, `')}\`) VALUES\n${values};`
          }
          parts.push(sql)
        } catch (e: any) { alert(e.message || '导出失败'); return }
      }
      fullSql = parts.join('\n\n-- ----------------------------\n\n')
    }
    const blob = new Blob([fullSql], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportSql.tableName}.sql`
    a.click()
    URL.revokeObjectURL(url)
    setExportSql(null)
  }

  const handleCopySql = async () => {
    if (!exportSql) return
    await navigator.clipboard.writeText(exportSql.sql)
    setExportSql(null)
    alert('已复制到剪贴板')
  }

  // 合并表信息
  const mergedTables = tableList.map(t => {
    const status = tableStatus.find(s => s.name === t.name)
    return { ...t, ...status }
  }).filter(t => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))

  const formatSize = (bytes: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const columns = [
    {
      key: 'name',
      title: '名称',
      dataIndex: 'name',
      width: 200,
      render: (v: string) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', color: 'var(--accent)', cursor: 'pointer' }}>
          <TableOutlined style={{ marginRight: 6, flexShrink: 0 }} />{v}
        </span>
      )
    },
    { key: 'rows', title: '行数', dataIndex: 'rows', width: 100, render: (v: number) => v?.toLocaleString() || '-' },
    { key: 'dataLength', title: '数据大小', dataIndex: 'dataLength', width: 100, render: formatSize },
    { key: 'engine', title: '引擎', dataIndex: 'engine', width: 80 },
    { key: 'collation', title: '排序规则', dataIndex: 'collation', width: 150 },
    { key: 'createTime', title: '创建时间', dataIndex: 'createTime', width: 160, render: (v: any) => v ? (v instanceof Date ? v.toLocaleString() : String(v)) : '-' },
    { key: 'comment', title: '注释', dataIndex: 'comment', ellipsis: true, render: (v: any) => v || '-' },
  ]

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, position: 'relative' }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(59,130,246,0.1)', border: '2px dashed var(--accent)', borderRadius: 8, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--accent)', pointerEvents: 'none' }}>
          拖放 .sql 文件到此处导入
        </div>
      )}
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Button size="small" onClick={handleNewTable}><PlusOutlined /> 新建表</Button>
        <Button size="small" onClick={handleImportSql} disabled={importing}><ImportOutlined /> {importing ? '导入中...' : '导入SQL'}</Button>
        <Button size="small" onClick={handleRefresh}><ReloadOutlined /> 刷新</Button>
        {selectedTables.size > 0 && (
          <Button size="small" type="danger" onClick={() => setBatchDeleteConfirm(true)}>
            <DeleteOutlined /> 删除选中({selectedTables.size})
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索表..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ width: 200 }}
        />
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4 }}>
          <button
            onClick={() => { setViewMode('table'); setStoredViewMode('table') }}
            style={{
              padding: '4px 8px',
              background: viewMode === 'table' ? 'var(--accent)' : 'transparent',
              color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '3px 0 0 3px',
            }}
          >
            <TableOutlined />
          </button>
          <button
            onClick={() => { setViewMode('card'); setStoredViewMode('card') }}
            style={{
              padding: '4px 8px',
              background: viewMode === 'card' ? 'var(--accent)' : 'transparent',
              color: viewMode === 'card' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '0 3px 3px 0',
            }}
          >
            <AppstoreOutlined />
          </button>
        </div>
      </div>

      {/* 统计信息 */}
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        共 {mergedTables.length} 个表
        {error && <span style={{ color: 'var(--error)', marginLeft: 12 }}>{error}</span>}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', userSelect: 'none' }} onContextMenu={e => e.preventDefault()}>
        {viewMode === 'table' ? (
          <Table
            size="small"
            loading={loading}
            columns={columns}
            dataSource={mergedTables}
            rowKey="name"
            resizable
            onRow={(record) => ({
              onClick: (e) => handleRowClick(record.name, e),
              onDoubleClick: () => { window.getSelection()?.removeAllRanges(); handleOpen(record.name) },
              onContextMenu: (e) => handleContextMenu(e, record.name),
              style: selectedTables.has(record.name) ? { background: 'rgba(59,130,246,0.35)' } : undefined,
            })}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {mergedTables.map(t => (
              <div
                key={t.name}
                style={{
                  background: selectedTables.has(t.name) ? 'rgba(59,130,246,0.25)' : 'var(--bg-surface)',
                  border: `1px solid ${selectedTables.has(t.name) ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 8,
                  padding: 16,
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onClick={(e) => handleRowClick(t.name, e)}
                onDoubleClick={() => { window.getSelection()?.removeAllRanges(); handleOpen(t.name) }}
                onContextMenu={(e) => handleContextMenu(e, t.name)}
                onMouseEnter={e => { if (!selectedTables.has(t.name)) e.currentTarget.style.borderColor = 'var(--accent)' }}
                onMouseLeave={e => { if (!selectedTables.has(t.name)) e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <TableOutlined style={{ color: 'var(--accent)', marginRight: 8 }} />
                  <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div>行数: <span style={{ color: 'var(--text-primary)' }}>{t.rows?.toLocaleString() || '-'}</span></div>
                  <div>大小: <span style={{ color: 'var(--text-primary)' }}>{formatSize(t.dataLength || 0)}</span></div>
                  <div>引擎: <span style={{ color: 'var(--text-primary)' }}>{t.engine || '-'}</span></div>
                  <div>排序: <span style={{ color: 'var(--text-primary)' }}>{t.collation?.split('_')[0] || '-'}</span></div>
                </div>
                {t.comment && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.comment}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (() => {
        const n = selectedTables.size
        const s = n > 1 ? `(${n})` : ''
        return (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <div className="context-menu-item" onClick={() => handleMenuAction('open')}><FolderOpenOutlined /> 打开表{s}</div>
          <div className="context-menu-item" onClick={() => handleMenuAction('design')}><EditOutlined /> 编辑表{s}</div>
          {n <= 1 && <div className="context-menu-item" onClick={() => handleMenuAction('rename')}><FormOutlined /> 重命名</div>}
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <div className="context-menu-item danger" onClick={() => handleMenuAction('truncate')}><ClearOutlined /> 清空表{s}</div>
          <div className="context-menu-item danger" onClick={() => handleMenuAction('drop')}><DeleteOutlined /> 删除表{s}</div>
          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
          <div className="context-menu-item" onClick={() => handleMenuAction('exportStructure')}><ExportOutlined /> 转储SQL(仅结构){s}</div>
          <div className="context-menu-item" onClick={() => handleMenuAction('exportAll')}><ExportOutlined /> 转储SQL(结构+数据){s}</div>
        </div>
        )
      })()}

      {/* 删除确认 */}
      <Modal open={!!deleteConfirm} title="删除表" width={400} onClose={() => setDeleteConfirm(null)} footer={
        <>
          <Button variant="default" onClick={() => setDeleteConfirm(null)}>取消</Button>
          <Button variant="primary" onClick={handleDelete} disabled={operating} style={{ background: 'var(--error)' }}>{operating ? '删除中...' : '确认删除'}</Button>
        </>
      }>
        <p>确定要删除表 <strong style={{ color: 'var(--error)' }}>{deleteConfirm}</strong> 吗？</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复！</p>
      </Modal>

      {/* 清空确认 */}
      <Modal open={!!truncateConfirm} title="清空表" width={400} onClose={() => setTruncateConfirm(null)} footer={
        <>
          <Button variant="default" onClick={() => setTruncateConfirm(null)}>取消</Button>
          <Button variant="primary" onClick={handleTruncate} disabled={operating} style={{ background: 'var(--warning)' }}>{operating ? '清空中...' : '确认清空'}</Button>
        </>
      }>
        <p>确定要清空表 <strong style={{ color: 'var(--warning)' }}>{truncateConfirm}</strong> 的所有数据吗？</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复！</p>
      </Modal>

      {/* 重命名 */}
      <Modal open={!!renameModal} title="重命名表" width={400} onClose={() => setRenameModal(null)} footer={
        <>
          <Button variant="default" onClick={() => setRenameModal(null)}>取消</Button>
          <Button variant="primary" onClick={handleRename} disabled={operating || !renameModal?.newName || renameModal?.newName === renameModal?.tableName}>{operating ? '保存中...' : '确认'}</Button>
        </>
      }>
        {renameModal && (
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>新表名</label>
            <input
              value={renameModal.newName}
              onChange={(e) => setRenameModal({ ...renameModal, newName: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>
        )}
      </Modal>

      {/* 批量删除确认 */}
      <Modal open={batchDeleteConfirm} title="批量删除表" width={400} onClose={() => setBatchDeleteConfirm(false)} footer={
        <>
          <Button variant="default" onClick={() => setBatchDeleteConfirm(false)}>取消</Button>
          <Button variant="primary" onClick={handleBatchDelete} disabled={operating} style={{ background: 'var(--error)' }}>{operating ? '删除中...' : `确认删除 ${selectedTables.size} 个表`}</Button>
        </>
      }>
        <p>确定要删除以下 <strong style={{ color: 'var(--error)' }}>{selectedTables.size}</strong> 个表吗？</p>
        <div style={{ maxHeight: 200, overflow: 'auto', margin: '8px 0', fontSize: 13 }}>
          {[...selectedTables].map(n => <div key={n}>• {n}</div>)}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复！</p>
      </Modal>

      {/* 导出SQL */}
      <Modal open={!!exportSql} title={`导出 ${exportSql?.tableName}.sql`} width={600} onClose={() => setExportSql(null)} footer={
        <>
          <Button variant="default" onClick={() => setExportSql(null)}>取消</Button>
          {!exportSql?.includeData && <Button variant="default" onClick={handleCopySql}>复制到剪贴板</Button>}
          <Button variant="primary" onClick={handleDownloadSql}>下载文件</Button>
        </>
      }>
        {exportSql && (
          <div>
            <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 12 }}>{exportSql.sql.length.toLocaleString()} 字符（仅结构）</div>
            <textarea
              readOnly
              value={exportSql.sql}
              style={{ width: '100%', height: 300, background: 'var(--bg-overlay)', color: 'var(--text-primary)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'Consolas, Monaco, monospace', resize: 'vertical' }}
            />
            {exportSql.includeData && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                💡 INSERT 数据语句已省略，点击「下载文件」将导出完整的结构+数据
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 导入进度遮罩 — portal 到 body */}
      {createPortal(
        <div style={{
          display: importing ? 'flex' : 'none',
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.45)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-elevated, #1e1e1e)', borderRadius: 8, padding: '32px 40px',
            textAlign: 'center', fontSize: 13, color: 'var(--text)', minWidth: 300,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ marginBottom: 16, fontSize: 14, fontWeight: 500 }}>SQL 导入中...</div>
            <div style={{ marginBottom: 8 }}>
              {importProgress.total > 0
                ? `已执行 ${importProgress.current} / ${importProgress.total} 条语句${importProgress.fail > 0 ? `（${importProgress.fail} 条失败）` : ''}`
                : '正在解析 SQL 语句...'}
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: importProgress.total > 0 ? `${Math.round(importProgress.current / importProgress.total * 100)}%` : '0%',
                background: importProgress.fail > 0 ? 'var(--warning)' : 'var(--accent)',
                borderRadius: 3,
                transition: 'width 0.2s ease',
              }} />
            </div>
            {importProgress.total > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {Math.round(importProgress.current / importProgress.total * 100)}%
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* 导入结果弹窗 */}
      <Modal
        open={!!importMsg}
        title="SQL 导入"
        width={400}
        onClose={() => setImportMsg(null)}
        footer={<Button variant="primary" onClick={() => setImportMsg(null)}>确定</Button>}
      >
        <div style={{ padding: '8px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 13 }}>{importMsg}</div>
      </Modal>
    </div>
  )
}
