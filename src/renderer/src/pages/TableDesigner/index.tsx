import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Tabs, Button, Tooltip, toast } from '../../components/ui'
import { SaveOutlined, DiffOutlined, TableOutlined, CodeOutlined, CopyOutlined, DatabaseOutlined } from '@ant-design/icons'
import { ColumnEditor } from './ColumnEditor'
import { IndexEditor } from './IndexEditor'
import { ForeignKeyEditor } from './ForeignKeyEditor'
import { TableOptions } from './TableOptions'
import { StructureDiff } from './StructureDiff'
import { useTabStore, DesignTab } from '../../stores/tab.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'
import { ErrorNotice } from '../../components/ErrorNotice'
import { getErrorMessage } from '../../utils/error-info'
import type { TableDesign, ColumnDesign, IndexDesign, ForeignKeyDesign } from '../../../../shared/types/table-design'
import { columnDefaultToSql, parseColumnType } from '../../../../shared/column-type'

const emptyDesign: TableDesign = {
  name: '', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_general_ci',
  comment: '', columns: [], indexes: [], foreignKeys: [],
}

interface Props {
  tabId: string
}

const countChanges = (original: TableDesign, design: TableDesign): number => {
  const strip = ({ originalName: _o, ...rest }: ColumnDesign) => JSON.stringify(rest)
  const prevCols = new Map(original.columns.map((c) => [c.name, c]))
  const kept = new Set<string>()
  let n = 0
  for (const c of design.columns) {
    const prev = c.originalName ? prevCols.get(c.originalName) : undefined
    if (!prev) { n++; continue }
    kept.add(prev.name)
    if (strip(prev) !== strip(c)) n++
  }
  n += original.columns.filter((c) => !kept.has(c.name)).length
  const keyed = <T extends { name: string }>(a: T[], b: T[]) => {
    const prev = new Map(a.map((x) => [x.name, JSON.stringify(x)]))
    const next = new Map(b.map((x) => [x.name, JSON.stringify(x)]))
    let d = 0
    for (const [k, v] of next) if (prev.get(k) !== v) d++
    for (const k of prev.keys()) if (!next.has(k)) d++
    return d
  }
  n += keyed(original.indexes, design.indexes) + keyed(original.foreignKeys, design.foreignKeys)
  if (original.name !== design.name) n++
  for (const k of ['engine', 'charset', 'collation', 'comment'] as const) if (original[k] !== design[k]) n++
  const order = (d: TableDesign) => d.columns.map((c) => c.originalName ?? '').filter((x) => prevCols.has(x)).join(',')
  if (n === 0 && order(design) !== original.columns.map((c) => c.name).join(',')) n++
  return n
}

const TableDesigner: React.FC<Props> = ({ tabId }) => {
  const tabFromStore = useTabStore((s) => s.tabs.find((t) => t.id === tabId))
  const activeTabId = useTabStore((s) => s.activeTabId)
  const updateTabTitle = useTabStore((s) => s.updateTabTitle)
  const setDesignDirty = useTabStore((s) => s.setDesignDirty)
  const renameTable = useTabStore((s) => s.renameTable)
  const setDesignTable = useTabStore((s) => s.setDesignTable)
  const { loadTables, loadColumns } = useDatabaseStore()
  const tab = tabFromStore as DesignTab | undefined

  const connectionId = tab?.connectionId
  const database = tab?.database
  const tableName = tab?.table  // null = 新建表

  const isEdit = !!tableName
  const [design, setDesign] = useState<TableDesign>({ ...emptyDesign })
  const [original, setOriginal] = useState<TableDesign | null>(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [preview, setPreview] = useState<{ sql: string; error?: string }>({ sql: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [activePanel, setActivePanel] = useState('columns')

  const loadExisting = useCallback(async () => {
    if (!connectionId || !database || !tableName) return
    setLoading(true)
    setLoadError(null)
    try {
      const [cols, idxs, fks, statusList] = await Promise.all([
        api.meta.columns(connectionId, database, tableName),
        api.meta.indexes(connectionId, database, tableName),
        api.meta.foreignKeys(connectionId, database, tableName),
        api.meta.tableStatus(connectionId, database),
      ])
      const status = statusList.find((item) => item.name === tableName)

      const columns: ColumnDesign[] = cols.map((c) => {
        const parsed = parseColumnType(c.columnType)
        return {
          name: c.name, originalName: c.name, columnType: c.columnType, collation: c.collation || undefined,
          type: c.dataType.toUpperCase(), length: parsed.length, decimals: parsed.decimals,
          nullable: c.nullable, defaultValue: columnDefaultToSql(c.defaultValue, c.dataType, c.extra),
          autoIncrement: c.autoIncrement, primaryKey: c.primaryKey, unique: false, comment: c.comment,
          unsigned: parsed.unsigned, zerofill: parsed.zerofill,
          onUpdateCurrentTimestamp: /on update current_timestamp/i.test(c.extra),
        }
      })

      const indexes: IndexDesign[] = idxs.filter((i) => i.name !== 'PRIMARY').map((i) => ({
        name: i.name,
        type: i.type === 'FULLTEXT' ? 'FULLTEXT' : i.type === 'SPATIAL' ? 'SPATIAL' : i.unique ? 'UNIQUE' : 'INDEX',
        method: i.type === 'HASH' ? 'HASH' : 'BTREE',
        columns: i.columns.map((c) => ({ name: c.name, order: c.order, ...(c.subPart ? { length: Number(c.subPart) } : {}) })), comment: i.comment,
      }))

      const foreignKeys: ForeignKeyDesign[] = fks.map((f) => ({
        name: f.name, columns: f.columns, referencedTable: f.referencedTable,
        referencedColumns: f.referencedColumns,
        onUpdate: f.onUpdate as ForeignKeyDesign['onUpdate'],
        onDelete: f.onDelete as ForeignKeyDesign['onDelete'],
      }))

      const d: TableDesign = {
        name: tableName, engine: status?.engine || 'InnoDB', charset: (status?.collation || 'utf8mb4_general_ci').split('_')[0],
        collation: status?.collation || 'utf8mb4_general_ci', comment: status?.comment || '',
        columns, indexes, foreignKeys,
      }
      setDesign(d)
      setOriginal(JSON.parse(JSON.stringify(d)))
    } catch (e) {
      setLoadError(e)
    } finally {
      setLoading(false)
    }
  }, [connectionId, database, tableName])

  useEffect(() => {
    if (isEdit) {
      loadExisting()
    } else {
      setDesign({ ...emptyDesign })
      setOriginal(null)
      setLoading(false)
    }
  }, [isEdit, loadExisting])

  // SQL 预览由主进程生成，与实际执行的语句保持一致
  useEffect(() => {
    if (activePanel !== 'preview') return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const result = await api.design.preview(isEdit ? original : null, design).catch((e) => ({ sql: '', error: getErrorMessage(e, '生成 SQL 失败') }))
      if (!cancelled) setPreview(result)
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [activePanel, design, original, isEdit])

  const changeCount = useMemo(() => (original ? countChanges(original, design) : 0), [original, design])

  const handleDesignChange = (newDesign: TableDesign) => {
    setDesign(newDesign)
    setDesignDirty(tabId, true)
    if (!isEdit) updateTabTitle(tabId, newDesign.name ? `新建表: ${newDesign.name}` : '新建表')
  }

  const validateDesign = (): string | null => {
    if (!design.name.trim()) return '请输入表名'
    if (design.columns.length === 0) return '请至少添加一个字段'
    const seen = new Set<string>()
    for (let i = 0; i < design.columns.length; i++) {
      const col = design.columns[i]
      if (!col.name.trim()) return `第 ${i + 1} 个字段缺少名称`
      if (!col.type) return `字段 "${col.name}" 缺少类型`
      const key = col.name.trim().toLowerCase()
      if (seen.has(key)) return `字段名 "${col.name}" 重复`
      seen.add(key)
    }
    return null
  }

  const handleSave = useCallback(async () => {
    if (!connectionId || !database) { toast.warning('请先选择连接和数据库'); return }
    const validationError = validateDesign()
    if (validationError) { toast.warning(validationError); return }
    if (isEdit && changeCount === 0) { toast.info('没有需要保存的修改'); return }

    setIsSaving(true)
    setSaveError(null)
    try {
      if (isEdit && original) {
        const diff = await api.design.diff(original, design)
        await api.design.alterTable(connectionId, database, original.name, diff, design)
        if (original.name !== design.name) renameTable(connectionId, database, original.name, design.name)
      } else {
        await api.design.createTable(connectionId, database, design)
        setDesignTable(tabId, design.name)
      }
      const saved: TableDesign = {
        ...design,
        columns: design.columns.map((c) => ({ ...c, originalName: c.name })),
      }
      setDesign(saved)
      setOriginal(JSON.parse(JSON.stringify(saved)))
      setDesignDirty(tabId, false)
      toast.success(isEdit ? '表结构已保存' : `表 ${design.name} 已创建`)
      await loadTables(connectionId, database, true)
      await loadColumns(connectionId, database, design.name, true)
    } catch (e) {
      setSaveError(e)
    } finally {
      setIsSaving(false)
    }
  }, [connectionId, database, design, isEdit, original, tabId, changeCount, setDesignDirty])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && activeTabId === tabId) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, activeTabId, tabId])

  if (!tab) return null

  const statusChip = !isEdit
    ? <span className="td-chip td-chip-new">新建</span>
    : changeCount > 0
      ? <span className="td-chip td-chip-dirty">{changeCount} 处修改</span>
      : <span className="td-chip">已同步</span>

  const count = (n: number) => <span className="td-tab-count">{n}</span>

  return (
    <div className="td-page">
      <div className="td-header">
        <div className="td-header-icon"><TableOutlined /></div>
        <div className="td-header-main">
          <div className="td-title-row">
            <input
              className="td-title-input"
              value={design.name}
              placeholder="输入表名"
              spellCheck={false}
              autoFocus={!isEdit}
              disabled={loading}
              onChange={(e) => handleDesignChange({ ...design, name: e.target.value })}
            />
            {statusChip}
          </div>
          <div className="td-meta-row">
            <span className="td-meta-db"><DatabaseOutlined /> {database}</span>
            <span className="td-meta-dot" />
            <input
              className="td-comment-input"
              value={design.comment}
              placeholder="添加表注释…"
              disabled={loading}
              onChange={(e) => handleDesignChange({ ...design, comment: e.target.value })}
            />
            <span className="td-meta-dot" />
            <button type="button" className="td-meta-link" onClick={() => setActivePanel('options')}>
              {design.engine} · {design.collation}
            </button>
          </div>
        </div>
        <div className="td-header-actions">
          <Tooltip title="查看将要执行的 SQL" placement="bottom">
            <Button size="small" icon={<CodeOutlined />} onClick={() => setActivePanel('preview')}>预览 SQL</Button>
          </Tooltip>
          {isEdit && <Button size="small" icon={<DiffOutlined />} onClick={() => setDiffOpen(true)} disabled={isSaving || !original}>查看差异</Button>}
          <Tooltip title="Ctrl+S" placement="bottom">
            <Button size="small" type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={isSaving} disabled={isSaving || loading}>
              {isEdit ? '保存修改' : '创建表'}
            </Button>
          </Tooltip>
        </div>
      </div>

      {saveError != null && (
        <ErrorNotice className="td-error" error={saveError} fallbackTitle={isEdit ? '修改表失败' : '创建表失败'} onClose={() => setSaveError(null)} />
      )}

      <div className="td-content">
        {loading ? (
          <div className="td-skeleton">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="ui-table-skeleton-line" style={{ width: `${90 - i * 8}%` }} />)}
          </div>
        ) : loadError != null ? (
          <div className="td-load-error">
            <ErrorNotice error={loadError} fallbackTitle="加载表结构失败" onRetry={loadExisting} />
          </div>
        ) : (
          <Tabs
            className="td-tabs"
            activeKey={activePanel}
            onChange={setActivePanel}
            items={[
              {
                key: 'columns',
                label: <>字段{count(design.columns.length)}</>,
                children: <ColumnEditor columns={design.columns} original={original?.columns} onChange={(columns) => handleDesignChange({ ...design, columns })} />,
              },
              {
                key: 'indexes',
                label: <>索引{count(design.indexes.length)}</>,
                children: <IndexEditor indexes={design.indexes} columns={design.columns} onChange={(indexes) => handleDesignChange({ ...design, indexes })} />,
              },
              {
                key: 'fk',
                label: <>外键{count(design.foreignKeys.length)}</>,
                children: activePanel === 'fk' && connectionId && database
                  ? <ForeignKeyEditor connectionId={connectionId} database={database} tableName={design.name} foreignKeys={design.foreignKeys} columns={design.columns} onChange={(foreignKeys) => handleDesignChange({ ...design, foreignKeys })} />
                  : null,
              },
              {
                key: 'options',
                label: '选项',
                children: <TableOptions design={design} onChange={handleDesignChange} />,
              },
              {
                key: 'preview',
                label: isEdit ? 'SQL 预览' : 'DDL 预览',
                children: activePanel === 'preview' ? <SqlPreview isEdit={isEdit} preview={preview} /> : null,
              },
            ]}
          />
        )}
      </div>

      {original && <StructureDiff open={diffOpen} onClose={() => setDiffOpen(false)} original={original} current={design} />}
    </div>
  )
}

function SqlPreview({ isEdit, preview }: { isEdit: boolean; preview: { sql: string; error?: string } }) {
  const copy = async () => {
    await window.api.clipboard.writeText(preview.sql)
    toast.success('SQL 已复制')
  }
  const empty = !preview.error && !preview.sql.trim()
  return (
    <div className="td-preview">
      <div className="td-preview-head">
        <span>{isEdit ? '保存时将执行以下语句' : '创建表时将执行以下语句'}</span>
        <Button size="small" variant="text" icon={<CopyOutlined />} disabled={!preview.sql} onClick={copy}>复制</Button>
      </div>
      {preview.error ? (
        <div className="td-preview-msg">{preview.error}</div>
      ) : empty ? (
        <div className="td-preview-msg">{isEdit ? '暂无修改' : '填写表名和字段后这里会显示建表语句'}</div>
      ) : (
        <pre className="td-preview-code">{preview.sql}</pre>
      )}
    </div>
  )
}

export default TableDesigner
