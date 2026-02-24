import React, { useState } from 'react'
import { Button, Table, Tag, Alert, Card, Space } from '../../components/ui'
import { BulbOutlined, CheckOutlined } from '@ant-design/icons'
import type { ExplainResult } from '../../../../shared/types/query'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const ACCESS_TYPE_COLORS: Record<string, string> = {
  ALL: 'error', index: 'warning', range: 'warning', ref: 'success', eq_ref: 'primary', const: 'primary', system: 'primary',
}

interface IndexSuggestion { table: string; columns: string[]; reason: string; sql: string }

const IndexAdvisor: React.FC = () => {
  const [sql, setSql] = useState('')
  const [explainResults, setExplainResults] = useState<ExplainResult[]>([])
  const [suggestions, setSuggestions] = useState<IndexSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const analyze = async () => {
    if (!connId || !sql.trim() || !db) return
    setLoading(true); setError(null); setSuggestions([])
    try {
      const res = await api.query.explain(connId, sql, db)
      const rows: ExplainResult[] = Array.isArray(res) ? res : [res]
      setExplainResults(rows)
      const suggs: IndexSuggestion[] = []
      const sqlLower = sql.toLowerCase()
      for (const r of rows) {
        if (!r.table) continue
        if (r.type === 'ALL' && !r.key) {
          const whereCols = extractColumnsAfter(sqlLower, 'where', r.table)
          if (whereCols.length > 0) suggs.push({ table: r.table, columns: whereCols, reason: 'WHERE 子句列缺少索引（全表扫描）', sql: `CREATE INDEX idx_${r.table}_${whereCols.join('_')} ON \`${r.table}\` (${whereCols.map(c => `\`${c}\``).join(', ')});` })
        }
        if (r.type === 'ALL' && r.ref === null) {
          const joinCols = extractColumnsAfter(sqlLower, 'join', r.table)
          if (joinCols.length > 0) suggs.push({ table: r.table, columns: joinCols, reason: 'JOIN 列缺少索引', sql: `CREATE INDEX idx_${r.table}_${joinCols.join('_')} ON \`${r.table}\` (${joinCols.map(c => `\`${c}\``).join(', ')});` })
        }
      }
      for (const keyword of ['order by', 'group by']) {
        const cols = extractColumnsAfterKeyword(sqlLower, keyword)
        if (cols.length > 0) {
          const table = rows[0]?.table
          if (table && rows.some(r => r.extra?.includes('Using filesort') || r.extra?.includes('Using temporary')))
            suggs.push({ table, columns: cols, reason: `${keyword.toUpperCase()} 列可能需要索引`, sql: `CREATE INDEX idx_${table}_${cols.join('_')} ON \`${table}\` (${cols.map(c => `\`${c}\``).join(', ')});` })
        }
      }
      setSuggestions(suggs)
    } catch (e: any) { setError(e.message || String(e)) } finally { setLoading(false) }
  }

  const applyIndex = async (s: IndexSuggestion) => {
    if (!connId || !db) return
    setApplying(s.sql)
    try { await api.query.execute(connId, s.sql, db); setSuggestions((prev) => prev.filter((x) => x.sql !== s.sql)) }
    catch (e: any) { setError(e.message || String(e)) } finally { setApplying(null) }
  }

  const explainColumns = [
    { key: 'id', title: 'id', dataIndex: 'id', width: 50 },
    { key: 'table', title: 'table', dataIndex: 'table', width: 120 },
    { key: 'type', title: 'type', dataIndex: 'type', width: 80, render: (v: string) => <Tag type={ACCESS_TYPE_COLORS[v] || 'default'}>{v}</Tag> },
    { key: 'key', title: 'key', dataIndex: 'key', width: 120 },
    { key: 'rows', title: 'rows', dataIndex: 'rows', width: 80 },
    { key: 'extra', title: 'Extra', dataIndex: 'extra', ellipsis: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea value={sql} onChange={(e) => setSql(e.target.value)} placeholder="粘贴慢查询 SQL..." className="ui-input" style={{ flex: 1, minHeight: 80, padding: 8, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} />
        <Button type="primary" onClick={analyze} disabled={loading}><BulbOutlined /> {loading ? '分析中...' : '分析'}</Button>
      </div>
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {explainResults.length > 0 && <Card title="EXPLAIN 结果" size="small"><Table dataSource={explainResults} columns={explainColumns} rowKey={(r) => `${r.id}-${r.table}`} size="small" /></Card>}
      {suggestions.length > 0 && (
        <Card title={<span><BulbOutlined /> 索引建议</span>} size="small">
          {suggestions.map((s, i) => (
            <div key={i} style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><Tag type="primary">{s.table}</Tag> {s.reason}<div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.sql}</div></div>
              <Button type="primary" size="small" onClick={() => applyIndex(s)} disabled={applying === s.sql}><CheckOutlined /> {applying === s.sql ? '应用中...' : '应用'}</Button>
            </div>
          ))}
        </Card>
      )}
      {explainResults.length > 0 && suggestions.length === 0 && <Alert type="success" message="未发现明显的索引优化建议" />}
    </div>
  )
}

function extractColumnsAfter(sql: string, keyword: string, table: string): string[] {
  const regex = new RegExp(`${table}\\.\\s*(\\w+)`, 'gi'); const cols: string[] = []; let m: RegExpExecArray | null
  while ((m = regex.exec(sql))) cols.push(m[1]); return [...new Set(cols)].slice(0, 3)
}

function extractColumnsAfterKeyword(sql: string, keyword: string): string[] {
  const idx = sql.indexOf(keyword); if (idx === -1) return []
  const after = sql.slice(idx + keyword.length, sql.indexOf(' limit', idx) > 0 ? sql.indexOf(' limit', idx) : undefined)
  const cols = after.match(/\b(\w+)\b/g)?.filter(c => !['asc', 'desc', 'and', 'or', 'by'].includes(c)) ?? []
  return [...new Set(cols)].slice(0, 3)
}

export default IndexAdvisor
