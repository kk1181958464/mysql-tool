import React, { useState, useRef } from 'react'
import { Button, Table, Select, Input, Switch, Alert, Card, Space } from '../../components/ui'
import { ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void }

const ImportWizard: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState(0)
  const [filePath, setFilePath] = useState('')
  const [fileType, setFileType] = useState<'csv' | 'excel' | 'sql'>('csv')
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, unknown>[] }>({ columns: [], rows: [] })
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [sheetName, setSheetName] = useState('')
  const [targetDb, setTargetDb] = useState<string>('')
  const [targetTable, setTargetTable] = useState('')
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [options, setOptions] = useState({ truncate: false, ignoreErrors: false, atomic: false, batchSize: 1000 })
  const [csvOptions, setCsvOptions] = useState({ delimiter: ',', quote: '"', columns: true })
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('准备中')
  const [progressErrors, setProgressErrors] = useState(0)
  const [result, setResult] = useState<{ success: boolean; imported: number; errors: number; message?: string; errorReportPath?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const taskIdRef = useRef<string | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])
  const tables = useDatabaseStore((s) => connId && targetDb ? s.tables[`${connId}:${targetDb}`] ?? [] : [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase()
    const fullName = file.name.toLowerCase()
    if (ext === 'csv') setFileType('csv')
    else if (ext === 'xlsx' || ext === 'xls') setFileType('excel')
    else if (ext === 'sql' || fullName.endsWith('.sql.gz')) setFileType('sql')
    setFilePath((file as any).path || file.name)

    if (connId && ext !== 'sql' && !fullName.endsWith('.sql.gz')) {
      try {
        const preview = await api.importExport.preview((file as any).path || file.name)
        if (preview) {
          setPreviewData({ columns: preview.columns || [], rows: (preview.rows || []).slice(0, 100) })
          setSheetNames(preview.sheetNames || [])
          setSheetName(preview.sheetNames?.[0] || '')
          const mapping: Record<string, string> = {}
          for (const c of preview.columns || []) mapping[c] = c
          setColumnMapping(mapping)
        }
      } catch (e) {
        console.warn('[ImportWizard] 预览文件失败:', e)
      }
    }
  }

  const refreshPreview = async (previewOptions: { sheetName?: string; delimiter?: string; quote?: string; columns?: boolean }) => {
    const preview = await api.importExport.preview(filePath, previewOptions)
    setPreviewData({ columns: preview.columns || [], rows: (preview.rows || []).slice(0, 100) })
    setColumnMapping(Object.fromEntries((preview.columns || []).map((column: string) => [column, column])))
  }

  const selectSheet = async (value: string) => {
    setSheetName(value)
    await refreshPreview({ sheetName: value })
  }

  const updateCsvPreview = async (next: typeof csvOptions) => {
    setCsvOptions(next)
    if (fileType === 'csv' && filePath && next.delimiter.length === 1 && next.quote.length === 1) {
      await refreshPreview(next)
    }
  }

  const loadTables = async (db: string) => {
    setTargetDb(db)
    if (connId) await useDatabaseStore.getState().loadTables(connId, db)
  }

  const execute = async () => {
    if (!connId || !targetDb) return
    if (fileType !== 'sql' && !targetTable) return
    setLoading(true)
    setProgress(0)
    setProgressErrors(0)
    setProgressStage('读取文件')
    const taskId = crypto.randomUUID()
    taskIdRef.current = taskId
    const unsubscribe = api.onImportProgress((data) => {
      if (data.taskId !== taskId) return
      const total = Math.max(1, data.total)
      setProgress(Math.min(99, Math.max(0, Math.round((data.current / total) * 100))))
      setProgressErrors(data.fail || 0)
      setProgressStage(data.stage === 'executing' ? '写入数据库' : data.stage === 'parsing' ? '解析 SQL' : '读取文件')
    })
    try {
      const res = await api.importExport.importFile(connId, targetDb, targetTable, filePath, {
        taskId, fileType, columnMapping, truncate: options.truncate, ignoreErrors: options.ignoreErrors, atomic: options.atomic, batchSize: options.batchSize,
        delimiter: csvOptions.delimiter, quote: csvOptions.quote, columns: csvOptions.columns, sheetName,
      })
      setResult({ success: true, imported: res?.imported ?? res?.executed ?? 0, errors: res?.errors ?? 0, errorReportPath: res?.errorReportPath })
      setProgress(100)
      setProgressStage('完成')
    } catch (e: any) {
      setResult({ success: false, imported: 0, errors: 1, message: e.message || String(e) })
    } finally {
      taskIdRef.current = null
      unsubscribe()
      setLoading(false)
    }
  }

  const stepTitles = ['选择文件', '预览数据', '目标配置', '选项', '执行']

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.sql,.sql.gz" onChange={handleFileSelect} style={{ display: 'none' }} />
            <Button icon={<UploadOutlined />} size="large" onClick={() => fileInputRef.current?.click()}>选择文件</Button>
            {filePath && <p style={{ marginTop: 12 }}>已选择: {filePath} ({fileType.toUpperCase()})</p>}
          </div>
        )
      case 1:
        return fileType === 'sql' ? (
          <Alert message="SQL 文件不做表格预览，导入时会按脚本语句执行。" type="info" />
        ) : previewData.columns.length > 0 ? (
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
            {fileType !== 'sql' && (
              <>
                <Select style={{ width: 300 }} value={targetTable || undefined} onChange={setTargetTable} placeholder="选择目标表"
                  options={tables.map((t) => ({ label: t.name, value: t.name }))} />
              </>
            )}
            {fileType !== 'sql' && previewData.columns.length > 0 && (
              <Card title="列映射" size="small" style={{ width: '100%' }}>
                {previewData.columns.map((c) => (
                  <div key={c} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                    <span style={{ width: 150 }}>{c}</span><span>→</span>
                    <Input style={{ width: 200 }} value={columnMapping[c] || ''} onChange={(e) => setColumnMapping((m) => ({ ...m, [c]: e.target.value }))} />
                  </div>
                ))}
              </Card>
            )}
            {fileType === 'excel' && sheetNames.length > 1 && (
              <div><label>工作表：</label><Select style={{ width: 300 }} value={sheetName} onChange={selectSheet} options={sheetNames.map((name) => ({ label: name, value: name }))} /></div>
            )}
          </Space>
        )
      case 3:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <div><Switch checked={options.truncate} onChange={(v) => setOptions((o) => ({ ...o, truncate: v }))} /> <span style={{ marginLeft: 8 }}>{options.truncate ? '导入前清空表' : '保留现有数据'}</span></div>
            <div><Switch checked={options.ignoreErrors} disabled={options.atomic} onChange={(v) => setOptions((o) => ({ ...o, ignoreErrors: v }))} /> <span style={{ marginLeft: 8 }}>{options.ignoreErrors ? '忽略错误' : '遇错停止'}</span></div>
            {fileType !== 'sql' && (
              <div><Switch checked={options.atomic} onChange={(v) => setOptions((o) => ({ ...o, atomic: v, ignoreErrors: v ? false : o.ignoreErrors }))} /> <span style={{ marginLeft: 8 }}>{options.atomic ? '事务导入，失败时整体回滚' : '普通导入，速度更快'}</span></div>
            )}
            <div><label>批量大小：</label><Input type="number" min={100} max={10000} step={100} value={options.batchSize} onChange={(e) => setOptions((o) => ({ ...o, batchSize: parseInt(e.target.value) || 1000 }))} style={{ width: 120 }} /></div>
            {fileType === 'csv' && <>
              <div><label>分隔符：</label><Input style={{ width: 80 }} value={csvOptions.delimiter} onChange={(e) => void updateCsvPreview({ ...csvOptions, delimiter: e.target.value })} /></div>
              <div><label>引号符：</label><Input style={{ width: 80 }} value={csvOptions.quote} onChange={(e) => void updateCsvPreview({ ...csvOptions, quote: e.target.value })} /></div>
              <div><Switch checked={csvOptions.columns} onChange={(v) => void updateCsvPreview({ ...csvOptions, columns: v })} /> <span style={{ marginLeft: 8 }}>{csvOptions.columns ? '首行为表头' : '首行为数据'}</span></div>
            </>}
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
                <div style={{ marginBottom: 12, color: 'var(--text-secondary)', fontSize: 12 }}>
                  {progressStage} {progress}%{progressErrors > 0 ? `，错误 ${progressErrors}` : ''}
                </div>
                <Space>
                  <Button type="primary" size="large" loading={loading} onClick={execute}>开始导入</Button>
                  {loading && <Button size="large" onClick={() => taskIdRef.current && api.importExport.cancel(taskIdRef.current)}>取消</Button>}
                </Space>
              </>
            ) : (
              <Alert type={result.success ? 'success' : 'error'} message={result.success ? '导入完成' : '导入失败'}
                description={result.success ? `${fileType === 'sql' ? '执行' : '成功导入'} ${result.imported} 条/行，${result.errors} 个错误${result.errorReportPath ? `；失败行报告：${result.errorReportPath}` : ''}` : result.message} />
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
        <Button type="primary" disabled={
          loading
          || (step === 0 && !filePath)
          || (step === 1 && fileType !== 'sql' && previewData.columns.length === 0)
          || (step === 2 && (!targetDb || (fileType !== 'sql' && !targetTable)))
          || (step === stepTitles.length - 1 && !!result)
        } onClick={() => setStep((s) => Math.min(stepTitles.length - 1, s + 1))}>下一步</Button>
      </div>
    </div>
  )
}

export default ImportWizard
