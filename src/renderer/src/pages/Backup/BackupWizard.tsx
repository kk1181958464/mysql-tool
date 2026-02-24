import React, { useState } from 'react'
import { Button, Card, Select, Switch, Alert, Space, Checkbox } from '../../components/ui'
import { ArrowLeftOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void }

const BackupWizard: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState(0)
  const [selectedDbs, setSelectedDbs] = useState<string[]>([])
  const [backupType, setBackupType] = useState<'full' | 'structure' | 'data'>('full')
  const [compress, setCompress] = useState(true)
  const [filePath, setFilePath] = useState('')
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; filePath?: string; size?: number; duration?: number; message?: string } | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])

  const execute = async () => {
    if (!connId || selectedDbs.length === 0) return
    setLoading(true); setProgress(0)
    try {
      const startTime = Date.now()
      const res = await api.backup.create({ connectionId: connId, databases: selectedDbs, backupType, compress, filePath: filePath || undefined })
      setProgress(100)
      setResult({ success: true, filePath: res?.filePath ?? filePath, size: res?.fileSize ?? 0, duration: Date.now() - startTime })
    } catch (e: any) {
      setResult({ success: false, message: e.message || String(e) })
    } finally { setLoading(false) }
  }

  const formatBytes = (b: number) => {
    if (!b) return '0 B'
    const k = 1024, s = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(b) / Math.log(k))
    return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`
  }

  const toggleDb = (name: string, checked: boolean) => {
    setSelectedDbs((prev) => checked ? [...prev, name] : prev.filter((d) => d !== name))
  }

  const stepTitles = ['选择数据库', '备份类型', '选项', '执行']

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {databases.map((d) => (
              <Checkbox key={d.name} checked={selectedDbs.includes(d.name)} onChange={(v) => toggleDb(d.name, v)}>{d.name}</Checkbox>
            ))}
          </div>
        )
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([
              { value: 'full', label: '完整备份', desc: '结构 + 数据' },
              { value: 'structure', label: '仅结构', desc: '仅表结构，不含数据' },
              { value: 'data', label: '仅数据', desc: '仅数据，不含表结构' },
            ] as const).map((t) => (
              <Card key={t.value} size="small" style={{ cursor: 'pointer', borderColor: backupType === t.value ? 'var(--accent)' : undefined }} onClick={() => setBackupType(t.value)}>
                <strong>{t.label}</strong>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>{t.desc}</p>
              </Card>
            ))}
          </div>
        )
      case 2:
        return <div><Switch checked={compress} onChange={setCompress} /> <span style={{ marginLeft: 8 }}>{compress ? 'gzip 压缩' : '不压缩'}</span></div>
      case 3:
        return (
          <div style={{ textAlign: 'center', padding: 24 }}>
            {!result ? (
              <>
                <div style={{ width: '100%', height: 8, background: 'var(--bg-hover)', borderRadius: 4, marginBottom: 16 }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <Button type="primary" size="large" loading={loading} onClick={execute}>开始备份</Button>
              </>
            ) : (
              <Alert type={result.success ? 'success' : 'error'} message={result.success ? '备份完成' : '备份失败'}
                description={result.success ? `文件: ${result.filePath}\n大小: ${formatBytes(result.size ?? 0)}\n耗时: ${((result.duration ?? 0) / 1000).toFixed(1)}s` : result.message} />
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

export default BackupWizard
