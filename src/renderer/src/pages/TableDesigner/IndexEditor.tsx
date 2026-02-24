import React, { useState } from 'react'
import { Table, Button, Modal, Input, Select, Space, Popconfirm } from '../../components/ui'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { IndexDesign, ColumnDesign } from '../../../../shared/types/table-design'

interface Props {
  indexes: IndexDesign[]
  columns: ColumnDesign[]
  onChange: (indexes: IndexDesign[]) => void
}

export const IndexEditor: React.FC<Props> = ({ indexes, columns, onChange }) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', type: 'INDEX', method: 'BTREE', columns: [] as string[], comment: '' })

  const openNew = () => {
    setEditingIdx(null)
    setForm({ name: '', type: 'INDEX', method: 'BTREE', columns: [], comment: '' })
    setModalOpen(true)
  }

  const openEdit = (i: number) => {
    setEditingIdx(i)
    const idx = indexes[i]
    setForm({ name: idx.name, type: idx.type, method: idx.method, columns: idx.columns.map((c) => c.name), comment: idx.comment || '' })
    setModalOpen(true)
  }

  const handleSave = () => {
    if (!form.name || form.columns.length === 0) return
    const idx: IndexDesign = {
      name: form.name, type: form.type as IndexDesign['type'], method: form.method as IndexDesign['method'],
      columns: form.columns.map((name) => ({ name, order: 'ASC' as const })), comment: form.comment,
    }
    if (editingIdx !== null) {
      const next = [...indexes]; next[editingIdx] = idx; onChange(next)
    } else {
      onChange([...indexes, idx])
    }
    setModalOpen(false)
  }

  const remove = (i: number) => onChange(indexes.filter((_, idx) => idx !== i))
  const colOptions = columns.map((c) => ({ value: c.name, label: c.name }))

  return (
    <div>
      <Button size="small" icon={<PlusOutlined />} onClick={openNew} style={{ marginBottom: 8 }}>添加索引</Button>
      <Table size="small" dataSource={indexes.map((idx, i) => ({ ...idx, _key: i }))} rowKey="_key"
        columns={[
          { title: '名称', dataIndex: 'name', width: 160 },
          { title: '类型', dataIndex: 'type', width: 100 },
          { title: '方法', dataIndex: 'method', width: 80 },
          { title: '列', dataIndex: 'columns', render: (v: IndexDesign['columns']) => v.map((c) => c.name).join(', ') },
          { title: '注释', dataIndex: 'comment', width: 140 },
          { title: '', width: 80, render: (_: any, __: any, i: number) => (
            <Space>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(i)} />
              <Popconfirm title="确定删除？" onConfirm={() => remove(i)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>
            </Space>
          )},
        ]}
      />
      <Modal title={editingIdx !== null ? '编辑索引' : '添加索引'} open={modalOpen} onClose={() => setModalOpen(false)} onOk={handleSave}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label>名称</label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div><label>类型</label><Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} options={[{ value: 'INDEX', label: 'INDEX' }, { value: 'UNIQUE', label: 'UNIQUE' }, { value: 'FULLTEXT', label: 'FULLTEXT' }, { value: 'SPATIAL', label: 'SPATIAL' }]} /></div>
          <div><label>方法</label><Select value={form.method} onChange={(v) => setForm((f) => ({ ...f, method: v }))} options={[{ value: 'BTREE', label: 'BTREE' }, { value: 'HASH', label: 'HASH' }]} /></div>
          <div><label>列</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {colOptions.map((o) => (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={form.columns.includes(o.value)} onChange={(e) => setForm((f) => ({ ...f, columns: e.target.checked ? [...f.columns, o.value] : f.columns.filter((c) => c !== o.value) }))} />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
          <div><label>注释</label><Input value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} /></div>
        </div>
      </Modal>
    </div>
  )
}
