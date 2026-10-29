import React, { useState } from 'react'
import { Button, Modal, Input, Select, Popconfirm } from '../../components/ui'
import { PlusOutlined, EditOutlined, DeleteOutlined, NodeIndexOutlined, CloseOutlined } from '@ant-design/icons'
import { FormField } from '../ConnectionManager/FormField'
import type { IndexDesign, ColumnDesign } from '../../../../shared/types/table-design'

interface Props {
  indexes: IndexDesign[]
  columns: ColumnDesign[]
  onChange: (indexes: IndexDesign[]) => void
}

type IndexColumn = IndexDesign['columns'][number]

const TYPE_OPTIONS = ['INDEX', 'UNIQUE', 'FULLTEXT', 'SPATIAL'].map((v) => ({ value: v, label: v }))
const METHOD_OPTIONS = ['BTREE', 'HASH'].map((v) => ({ value: v, label: v }))
const TYPE_LABEL: Record<string, string> = { INDEX: '普通', UNIQUE: '唯一', FULLTEXT: '全文', SPATIAL: '空间' }

const emptyForm = { name: '', type: 'INDEX' as IndexDesign['type'], method: 'BTREE' as IndexDesign['method'], columns: [] as IndexColumn[], comment: '' }

const suggestName = (type: string, cols: IndexColumn[]) =>
  cols.length ? `${type === 'UNIQUE' ? 'uk' : type === 'FULLTEXT' ? 'ft' : 'idx'}_${cols.map((c) => c.name).join('_')}`.slice(0, 64) : ''

export const IndexEditor: React.FC<Props> = ({ indexes, columns, onChange }) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [nameTouched, setNameTouched] = useState(false)
  const [formError, setFormError] = useState('')

  const openNew = () => {
    setEditingIdx(null)
    setForm(emptyForm)
    setNameTouched(false)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (i: number) => {
    const idx = indexes[i]
    setEditingIdx(i)
    setForm({ name: idx.name, type: idx.type, method: idx.method, columns: idx.columns.map((c) => ({ ...c })), comment: idx.comment || '' })
    setNameTouched(true)
    setFormError('')
    setModalOpen(true)
  }

  const setColumns = (cols: IndexColumn[]) => {
    setForm((f) => ({ ...f, columns: cols, name: nameTouched ? f.name : suggestName(f.type, cols) }))
  }

  const toggleColumn = (name: string) => {
    const has = form.columns.some((c) => c.name === name)
    setColumns(has ? form.columns.filter((c) => c.name !== name) : [...form.columns, { name, order: 'ASC' }])
  }

  const handleSave = () => {
    const name = form.name.trim()
    if (!name) { setFormError('请输入索引名称'); return }
    if (form.columns.length === 0) { setFormError('请至少选择一个字段'); return }
    if (indexes.some((x, i) => i !== editingIdx && x.name.toLowerCase() === name.toLowerCase())) { setFormError(`索引 "${name}" 已存在`); return }
    const idx: IndexDesign = { name, type: form.type, method: form.method, columns: form.columns, comment: form.comment }
    if (editingIdx !== null) {
      const next = [...indexes]; next[editingIdx] = idx; onChange(next)
    } else {
      onChange([...indexes, idx])
    }
    setModalOpen(false)
  }

  const remove = (i: number) => onChange(indexes.filter((_, idx) => idx !== i))
  const pkCols = columns.filter((c) => c.primaryKey).map((c) => c.name)

  return (
    <div className="td-panel">
      <div className="td-toolbar">
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openNew} disabled={!columns.length}>添加索引</Button>
        <span className="td-toolbar-tip">{columns.length ? '主键在「字段」中设置；这里管理其余索引' : '请先添加字段'}</span>
      </div>

      <div className="td-card-list">
        {pkCols.length > 0 && (
          <div className="td-card td-card-static">
            <div className="td-card-main">
              <div className="td-card-title">
                <span className="td-badge td-badge-pk">主键</span>
                <span className="td-card-name">PRIMARY</span>
              </div>
              <div className="td-chips">{pkCols.map((c) => <span key={c} className="td-col-chip">{c}</span>)}</div>
            </div>
          </div>
        )}
        {indexes.map((idx, i) => (
          <div key={`${idx.name}-${i}`} className="td-card" onDoubleClick={() => openEdit(i)}>
            <div className="td-card-main">
              <div className="td-card-title">
                <span className={`td-badge td-badge-${idx.type.toLowerCase()}`}>{TYPE_LABEL[idx.type] ?? idx.type}</span>
                <span className="td-card-name">{idx.name}</span>
                <span className="td-card-sub">{idx.method}</span>
              </div>
              <div className="td-chips">
                {idx.columns.map((c, k) => (
                  <span key={c.name} className="td-col-chip">
                    <em>{k + 1}</em>{c.name}{c.length ? `(${c.length})` : ''}{c.order === 'DESC' ? ' ↓' : ''}
                  </span>
                ))}
              </div>
              {idx.comment && <div className="td-card-desc">{idx.comment}</div>}
            </div>
            <div className="td-card-actions">
              <Button size="small" variant="text" icon={<EditOutlined />} onClick={() => openEdit(i)} />
              <Popconfirm title={`删除索引 ${idx.name}？`} onConfirm={() => remove(i)}>
                <Button size="small" variant="text" className="danger-text-btn" icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        ))}
        {indexes.length === 0 && (
          <div className="td-empty td-empty-sm">
            <NodeIndexOutlined className="td-empty-icon" />
            <div className="td-empty-title">暂无其他索引</div>
            <div className="td-empty-desc">为常用于查询条件、排序或关联的字段建立索引可以加快查询</div>
          </div>
        )}
      </div>

      <Modal title={editingIdx !== null ? '编辑索引' : '添加索引'} open={modalOpen} width={560} onClose={() => setModalOpen(false)} onOk={handleSave}>
        <div className="cm-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <FormField label="索引名称" required span={2}>
            <Input value={form.name} spellCheck={false} onChange={(e) => { setNameTouched(true); setForm((f) => ({ ...f, name: e.target.value })) }} placeholder="选择字段后自动生成" />
          </FormField>
          <FormField label="类型">
            <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v as IndexDesign['type'], name: nameTouched ? f.name : suggestName(v as string, f.columns) }))} options={TYPE_OPTIONS} style={{ width: '100%' }} />
          </FormField>
          <FormField label="方法">
            <Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v as IndexDesign['method'] }))} options={METHOD_OPTIONS} style={{ width: '100%' }} />
          </FormField>
          <FormField label="字段" required span={2} hint="按点击顺序组成联合索引，顺序会影响索引能否命中">
            <div className="td-pick">
              {columns.filter((c) => c.name).map((c) => {
                const pos = form.columns.findIndex((x) => x.name === c.name)
                return (
                  <button key={c.name} type="button" className={`td-pick-item ${pos >= 0 ? 'active' : ''}`} onClick={() => toggleColumn(c.name)}>
                    {pos >= 0 && <em>{pos + 1}</em>}{c.name}
                  </button>
                )
              })}
            </div>
          </FormField>
          {form.columns.length > 0 && (
            <FormField label="字段设置" span={2}>
              <div className="td-order-list">
                {form.columns.map((c, k) => (
                  <div key={c.name} className="td-order-row">
                    <em>{k + 1}</em>
                    <span className="td-order-name">{c.name}</span>
                    <Input size="small" className="td-len-input" value={c.length ? String(c.length) : ''} placeholder="前缀长度"
                      onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setColumns(form.columns.map((x, j) => (j === k ? { ...x, length: v ? Number(v) : undefined } : x))) }} />
                    <Select size="small" style={{ width: 84 }} value={c.order} options={[{ value: 'ASC', label: 'ASC' }, { value: 'DESC', label: 'DESC' }]}
                      onChange={(v) => setColumns(form.columns.map((x, j) => (j === k ? { ...x, order: v as 'ASC' | 'DESC' } : x)))} />
                    <button type="button" className="td-order-remove" title="移除" onClick={() => toggleColumn(c.name)}><CloseOutlined /></button>
                  </div>
                ))}
              </div>
            </FormField>
          )}
          <FormField label="注释" span={2}>
            <Input value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
          </FormField>
        </div>
        {formError && <div className="td-form-error">{formError}</div>}
      </Modal>
    </div>
  )
}
