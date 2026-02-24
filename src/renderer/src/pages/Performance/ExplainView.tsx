import React, { useState } from 'react'
import { Button, Table, Tag, Alert, Card, Space } from '../../components/ui'
import { ThunderboltOutlined, WarningOutlined } from '@ant-design/icons'
import type { ExplainResult } from '../../../../shared/types/query'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const ACCESS_TYPE_COLORS: Record<string, string> = {
  ALL: 'error', index: 'warning', range: 'warning', ref: 'success',
  eq_ref: 'primary', const: 'primary', system: 'primary',
}

const ExplainView: React.FC = () => {
  const [sql, setSql] = useState('')
  const [results, setResults] = useState<ExplainResult[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const selectedDatabase = useAppStore((s) => s.selectedDatabase)

  const runExplain = async () => {
    if (!activeConnectionId || !sql.trim()) return
    setLoading(true)
    setError(null)
    setWarnings([])
    try {
      const res = await api.query.explain(activeConnectionId, sql, selectedDatabase ?? '')
      setResults(Array.isArray(res) ? res : [res])
      const w: string[] = []
      for (const r of Array.isArray(res) ? res : [res]) {
        if (r.type === 'ALL') w.push(`全表扫描: ${r.table} (${r.rows} 行)`)
        if (r.extra?.includes('Using filesort')) w.push(`文件排序: ${r.table}`)
        if (r.extra?.includes('Using temporary')) w.push(`临时表: ${r.table}`)
      }
      setWarnings(w)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { key: 'id', title: 'id', dataIndex: 'id', width: 60 },
    { key: 'selectType', title: 'select_type', dataIndex: 'selectType', width: 120 },
    { key: 'table', title: 'table', dataIndex: 'table', width: 120 },
    { key: 'type', title: 'type', dataIndex: 'type', width: 100, render: (v: string) => <Tag type={ACCESS_TYPE_COLORS[v] || 'default'}>{v}</Tag> },
    { key: 'possibleKeys', title: 'possible_keys', dataIndex: 'possibleKeys', width: 160, ellipsis: true },
    { key: 'key', title: 'key', dataIndex: 'key', width: 120 },
    { key: 'keyLen', title: 'key_len', dataIndex: 'keyLen', width: 80 },
    { key: 'ref', title: 'ref', dataIndex: 'ref', width: 120, ellipsis: true },
    { key: 'rows', title: 'rows', dataIndex: 'rows', width: 80 },
    { key: 'filtered', title: 'filtered', dataIndex: 'filtered', width: 80, render: (v: number) => v != null ? `${v}%` : '-' },
    { key: 'extra', title: 'Extra', dataIndex: 'extra', ellipsis: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="输入 SQL 查询语句..."
          className="ui-input"
          style={{ flex: 1, minHeight: 80, padding: 8, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
        />
        <Button type="primary" onClick={runExplain} disabled={loading}>
          <ThunderboltOutlined /> {loading ? '分析中...' : 'Explain'}
        </Button>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {warnings.length > 0 && (
        <Alert type="warning" message="性能警告" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>} />
      )}

      {results.length > 0 && (
        <>
          <Table dataSource={results} columns={columns} rowKey={(r) => `${r.id}-${r.table}`} size="small" scroll={{ x: 'max-content' }} />
          <Card title="查询计划树" size="small">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((r, i) => (
                <div key={i} style={{ marginLeft: i * 24, padding: 8, border: '1px solid var(--border)', borderRadius: 6, borderLeft: `3px solid ${r.type === 'ALL' ? 'var(--error)' : 'var(--accent)'}` }}>
                  <Space>
                    <Tag type={ACCESS_TYPE_COLORS[r.type] || 'default'}>{r.type}</Tag>
                    <strong>{r.table}</strong>
                    {r.key && <span>使用索引: {r.key}</span>}
                    <span>行数: {r.rows}</span>
                    {r.extra && <span style={{ color: 'var(--text-muted)' }}>{r.extra}</span>}
                  </Space>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export default ExplainView
