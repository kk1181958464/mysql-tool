import React, { useEffect, useState } from 'react'
import { Tabs, Table, Button } from '../../components/ui'
import { EditOutlined } from '@ant-design/icons'
import { useDatabaseStore } from '../../stores/database.store'
import { useTabStore } from '../../stores/tab.store'
import { api } from '../../utils/ipc'
import type { ColumnDetail, IndexInfo, ForeignKeyInfo } from '../../../../shared/types/metadata'
import { ErrorNotice } from '../../components/ErrorNotice'
import { getErrorMessage } from '../../utils/error-info'

interface Props {
  connectionId: string
  database: string
  table: string
}

export const TableStructure: React.FC<Props> = ({ connectionId, database, table }) => {
  const { loadColumns, columns: columnCache } = useDatabaseStore()
  const { addDesignTab } = useTabStore()
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([])
  const [ddl, setDdl] = useState('')
  const [activeKey, setActiveKey] = useState('columns')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const cacheKey = `${connectionId}:${database}:${table}`
  const cols: ColumnDetail[] = columnCache[cacheKey] || []

  useEffect(() => {
    if (!connectionId || !database || !table) return
    let cancelled = false
    setLoadError(null)
    const fail = (e: unknown) => { if (!cancelled) setLoadError(getErrorMessage(e, '加载表结构失败')) }
    loadColumns(connectionId, database, table, reloadKey > 0).catch(fail)
    api.meta.indexes(connectionId, database, table).then((v) => { if (!cancelled) setIndexes(v) }).catch(fail)
    api.meta.foreignKeys(connectionId, database, table).then((v) => { if (!cancelled) setForeignKeys(v) }).catch(fail)
    api.meta.tableDDL(connectionId, database, table).then((v) => { if (!cancelled) setDdl(v) }).catch(fail)
    return () => { cancelled = true }
  }, [connectionId, database, table, reloadKey])

  const columnsCols = [
    { key: 'name', title: '名称', dataIndex: 'name', width: 140 },
    { key: 'type', title: '类型', dataIndex: 'columnType', width: 140 },
    { key: 'nullable', title: '可空', dataIndex: 'nullable', width: 60, render: (v: boolean) => v ? 'YES' : 'NO' },
    { key: 'default', title: '默认值', dataIndex: 'defaultValue', width: 100, render: (v: unknown) => v === null ? <span style={{ color: 'var(--text-muted)' }}>NULL</span> : String(v ?? '') },
    { key: 'key', title: '键', dataIndex: 'primaryKey', width: 60, render: (v: boolean, r: ColumnDetail) => v ? 'PRI' : r.autoIncrement ? 'AI' : '' },
    { key: 'extra', title: 'Extra', dataIndex: 'extra', width: 120 },
    { key: 'comment', title: '注释', dataIndex: 'comment', ellipsis: true },
  ]

  const indexCols = [
    { key: 'name', title: '名称', dataIndex: 'name', width: 160 },
    { key: 'columns', title: '列', dataIndex: 'columns', render: (v: IndexInfo['columns']) => v.map((c) => c.name).join(', ') },
    { key: 'unique', title: '唯一', dataIndex: 'unique', width: 60, render: (v: boolean) => v ? 'YES' : 'NO' },
    { key: 'type', title: '类型', dataIndex: 'type', width: 80 },
  ]

  const fkCols = [
    { key: 'name', title: '名称', dataIndex: 'name', width: 160 },
    { key: 'columns', title: '列', dataIndex: 'columns', render: (v: string[]) => v.join(', '), width: 120 },
    { key: 'refTable', title: '引用表', dataIndex: 'referencedTable', width: 140 },
    { key: 'refCols', title: '引用列', dataIndex: 'referencedColumns', render: (v: string[]) => v.join(', '), width: 120 },
    { key: 'onUpdate', title: 'ON UPDATE', dataIndex: 'onUpdate', width: 100 },
    { key: 'onDelete', title: 'ON DELETE', dataIndex: 'onDelete', width: 100 },
  ]

  const handleEditInDesigner = () => {
    addDesignTab(connectionId, database, table)
  }

  return (
    <div style={{ padding: '8px 12px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ marginBottom: 8 }}>
        <Button size="small" onClick={handleEditInDesigner}>
          <EditOutlined /> 在设计器中编辑
        </Button>
      </div>
      {loadError && (
        <ErrorNotice
          error={loadError}
          fallbackTitle="加载表结构失败"
          onRetry={() => setReloadKey((k) => k + 1)}
          onClose={() => setLoadError(null)}
          style={{ marginBottom: 8 }}
        />
      )}
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        items={[
          {
            key: 'columns',
            label: `列 (${cols.length})`,
            children: activeKey === 'columns' ? <Table size="small" dataSource={cols} columns={columnsCols} rowKey="name" /> : null,
          },
          {
            key: 'indexes',
            label: `索引 (${indexes.length})`,
            children: activeKey === 'indexes' ? <Table size="small" dataSource={indexes} columns={indexCols} rowKey="name" /> : null,
          },
          {
            key: 'fk',
            label: `外键 (${foreignKeys.length})`,
            children: activeKey === 'fk' ? <Table size="small" dataSource={foreignKeys} columns={fkCols} rowKey="name" /> : null,
          },
          {
            key: 'ddl',
            label: 'DDL',
            children: activeKey === 'ddl' ? (
              <pre style={{ background: 'var(--bg-overlay)', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', flex: 1, margin: 0 }}>
                {ddl || (loadError ? '加载失败' : '加载中...')}
              </pre>
            ) : null,
          },
        ]}
      />
    </div>
  )
}
