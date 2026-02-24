import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Switch, Input, Tag } from '../../components/ui'
import { DeleteOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons'
import type { QueryHistoryItem } from '../../../../shared/types/query'
import { useConnectionStore } from '../../stores/connection.store'
import { useEditorStore } from '../../stores/editor.store'
import { api } from '../../utils/ipc'

const QueryHistory: React.FC = () => {
  const [history, setHistory] = useState<QueryHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selectedSql, setSelectedSql] = useState<string | null>(null)
  const [filters, setFilters] = useState({ slowOnly: false, failedOnly: false, search: '' })
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const addTab = useEditorStore((s) => s.addTab)

  const loadHistory = useCallback(async () => {
    if (!activeConnectionId) return
    setLoading(true)
    try {
      const data = await api.store.getHistory(activeConnectionId)
      setHistory(Array.isArray(data) ? data : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [activeConnectionId])

  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(loadHistory, 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, loadHistory])

  const filtered = history.filter((h) => {
    if (filters.slowOnly && !h.isSlow) return false
    if (filters.failedOnly && h.isSuccess) return false
    if (filters.search && !h.sqlText.toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  })

  const openInEditor = (sql: string) => {
    addTab(activeConnectionId ?? undefined)
    const tabs = useEditorStore.getState().tabs
    const last = tabs[tabs.length - 1]
    if (last) useEditorStore.getState().updateContent(last.id, sql)
    setSelectedSql(null)
  }

  const columns = [
    { key: 'sqlText', title: 'SQL', dataIndex: 'sqlText', ellipsis: true, render: (v: string) => <a onClick={() => setSelectedSql(v)} style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.length > 100 ? v.slice(0, 100) + '...' : v}</a> },
    { key: 'databaseName', title: '数据库', dataIndex: 'databaseName', width: 120 },
    { key: 'executionTimeMs', title: '耗时', dataIndex: 'executionTimeMs', width: 100, render: (v: number) => <Tag type={v > 5000 ? 'error' : v > 1000 ? 'warning' : 'default'}>{v}ms</Tag> },
    { key: 'rowCount', title: '行数', dataIndex: 'rowCount', width: 80 },
    { key: 'isSuccess', title: '状态', dataIndex: 'isSuccess', width: 80, render: (v: boolean) => <Tag type={v ? 'success' : 'error'}>{v ? '成功' : '失败'}</Tag> },
    { key: 'createdAt', title: '时间', dataIndex: 'createdAt', width: 170 },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space>
        <Input placeholder="搜索 SQL..." value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} style={{ width: 240 }} />
        <Switch checked={filters.slowOnly} onChange={(v) => setFilters((f) => ({ ...f, slowOnly: v }))} /> <span>慢查询</span>
        <Switch checked={filters.failedOnly} onChange={(v) => setFilters((f) => ({ ...f, failedOnly: v }))} /> <span>仅失败</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} /> <span>自动刷新</span>
        <Button onClick={loadHistory}><ReloadOutlined /> 刷新</Button>
      </Space>

      <Table dataSource={filtered} columns={columns} rowKey="id" loading={loading} size="small" />

      <Modal title="SQL 详情" open={!!selectedSql} onClose={() => setSelectedSql(null)} width={700}
        footer={<Space><Button onClick={() => { navigator.clipboard.writeText(selectedSql ?? '') }}><CopyOutlined /> 复制</Button><Button type="primary" onClick={() => selectedSql && openInEditor(selectedSql)}>在编辑器中打开</Button></Space>}>
        <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 13 }}>{selectedSql}</pre>
      </Modal>
    </div>
  )
}

export default QueryHistory
