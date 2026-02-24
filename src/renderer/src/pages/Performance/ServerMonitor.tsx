import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Card, Row, Col, Statistic, Switch, Input, Tabs, Space } from '../../components/ui'
import { ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

interface ProcessItem {
  Id: number; User: string; Host: string; db: string | null
  Command: string; Time: number; State: string; Info: string | null
}

const ServerMonitor: React.FC = () => {
  const [processes, setProcesses] = useState<ProcessItem[]>([])
  const [variables, setVariables] = useState<{ name: string; value: string }[]>([])
  const [status, setStatus] = useState<{ name: string; value: string }[]>([])
  const [innodbStatus, setInnodbStatus] = useState('')
  const [metrics, setMetrics] = useState({ connections: 0, queriesPerSec: 0, threads: 0, bufferPool: '' })
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [loading, setLoading] = useState(false)
  const [varSearch, setVarSearch] = useState('')
  const [statusSearch, setStatusSearch] = useState('')
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const load = useCallback(async () => {
    if (!connId) return
    setLoading(true)
    try {
      const [procRes, varRes, statRes, innoRes] = await Promise.all([
        api.perf.processList(connId), api.perf.variables(connId), api.perf.status(connId), api.perf.innodbStatus(connId),
      ])
      setProcesses(Array.isArray(procRes) ? procRes : [])
      const vars = Array.isArray(varRes) ? varRes.map((r: any) => ({ name: r.Variable_name, value: r.Value })) : []
      setVariables(vars)
      const stats = Array.isArray(statRes) ? statRes.map((r: any) => ({ name: r.Variable_name, value: r.Value })) : []
      setStatus(stats)
      setInnodbStatus(typeof innoRes === 'string' ? innoRes : innoRes?.Status ?? '')
      const findStat = (n: string) => stats.find((s: any) => s.name === n)?.value ?? '0'
      setMetrics({
        connections: parseInt(findStat('Threads_connected')),
        queriesPerSec: parseInt(findStat('Queries')),
        threads: parseInt(findStat('Threads_running')),
        bufferPool: `${(parseInt(findStat('Innodb_buffer_pool_pages_data')) / Math.max(1, parseInt(findStat('Innodb_buffer_pool_pages_total'))) * 100).toFixed(1)}%`,
      })
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [autoRefresh, load])

  const killProcess = async (id: number) => {
    if (confirm(`确定要终止进程 ${id} 吗？`)) {
      await api.query.execute(connId!, `KILL ${id}`, db ?? '')
      load()
    }
  }

  const processColumns = [
    { key: 'Id', title: 'Id', dataIndex: 'Id', width: 70 },
    { key: 'User', title: 'User', dataIndex: 'User', width: 100 },
    { key: 'Host', title: 'Host', dataIndex: 'Host', width: 150, ellipsis: true },
    { key: 'db', title: 'db', dataIndex: 'db', width: 100 },
    { key: 'Command', title: 'Command', dataIndex: 'Command', width: 100 },
    { key: 'Time', title: 'Time', dataIndex: 'Time', width: 80 },
    { key: 'State', title: 'State', dataIndex: 'State', width: 150, ellipsis: true },
    { key: 'Info', title: 'Info', dataIndex: 'Info', ellipsis: true },
    { key: 'action', title: '操作', width: 80, render: (_: any, r: ProcessItem) => <Button size="small" type="danger" onClick={() => killProcess(r.Id)}><StopOutlined /> Kill</Button> },
  ]

  const varColumns = [
    { key: 'name', title: '变量名', dataIndex: 'name', width: 300 },
    { key: 'value', title: '值', dataIndex: 'value', ellipsis: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Row gutter={16}>
        <Col span={6}><Card size="small"><Statistic title="连接数" value={metrics.connections} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Queries" value={metrics.queriesPerSec} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="活跃线程" value={metrics.threads} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="Buffer Pool" value={metrics.bufferPool} /></Card></Col>
      </Row>
      <Space>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} /> <span>自动刷新</span>
        <Button onClick={load} disabled={loading}><ReloadOutlined /> {loading ? '加载中...' : '刷新'}</Button>
      </Space>
      <Tabs items={[
        { key: 'process', label: '进程列表', children: <Table dataSource={processes} columns={processColumns} rowKey="Id" size="small" scroll={{ y: 400, x: 'max-content' }} /> },
        { key: 'variables', label: '服务器变量', children: <><Input placeholder="搜索变量..." value={varSearch} onChange={(e) => setVarSearch(e.target.value)} style={{ width: 300, marginBottom: 8 }} /><Table dataSource={variables.filter((v) => !varSearch || v.name.toLowerCase().includes(varSearch.toLowerCase()))} columns={varColumns} rowKey="name" size="small" /></> },
        { key: 'status', label: '全局状态', children: <><Input placeholder="搜索状态..." value={statusSearch} onChange={(e) => setStatusSearch(e.target.value)} style={{ width: 300, marginBottom: 8 }} /><Table dataSource={status.filter((v) => !statusSearch || v.name.toLowerCase().includes(statusSearch.toLowerCase()))} columns={varColumns} rowKey="name" size="small" /></> },
        { key: 'innodb', label: 'InnoDB 状态', children: <pre style={{ maxHeight: 500, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 12 }}>{innodbStatus || '无数据'}</pre> },
      ]} />
    </div>
  )
}

export default ServerMonitor
