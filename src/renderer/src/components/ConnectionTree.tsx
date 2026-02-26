import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { Tree, Empty, Modal, Button, Select } from './ui'
import {
  DatabaseOutlined,
  TableOutlined,
  EyeOutlined,
  CodeOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  FolderOutlined,
  LoadingOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  PlusOutlined,
  FolderOpenOutlined,
  ClearOutlined,
  FormOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '../stores/connection.store'
import { useDatabaseStore } from '../stores/database.store'
import { useTabStore } from '../stores/tab.store'
import { useAppStore } from '../stores/app.store'
import { api } from '../utils/ipc'

interface TreeNode {
  key: string
  title: React.ReactNode
  icon?: React.ReactNode
  children?: TreeNode[]
  isLeaf?: boolean
}

interface Props {
  filterText?: string
}

export default function ConnectionTree({ filterText = '' }: Props) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connectionStatuses = useConnectionStore((s) => s.connectionStatuses)
  const { databases, tables, loadDatabases, loadTables, loadingDatabases } = useDatabaseStore()
  const { addDataTab, addDesignTab, addQueryTab, addObjectsTab, renameTable: renameTableInTabs, tabs: mainTabs, setActiveTab } = useTabStore()
  const setSelectedDatabase = useAppStore((s) => s.setSelectedDatabase)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ dbName: string } | null>(null)
  const [deleteTableConfirm, setDeleteTableConfirm] = useState<{ dbName: string; tableName: string } | null>(null)
  const [truncateConfirm, setTruncateConfirm] = useState<{ dbName: string; tableName: string } | null>(null)
  const [renameTable, setRenameTable] = useState<{ dbName: string; tableName: string; newName: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editDb, setEditDb] = useState<{ dbName: string; charset: string; collation: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportSql, setExportSql] = useState<{ dbName: string; tableName: string; includeData: boolean; sql: string; isDb?: boolean } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<{ current: string; done: number; total: number; rows: number; finished?: boolean; cancelled?: boolean } | null>(null)
  const exportCancelledRef = useRef(false)
  const [dbRemarks, setDbRemarks] = useState<Record<string, string>>({})
  const [remarkEdit, setRemarkEdit] = useState<{ dbName: string; value: string } | null>(null)

  // 加载数据库备注
  useEffect(() => {
    api.store.getSettings('db-remarks').then((v: any) => {
      if (v) try { setDbRemarks(JSON.parse(v)) } catch {}
    })
  }, [])

  const dbs = activeConnectionId ? databases[activeConnectionId] ?? [] : []
  const isLoading = activeConnectionId ? loadingDatabases[activeConnectionId] : false
  const connectionStatus = activeConnectionId ? connectionStatuses[activeConnectionId] : null
  const isConnected = connectionStatus?.connected
  const connectionError = connectionStatus?.error
  const filter = filterText.toLowerCase().trim()

  // 点击外部或滚动时关闭右键菜单
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

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return

    const menuEl = contextMenuRef.current
    const rect = menuEl.getBoundingClientRect()
    let nextX = contextMenu.x
    let nextY = contextMenu.y

    if (rect.right > window.innerWidth - 8) {
      nextX = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (rect.bottom > window.innerHeight - 8) {
      nextY = Math.max(8, window.innerHeight - rect.height - 8)
    }

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu({ ...contextMenu, x: nextX, y: nextY })
    }
  }, [contextMenu])

  // 当连接成功且没有数据库列表时，触发加载
  useEffect(() => {
    if (activeConnectionId && isConnected && dbs.length === 0 && !isLoading) {
      loadDatabases(activeConnectionId)
    }
  }, [activeConnectionId, isConnected])

  const treeData: TreeNode[] = useMemo(() => {
    return dbs.map((db) => {
      const dbKey = `db:${db.name}`
      const tbls = activeConnectionId ? tables[`${activeConnectionId}:${db.name}`] ?? [] : []
      const realTables = tbls.filter((t) => t.type === 'TABLE')
      const views = tbls.filter((t) => t.type === 'VIEW')
      const tablesLoaded = tbls.length > 0 || tables[`${activeConnectionId}:${db.name}`] !== undefined

      const filteredTables = filter ? realTables.filter((t) => t.name.toLowerCase().includes(filter)) : realTables
      const filteredViews = filter ? views.filter((v) => v.name.toLowerCase().includes(filter)) : views

      // 搜索时：匹配数据库名 或 匹配表名/视图名
      const dbNameMatch = filter && db.name.toLowerCase().includes(filter)
      if (filter && !dbNameMatch && filteredTables.length === 0 && filteredViews.length === 0) return null

      const children: TreeNode[] = []

      if (!filter || filteredTables.length > 0 || dbNameMatch) {
        const tableCount = filter && !dbNameMatch ? filteredTables.length : realTables.length
        children.push({
          key: `folder:${db.name}:tables`,
          title: tablesLoaded ? `表 (${tableCount})` : '表',
          icon: <FolderOutlined style={{ color: 'var(--text-muted)' }} />,
          children: (filter && !dbNameMatch ? filteredTables : realTables).map((t) => ({
            key: `table:${db.name}:${t.name}`,
            title: t.name,
            icon: <TableOutlined style={{ color: 'var(--color-cyan)' }} />,
            isLeaf: true,
          })),
        })
      }

      if (!filter || filteredViews.length > 0 || dbNameMatch) {
        const viewCount = filter && !dbNameMatch ? filteredViews.length : views.length
        children.push({
          key: `folder:${db.name}:views`,
          title: tablesLoaded ? `视图 (${viewCount})` : '视图',
          icon: <FolderOutlined style={{ color: 'var(--text-muted)' }} />,
          children: (filter && !dbNameMatch ? filteredViews : views).map((v) => ({
            key: `view:${db.name}:${v.name}`,
            title: v.name,
            icon: <EyeOutlined style={{ color: 'var(--color-purple)' }} />,
            isLeaf: true,
          })),
        })
      }

      if (!filter) {
        children.push(
          { key: `folder:${db.name}:procedures`, title: '存储过程', icon: <CodeOutlined style={{ color: 'var(--color-yellow)' }} />, children: [] },
          { key: `folder:${db.name}:functions`, title: '函数', icon: <CodeOutlined style={{ color: 'var(--color-peach)' }} />, children: [] },
          { key: `folder:${db.name}:triggers`, title: '触发器', icon: <ThunderboltOutlined style={{ color: 'var(--color-red)' }} />, children: [] },
          { key: `folder:${db.name}:events`, title: '事件', icon: <ClockCircleOutlined style={{ color: 'var(--text-muted)' }} />, children: [] },
        )
      }

      const remarkKey = `${activeConnectionId}:${db.name}`
      const remark = dbRemarks[remarkKey]
      const titleNode = remark
        ? <span>{db.name} <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>({remark})</span></span>
        : db.name
      return { key: dbKey, title: titleNode, icon: <DatabaseOutlined style={{ color: 'var(--color-primary)' }} />, children }
    }).filter(Boolean) as TreeNode[]
  }, [dbs, tables, activeConnectionId, filter, dbRemarks])

  const handleExpand = async (keys: string[]) => {
    const newKey = keys.find((k) => !expandedKeys.includes(k))
    setExpandedKeys(keys)
    if (newKey?.startsWith('db:') && activeConnectionId) {
      const dbName = newKey.slice(3)
      setSelectedDatabase(dbName)
      await loadTables(activeConnectionId, dbName)
    }
  }

  const handleSelect = (_keys: string[], info: { node: TreeNode }) => {
    const key = info.node.key
    setSelectedKeys([key])
    let dbName = ''
    if (key.startsWith('db:')) {
      dbName = key.slice(3)
    } else if (key.startsWith('folder:')) {
      dbName = key.split(':')[1]
    } else if (key.startsWith('table:') || key.startsWith('view:')) {
      dbName = key.split(':')[1]
    }
    if (dbName) {
      setSelectedDatabase(dbName)
      // 如果已有对象 tab，切换到对应数据库
      if (activeConnectionId && mainTabs.some(t => t.type === 'objects')) {
        addObjectsTab(activeConnectionId, dbName)
      }
    }
  }

  const handleDoubleClick = (node: TreeNode) => {
    const key = node.key
    if (key.startsWith('db:')) {
      const dbName = key.slice(3)
      setSelectedDatabase(dbName)
      if (activeConnectionId) addObjectsTab(activeConnectionId, dbName)
    } else if (key.startsWith('folder:')) {
      const dbName = key.split(':')[1]
      setSelectedDatabase(dbName)
      if (activeConnectionId) addObjectsTab(activeConnectionId, dbName)
    } else if (key.startsWith('table:') || key.startsWith('view:')) {
      const parts = key.split(':')
      setSelectedDatabase(parts[1])
      if (activeConnectionId) addDataTab(activeConnectionId, parts[1], parts[2])
    }
  }

  const handleContextMenu = (e: React.MouseEvent, node: { key: string }) => {
    e.preventDefault()
    setContextMenu({ key: node.key, x: e.clientX, y: e.clientY })
  }

  const handleMenuClick = async (action: string) => {
    if (!contextMenu || !activeConnectionId) return
    const nodeKey = contextMenu.key

    if (nodeKey.startsWith('db:')) {
      const dbName = nodeKey.slice(3)
      switch (action) {
        case 'newQuery':
          setSelectedDatabase(dbName)
          addQueryTab(activeConnectionId, dbName)
          break
        case 'createTable':
          addDesignTab(activeConnectionId, dbName, null)
          break
        case 'exportStructure':
          await exportDbSql(dbName, false)
          break
        case 'exportAll':
          await exportDbSql(dbName, true)
          break
        case 'refresh':
          await loadTables(activeConnectionId, dbName)
          break
        case 'edit':
          try {
            const result = await api.query.execute(activeConnectionId,
              `SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${dbName}'`
            )
            if (result.rows?.[0]) {
              setEditDb({
                dbName,
                charset: result.rows[0].DEFAULT_CHARACTER_SET_NAME || 'utf8mb4',
                collation: result.rows[0].DEFAULT_COLLATION_NAME || 'utf8mb4_general_ci'
              })
            }
          } catch (e) {
            setEditDb({ dbName, charset: 'utf8mb4', collation: 'utf8mb4_general_ci' })
          }
          break
        case 'editRemark': {
          const rk = `${activeConnectionId}:${dbName}`
          setRemarkEdit({ dbName, value: dbRemarks[rk] || '' })
          break
        }
        case 'drop':
          setDeleteConfirm({ dbName })
          break
      }
    } else if (nodeKey.startsWith('folder:') && nodeKey.includes(':tables')) {
      const dbName = nodeKey.split(':')[1]
      if (action === 'newQuery') {
        setSelectedDatabase(dbName)
        addQueryTab(activeConnectionId, dbName)
      } else if (action === 'createTable') {
        addDesignTab(activeConnectionId, dbName, null)
      } else if (action === 'exportStructure') {
        await exportDbSql(dbName, false)
      } else if (action === 'exportAll') {
        await exportDbSql(dbName, true)
      } else if (action === 'refresh') {
        await loadTables(activeConnectionId, dbName)
      }
    } else if (nodeKey.startsWith('table:')) {
      const [, dbName, tableName] = nodeKey.split(':')
      switch (action) {
        case 'open':
          addDataTab(activeConnectionId, dbName, tableName)
          break
        case 'newQuery':
          setSelectedDatabase(dbName)
          addQueryTab(activeConnectionId, dbName, `SELECT * FROM \`${tableName}\` WHERE ?;`)
          break
        case 'design':
          addDesignTab(activeConnectionId, dbName, tableName)
          break
        case 'drop':
          setDeleteTableConfirm({ dbName, tableName })
          break
        case 'truncate':
          setTruncateConfirm({ dbName, tableName })
          break
        case 'rename':
          setRenameTable({ dbName, tableName, newName: tableName })
          break
        case 'exportStructure':
          await exportTableSql(dbName, tableName, false)
          break
        case 'exportAll':
          await exportTableSql(dbName, tableName, true)
          break
      }
    } else if (action === 'refresh') {
      await loadDatabases(activeConnectionId)
    }
    setContextMenu(null)
  }

  const handleDeleteDb = async () => {
    if (!deleteConfirm || !activeConnectionId) return
    setDeleting(true)
    try {
      await api.query.execute(activeConnectionId, `DROP DATABASE \`${deleteConfirm.dbName}\``)
      await loadDatabases(activeConnectionId)
      setDeleteConfirm(null)
    } catch (e: any) {
      alert(e.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteTable = async () => {
    if (!deleteTableConfirm || !activeConnectionId) return
    setDeleting(true)
    try {
      await api.query.execute(activeConnectionId, `DROP TABLE \`${deleteTableConfirm.dbName}\`.\`${deleteTableConfirm.tableName}\``)
      await loadTables(activeConnectionId, deleteTableConfirm.dbName)
      setDeleteTableConfirm(null)
    } catch (e: any) {
      alert(e.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleTruncateTable = async () => {
    if (!truncateConfirm || !activeConnectionId) return
    setDeleting(true)
    try {
      await api.query.execute(activeConnectionId, `TRUNCATE TABLE \`${truncateConfirm.dbName}\`.\`${truncateConfirm.tableName}\``)
      setTruncateConfirm(null)
    } catch (e: any) {
      alert(e.message || '清空失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleRenameTable = async () => {
    if (!renameTable || !activeConnectionId) return
    setSaving(true)
    try {
      await api.query.execute(activeConnectionId, `RENAME TABLE \`${renameTable.dbName}\`.\`${renameTable.tableName}\` TO \`${renameTable.dbName}\`.\`${renameTable.newName}\``)
      await loadTables(activeConnectionId, renameTable.dbName)
      // 更新已打开的标签页
      renameTableInTabs(activeConnectionId, renameTable.dbName, renameTable.tableName, renameTable.newName)
      setRenameTable(null)
    } catch (e: any) {
      alert(e.message || '重命名失败')
    } finally {
      setSaving(false)
    }
  }

  const exportTableSql = async (dbName: string, tableName: string, includeData: boolean) => {
    if (!activeConnectionId) return
    if (includeData) {
      const filePath = await api.dialog.saveFile({ defaultPath: `${tableName}.sql`, filters: [{ name: 'SQL Files', extensions: ['sql'] }] })
      if (!filePath) return
      setExporting(true)
      exportCancelledRef.current = false
      try {
        setExportProgress({ current: tableName, done: 0, total: 1, rows: 0 })
        const sql = await fullExportTable(dbName, tableName, (n) => setExportProgress({ current: tableName, done: 0, total: 1, rows: n }))
        if (exportCancelledRef.current) {
          setExportProgress(prev => prev ? { ...prev, cancelled: true } : null)
        } else {
          await api.dialog.writeFile(filePath, sql)
          setExportProgress(prev => prev ? { ...prev, finished: true } : null)
        }
      } catch (e: any) {
        alert(e.message || '导出失败')
        setExportProgress(null); setExporting(false)
      }
      return
    }
    try {
      const ddl = await api.meta.tableDDL(activeConnectionId, dbName, tableName)
      let sql = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
      if (!sql.trimEnd().endsWith(';')) sql += ';'
      setExportSql({ dbName, tableName, includeData, sql })
    } catch (e: any) {
      alert(e.message || '导出失败')
    }
  }

  const exportDbSql = async (dbName: string, includeData: boolean) => {
    if (!activeConnectionId) return
    if (includeData) {
      const filePath = await api.dialog.saveFile({ defaultPath: `${dbName}.sql`, filters: [{ name: 'SQL Files', extensions: ['sql'] }] })
      if (!filePath) return
      setExporting(true)
      exportCancelledRef.current = false
      try {
        await loadTables(activeConnectionId, dbName)
        const tbls = useDatabaseStore.getState().tables[`${activeConnectionId}:${dbName}`] || []
        const parts: string[] = []
        let baseRows = 0
        for (let i = 0; i < tbls.length; i++) {
          if (exportCancelledRef.current) break
          setExportProgress({ current: tbls[i].name, done: i, total: tbls.length, rows: baseRows })
          const b = baseRows
          let lastN = 0
          parts.push(await fullExportTable(dbName, tbls[i].name, (n) => {
            lastN = n
            setExportProgress({ current: tbls[i].name, done: i, total: tbls.length, rows: b + n })
          }))
          baseRows = b + lastN
        }
        if (exportCancelledRef.current) {
          setExportProgress(prev => prev ? { ...prev, cancelled: true } : null)
        } else {
          await api.dialog.writeFile(filePath, parts.join('\n\n-- ----------------------------\n\n'))
          setExportProgress(prev => prev ? { ...prev, finished: true } : null)
        }
      } catch (e: any) {
        alert(e.message || '导出失败')
        setExportProgress(null); setExporting(false)
      }
      return
    }
    try {
      await loadTables(activeConnectionId, dbName)
      const tbls = useDatabaseStore.getState().tables[`${activeConnectionId}:${dbName}`] || []
      const parts: string[] = []
      for (const t of tbls) {
        const ddl = await api.meta.tableDDL(activeConnectionId, dbName, t.name)
        let d = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
        if (!d.trimEnd().endsWith(';')) d += ';'
        parts.push(d)
      }
      const sql = parts.join('\n\n-- ----------------------------\n\n')
      setExportSql({ dbName, tableName: dbName, includeData, sql, isDb: true })
    } catch (e: any) {
      alert(e.message || '导出失败')
    }
  }

  // 分批导出单表全量数据
  const fullExportTable = async (dbName: string, tableName: string, onRows?: (n: number) => void): Promise<string> => {
    const ddl = await api.meta.tableDDL(activeConnectionId!, dbName, tableName)
    let raw = (typeof ddl === 'string' ? ddl : (ddl as any)?.ddl) || ''
    let sql = raw.trimEnd().endsWith(';') ? raw : raw + ';'
    const batchSize = 1000
    let offset = 0
    let totalRows = 0
    while (true) {
      if (exportCancelledRef.current) break
      const res = await api.query.execute(activeConnectionId!, `SELECT * FROM \`${dbName}\`.\`${tableName}\` LIMIT ${batchSize} OFFSET ${offset}`, dbName)
      if (!res.rows?.length) break
      totalRows += res.rows.length
      onRows?.(totalRows)
      const cols = res.fields?.map((f: any) => f.name) || Object.keys(res.rows[0])
      const values = res.rows.map((row: any) =>
        '(' + cols.map((c: string) => {
          const v = row[c]
          if (v === null) return 'NULL'
          if (typeof v === 'number') return v
          return `'${String(v).replace(/'/g, "''")}'`
        }).join(', ') + ')'
      ).join(',\n')
      sql += `\n\nINSERT INTO \`${tableName}\` (\`${cols.join('`, `')}\`) VALUES\n${values};`
      if (res.rows.length < batchSize) break
      offset += batchSize
    }
    return sql
  }

  const handleDownloadSql = async () => {
    if (!exportSql || !activeConnectionId) return
    const { dbName, tableName, includeData, isDb } = exportSql

    // 先弹文件选择框
    const filePath = await api.dialog.saveFile({
      defaultPath: `${tableName}.sql`,
      filters: [{ name: 'SQL Files', extensions: ['sql'] }],
    })
    if (!filePath) return

    setExportSql(null)

    if (!includeData) {
      // 仅结构，直接写文件
      await api.dialog.writeFile(filePath, exportSql.sql)
      return
    }

    // 含数据，分批导出
    setExporting(true)
    exportCancelledRef.current = false
    try {
      let fullSql: string
      if (isDb) {
        const tbls = useDatabaseStore.getState().tables[`${activeConnectionId}:${dbName}`] || []
        const parts: string[] = []
        for (let i = 0; i < tbls.length; i++) {
          if (exportCancelledRef.current) break
          setExportProgress({ current: tbls[i].name, done: i, total: tbls.length, rows: 0 })
          parts.push(await fullExportTable(dbName, tbls[i].name, (n) => {
            setExportProgress({ current: tbls[i].name, done: i, total: tbls.length, rows: n })
          }))
        }
        fullSql = parts.join('\n\n-- ----------------------------\n\n')
      } else {
        setExportProgress({ current: tableName, done: 0, total: 1, rows: 0 })
        fullSql = await fullExportTable(dbName, tableName, (n) => {
          setExportProgress({ current: tableName, done: 0, total: 1, rows: n })
        })
      }

      if (exportCancelledRef.current) {
        setExportProgress(prev => prev ? { ...prev, cancelled: true } : null)
      } else {
        await api.dialog.writeFile(filePath, fullSql)
        setExportProgress(prev => prev ? { ...prev, finished: true } : null)
      }
    } catch (e: any) {
      alert(e.message || '导出失败')
      setExportProgress(null)
      setExporting(false)
    }
  }

  const handleCopySql = async () => {
    if (!exportSql) return
    await navigator.clipboard.writeText(exportSql.sql)
    setExportSql(null)
    alert('已复制到剪贴板')
  }

  const CHARSETS = ['utf8mb4', 'utf8mb3', 'utf8', 'latin1', 'gbk', 'gb2312', 'gb18030', 'big5', 'ascii', 'binary']
  const COLLATIONS: Record<string, string[]> = {
    utf8mb4: ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_bin', 'utf8mb4_0900_ai_ci'],
    utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin'],
    utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
    latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
    gbk: ['gbk_chinese_ci', 'gbk_bin'],
    gb2312: ['gb2312_chinese_ci', 'gb2312_bin'],
    gb18030: ['gb18030_chinese_ci', 'gb18030_bin'],
    big5: ['big5_chinese_ci', 'big5_bin'],
    ascii: ['ascii_general_ci', 'ascii_bin'],
    binary: ['binary'],
  }

  const handleSaveRemark = async () => {
    if (!remarkEdit || !activeConnectionId) return
    const key = `${activeConnectionId}:${remarkEdit.dbName}`
    const next = { ...dbRemarks }
    if (remarkEdit.value.trim()) next[key] = remarkEdit.value.trim()
    else delete next[key]
    setDbRemarks(next)
    await api.store.saveSettings('db-remarks', JSON.stringify(next))
    setRemarkEdit(null)
  }

  const handleEditDb = async () => {
    if (!editDb || !activeConnectionId) return
    setSaving(true)
    try {
      await api.query.execute(activeConnectionId,
        `ALTER DATABASE \`${editDb.dbName}\` CHARACTER SET ${editDb.charset} COLLATE ${editDb.collation}`
      )
      setEditDb(null)
    } catch (e: any) {
      alert(e.message || '修改失败')
    } finally {
      setSaving(false)
    }
  }

  const getContextMenuItems = () => {
    if (!contextMenu) return []
    const nodeKey = contextMenu.key
    if (nodeKey.startsWith('db:')) {
      return [
        { key: 'newQuery', label: '新建查询', icon: <CodeOutlined /> },
        { key: 'createTable', label: '新建表', icon: <PlusOutlined /> },
        { type: 'divider' },
        { key: 'exportStructure', label: '转储SQL(仅结构)', icon: <ExportOutlined /> },
        { key: 'exportAll', label: '转储SQL(结构+数据)', icon: <ExportOutlined /> },
        { type: 'divider' },
        { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
        { key: 'editRemark', label: '编辑备注', icon: <FormOutlined /> },
        { key: 'edit', label: '编辑数据库', icon: <EditOutlined /> },
        { key: 'drop', label: '删除数据库', danger: true, icon: <DeleteOutlined /> },
      ]
    }
    if (nodeKey.startsWith('folder:') && nodeKey.includes(':tables')) {
      return [
        { key: 'newQuery', label: '新建查询', icon: <CodeOutlined /> },
        { key: 'createTable', label: '新建表', icon: <PlusOutlined /> },
        { type: 'divider' },
        { key: 'exportStructure', label: '转储SQL(仅结构)', icon: <ExportOutlined /> },
        { key: 'exportAll', label: '转储SQL(结构+数据)', icon: <ExportOutlined /> },
        { type: 'divider' },
        { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
      ]
    }
    if (nodeKey.startsWith('table:')) {
      return [
        { key: 'open', label: '打开表', icon: <FolderOpenOutlined /> },
        { key: 'newQuery', label: '新建查询', icon: <CodeOutlined /> },
        { key: 'design', label: '编辑表', icon: <EditOutlined /> },
        { key: 'rename', label: '重命名', icon: <FormOutlined /> },
        { key: 'truncate', label: '清空表', danger: true, icon: <ClearOutlined /> },
        { key: 'drop', label: '删除表', danger: true, icon: <DeleteOutlined /> },
        { type: 'divider' },
        { key: 'exportStructure', label: '转储SQL(仅结构)', icon: <ExportOutlined /> },
        { key: 'exportAll', label: '转储SQL(结构+数据)', icon: <ExportOutlined /> },
      ]
    }
    return [
      { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
    ]
  }

  if (!activeConnectionId) {
    return <Empty description="选择一个连接开始浏览数据库" icon={<DatabaseOutlined />} />
  }

  if (connectionError) {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <div style={{ color: 'var(--error)', marginBottom: 8 }}>连接失败</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, wordBreak: 'break-all' }}>{connectionError}</div>
      </div>
    )
  }

  if (!isConnected || isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 100, color: 'var(--text-muted)', gap: 12 }}>
        <div className="ui-spin-dot" />
        <span style={{ fontSize: 12, animation: 'pulse-text 1.5s ease-in-out infinite' }}>{isConnected ? '加载中...' : '连接中...'}</span>
      </div>
    )
  }

  if (dbs.length === 0) {
    return <Empty description="暂无数据库，请检查连接" icon={<DatabaseOutlined />} />
  }

  return (
    <>
      <div style={{ height: '100%', overflow: 'auto' }} onContextMenu={(e) => e.preventDefault()}>
        <Tree
          treeData={treeData}
          expandedKeys={expandedKeys}
          selectedKeys={selectedKeys}
          onExpand={handleExpand}
          onSelect={handleSelect}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          style={{ background: 'transparent' }}
        />
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={() => setContextMenu(null)}
          >
            {getContextMenuItems().map((item: any, idx) =>
              item.type === 'divider' ? (
                <div key={idx} style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              ) : (
                <div
                  key={item.key}
                  className={`context-menu-item ${item.danger ? 'danger' : ''}`}
                  onClick={() => handleMenuClick(item.key)}
                >
                  {item.icon} {item.label}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <Modal
        open={!!deleteConfirm}
        title="删除数据库"
        width={400}
        onClose={() => setDeleteConfirm(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setDeleteConfirm(null)}>取消</Button>
            <Button variant="primary" onClick={handleDeleteDb} disabled={deleting} style={{ background: 'var(--error)' }}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ marginBottom: 12 }}>确定要删除数据库 <strong style={{ color: 'var(--error)' }}>{deleteConfirm?.dbName}</strong> 吗？</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复，数据库中的所有数据将被永久删除！</p>
        </div>
      </Modal>

      <Modal
        open={!!editDb}
        title="编辑数据库"
        width={400}
        onClose={() => setEditDb(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setEditDb(null)}>取消</Button>
            <Button variant="primary" onClick={handleEditDb} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </>
        }
      >
        {editDb && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>数据库名称</label>
              <input
                value={editDb.dbName}
                disabled
                style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>字符集</label>
              <Select
                value={editDb.charset}
                onChange={(v) => {
                  const newCharset = v as string
                  const collations = COLLATIONS[newCharset] || []
                  setEditDb({ ...editDb, charset: newCharset, collation: collations[0] || '' })
                }}
                options={CHARSETS.map(c => ({ value: c, label: c }))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>排序规则</label>
              <Select
                value={editDb.collation}
                onChange={(v) => setEditDb({ ...editDb, collation: v as string })}
                options={(COLLATIONS[editDb.charset] || []).map(c => ({ value: c, label: c }))}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 编辑备注 */}
      <Modal
        open={!!remarkEdit}
        title={`编辑备注 - ${remarkEdit?.dbName}`}
        width={400}
        onClose={() => setRemarkEdit(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setRemarkEdit(null)}>取消</Button>
            <Button variant="primary" onClick={handleSaveRemark}>保存</Button>
          </>
        }
      >
        {remarkEdit && (
          <div style={{ padding: '8px 0' }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>备注（留空清除）</label>
            <input
              value={remarkEdit.value}
              onChange={(e) => setRemarkEdit({ ...remarkEdit, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveRemark() }}
              placeholder="输入备注，如：生产库、测试库..."
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>
        )}
      </Modal>

      {/* 删除表确认 */}
      <Modal
        open={!!deleteTableConfirm}
        title="删除表"
        width={400}
        onClose={() => setDeleteTableConfirm(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setDeleteTableConfirm(null)}>取消</Button>
            <Button variant="primary" onClick={handleDeleteTable} disabled={deleting} style={{ background: 'var(--error)' }}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ marginBottom: 12 }}>确定要删除表 <strong style={{ color: 'var(--error)' }}>{deleteTableConfirm?.tableName}</strong> 吗？</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复，表中的所有数据将被永久删除！</p>
        </div>
      </Modal>

      {/* 清空表确认 */}
      <Modal
        open={!!truncateConfirm}
        title="清空表"
        width={400}
        onClose={() => setTruncateConfirm(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setTruncateConfirm(null)}>取消</Button>
            <Button variant="primary" onClick={handleTruncateTable} disabled={deleting} style={{ background: 'var(--warning)' }}>
              {deleting ? '清空中...' : '确认清空'}
            </Button>
          </>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ marginBottom: 12 }}>确定要清空表 <strong style={{ color: 'var(--warning)' }}>{truncateConfirm?.tableName}</strong> 的所有数据吗？</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>⚠️ 此操作不可恢复，表结构将保留，但所有数据将被删除！</p>
        </div>
      </Modal>

      {/* 重命名表 */}
      <Modal
        open={!!renameTable}
        title="重命名表"
        width={400}
        onClose={() => setRenameTable(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setRenameTable(null)}>取消</Button>
            <Button variant="primary" onClick={handleRenameTable} disabled={saving || !renameTable?.newName || renameTable?.newName === renameTable?.tableName}>
              {saving ? '保存中...' : '确认'}
            </Button>
          </>
        }
      >
        {renameTable && (
          <div style={{ padding: '8px 0' }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>新表名</label>
            <input
              value={renameTable.newName}
              onChange={(e) => setRenameTable({ ...renameTable, newName: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              autoFocus
            />
          </div>
        )}
      </Modal>

      {/* 导出SQL */}
      <Modal
        open={!!exportSql}
        title={`导出 ${exportSql?.tableName}.sql`}
        width={600}
        onClose={() => setExportSql(null)}
        footer={
          <>
            <Button variant="default" onClick={() => setExportSql(null)}>取消</Button>
            {!exportSql?.includeData && <Button variant="default" onClick={handleCopySql}>复制到剪贴板</Button>}
            <Button variant="primary" loading={exporting} onClick={handleDownloadSql}>{exporting ? '导出中...' : '下载文件'}</Button>
          </>
        }
      >
        {exportSql && (
          <div>
            <div style={{ marginBottom: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              {exportSql.includeData ? '结构 + 数据（预览前1000行）' : '仅结构'} | {exportSql.sql.length.toLocaleString()} 字符 | {exportSql.sql.split('\n').length.toLocaleString()} 行
            </div>
            <textarea
              readOnly
              value={exportSql.sql}
              style={{
                width: '100%',
                height: 300,
                background: 'var(--bg-overlay)',
                color: 'var(--text-primary)',
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontSize: 12,
                fontFamily: 'Consolas, Monaco, monospace',
                resize: 'vertical',
              }}
            />
          </div>
        )}
      </Modal>

      {/* 导出进度 */}
      <Modal
        open={!!exportProgress}
        title={exportProgress?.finished ? '导出完成' : exportProgress?.cancelled ? '导出已取消' : '正在导出...'}
        width={400}
        onClose={() => {}}
        footer={
          exportProgress?.finished ? (
            <Button variant="primary" onClick={() => { setExportProgress(null); setExporting(false) }}>完成</Button>
          ) : exportProgress?.cancelled ? (
            <Button variant="default" onClick={() => { setExportProgress(null); setExporting(false) }}>关闭</Button>
          ) : (
            <Button variant="danger" onClick={() => { exportCancelledRef.current = true }}>取消</Button>
          )
        }
      >
        {exportProgress && (
          <div style={{ padding: '8px 0' }}>
            {exportProgress.finished ? (
              <div style={{ color: 'var(--color-green, #22c55e)' }}>✓ 所有数据已成功导出到文件</div>
            ) : exportProgress.cancelled ? (
              <div style={{ color: 'var(--color-red, #ef4444)' }}>导出已中断，已导出的数据未保存</div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  正在导出表：<strong>{exportProgress.current}</strong>
                </div>
                {exportProgress.total > 1 && (
                  <div style={{ marginBottom: 8 }}>
                    表进度：{exportProgress.done}/{exportProgress.total}
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 4 }}>
                      <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 3, width: `${(exportProgress.done / exportProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  已导出 {exportProgress.rows.toLocaleString()} 行数据...
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
