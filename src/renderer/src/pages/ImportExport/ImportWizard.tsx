import React, { useState, useRef } from 'react'
import { Button, Table, Select, Input, Switch, Alert, Card, Space } from '../../components/ui'
import { ArrowLeftOutlined, UploadOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void }

const ImportWizard: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState(0)
  const [filePath, setFilePath] = useState('')
  const [fileType, setFileType] = useState<'csv' | 'excel' | 'sql'>('csv')
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, unknown>[] }>({ columns: [], rows: [] })
  const [targetDb, setTargetDb] = useState<string>('')
  const [targetTable, setTargetTable] = useState('')
  const [isNewTable, setIsNewTable] = useState(false)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [options, setOptions] = useState({ truncate: false, ignoreErrors: false, batchSize: 1000 })
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ success: boolean; imported: number; errors: number; message?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])
  const tables = useDatabaseStore((s) => connId && targetDb ? s.tables[`${connId}:${targetDb}`] ?? [] : [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'csv') setFileType('csv')
    else if (ext === 'xlsx' || ext === 'xls') setFileType('excel')
    else if (ext === 'sql') setFileType('sql')
    setFilePath(file.name)

    if (connId) {
      try {
        const preview = await api.importExport.preview((file as any).path || file.name)
        if (preview) {
          setPreviewData({ columns: preview.columns || [], rows: (preview.rows || []).slice(0, 100) })
          const mapping: Record<string, string> = {}
          for (const c of preview.columns || []) mapping[c] = c
          setColumnMapping(mapping)
        }
      } catch { /* ignore */ }
    }
  }

  const loadTables = async (db: string) => {
    setTargetDb(db)
    if (connId) await useDatabaseStore.getState().loadTables(connId, db)
  }

  const execute = async () => {
    if (!connId || !targetDb) return
    setLoading(true)
    setProgress(0)
    try {
      const res = await api.importExport.importFile(connId, targetDb, targetTable, filePath, {
        fileType, columnMapping, truncate: options.truncate, ignoreErrors: options.ignoreErrors, batchSize: options.batchSize,
      })
      setResult({ success: true, imported: res?.imported ?? 0, errors: res?.errors ?? 0 })
      setProgress(100)
    } catch (e: any) {
      setResult({ success: false, imported: 0, errors: 1, message: e.message || String(e) })
    } finally {
      setLoading(false)
    }
  }

  const stepTitles = ['选择文件', '预览数据', '目标配置', '选项', '执行']

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.sql" onChange={handleFileSelect} style={{ display: 'none' }} />
            <Button icon={<UploadOutlined />} size="large" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
            {filePath && <p style={{ marginTop: 12 }}>已选择: {filePath} ({fileType.toUpperCase()})</p>}
          </div>
        )
      case 1:
        return previewData.columns.length > 0 ? (
          <Table dataSource={previewData.rows.map((r, i) => ({ ...r, _key: i }))}
            columns={previewData.columns.map((c) => ({ title: c, dataIndex: c, key: c, ellipsis: true }))}
            rowKey="_key" size="small" scroll={{ x: 'max-content' }} />
        ) : <Alert message="无预览数据，请返回选择文件" type="warning" />
      case 2:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div><label>数据库：</label>
              <Select style={{ width: 300 }} value={targetDb || undefined} onChange={loadTables} placeholder="选择数据库"
                options={databases.map((d) => ({ label: d.name, value: d.name }))} />
            </div>
            <div><Switch checked={isNewTable} onChange={setIsNewTable} /> <span style={{ marginLeft: 8 }}>{isNewTable ? '新建表' : '已有表'}</span></div>
            {isNewTable ? (
              <Input placeholder="新表名" value={targetTable} onChange={(e) => setTargetTable(e.target.value)} style={{ width: 300 }} />
            ) : (
              <Select style={{ width: 300 }} value={targetTable || undefined} onChange={setTargetTable} placeholder="选择表"
                options={tables.map((t) => ({ label: t.name, value: t.name }))} />
            )}
            {previewData.columns.length > 0 && (
              <Card title="列映射" size="small" style={{ width: '100%' }}>
                {previewData.columns.map((c) => (
                  <div key={c} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                    <span style={{ width: 150 }}>{c}</span><span>→</span>
                    <Input style={{ width: 200 }} value={columnMapping[c] || ''} onChange={(e) => setColumnMapping((m) => ({ ...m, [c]: e.target.value }))} />
                  </div>
                ))}
              </Card>
            )}
          </Space>
        )
      case 3:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div><Switch checked={options.truncate} onChange={(v) => setOptions((o) => ({ ...o, truncate: v }))} /> <span style={{ marginLeft: 8 }}>{options.truncate ? '导入前清空表' : '保留现有数据'}</span></div>
            <div><Switch checked={options.ignoreErrors} onChange={(v) => setOptions((o) => ({ ...o, ignoreErrors: v }))} /> <span style={{ marginLeft: 8 }}>{options.ignoreErrors ? '忽略错误' : '遇错停止'}</span></div>
            <div><label>批量大小：</label><Input type="number" min={100} max={10000} step={100} value={options.batchSize} onChange={(e) => setOptions((o) => ({ ...o, batchSize: parseInt(e.target.value) || 1000 }))} style={{ width: 120 }} /></div>
          </Space>
        )
      case 4:
        return (
          <div style={{ textAlign: 'center', padding: 24 }}>
            {!result ? (
              <>
                <div style={{ width: '100%', height: 8, background: 'var(--bg-hover)', borderRadius: 4, marginBottom: 16 }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <Button type="primary" size="large" loading={loading} onClick={execute}>开始导入</Button>
              </>
            ) : (
              <Alert type={result.success ? 'success' : 'error'} message={result.success ? '导入完成' : '导入失败'}
                description={result.success ? `成功导入 ${result.imported} 行，${result.errors} 个错误` : result.message} />
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
        <Button type="primary" disabled={step === stepTitles.length - 1 && !!result} onClick={() => setStep((s) => s + 1)}>下一步</Button>
      </div>
    </div>
  )
}

export default ImportWizard
