import React, { useState } from 'react'
import { Modal, Select, Switch, Input, Button, Space } from '../../components/ui'
import { api } from '../../utils/ipc'

interface Props {
  open: boolean
  onClose: () => void
  connectionId: string
  database: string
  table: string
}

export const DataExport: React.FC<Props> = ({ open, onClose, connectionId, database, table }) => {
  const [form, setForm] = useState({
    format: 'csv',
    includeHeaders: true,
    delimiter: ',',
    prettyPrint: true,
    rowRange: 'all',
    where: '',
    limit: 1000,
    offset: 0,
  })
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const handleExport = async () => {
    if (!connectionId || !database || !table) return
    setExporting(true)
    setError('')
    try {
      const sql = `SELECT * FROM \`${table}\`${form.where ? ` WHERE ${form.where}` : ''}${form.rowRange === 'custom' ? ` LIMIT ${form.limit} OFFSET ${form.offset}` : ''}`
      await api.importExport.exportData(connectionId, database, sql, '', form.format, {
        includeHeaders: form.includeHeaders,
        delimiter: form.delimiter,
        prettyPrint: form.prettyPrint,
      })
      onClose()
    } catch (e: any) {
      setError(e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal title="导出数据" open={open} onClose={onClose} footer={null} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div style={{ color: 'var(--color-red)' }}>{error}</div>}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>格式</label>
          <Select
            value={form.format}
            onChange={(v) => setForm({ ...form, format: v as string })}
            options={[
              { value: 'csv', label: 'CSV' },
              { value: 'json', label: 'JSON' },
              { value: 'sql', label: 'SQL INSERT' },
              { value: 'excel', label: 'Excel' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
        {form.format === 'csv' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={form.includeHeaders} onChange={(v) => setForm({ ...form, includeHeaders: v })} />
              <span>包含表头</span>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>分隔符</label>
              <Select
                value={form.delimiter}
                onChange={(v) => setForm({ ...form, delimiter: v as string })}
                options={[{ value: ',', label: '逗号' }, { value: '\t', label: 'Tab' }, { value: ';', label: '分号' }]}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}
        {form.format === 'json' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={form.prettyPrint} onChange={(v) => setForm({ ...form, prettyPrint: v })} />
            <span>格式化输出</span>
          </div>
        )}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>行范围</label>
          <Select
            value={form.rowRange}
            onChange={(v) => setForm({ ...form, rowRange: v as string })}
            options={[
              { value: 'all', label: '全部' },
              { value: 'current', label: '当前页' },
              { value: 'custom', label: '自定义' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
        {form.rowRange === 'custom' && (
          <Space>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>起始行</label>
              <Input type="number" value={String(form.offset)} onChange={(e) => setForm({ ...form, offset: Number(e.target.value) })} style={{ width: 100 }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>行数</label>
              <Input type="number" value={String(form.limit)} onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })} style={{ width: 100 }} />
            </div>
          </Space>
        )}
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>WHERE 条件</label>
          <Input value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} placeholder="可选过滤条件" />
        </div>
        <Button type="primary" onClick={handleExport} disabled={exporting}>
          {exporting ? '导出中...' : '导出'}
        </Button>
      </div>
    </Modal>
  )
}
