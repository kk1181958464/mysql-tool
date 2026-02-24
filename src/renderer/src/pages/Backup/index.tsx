import React, { useEffect, useState, useCallback } from 'react'
import { Card, Table, Button, Tag, Space, Empty } from '../../components/ui'
import { PlusOutlined, HistoryOutlined, RollbackOutlined } from '@ant-design/icons'
import type { BackupRecord } from '../../../../shared/types/table-design'
import { useConnectionStore } from '../../stores/connection.store'
import { api } from '../../utils/ipc'
import BackupWizard from './BackupWizard'
import RestoreWizard from './RestoreWizard'
import BackupSchedule from './BackupSchedule'

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

const Backup: React.FC = () => {
  const [view, setView] = useState<'main' | 'backup' | 'restore' | 'schedule'>('main')
  const [records, setRecords] = useState<BackupRecord[]>([])
  const [loading, setLoading] = useState(false)
  const connId = useConnectionStore((s) => s.activeConnectionId)

  const load = useCallback(async () => {
    if (!connId) return
    setLoading(true)
    try {
      const res = await api.backup.list(connId)
      setRecords(Array.isArray(res) ? res : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId])

  useEffect(() => { load() }, [load])

  if (view === 'backup') return <BackupWizard onBack={() => { setView('main'); load() }} />
  if (view === 'restore') return <RestoreWizard onBack={() => { setView('main'); load() }} records={records} />
  if (view === 'schedule') return <BackupSchedule onBack={() => setView('main')} />

  const columns = [
    { title: '数据库', dataIndex: 'databaseName', key: 'databaseName', width: 150 },
    { title: '类型', dataIndex: 'backupType', key: 'backupType', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '文件', dataIndex: 'filePath', key: 'filePath', ellipsis: true },
    { title: '大小', dataIndex: 'fileSize', key: 'fileSize', width: 100, render: (v: number) => formatBytes(v) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag type={v === 'completed' ? 'success' : v === 'running' ? 'primary' : 'error'}>{v}</Tag> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
    { title: '操作', key: 'action', width: 120, render: (_: any, r: BackupRecord) => (
      <Space><Button size="small" icon={<RollbackOutlined />} onClick={() => setView('restore')}>恢复</Button></Space>
    )},
  ]

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setView('backup')}>创建备份</Button>
        <Button icon={<RollbackOutlined />} onClick={() => setView('restore')}>恢复</Button>
        <Button icon={<HistoryOutlined />} onClick={() => setView('schedule')}>定时备份</Button>
      </Space>

      <Card title={<span><HistoryOutlined /> 备份历史</span>} size="small">
        {records.length > 0 ? (
          <Table dataSource={records} columns={columns} rowKey="id" size="small" loading={loading} />
        ) : (
          <Empty description="暂无备份记录" />
        )}
      </Card>
    </div>
  )
}

export default Backup
