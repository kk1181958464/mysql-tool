import React, { useEffect, useState } from 'react'
import { Modal, Input, Checkbox } from '../../components/ui'
import { api } from '../../utils/ipc'
import type { ColumnInfo } from '../../../../shared/types/query'

interface Props {
  open: boolean
  onClose: () => void
  columns: ColumnInfo[]
  row: Record<string, unknown> | null
  onSaved: () => void
  connectionId: string
  database: string
  table: string
}

export const RowEditor: React.FC<Props> = ({ open, onClose, columns, row, onSaved, connectionId, database, table }) => {
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [nullFields, setNullFields] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const isEdit = !!row

  useEffect(() => {
    if (open && row) {
      setForm({ ...row })
      const nulls = new Set<string>()
      for (const [k, v] of Object.entries(row)) {
        if (v === null) nulls.add(k)
      }
      setNullFields(nulls)
    } else {
      setForm({})
      setNullFields(new Set())
    }
    setError('')
  }, [open, row])

  const handleSave = async () => {
    if (!connectionId || !database || !table) return
    const data: Record<string, unknown> = {}
    for (const col of columns) {
      data[col.name] = nullFields.has(col.name) ? null : form[col.name]
    }
    delete data._rowIndex

    try {
      if (isEdit) {
        const pk = columns.find((c) => c.primaryKey)
        if (!pk) { setError('无主键，无法更新'); return }
        await api.data.update(connectionId, database, table, data, { [pk.name]: row![pk.name] })
      } else {
        for (const col of columns) {
          if (col.autoIncrement) delete data[col.name]
        }
        await api.data.insert(connectionId, database, table, data)
      }
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || '操作失败')
    }
  }

  const toggleNull = (name: string) => {
    setNullFields((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <Modal title={isEdit ? '编辑行' : '新增行'} open={open} onClose={onClose} onOk={handleSave} width={560}>
      {error && <div style={{ color: 'var(--color-red)', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflow: 'auto' }}>
        {columns.filter((c) => c.name !== '_rowIndex').map((col) => (
          <div key={col.name}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
              {col.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{col.type}{col.nullable ? ' | NULL' : ''}</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {col.autoIncrement ? (
                <Input disabled placeholder="(Auto)" style={{ flex: 1 }} />
              ) : col.type.toUpperCase().includes('TEXT') || col.type.toUpperCase().includes('JSON') ? (
                <textarea
                  className="ui-input"
                  rows={3}
                  disabled={nullFields.has(col.name)}
                  value={String(form[col.name] ?? '')}
                  onChange={(e) => setForm({ ...form, [col.name]: e.target.value })}
                  style={{ flex: 1, resize: 'vertical' }}
                />
              ) : (
                <Input
                  disabled={nullFields.has(col.name)}
                  value={String(form[col.name] ?? '')}
                  onChange={(e) => setForm({ ...form, [col.name]: e.target.value })}
                  style={{ flex: 1 }}
                />
              )}
              {col.nullable && (
                <Checkbox checked={nullFields.has(col.name)} onChange={() => toggleNull(col.name)}>NULL</Checkbox>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
