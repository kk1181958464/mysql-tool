import React, { useEffect, useState, useRef, useMemo } from 'react'
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
import type { ImportProgressPayload } from '../../../../../preload/types'

interface Props {
  connectionId: string
  database: string
}

type ViewMode = 'table' | 'card'

// 持久化视图模式
const VIEW_MODE_KEY = 'objects-view-mode'
const getStoredViewMode = (): ViewMode => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'table'
const setStoredViewMode = (mode: ViewMode) => localStorage.setItem(VIEW_MODE_KEY, mode)
const tableStatusCache: Record<string, TableInfo[]> = {}

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
  const [exportSql, setExportSql] = useState<{ tableName: string; sql: string; includeData?: boolean; selectedNames?: string[] } | null>(null)
  const [operating, setOperating] = useState(false)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const lastClickedRef = useRef<string | null>(null)
  const latestStatusRequestKeyRef = useRef('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgressPayload>({ current: 0, total: 0, fail: 0, stage: 'parsing' })
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewLoadingText, setPreviewLoadingText] = useState('正在生成导出预览...')
  const [exporting, setExporting] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: string; done: number; total: number; rows: number; totalRows?: number; finished?: boolean; cancelled?: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pendingImport = useRef<string | null>(null)
  const exportCancelledRef = useRef(false)
  const exportSessionActiveRef = useRef(false)

  const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('文件读取失败'))
    r.readAsText(file, 'utf-8')
  })

  const executeSqlContent = async (content: string) => {
    pendingImport.current = content
    setImportMsg(null)
    setImportProgress({ current: 0, total: 0, fail: 0, stage: 'parsing' })
    setImporting(true)
  }

  // importing 变 true 后，下一个渲染周期浏览器已 paint 出遮罩，再执行导入
  useEffect(() => {
    if (!importing || !pendingImport.current) return
    const content = pendingImport.current
    setImportProgress({ current: 0, total: 0, fail: 0, stage: 'parsing' })
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
    const off = api.onExportProgress((data) => {
      if (!exportSessionActiveRef.current) return
      setExportProgress((prev) => {
        if (!prev) return data
        if (prev.cancelled || prev.finished) return prev
        return { ...prev, ...data }
      })
    })
    return off
  }, [])

  const loadTableStatus = async (forceLoading = false) => {
    if (!connectionId || !database) return
    const statusKey = `${connectionId}:${database}`
    const hasCachedStatus = Array.isArray(tableStatusCache[statusKey])
    const shouldShowLoading = forceLoading || !hasCachedStatus
    if (shouldShowLoading) {
      setLoading(true)
    }
    setError('')

    const requestKey = `${statusKey}:${Date.now()}`
    latestStatusRequestKeyRef.current = requestKey
    try {
      const status = await api.meta.tableStatus(connectionId, database)
      if (latestStatusRequestKeyRef.current !== requestKey) return
      const normalized = status || []
      tableStatusCache[statusKey] = normalized
      setTableStatus(normalized)
    } catch (e: any) {
      if (latestStatusRequestKeyRef.current !== requestKey) return
      console.error('loadTableStatus error:', e)
      const rawMessage = e?.message || '加载失败'
      const lower = String(rawMessage).toLowerCase()
      const isConnLost = lower.includes('connection lost')
        || lower.includes('server closed the connection')
        || lower.includes('连接已失效')
      setError(isConnLost ? '连接已失效，请点击刷新或重新连接后重试' : rawMessage)
    }

    if (latestStatusRequestKeyRef.current === requestKey) {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    loadTables(connectionId, database, true)
    void loadTableStatus(true)
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
    if (validSelectedTableNames.length === 0) {
      setBatchDeleteConfirm(false)
      return
    }

    setBatchDeleteConfirm(false)
    setOperating(true)
    try {
      for (const name of validSelectedTableNames) {
        await api.query.execute(connectionId, `DROP TABLE \`${database}\`.\`${name}\``)
      }
      setSelectedTables(new Set())
      setExportSql(null)
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
        const previewNames = names.slice(0, 3)
        setPreviewLoading(true)
        setPreviewLoadingText('正在生成结构 + 数据摘要预览...')
        const out: string[] = []
        out.push('-- Preview summary only: showing the first 3 tables. Click "Download File" to export the full structure and data.')
        if (names.length > previewNames.length) {
          out.push(`-- ${names.length - previewNames.length} more tables omitted from preview.`)
        }
        out.push('')
        out.push('SET NAMES utf8mb4;')
        out.push('SET FOREIGN_KEY_CHECKS = 0;')
        out.push('')

        for (const n of previewNames) {
          try {
            const ddl = await api.meta.tableDDL(connectionId, database, n)
            const ddlSql = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
            out.push('-- ----------------------------')
            out.push(`-- Table structure for \`${n}\``)
            out.push('-- ----------------------------')
            out.push(`DROP TABLE IF EXISTS \`${n}\`;`)
            out.push(`${ddlSql};`)
            out.push('')
            out.push('-- ----------------------------')
            out.push(`-- Records of \`${n}\``)
            out.push('-- ----------------------------')
            out.push('-- INSERT statements omitted in preview. Click "Download File" to export the full structure and data.')
            out.push('')
          } catch (e: any) { alert(e.message || '导出失败'); setPreviewLoading(false); return }
        }

        out.push('SET FOREIGN_KEY_CHECKS = 1;')
        setExportSql({ tableName: names.length > 1 ? database : names[0], sql: out.join('\n'), includeData: true, selectedNames: names })
        setPreviewLoading(false)
        break
      }
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setOperating(true)
    try {
      await api.query.execute(connectionId, `DROP TABLE \`${database}\`.\`${deleteConfirm}\``)
      setExportSql(null)
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
    setPreviewLoading(true)
    setPreviewLoadingText(includeData ? '正在生成结构 + 数据摘要预览...' : '正在生成结构预览...')
    try {
      const ddl = await api.meta.tableDDL(connectionId, database, tableName)
      let sql = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
      if (includeData) {
        sql += `\n\n-- ----------------------------\n-- Records of \`${tableName}\`\n-- ----------------------------\n-- INSERT statements omitted in preview. Click \"Download File\" to export the full structure and data.`
      }
      setExportSql({ tableName, sql, includeData, selectedNames: [tableName] })
    } catch (e: any) { alert(e.message || '导出失败') }
    finally { setPreviewLoading(false) }
  }

  const handleDownloadSql = async () => {
    if (!exportSql) return
    if (exportSql.includeData && exportSql.selectedNames?.length && validExportTableNames.length === 0) {
      alert('所选导出表已失效，请重新选择后再导出')
      setExportSql(null)
      return
    }

    const filePath = await api.dialog.saveFile({
      defaultPath: `${exportSql.tableName}.sql`,
      filters: [{ name: 'SQL Files', extensions: ['sql'] }],
    })
    if (!filePath) return

    try {
      if (exportSql.includeData && validExportTableNames.length > 0) {
        setExportSql(null)
        setExporting(true)
        setExportModalOpen(true)
        exportSessionActiveRef.current = true
        exportCancelledRef.current = false
        const firstTable = validExportTableNames[0] || exportSql.tableName
        const singleTable = validExportTableNames.length === 1 ? firstTable : null
        const totalRows = singleTable
          ? Number((await api.query.execute(connectionId, `SELECT COUNT(*) AS total FROM \`${database}\`.\`${singleTable}\``, database)).rows?.[0]?.total ?? 0)
          : undefined
        setExportProgress({ current: firstTable, done: 0, total: validExportTableNames.length || 1, rows: 0, totalRows })
        await api.importExport.exportData(connectionId, database, '', filePath, 'sql', {
          tables: validExportTableNames,
          includeData: true,
          createTable: true,
          dropTable: true,
          insertStyle: 'single',
        })
        if (exportCancelledRef.current) {
          setExportProgress(prev => prev ? { ...prev, cancelled: true } : null)
        } else {
          setExportProgress(prev => prev ? { ...prev, done: prev.total, finished: true } : null)
        }
        exportSessionActiveRef.current = false
      } else {
        await api.dialog.writeFile(filePath, exportSql.sql)
        setExportSql(null)
      }
    } catch (e: any) {
      exportSessionActiveRef.current = false
      alert(e.message || '导出失败')
      setExportProgress(null)
      setExporting(false)
      setExportModalOpen(false)
    }
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

  const validSelectedTableNames = useMemo(() => {
    const mergedTableNameSet = new Set(mergedTables.map(t => t.name))
    return [...selectedTables].filter(name => mergedTableNameSet.has(name))
  }, [mergedTables, selectedTables])

  const validExportTableNames = useMemo(() => {
    if (!exportSql?.selectedNames?.length) return []
    const mergedTableNameSet = new Set(mergedTables.map(t => t.name))
    return exportSql.selectedNames.filter(name => mergedTableNameSet.has(name))
  }, [exportSql, mergedTables])

  useEffect(() => {
    const mergedTableNameSet = new Set(mergedTables.map(t => t.name))
    setSelectedTables(prev => {
      const next = new Set([...prev].filter(name => mergedTableNameSet.has(name)))
      return next.size === prev.size ? prev : next
    })

    if (lastClickedRef.current && !mergedTableNameSet.has(lastClickedRef.current)) {
      lastClickedRef.current = null
    }

    setExportSql(prev => {
      if (!prev?.selectedNames?.length) return prev
      const nextSelectedNames = prev.selectedNames.filter(name => mergedTableNameSet.has(name))
      if (nextSelectedNames.length === prev.selectedNames.length) return prev
      if (nextSelectedNames.length === 0) return null
      const nextTableName = nextSelectedNames.length > 1 ? database : nextSelectedNames[0]
      return {
        ...prev,
        selectedNames: nextSelectedNames,
        tableName: nextTableName,
      }
    })
  }, [database, mergedTables])

  // Ctrl/Cmd + A：对象页全选所有表
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      const root = rootRef.current
      // 仅在对象页可见时生效（标签隐藏时 offsetParent 为 null）
      if (!root || root.offsetParent === null) return
      e.preventDefault()
      const all = mergedTables.map(t => t.name)
      setSelectedTables(new Set(all))
      if (all.length) lastClickedRef.current = all[all.length - 1]
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mergedTables])

  const formatSize = (bytes: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const importPercent = importProgress.total > 0
    ? Math.min(100, Math.max(0, Math.round(importProgress.current / importProgress.total * 100)))
    : 0
  const showEmptyState = !loading && mergedTables.length === 0
  const parsedStatementTotal = importProgress.originalStatementTotal ?? 0
  const executableStatementTotal = importProgress.executableStatementTotal ?? importProgress.total
  const showsStatementSummary = importProgress.stage === 'executing' || parsedStatementTotal > 0 || executableStatementTotal > 0
  const importStatusText = importProgress.stage === 'parsing'
    ? '正在解析 SQL 语句并识别可执行语句...'
    : `正在执行 ${importProgress.current} / ${importProgress.total} 条可执行语句${importProgress.fail > 0 ? `（${importProgress.fail} 条失败）` : ''}`
  const importDetailText = importProgress.stage === 'parsing'
    ? '解析阶段按文件内容扫描，不代表最终会执行的语句数量。'
    : parsedStatementTotal > executableStatementTotal
      ? `本次共解析出 ${parsedStatementTotal} 条 SQL 片段，其中 ${executableStatementTotal} 条为实际执行语句。`
      : `本次共解析并执行 ${executableStatementTotal} 条 SQL 语句。`

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
    { key: 'updateTime', title: '最后变更时间', dataIndex: 'updateTime', width: 160, render: (v: any) => v ? (v instanceof Date ? v.toLocaleString() : String(v)) : '-' },
    { key: 'comment', title: '注释', dataIndex: 'comment', ellipsis: true, render: (v: any) => v || '-' },
  ]

  return (
    <div ref={rootRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, position: 'relative' }}
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
        {validSelectedTableNames.length > 0 && (
          <Button size="small" type="danger" onClick={() => setBatchDeleteConfirm(true)}>
            <DeleteOutlined /> 删除选中({validSelectedTableNames.length})
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
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', userSelect: 'none' }} onContextMenu={e => e.preventDefault()}>
        {showEmptyState ? (
          <div style={{
            height: '100%',
            minHeight: 320,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            textAlign: 'center',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-surface)',
          }}>
            <div style={{ margin: '0 auto 12px', width: 64 }}>
              <svg width="64" height="48" viewBox="0 0 64 48" fill="none">
                <ellipse cx="32" cy="44" rx="32" ry="4" fill="currentColor" opacity="0.08"/>
                <rect x="12" y="8" width="40" height="30" rx="4" stroke="currentColor" opacity="0.15" strokeWidth="1.5" fill="none"/>
                <line x1="12" y1="16" x2="52" y2="16" stroke="currentColor" opacity="0.1" strokeWidth="1.5"/>
                <rect x="18" y="21" width="12" height="2" rx="1" fill="currentColor" opacity="0.12"/>
                <rect x="18" y="27" width="20" height="2" rx="1" fill="currentColor" opacity="0.08"/>
                <rect x="18" y="33" width="8" height="2" rx="1" fill="currentColor" opacity="0.06"/>
              </svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>暂无数据</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>当前没有可显示的记录</div>
          </div>
        ) : viewMode === 'table' ? (
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
          <Button variant="primary" onClick={handleBatchDelete} disabled={operating || validSelectedTableNames.length === 0} style={{ background: 'var(--error)' }}>{operating ? '删除中...' : `确认删除 ${validSelectedTableNames.length} 个表`}</Button>
        </>
      }>
        <p>确定要删除以下 <strong style={{ color: 'var(--error)' }}>{validSelectedTableNames.length}</strong> 个表吗？</p>
        <div style={{ maxHeight: 200, overflow: 'auto', margin: '8px 0', fontSize: 13 }}>
          {validSelectedTableNames.map(n => <div key={n}>• {n}</div>)}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复！</p>
      </Modal>

      {/* 生成预览中 */}
      <Modal open={previewLoading} title="正在生成预览..." width={420} onClose={() => {}} footer={null}>
        <div style={{ padding: '12px 0', color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 8 }}>{previewLoadingText}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>将先展示摘要预览；完整结构 + 数据需点击「下载文件」后导出。</div>
        </div>
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
            <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              {exportSql.includeData
                ? `${exportSql.sql.length.toLocaleString()} 字符（结构 + 数据摘要预览）`
                : `${exportSql.sql.length.toLocaleString()} 字符（仅结构）`}
            </div>
            <textarea
              readOnly
              value={exportSql.sql}
              style={{ width: '100%', height: 300, background: 'var(--bg-overlay)', color: 'var(--text-primary)', padding: 12, borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, fontFamily: 'Consolas, Monaco, monospace', resize: 'vertical' }}
            />
            {exportSql.includeData && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                💡 点击「下载文件」将导出完整的结构+数据
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 导出进度 */}
      <Modal
        open={exportModalOpen}
        title={exportProgress?.finished ? '导出完成' : exportProgress?.cancelled ? '导出已取消' : '正在导出...'}
        width={400}
        onClose={() => {}}
        footer={
          exportProgress?.finished ? (
            <Button variant="primary" onClick={() => { exportSessionActiveRef.current = false; setExportModalOpen(false); setExportProgress(null); setExporting(false); setExportSql(null) }}>完成</Button>
          ) : exportProgress?.cancelled ? (
            <Button variant="default" onClick={() => { exportSessionActiveRef.current = false; setExportModalOpen(false); setExportProgress(null); setExporting(false); setExportSql(null) }}>关闭</Button>
          ) : (
            <Button variant="danger" onClick={() => { exportCancelledRef.current = true; exportSessionActiveRef.current = false; setExportProgress(prev => prev ? { ...prev, cancelled: true } : prev); setExporting(false); setExportSql(null) }}>取消</Button>
          )
        }
      >
        {exportProgress && (
          <div style={{ padding: '8px 0' }}>
            {exportProgress.finished ? (
              <div style={{ color: 'var(--color-green, #22c55e)' }}>✓ 所有数据已成功导出到文件</div>
            ) : exportProgress.cancelled ? (
              <div style={{ color: 'var(--color-red, #ef4444)' }}>导出已中断，目标文件中可能已包含部分导出数据</div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  正在导出表：<strong>{exportProgress.current}</strong>
                </div>
                {exportProgress.total > 1 ? (
                  <div style={{ marginBottom: 8 }}>
                    表进度：{exportProgress.done}/{exportProgress.total}
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 4 }}>
                      <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, width: `${(exportProgress.done / exportProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                ) : typeof exportProgress.totalRows === 'number' && exportProgress.totalRows >= 0 ? (
                  <div style={{ marginBottom: 8 }}>
                    导出进度：{exportProgress.totalRows === 0 ? 100 : Math.min(100, Math.round((exportProgress.rows / exportProgress.totalRows) * 100))}%
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 4 }}>
                      <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, width: `${exportProgress.totalRows === 0 ? 100 : Math.min(100, Math.round((exportProgress.rows / exportProgress.totalRows) * 100))}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                ) : null}
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {exportProgress.total > 1
                    ? `当前表已导出 ${exportProgress.rows.toLocaleString()} 行数据，正在写入 SQL 文件...`
                    : `已导出 ${exportProgress.rows.toLocaleString()} 行数据...`}
                </div>
              </>
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
              {importStatusText}
            </div>
            {showsStatementSummary && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                {importDetailText}
              </div>
            )}
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${importPercent}%`,
                background: importProgress.fail > 0 ? 'var(--warning)' : 'var(--accent)',
                borderRadius: 3,
                transition: 'width 0.2s ease',
              }} />
            </div>
            {importProgress.total > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {importPercent}%
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
