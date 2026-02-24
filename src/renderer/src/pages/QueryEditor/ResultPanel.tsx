import React, { useEffect, useState } from 'react'
import { Tabs, Table, Tag, Button, Space, Dropdown, Empty, Spin } from '../../components/ui'
import { DownloadOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useTabStore, QueryTab } from '../../stores/tab.store'
import { useConnectionStore } from '../../stores/connection.store'
import { api } from '../../utils/ipc'
import type { QueryHistoryItem } from '../../../../shared/types/query'

interface Props {
  tabId: string
}

// Explain 类型评级
const getTypeLevel = (type: string): { color: string; icon: React.ReactNode; label: string } => {
  const t = type?.toLowerCase() || ''
  if (t === 'system' || t === 'const' || t === 'eq_ref') return { color: 'var(--success)', icon: <CheckCircleOutlined />, label: '优秀' }
  if (t === 'ref' || t === 'range' || t === 'index_merge') return { color: 'var(--accent)', icon: <CheckCircleOutlined />, label: '良好' }
  if (t === 'index') return { color: 'var(--warning)', icon: <WarningOutlined />, label: '一般' }
  return { color: 'var(--error)', icon: <CloseCircleOutlined />, label: '较差' }
}

// Explain 卡片视图
const ExplainView: React.FC<{ rows: Record<string, unknown>[] }> = ({ rows }) => (
  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
    {rows.map((row, i) => {
      const typeInfo = getTypeLevel(row.type as string)
      return (
        <div key={i} style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          borderLeft: `4px solid ${typeInfo.color}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{
              background: 'var(--bg-hover)',
              padding: '2px 10px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
            }}>
              #{row.id}
            </span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{row.table || '(无表)'}</span>
            <span style={{
              color: typeInfo.color,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              fontSize: 12,
            }}>
              {typeInfo.icon} {typeInfo.label}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px 24px', fontSize: 13 }}>
            <div><span style={{ color: 'var(--text-muted)' }}>访问类型：</span><Tag type={typeInfo.color === 'var(--success)' ? 'success' : typeInfo.color === 'var(--error)' ? 'error' : 'warning'}>{row.type || '-'}</Tag></div>
            <div><span style={{ color: 'var(--text-muted)' }}>查询类型：</span>{row.select_type || '-'}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>使用索引：</span><span style={{ color: row.key ? 'var(--success)' : 'var(--error)' }}>{row.key || '无'}</span></div>
            <div><span style={{ color: 'var(--text-muted)' }}>可用索引：</span>{row.possible_keys || '-'}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>扫描行数：</span><span style={{ fontWeight: 600 }}>{row.rows?.toLocaleString() || '-'}</span></div>
            <div><span style={{ color: 'var(--text-muted)' }}>过滤比例：</span>{row.filtered ? `${row.filtered}%` : '-'}</div>
          </div>
          {row.Extra && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
              {String(row.Extra)}
            </div>
          )}
        </div>
      )
    })}
  </div>
)

export const ResultPanel: React.FC<Props> = ({ tabId }) => {
  const { tabs } = useTabStore()
  const { activeConnectionId } = useConnectionStore()
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [activeKey, setActiveKey] = useState('results')

  const tab = tabs.find((t) => t.id === tabId) as QueryTab | undefined
  const result = tab?.result
  const error = tab?.error
  const executing = tab?.isExecuting

  useEffect(() => {
    if (activeKey === 'history' && activeConnectionId) {
      api.store.getHistory(activeConnectionId).then(setHistory).catch(() => {})
    }
  }, [activeKey, activeConnectionId])

  const resultColumns = result?.columns.map((col) => ({
    key: col.name,
    title: <span>{col.name} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{col.type}</span></span>,
    dataIndex: col.name,
    width: 150,
    ellipsis: true,
    render: (v: unknown) => {
      if (v === null) return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>NULL</span>
      return String(v)
    },
  })) || []

  const handleExport = async (format: string) => {
    if (!result || !activeConnectionId) return
    try {
      await api.importExport.exportData(activeConnectionId, '', result.sql, '', format)
    } catch { /* ignore */ }
  }

  // 判断是否为 Explain 结果
  const isExplain = result?.sql?.toUpperCase().startsWith('EXPLAIN ')

  const tabItems = [
    {
      key: 'results',
      label: `结果${result ? ` (${result.rowCount})` : ''}`,
      children: executing ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="执行中..." /></div>
      ) : result ? (
        isExplain ? (
          <ExplainView rows={result.rows} />
        ) : (
          <div style={{ height: '100%', overflow: 'auto' }}>
            <Table
              columns={resultColumns}
              dataSource={result.rows.map((r, i) => ({ ...r, _key: i }))}
              rowKey="_key"
              size="small"
              scroll={{ x: 'max-content' }}
            />
            <Space style={{ padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{result.rowCount} 行 | {result.executionTime}ms</span>
              <Dropdown
                items={[
                  { key: 'csv', label: 'CSV' },
                  { key: 'json', label: 'JSON' },
                  { key: 'sql', label: 'SQL INSERT' },
                ]}
                onSelect={handleExport}
              >
                <Button size="small"><DownloadOutlined /> 导出</Button>
              </Dropdown>
            </Space>
          </div>
        )
      ) : (
        <Empty description="无结果" />
      ),
    },
    {
      key: 'messages',
      label: '消息',
      children: (
        <div style={{ padding: 12 }}>
          {error && <Tag type="error">{error}</Tag>}
          {result && !result.isSelect && <span>影响行数: {result.affectedRows} | 耗时: {result.executionTime}ms</span>}
          {result?.isSelect && <span>返回 {result.rowCount} 行 | 耗时: {result.executionTime}ms</span>}
          {!error && !result && <span style={{ color: 'var(--text-muted)' }}>暂无消息</span>}
        </div>
      ),
    },
    {
      key: 'history',
      label: '历史',
      children: (
        <Table
          columns={[
            { key: 'sqlText', title: 'SQL', dataIndex: 'sqlText', ellipsis: true, width: 300 },
            { key: 'isSuccess', title: '状态', dataIndex: 'isSuccess', width: 60, render: (v: boolean) => v ? <Tag type="success">OK</Tag> : <Tag type="error">ERR</Tag> },
            { key: 'executionTimeMs', title: '耗时', dataIndex: 'executionTimeMs', width: 80, render: (v: number) => `${v}ms` },
            { key: 'rowCount', title: '行数', dataIndex: 'rowCount', width: 60 },
            { key: 'createdAt', title: '时间', dataIndex: 'createdAt', width: 160 },
          ]}
          dataSource={history}
          rowKey="id"
          size="small"
        />
      ),
    },
  ]

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <Tabs items={tabItems} activeKey={activeKey} onChange={setActiveKey} style={{ height: '100%' }} />
    </div>
  )
}
