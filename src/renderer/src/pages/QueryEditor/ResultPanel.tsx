import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Tabs, Table, Tag, Button, Space, Dropdown, Empty, Spin } from '../../components/ui'
import { DownloadOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useTabStore, QueryTab } from '../../stores/tab.store'
import { useConnectionStore } from '../../stores/connection.store'
import { api } from '../../utils/ipc'
import type { QueryHistoryItem, QueryStatementResult } from '../../../../shared/types/query'
import tableTransformWorker from '../../workers/table-transform.worker?worker'

interface Props {
  tabId: string
}

const RESULT_VIRTUAL_THRESHOLD = 1000
const HISTORY_VIRTUAL_THRESHOLD = 12
const RESULT_WORKER_THRESHOLD = 5000

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
  const [historyRows, setHistoryRows] = useState<QueryHistoryItem[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize] = useState(20)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activeKey, setActiveKey] = useState('results')
  const [activeStatementIndex, setActiveStatementIndex] = useState(0)
  const [transformedRows, setTransformedRows] = useState<Array<Record<string, unknown>>>([])
  const transformJobIdRef = useRef(0)

  const tab = tabs.find((t) => t.id === tabId) as QueryTab | undefined
  const result = tab?.result
  const error = tab?.error
  const executing = tab?.isExecuting
  const statementResults = result?.statementResults?.length
    ? result.statementResults
    : result
      ? [{
          index: 1,
          sql: result.sql,
          isSelect: result.isSelect,
          success: !error,
          columns: result.columns,
          rows: result.rows,
          affectedRows: result.affectedRows,
          insertId: result.insertId,
          executionTime: result.executionTime,
          rowCount: result.rowCount,
          error: error ?? null,
        } satisfies QueryStatementResult]
      : []
  const selectedStatement = statementResults[activeStatementIndex] || statementResults[0] || null
  const hasMultipleStatements = statementResults.length > 1
  const aggregateAffectedRows = statementResults.reduce((sum, item) => sum + item.affectedRows, 0)
  const aggregateExecutionTime = statementResults.reduce((sum, item) => sum + item.executionTime, 0)
  const aggregateSuccessCount = statementResults.filter((item) => item.success).length
  const aggregateFailCount = statementResults.filter((item) => !item.success).length
  const aggregateSelectRows = statementResults.reduce((sum, item) => sum + item.rowCount, 0)
  const hasAnySelect = statementResults.some((item) => item.isSelect)

  useEffect(() => {
    setActiveStatementIndex(0)
  }, [result?.sql, result?.executionTime, result?.statementResults?.length])

  useEffect(() => {
    setHistoryPage(1)
  }, [activeConnectionId])

  useEffect(() => {
    if (activeKey !== 'history' || !activeConnectionId) return

    const offset = (historyPage - 1) * historyPageSize
    const start = performance.now()
    setHistoryLoading(true)

    api.store.getHistory(activeConnectionId, historyPageSize, offset)
      .then((rows) => {
        const data = Array.isArray(rows) ? rows : []
        setHistoryRows(data)
        setHistoryHasMore(data.length >= historyPageSize)
        void api.perf.reportMetric({
          name: 'result_panel.history_fetch_ms',
          value: Number((performance.now() - start).toFixed(2)),
          tags: {
            page: 'query_editor',
            tab: 'history',
            pageNo: historyPage,
            pageSize: historyPageSize,
            rows: data.length,
          },
          ts: Date.now(),
        })
      })
      .catch(() => {
        setHistoryRows([])
        setHistoryHasMore(false)
      })
      .finally(() => setHistoryLoading(false))
  }, [activeKey, activeConnectionId, historyPage, historyPageSize])

  const resultColumns = selectedStatement?.columns.map((col) => ({
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

  useEffect(() => {
    const rows = selectedStatement?.rows
    if (!rows || rows.length === 0) {
      setTransformedRows([])
      return
    }

    if (rows.length < RESULT_WORKER_THRESHOLD) {
      setTransformedRows(rows)
      return
    }

    const worker = new tableTransformWorker()
    const nextJobId = transformJobIdRef.current + 1
    transformJobIdRef.current = nextJobId
    const jobId = `${tabId}-${nextJobId}`
    const workerStart = performance.now()

    worker.onmessage = (event: MessageEvent<{ id: string; rows: Array<Record<string, unknown>> }>) => {
      if (event.data.id !== jobId) return
      setTransformedRows(event.data.rows)
      void api.perf.reportMetric({
        name: 'result_panel.worker_transform_ms',
        value: Number((performance.now() - workerStart).toFixed(2)),
        tags: {
          page: 'query_editor',
          tab: 'results',
          rows: rows.length,
        },
        ts: Date.now(),
      })
      worker.terminate()
    }

    worker.postMessage({ id: jobId, rows })

    return () => {
      worker.terminate()
    }
  }, [selectedStatement?.rows, tabId, activeStatementIndex])

  const normalizedRows = useMemo(() => {
    const rows = transformedRows.length ? transformedRows : (selectedStatement?.rows || [])
    return rows.map((r, i) => ({ ...r, _key: i }))
  }, [transformedRows, selectedStatement?.rows])

  useEffect(() => {
    if (activeKey !== 'results' || !selectedStatement) return
    const start = performance.now()
    requestAnimationFrame(() => {
      void api.perf.reportMetric({
        name: 'result_panel.render_cost_ms',
        value: Number((performance.now() - start).toFixed(2)),
        tags: {
          page: 'query_editor',
          tab: 'results',
          rows: normalizedRows.length,
          isSelect: selectedStatement.isSelect,
        },
        ts: Date.now(),
      })
    })
  }, [activeKey, selectedStatement, normalizedRows.length])

  const handleExport = async (format: string) => {
    if (!selectedStatement || !activeConnectionId) return
    try {
      await api.importExport.exportData(activeConnectionId, '', selectedStatement.sql, '', format)
    } catch {
      // ignore
    }
  }

  const isExplain = selectedStatement?.sql?.toUpperCase().startsWith('EXPLAIN ')
  const resultCount = hasMultipleStatements
    ? (hasAnySelect ? aggregateSelectRows : aggregateAffectedRows)
    : (selectedStatement ? (selectedStatement.isSelect ? selectedStatement.rowCount : selectedStatement.affectedRows) : 0)

  const historyPaginationTotal = historyHasMore
    ? historyPage * historyPageSize + 1
    : (historyPage - 1) * historyPageSize + historyRows.length

  const multiStatementSummary = hasMultipleStatements ? (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-hover)',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 12,
      fontSize: 12,
      color: 'var(--text-secondary)',
    }}>
      <span>共执行 {statementResults.length} 条语句</span>
      <span>成功 {aggregateSuccessCount} 条</span>
      <span>失败 {aggregateFailCount} 条</span>
      <span>总影响行数 {aggregateAffectedRows}</span>
      <span>总返回行数 {aggregateSelectRows}</span>
      <span>总耗时 {aggregateExecutionTime}ms</span>
    </div>
  ) : null

  const tabItems = [
    {
      key: 'results',
      label: `结果${result ? ` (${resultCount})` : ''}`,
      children: executing ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="执行中..." /></div>
      ) : selectedStatement ? (
        isExplain ? (
          <div style={{ height: '100%', overflow: 'auto' }}>
            {multiStatementSummary}
            {statementResults.length > 1 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>当前语句</span>
                <select
                  value={selectedStatement.index}
                  onChange={(e) => setActiveStatementIndex(Math.max(0, statementResults.findIndex((item) => item.index === Number(e.target.value))))}
                  style={{ minWidth: 220, padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 }}
                >
                  {statementResults.map((item) => (
                    <option key={item.index} value={item.index}>
                      {`#${item.index} ${item.success ? 'OK' : 'ERR'} ${item.sql.replace(/\s+/g, ' ').slice(0, 80)}`}
                    </option>
                  ))}
                </select>
                {selectedStatement.success ? <Tag type="success">成功</Tag> : <Tag type="error">失败</Tag>}
              </div>
            )}
            <ExplainView rows={selectedStatement.rows} />
          </div>
        ) : selectedStatement.isSelect ? (
          <div style={{ height: '100%', overflow: 'auto' }}>
            {multiStatementSummary}
            {statementResults.length > 1 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>当前语句</span>
                <select
                  value={selectedStatement.index}
                  onChange={(e) => setActiveStatementIndex(Math.max(0, statementResults.findIndex((item) => item.index === Number(e.target.value))))}
                  style={{ minWidth: 220, padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 }}
                >
                  {statementResults.map((item) => (
                    <option key={item.index} value={item.index}>
                      {`#${item.index} ${item.success ? 'OK' : 'ERR'} ${item.sql.replace(/\s+/g, ' ').slice(0, 80)}`}
                    </option>
                  ))}
                </select>
                {selectedStatement.success ? <Tag type="success">成功</Tag> : <Tag type="error">失败</Tag>}
              </div>
            )}
            <Table
              columns={resultColumns}
              dataSource={normalizedRows}
              rowKey="_key"
              size="small"
              scroll={{ x: 'max-content' }}
              virtual={{
                enabled: normalizedRows.length >= RESULT_VIRTUAL_THRESHOLD,
                rowHeight: 34,
                overscan: 8,
                threshold: RESULT_VIRTUAL_THRESHOLD,
              }}
            />
            <Space style={{ padding: '4px 8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {selectedStatement.rowCount} 行 | {selectedStatement.executionTime}ms
              </span>
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
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div style={{ textAlign: 'center', maxWidth: 400 }}>
              {hasMultipleStatements && (
                <div style={{
                  marginBottom: 16,
                  padding: '10px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-hover)',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}>
                  <div>共执行 {statementResults.length} 条语句</div>
                  <div>成功 {aggregateSuccessCount} 条，失败 {aggregateFailCount} 条</div>
                  <div>总影响行数 {aggregateAffectedRows} | 总返回行数 {aggregateSelectRows} | 总耗时 {aggregateExecutionTime}ms</div>
                </div>
              )}
              <div style={{ fontSize: 48, color: selectedStatement.success ? 'var(--accent)' : 'var(--error)', marginBottom: 16 }}>
                {selectedStatement.success ? '✓' : '!'}
              </div>
              <h3 style={{ marginBottom: 8, color: 'var(--text-primary)' }}>{selectedStatement.success ? '执行成功' : '执行失败'}</h3>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                <div>影响行数: {selectedStatement.affectedRows}</div>
                {selectedStatement.insertId > 0 && <div>插入ID: {selectedStatement.insertId}</div>}
                <div>执行时间: {selectedStatement.executionTime}ms</div>
                {selectedStatement.error && <div style={{ color: 'var(--error)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 8 }}>{selectedStatement.error}</div>}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
                {statementResults.length > 1 && (
                  <div style={{ marginBottom: 8 }}>
                    <select
                      value={selectedStatement.index}
                      onChange={(e) => setActiveStatementIndex(Math.max(0, statementResults.findIndex((item) => item.index === Number(e.target.value))))}
                      style={{ minWidth: 220, padding: '4px 8px', background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 }}
                    >
                      {statementResults.map((item) => (
                        <option key={item.index} value={item.index}>
                          {`#${item.index} ${item.success ? 'OK' : 'ERR'} ${item.sql.replace(/\s+/g, ' ').slice(0, 80)}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>SQL: {selectedStatement.sql.length > 100 ? selectedStatement.sql.substring(0, 100) + '...' : selectedStatement.sql}</div>
              </div>
            </div>
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
          {error && <div style={{ marginBottom: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}><Tag type="error">{error}</Tag></div>}
          {statementResults.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {statementResults.map((item, idx) => (
                <div
                  key={item.index}
                  onClick={() => {
                    setActiveStatementIndex(idx)
                    setActiveKey('results')
                  }}
                  style={{
                    padding: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: idx === activeStatementIndex ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Tag type={item.success ? 'success' : 'error'}>{item.success ? 'OK' : 'ERR'}</Tag>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{item.index}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {item.isSelect ? `返回 ${item.rowCount} 行` : `影响 ${item.affectedRows} 行`} | {item.executionTime}ms
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: item.error ? 6 : 0, wordBreak: 'break-word' }}>
                    {item.sql}
                  </div>
                  {item.error && (
                    <div style={{ fontSize: 12, color: 'var(--error)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {item.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !error && !result && <span style={{ color: 'var(--text-muted)' }}>暂无消息</span>
          )}
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
          dataSource={historyRows}
          rowKey="id"
          size="small"
          loading={historyLoading}
          virtual={{
            enabled: historyRows.length >= HISTORY_VIRTUAL_THRESHOLD,
            rowHeight: 34,
            overscan: 6,
            threshold: HISTORY_VIRTUAL_THRESHOLD,
          }}
          pagination={{
            page: historyPage,
            pageSize: historyPageSize,
            total: historyPaginationTotal,
            onChange: (nextPage) => setHistoryPage(nextPage),
          }}
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
