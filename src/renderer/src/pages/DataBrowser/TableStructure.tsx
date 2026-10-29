import React, { useEffect, useState } from 'react'
import { Tabs, Table, Button, toast } from '../../components/ui'
import { CopyOutlined, ArrowRightOutlined, NodeIndexOutlined, LinkOutlined } from '@ant-design/icons'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'
import type { ColumnDetail, IndexInfo, ForeignKeyInfo } from '../../../../shared/types/metadata'
import { ErrorNotice } from '../../components/ErrorNotice'
import { getErrorMessage } from '../../utils/error-info'

interface Props {
  connectionId: string
  database: string
  table: string
}

const count = (n: number) => <span className="td-tab-count">{n}</span>

export const TableStructure: React.FC<Props> = ({ connectionId, database, table }) => {
  const { loadColumns, columns: columnCache } = useDatabaseStore()
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
    { key: 'pos', title: '#', width: 44, render: (_: unknown, r: ColumnDetail) => <span className="td-row-no">{r.ordinalPosition}</span> },
    {
      key: 'name', title: '字段名', dataIndex: 'name', width: 180,
      render: (v: string, r: ColumnDetail) => (
        <span className="ts-name">
          {r.primaryKey && <span className="td-pk">PK</span>}
          <span>{v}</span>
        </span>
      ),
    },
    { key: 'type', title: '类型', dataIndex: 'columnType', width: 170, render: (v: string) => <span className="ts-mono ts-type">{v}</span> },
    { key: 'nullable', title: '非空', dataIndex: 'nullable', width: 60, render: (v: boolean) => (v ? <span className="ts-muted">-</span> : <span className="ts-yes">✓</span>) },
    {
      key: 'default', title: '默认值', dataIndex: 'defaultValue', width: 160,
      render: (v: unknown, r: ColumnDetail) => (r.autoIncrement
        ? <span className="td-badge">自增</span>
        : v === null || v === undefined ? <span className="ts-muted">{r.nullable ? 'NULL' : '无'}</span> : <span className="ts-mono">{String(v)}</span>),
    },
    { key: 'extra', title: '附加', dataIndex: 'extra', width: 180, render: (v: string) => <span className="ts-muted ts-mono">{v.replace(/DEFAULT_GENERATED\s*/i, '').trim()}</span> },
    { key: 'comment', title: '注释', dataIndex: 'comment', ellipsis: true },
  ]

  const copyDdl = async () => {
    await window.api.clipboard.writeText(ddl)
    toast.success('DDL 已复制')
  }

  return (
    <div className="ts-page">
      {loadError && (
        <ErrorNotice
          error={loadError}
          fallbackTitle="加载表结构失败"
          onRetry={() => setReloadKey((k) => k + 1)}
          onClose={() => setLoadError(null)}
          className="db-notice"
        />
      )}
      <Tabs
        className="td-tabs"
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: 'columns',
            label: <>字段{count(cols.length)}</>,
            children: activeKey === 'columns' ? (
              <div className="ts-table"><Table size="small" dataSource={cols} columns={columnsCols} rowKey="name" /></div>
            ) : null,
          },
          {
            key: 'indexes',
            label: <>索引{count(indexes.length)}</>,
            children: activeKey === 'indexes' ? (
              <div className="td-card-list">
                {indexes.map((idx) => {
                  const kind = idx.name === 'PRIMARY' ? 'pk' : idx.type === 'FULLTEXT' ? 'fulltext' : idx.type === 'SPATIAL' ? 'spatial' : idx.unique ? 'unique' : 'index'
                  const label = { pk: '主键', fulltext: '全文', spatial: '空间', unique: '唯一', index: '普通' }[kind]
                  return (
                    <div key={idx.name} className="td-card td-card-static">
                      <div className="td-card-main">
                        <div className="td-card-title">
                          <span className={`td-badge td-badge-${kind}`}>{label}</span>
                          <span className="td-card-name">{idx.name}</span>
                          <span className="td-card-sub">{idx.type}</span>
                        </div>
                        <div className="td-chips">
                          {idx.columns.map((c, k) => (
                            <span key={c.name} className="td-col-chip"><em>{k + 1}</em>{c.name}{c.subPart ? `(${c.subPart})` : ''}{c.order === 'DESC' ? ' ↓' : ''}</span>
                          ))}
                        </div>
                        {idx.comment && <div className="td-card-desc">{idx.comment}</div>}
                      </div>
                    </div>
                  )
                })}
                {indexes.length === 0 && (
                  <div className="td-empty td-empty-sm">
                    <NodeIndexOutlined className="td-empty-icon" />
                    <div className="td-empty-title">没有索引</div>
                  </div>
                )}
              </div>
            ) : null,
          },
          {
            key: 'fk',
            label: <>外键{count(foreignKeys.length)}</>,
            children: activeKey === 'fk' ? (
              <div className="td-card-list">
                {foreignKeys.map((fk) => (
                  <div key={fk.name} className="td-card td-card-static">
                    <div className="td-card-main">
                      <div className="td-card-title">
                        <span className="td-badge td-badge-fk">外键</span>
                        <span className="td-card-name">{fk.name}</span>
                      </div>
                      <div className="td-fk-map">
                        <span className="td-chips">{fk.columns.map((c) => <span key={c} className="td-col-chip">{c}</span>)}</span>
                        <ArrowRightOutlined className="td-fk-arrow" />
                        <span className="td-fk-target">{fk.referencedTable}</span>
                        <span className="td-chips">{fk.referencedColumns.map((c) => <span key={c} className="td-col-chip">{c}</span>)}</span>
                      </div>
                      <div className="td-card-desc">ON UPDATE {fk.onUpdate} · ON DELETE {fk.onDelete}</div>
                    </div>
                  </div>
                ))}
                {foreignKeys.length === 0 && (
                  <div className="td-empty td-empty-sm">
                    <LinkOutlined className="td-empty-icon" />
                    <div className="td-empty-title">没有外键</div>
                  </div>
                )}
              </div>
            ) : null,
          },
          {
            key: 'ddl',
            label: 'DDL',
            children: activeKey === 'ddl' ? (
              <div className="td-preview">
                <div className="td-preview-head">
                  <span>CREATE TABLE 语句</span>
                  <Button size="small" variant="text" icon={<CopyOutlined />} disabled={!ddl} onClick={copyDdl}>复制</Button>
                </div>
                {ddl ? <pre className="td-preview-code">{ddl}</pre> : <div className="td-preview-msg">{loadError ? '加载失败' : '加载中…'}</div>}
              </div>
            ) : null,
          },
        ]}
      />
    </div>
  )
}
