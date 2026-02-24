import React, { useState } from 'react'
import { Button, Card, Select, Switch, Alert, Space, Table, Input } from '../../components/ui'
import { ArrowLeftOutlined, WarningOutlined } from '@ant-design/icons'
import type { BackupRecord } from '../../../../shared/types/table-design'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void; records: BackupRecord[] }

const RestoreWizard: React.FC<Props> = ({ onBack, records }) => {
  const [step, setStep] = useState(0)
  const [sourceType, setSourceType] = useState<'file' | 'history'>('history')
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')
  const [targetDb, setTargetDb] = useState('')
  const [createNew, setCreateNew] = useState(false)
  const [newDbName, setNewDbName] = useState('')
  const [dropExisting, setDropExisting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<{ success: boolean; message?: string } | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])

  const execute = async () => {
    if (!connId) return
    setLoading(true); setProgress(0); setLogs([])
    try {
      const source = sourceType === 'history' ? records.find((r) => r.id === selectedRecord)?.filePath ?? '' : filePath
      setLogs((l) => [...l, `开始恢复: ${source}`])
      await api.backup.restore(connId, source)
      setProgress(100)
      setLogs((l) => [...l, '恢复完成'])
      setResult({ success: true })
    } catch (e: any) {
      setLogs((l) => [...l, `错误: ${e.message || String(e)}`])
      setResult({ success: false, message: e.message || String(e) })
    } finally { setLoading(false) }
  }

  const stepTitles = ['选择备份', '目标数据库', '选项', '确认', '执行']

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
            <Select value={sourceType} onChange={(v) => setSourceType(v)} style={{ width: 200 }}
              options={[{ value: 'history', label: '从备份历史' }, { value: 'file', label: '从文件' }]} />
            {sourceType === 'history' ? (
              <Table dataSource={records.filter((r) => r.status === 'completed')}
                columns={[
                  { title: '数据库', dataIndex: 'databaseName', key: 'databaseName' },
                  { title: '类型', dataIndex: 'backupType', key: 'backupType', width: 100 },
                  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
                ]}
                rowKey="id" size="small"
                onRow={(r) => ({ onClick: () => setSelectedRecord(r.id), style: { cursor: 'pointer', background: selectedRecord === r.id ? 'var(--bg-hover)' : undefined } })}
              />
            ) : (
              <Input value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="输入备份文件路径" />
            )}
          </Space>
        )
      case 1:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <div><Switch checked={createNew} onChange={setCreateNew} /> <span style={{ marginLeft: 8 }}>{createNew ? '新建数据库' : '已有数据库'}</span></div>
            {createNew ? (
              <Input value={newDbName} onChange={(e) => setNewDbName(e.target.value)} placeholder="新数据库名" style={{ width: 300 }} />
            ) : (
              <Select style={{ width: 300 }} value={targetDb || undefined} onChange={setTargetDb} placeholder="选择数据库"
                options={databases.map((d) => ({ value: d.name, label: d.name }))} />
            )}
          </Space>
        )
      case 2:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <div><Switch checked={dropExisting} onChange={setDropExisting} /> <span style={{ marginLeft: 8 }}>{dropExisting ? '恢复前删除已有表' : '保留已有表'}</span></div>
            {dropExisting && <Alert type="warning" message="警告：恢复前将删除目标数据库中的已有表" />}
          </Space>
        )
      case 3:
        return (
          <Card size="small">
            <p><strong>源文件：</strong>{sourceType === 'history' ? records.find((r) => r.id === selectedRecord)?.filePath : filePath}</p>
            <p><strong>目标数据库：</strong>{createNew ? newDbName : targetDb}</p>
            <p><strong>删除已有表：</strong>{dropExisting ? '是' : '否'}</p>
            <Alert type="warning" message="请确认以上信息无误后再执行恢复" />
          </Card>
        )
      case 4:
        return (
          <div style={{ padding: 24 }}>
            {!result ? (
              <>
                <div style={{ width: '100%', height: 8, background: 'var(--bg-hover)', borderRadius: 4, marginBottom: 16 }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <Button type="primary" size="large" loading={loading} onClick={execute}>开始恢复</Button>
              </>
            ) : (
              <Alert type={result.success ? 'success' : 'error'} message={result.success ? '恢复完成' : '恢复失败'} description={result.message} />
            )}
            {logs.length > 0 && (
              <pre style={{ marginTop: 12, maxHeight: 200, overflow: 'auto', background: 'var(--bg-hover)', padding: 8, borderRadius: 6, fontSize: 12 }}>{logs.join('\n')}</pre>
            )}
          </div>
        )
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack} style={{ marginBottom: 16 }}>返回</Button>
      <div style={{ display: 'flex', marginBottom: 24 }}>
        {stepTitles.map((t, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: i <= step ? 'var(--accent)' : 'var(--bg-hover)', color: i <= step ? '#fff' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{i + 1}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: i <= step ? 'var(--text-primary)' : 'var(--text-muted)' }}>{t}</div>
          </div>
        ))}
      </div>
      <Card>{renderStep()}</Card>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>上一步</Button>
        {step < stepTitles.length - 1 && <Button type="primary" onClick={() => setStep((s) => s + 1)}>下一步</Button>}
      </div>
    </div>
  )
}

export default RestoreWizard
