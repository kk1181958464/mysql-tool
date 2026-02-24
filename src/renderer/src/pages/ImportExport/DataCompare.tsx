import React, { useState } from 'react'
import { Card, Select, Button, Table, Tag, Space, Statistic, Row, Col, Alert, Empty } from '../../components/ui'
import { SwapOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface DiffRow {
  key: string
  status: 'only_a' | 'only_b' | 'different' | 'match'
  data_a?: Record<string, unknown>
  data_b?: Record<string, unknown>
  diffCols?: string[]
}

const DataCompare: React.FC = () => {
  const [sourceA, setSourceA] = useState({ db: '', table: '' })
  const [sourceB, setSourceB] = useState({ db: '', table: '' })
  const [diffs, setDiffs] = useState<DiffRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [summary, setSummary] = useState({ total: 0, matching: 0, different: 0, onlyA: 0, onlyB: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])
  const tablesA = useDatabaseStore((s) => connId && sourceA.db ? s.tables[`${connId}:${sourceA.db}`] ?? [] : [])
  const tablesB = useDatabaseStore((s) => connId && sourceB.db ? s.tables[`${connId}:${sourceB.db}`] ?? [] : [])

  const loadTablesFor = async (db: string, side: 'a' | 'b') => {
    if (side === 'a') setSourceA((s) => ({ ...s, db }))
    else setSourceB((s) => ({ ...s, db }))
    if (connId) await useDatabaseStore.getState().loadTables(connId, db)
  }

  const compare = async () => {
    if (!connId || !sourceA.db || !sourceA.table || !sourceB.db || !sourceB.table) return
    setLoading(true)
    setError(null)
    try {
      const [resA, resB] = await Promise.all([
        api.query.execute(connId, `SELECT * FROM \`${sourceA.table}\` LIMIT 5000`, sourceA.db),
        api.query.execute(connId, `SELECT * FROM \`${sourceB.table}\` LIMIT 5000`, sourceB.db),
      ])
      const rowsA: Record<string, unknown>[] = resA?.rows ?? []
      const rowsB: Record<string, unknown>[] = resB?.rows ?? []
      const colsA = resA?.columns?.map((c: any) => c.name) ?? Object.keys(rowsA[0] ?? {})
      const colsB = resB?.columns?.map((c: any) => c.name) ?? Object.keys(rowsB[0] ?? {})
      const allCols = [...new Set([...colsA, ...colsB])]
      setColumns(allCols)

      const keyFn = (r: Record<string, unknown>) => JSON.stringify(allCols.map((c) => r[c]))
      const mapA = new Map(rowsA.map((r, i) => [keyFn(r), { row: r, idx: i }]))
      const mapB = new Map(rowsB.map((r, i) => [keyFn(r), { row: r, idx: i }]))

      const result: DiffRow[] = []
      let matching = 0, different = 0, onlyA = 0, onlyB = 0

      const seenB = new Set<string>()
      for (const [key, { row, idx }] of mapA) {
        if (mapB.has(key)) {
          matching++
          seenB.add(key)
        } else {
          const firstCol = allCols[0]
          const matchInB = rowsB.find((rb) => rb[firstCol] === row[firstCol])
          if (matchInB) {
            const dc = allCols.filter((c) => row[c] !== matchInB[c])
            different++
            result.push({ key: `diff-${idx}`, status: 'different', data_a: row, data_b: matchInB, diffCols: dc })
            seenB.add(keyFn(matchInB))
          } else {
            onlyA++
            result.push({ key: `a-${idx}`, status: 'only_a', data_a: row })
          }
        }
      }
      for (const [key, { row, idx }] of mapB) {
        if (!seenB.has(key) && !mapA.has(key)) {
          onlyB++
          result.push({ key: `b-${idx}`, status: 'only_b', data_b: row })
        }
      }

      setDiffs(result)
      setSummary({ total: rowsA.length + rowsB.length, matching, different, onlyA, onlyB })
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const statusTags: Record<string, { type: string; text: string }> = {
    only_a: { type: 'success', text: '仅源A' },
    only_b: { type: 'error', text: '仅源B' },
    different: { type: 'warning', text: '有差异' },
  }

  const tableColumns = [
    { title: '状态', key: 'status', width: 80, render: (_: any, r: DiffRow) => <Tag type={statusTags[r.status]?.type as any}>{statusTags[r.status]?.text}</Tag> },
    ...columns.map((c) => ({
      title: c, key: c, ellipsis: true,
      render: (_: any, r: DiffRow) => {
        const va = r.data_a?.[c]
        const vb = r.data_b?.[c]
        const isDiff = r.diffCols?.includes(c)
        if (r.status === 'only_a') return <span>{String(va ?? '')}</span>
        if (r.status === 'only_b') return <span>{String(vb ?? '')}</span>
        return <span style={isDiff ? { background: 'var(--warning)', padding: '0 4px', borderRadius: 2 } : undefined}>{String(va ?? '')} {isDiff ? `→ ${String(vb ?? '')}` : ''}</span>
      },
    })),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <Card title="数据比较" size="small">
        <Row gutter={16}>
          <Col span={10}>
            <Card size="small" title="源 A">
              <Space style={{ width: '100%', flexDirection: 'column', alignItems: 'stretch' }}>
                <Select style={{ width: '100%' }} value={sourceA.db || undefined} onChange={(v) => loadTablesFor(v, 'a')} placeholder="数据库"
                  options={databases.map((d) => ({ label: d.name, value: d.name }))} />
                <Select style={{ width: '100%' }} value={sourceA.table || undefined} onChange={(v) => setSourceA((s) => ({ ...s, table: v }))} placeholder="表"
                  options={tablesA.map((t) => ({ label: t.name, value: t.name }))} />
              </Space>
            </Card>
          </Col>
          <Col span={4} style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Button type="primary" icon={<SwapOutlined />} loading={loading} onClick={compare}>比较</Button>
          </Col>
          <Col span={10}>
            <Card size="small" title="源 B">
              <Space style={{ width: '100%', flexDirection: 'column', alignItems: 'stretch' }}>
                <Select style={{ width: '100%' }} value={sourceB.db || undefined} onChange={(v) => loadTablesFor(v, 'b')} placeholder="数据库"
                  options={databases.map((d) => ({ label: d.name, value: d.name }))} />
                <Select style={{ width: '100%' }} value={sourceB.table || undefined} onChange={(v) => setSourceB((s) => ({ ...s, table: v }))} placeholder="表"
                  options={tablesB.map((t) => ({ label: t.name, value: t.name }))} />
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {diffs.length > 0 && (
        <>
          <Row gutter={16}>
            <Col span={5}><Card size="small"><Statistic title="总行数" value={summary.total} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="匹配" value={summary.matching} valueStyle={{ color: 'var(--success)' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="差异" value={summary.different} valueStyle={{ color: 'var(--warning)' }} /></Card></Col>
            <Col span={5}><Card size="small"><Statistic title="仅源A" value={summary.onlyA} valueStyle={{ color: 'var(--accent)' }} /></Card></Col>
            <Col span={4}><Card size="small"><Statistic title="仅源B" value={summary.onlyB} valueStyle={{ color: 'var(--error)' }} /></Card></Col>
          </Row>
          <Table dataSource={diffs} columns={tableColumns} rowKey="key" size="small" scroll={{ x: 'max-content' }} />
        </>
      )}

      {!loading && diffs.length === 0 && summary.total === 0 && <Empty description="选择两个数据源后点击比较" />}
    </div>
  )
}

export default DataCompare
