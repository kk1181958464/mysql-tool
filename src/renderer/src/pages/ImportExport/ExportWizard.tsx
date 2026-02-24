import React, { useState } from 'react'
import { Button, Select, Card, Input, Switch, Alert, Space, Checkbox } from '../../components/ui'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void }

const ExportWizard: React.FC<Props> = ({ onBack }) => {
  const [step, setStep] = useState(0)
  const [sourceType, setSourceType] = useState<'tables' | 'sql'>('tables')
  const [selectedDb, setSelectedDb] = useState('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [customSql, setCustomSql] = useState('')
  const [format, setFormat] = useState<'csv' | 'json' | 'sql' | 'excel'>('csv')
  const [csvOptions, setCsvOptions] = useState({ delimiter: ',', quote: '"', headers: true, encoding: 'utf-8' })
  const [jsonOptions, setJsonOptions] = useState({ pretty: true, arrayMode: true })
  const [sqlOptions, setSqlOptions] = useState({ insertStyle: 'multi', dropTable: false, createTable: true })
  const [excelOptions, setExcelOptions] = useState({ sheetName: 'Sheet1' })
  const [outputPath, setOutputPath] = useState('')
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])
  const tables = useDatabaseStore((s) => connId && selectedDb ? s.tables[`${connId}:${selectedDb}`] ?? [] : [])

  const loadTables = async (db: string) => {
    setSelectedDb(db)
    if (connId) await useDatabaseStore.getState().loadTables(connId, db)
  }

  const execute = async () => {
    if (!connId || !selectedDb) return
    setLoading(true)
    setProgress(0)
    try {
      const sql = sourceType === 'sql' ? customSql : `SELECT * FROM ${selectedTables.map(t => `\`${t}\``).join(', ')}`
      await api.importExport.exportData(connId, selectedDb, sql, outputPath || `export_${Date.now()}.${format}`, format,
        format === 'csv' ? csvOptions : format === 'json' ? jsonOptions : format === 'sql' ? sqlOptions : excelOptions
      )
      setProgress(100)
      setResult({ success: true, message: `导出完成: ${outputPath || `export_${Date.now()}.${format}`}` })
    } catch (e: any) {
      setResult({ success: false, message: e.message || String(e) })
    } finally {
      setLoading(false)
    }
  }

  const stepTitles = ['选择数据源', '选择格式', '格式选项', '输出路径', '执行']

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 12, width: '100%' }}>
            <div><label>数据库：</label>
              <Select style={{ width: 300 }} value={selectedDb || undefined} onChange={loadTables} placeholder="选择数据库"
                options={databases.map((d) => ({ label: d.name, value: d.name }))} />
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <label><input type="radio" checked={sourceType === 'tables'} onChange={() => setSourceType('tables')} /> 选择表</label>
              <label><input type="radio" checked={sourceType === 'sql'} onChange={() => setSourceType('sql')} /> 自定义 SQL</label>
            </div>
            {sourceType === 'tables' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tables.map((t) => (
                  <Checkbox key={t.name} checked={selectedTables.includes(t.name)}
                    onChange={(v) => setSelectedTables((prev) => v ? [...prev, t.name] : prev.filter((x) => x !== t.name))}>
                    {t.name}
                  </Checkbox>
                ))}
              </div>
            ) : (
              <textarea value={customSql} onChange={(e) => setCustomSql(e.target.value)} placeholder="输入 SQL 查询..."
                className="ui-input" style={{ width: '100%', minHeight: 100, fontFamily: 'monospace' }} />
            )}
          </Space>
        )
      case 1:
        return (
          <div style={{ display: 'flex', gap: 16 }}>
            {(['csv', 'json', 'sql', 'excel'] as const).map((f) => (
              <div key={f} onClick={() => setFormat(f)}
                style={{ width: 100, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${format === f ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', background: format === f ? 'var(--bg-hover)' : 'transparent', fontWeight: format === f ? 600 : 400 }}>
                {f.toUpperCase()}
              </div>
            ))}
          </div>
        )
      case 2:
        return (
          <Card size="small">
            {format === 'csv' && (
              <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <div><label>分隔符：</label><Input style={{ width: 80 }} value={csvOptions.delimiter} onChange={(e) => setCsvOptions((o) => ({ ...o, delimiter: e.target.value }))} /></div>
                <div><label>引号符：</label><Input style={{ width: 80 }} value={csvOptions.quote} onChange={(e) => setCsvOptions((o) => ({ ...o, quote: e.target.value }))} /></div>
                <div><Switch checked={csvOptions.headers} onChange={(v) => setCsvOptions((o) => ({ ...o, headers: v }))} /> <span style={{ marginLeft: 8 }}>{csvOptions.headers ? '包含表头' : '无表头'}</span></div>
                <div><label>编码：</label>
                  <Select style={{ width: 150 }} value={csvOptions.encoding} onChange={(v) => setCsvOptions((o) => ({ ...o, encoding: v }))}
                    options={[{ label: 'UTF-8', value: 'utf-8' }, { label: 'GBK', value: 'gbk' }]} />
                </div>
              </Space>
            )}
            {format === 'json' && (
              <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <div><Switch checked={jsonOptions.pretty} onChange={(v) => setJsonOptions((o) => ({ ...o, pretty: v }))} /> <span style={{ marginLeft: 8 }}>{jsonOptions.pretty ? '格式化' : '压缩'}</span></div>
                <div><Switch checked={jsonOptions.arrayMode} onChange={(v) => setJsonOptions((o) => ({ ...o, arrayMode: v }))} /> <span style={{ marginLeft: 8 }}>{jsonOptions.arrayMode ? '数组模式' : '逐行对象'}</span></div>
              </Space>
            )}
            {format === 'sql' && (
              <Space style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <div><label>INSERT 风格：</label>
                  <Select style={{ width: 200 }} value={sqlOptions.insertStyle} onChange={(v) => setSqlOptions((o) => ({ ...o, insertStyle: v }))}
                    options={[{ label: '单行 INSERT', value: 'single' }, { label: '多行 INSERT', value: 'multi' }, { label: 'INSERT IGNORE', value: 'ignore' }, { label: 'REPLACE INTO', value: 'replace' }]} />
                </div>
                <div><Switch checked={sqlOptions.dropTable} onChange={(v) => setSqlOptions((o) => ({ ...o, dropTable: v }))} /> <span style={{ marginLeft: 8 }}>{sqlOptions.dropTable ? '包含 DROP TABLE' : '不含 DROP'}</span></div>
                <div><Switch checked={sqlOptions.createTable} onChange={(v) => setSqlOptions((o) => ({ ...o, createTable: v }))} /> <span style={{ marginLeft: 8 }}>{sqlOptions.createTable ? '包含 CREATE TABLE' : '不含 CREATE'}</span></div>
              </Space>
            )}
            {format === 'excel' && (
              <div><label>Sheet 名称：</label><Input style={{ width: 200 }} value={excelOptions.sheetName} onChange={(e) => setExcelOptions((o) => ({ ...o, sheetName: e.target.value }))} /></div>
            )}
          </Card>
        )
      case 3:
        return (
          <div><label>文件路径：</label><Input value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder={`export.${format}`} style={{ width: 400 }} /></div>
        )
      case 4:
        return (
          <div style={{ textAlign: 'center', padding: 24 }}>
            {!result ? (
              <>
                <div style={{ width: '100%', height: 8, background: 'var(--bg-hover)', borderRadius: 4, marginBottom: 16 }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <Button type="primary" size="large" loading={loading} onClick={execute}>开始导出</Button>
              </>
            ) : (
              <Alert type={result.success ? 'success' : 'error'} message={result.success ? '导出完成' : '导出失败'} description={result.message} />
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

export default ExportWizard
