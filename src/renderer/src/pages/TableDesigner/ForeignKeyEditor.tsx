import React, { useState, useEffect } from 'react'
import { Button, Modal, Input, Select, Popconfirm } from '../../components/ui'
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { FormField } from '../ConnectionManager/FormField'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'
import type { ForeignKeyDesign, ColumnDesign } from '../../../../shared/types/table-design'

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'] as const
const ACTION_OPTIONS = FK_ACTIONS.map((a) => ({ value: a, label: a }))

interface Props {
  connectionId: string
  database: string
  tableName: string
  foreignKeys: ForeignKeyDesign[]
  columns: ColumnDesign[]
  onChange: (fks: ForeignKeyDesign[]) => void
}

interface FormState {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onUpdate: ForeignKeyDesign['onUpdate']
  onDelete: ForeignKeyDesign['onDelete']
}

const emptyForm: FormState = { name: '', columns: [], referencedTable: '', referencedColumns: [], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }

export const ForeignKeyEditor: React.FC<Props> = ({ connectionId, database, tableName, foreignKeys, columns, onChange }) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [nameTouched, setNameTouched] = useState(false)
  const [formError, setFormError] = useState('')
  const [refColumns, setRefColumns] = useState<{ name: string; primaryKey: boolean }[]>([])
  const tables = useDatabaseStore((s) => s.tables[`${connectionId}:${database}`])
  const loadTables = useDatabaseStore((s) => s.loadTables)

  useEffect(() => { loadTables(connectionId, database) }, [connectionId, database])

  useEffect(() => {
    if (!modalOpen || !form.referencedTable) { setRefColumns([]); return }
    let cancelled = false
    const local = form.referencedTable === tableName
      ? Promise.resolve(columns.map((c) => ({ name: c.name, primaryKey: c.primaryKey })))
      : api.meta.columns(connectionId, database, form.referencedTable).then((cols) => cols.map((c) => ({ name: c.name, primaryKey: c.primaryKey })))
    local.then((cols) => { if (!cancelled) setRefColumns(cols) }).catch(() => { if (!cancelled) setRefColumns([]) })
    return () => { cancelled = true }
  }, [modalOpen, form.referencedTable, connectionId, database])

  // 引用列与本表列一一对应；未选的位置优先匹配同名列，其次是主键
  useEffect(() => {
    if (!refColumns.length) return
    setForm((f) => {
      const names = new Set(refColumns.map((c) => c.name))
      const pk = refColumns.find((c) => c.primaryKey)?.name ?? ''
      const next = f.columns.map((col, i) => {
        const cur = f.referencedColumns[i]
        if (cur && names.has(cur)) return cur
        return names.has(col) ? col : pk
      })
      return next.join(',') === f.referencedColumns.join(',') ? f : { ...f, referencedColumns: next }
    })
  }, [refColumns, form.columns])

  const tableOptions = [
    ...(tableName && !(tables ?? []).some((t) => t.name === tableName) ? [{ value: tableName, label: `${tableName}（本表）` }] : []),
    ...(tables ?? []).map((t) => ({ value: t.name, label: t.name === tableName ? `${t.name}（本表）` : t.name })),
  ]

  const suggest = (cols: string[], ref: string) => (cols.length && ref ? `fk_${tableName || 'tbl'}_${cols.join('_')}`.slice(0, 64) : '')

  const update = (patch: Partial<FormState>) => {
    setForm((f) => {
      const next = { ...f, ...patch }
      if (!nameTouched) next.name = suggest(next.columns, next.referencedTable)
      return next
    })
  }

  const openNew = () => {
    setEditingIdx(null)
    setForm(emptyForm)
    setNameTouched(false)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (i: number) => {
    const fk = foreignKeys[i]
    setEditingIdx(i)
    setForm({ name: fk.name, columns: [...fk.columns], referencedTable: fk.referencedTable, referencedColumns: [...fk.referencedColumns], onUpdate: fk.onUpdate, onDelete: fk.onDelete })
    setNameTouched(true)
    setFormError('')
    setModalOpen(true)
  }

  const toggleColumn = (name: string) => {
    const i = form.columns.indexOf(name)
    if (i >= 0) update({ columns: form.columns.filter((_, k) => k !== i), referencedColumns: form.referencedColumns.filter((_, k) => k !== i) })
    else update({ columns: [...form.columns, name] })
  }

  const handleSave = () => {
    const name = form.name.trim()
    if (!name) { setFormError('请输入外键名称'); return }
    if (!form.columns.length) { setFormError('请至少选择一个本表字段'); return }
    if (!form.referencedTable) { setFormError('请选择引用表'); return }
    if (form.referencedColumns.length !== form.columns.length || form.referencedColumns.some((c) => !c)) { setFormError('请为每个字段选择对应的引用字段'); return }
    if (foreignKeys.some((x, i) => i !== editingIdx && x.name.toLowerCase() === name.toLowerCase())) { setFormError(`外键 "${name}" 已存在`); return }
    const fk: ForeignKeyDesign = { ...form, name }
    if (editingIdx !== null) {
      const next = [...foreignKeys]; next[editingIdx] = fk; onChange(next)
    } else {
      onChange([...foreignKeys, fk])
    }
    setModalOpen(false)
  }

  const remove = (i: number) => onChange(foreignKeys.filter((_, idx) => idx !== i))
  const refOptions = refColumns.map((c) => ({ value: c.name, label: c.primaryKey ? `${c.name}（主键）` : c.name }))

  return (
    <div className="td-panel">
      <div className="td-toolbar">
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openNew} disabled={!columns.length}>添加外键</Button>
        <span className="td-toolbar-tip">外键要求两张表均为 InnoDB，且字段类型一致</span>
      </div>

      <div className="td-card-list">
        {foreignKeys.map((fk, i) => (
          <div key={`${fk.name}-${i}`} className="td-card" onDoubleClick={() => openEdit(i)}>
            <div className="td-card-main">
              <div className="td-card-title">
                <span className="td-badge td-badge-fk">外键</span>
                <span className="td-card-name">{fk.name}</span>
              </div>
              <div className="td-fk-map">
                <span className="td-chips">{fk.columns.map((c) => <span key={c} className="td-col-chip">{c}</span>)}</span>
                <ArrowRightOutlined className="td-fk-arrow" />
                <span className="td-fk-target">{fk.referencedTable}</span>
                <span className="td-chips">{fk.referencedColumns.map((c) => <span key={c} className="td-col-chip">{c}</span>)}</span>
              </div>
              <div className="td-card-desc">ON UPDATE {fk.onUpdate} · ON DELETE {fk.onDelete}</div>
            </div>
            <div className="td-card-actions">
              <Button size="small" variant="text" icon={<EditOutlined />} onClick={() => openEdit(i)} />
              <Popconfirm title={`删除外键 ${fk.name}？`} onConfirm={() => remove(i)}>
                <Button size="small" variant="text" className="danger-text-btn" icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        ))}
        {foreignKeys.length === 0 && (
          <div className="td-empty td-empty-sm">
            <LinkOutlined className="td-empty-icon" />
            <div className="td-empty-title">暂无外键</div>
            <div className="td-empty-desc">外键用于约束本表字段必须引用另一张表中已存在的值</div>
          </div>
        )}
      </div>

      <Modal title={editingIdx !== null ? '编辑外键' : '添加外键'} open={modalOpen} width={580} onClose={() => setModalOpen(false)} onOk={handleSave}>
        <div className="cm-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <FormField label="外键名称" required span={2}>
            <Input value={form.name} spellCheck={false} onChange={(e) => { setNameTouched(true); setForm((f) => ({ ...f, name: e.target.value })) }} placeholder="选择字段和引用表后自动生成" />
          </FormField>
          <FormField label="本表字段" required span={2}>
            <div className="td-pick">
              {columns.filter((c) => c.name).map((c) => {
                const pos = form.columns.indexOf(c.name)
                return (
                  <button key={c.name} type="button" className={`td-pick-item ${pos >= 0 ? 'active' : ''}`} onClick={() => toggleColumn(c.name)}>
                    {pos >= 0 && <em>{pos + 1}</em>}{c.name}
                  </button>
                )
              })}
            </div>
          </FormField>
          <FormField label="引用表" required span={2}>
            <Select value={form.referencedTable || undefined} onChange={(v) => update({ referencedTable: v as string, referencedColumns: [] })} options={tableOptions} placeholder="选择表" style={{ width: '100%' }} />
          </FormField>
          {form.columns.length > 0 && form.referencedTable && (
            <FormField label="字段对应" required span={2}>
              <div className="td-order-list">
                {form.columns.map((c, k) => (
                  <div key={c} className="td-order-row">
                    <span className="td-order-name">{c}</span>
                    <ArrowRightOutlined className="td-fk-arrow" />
                    <Select size="small" style={{ flex: 1 }} value={form.referencedColumns[k] || undefined} placeholder={refColumns.length ? '选择引用字段' : '加载中…'} options={refOptions}
                      onChange={(v) => setForm((f) => { const next = [...f.referencedColumns]; next[k] = v as string; return { ...f, referencedColumns: next } })} />
                  </div>
                ))}
              </div>
            </FormField>
          )}
          <FormField label="ON UPDATE">
            <Select value={form.onUpdate} onChange={(v) => setForm((f) => ({ ...f, onUpdate: v as FormState['onUpdate'] }))} options={ACTION_OPTIONS} style={{ width: '100%' }} />
          </FormField>
          <FormField label="ON DELETE">
            <Select value={form.onDelete} onChange={(v) => setForm((f) => ({ ...f, onDelete: v as FormState['onDelete'] }))} options={ACTION_OPTIONS} style={{ width: '100%' }} />
          </FormField>
        </div>
        {formError && <div className="td-form-error">{formError}</div>}
      </Modal>
    </div>
  )
}
