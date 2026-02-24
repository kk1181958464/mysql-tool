import React, { useState, useEffect } from 'react'
import { Table, Button, Modal, Input, Select, Space, Popconfirm } from '../../components/ui'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useAppStore } from '../../stores/app.store'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import type { ForeignKeyDesign, ColumnDesign } from '../../../../shared/types/table-design'

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION', 'SET DEFAULT'] as const

interface Props {
  foreignKeys: ForeignKeyDesign[]
  columns: ColumnDesign[]
  onChange: (fks: ForeignKeyDesign[]) => void
}

export const ForeignKeyEditor: React.FC<Props> = ({ foreignKeys, columns, onChange }) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', columns: [] as string[], referencedTable: '', referencedColumns: [] as string[], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' })
  const { selectedDatabase } = useAppStore()
  const { activeConnectionId } = useConnectionStore()
  const { tables, loadTables } = useDatabaseStore()

  const tableKey = `${activeConnectionId}:${selectedDatabase}`
  const tableList = tables[tableKey] || []

  useEffect(() => {
    if (activeConnectionId && selectedDatabase) loadTables(activeConnectionId, selectedDatabase)
  }, [activeConnectionId, selectedDatabase])

  const colOptions = columns.map((c) => ({ value: c.name, label: c.name }))
  const tableOptions = tableList.map((t) => ({ value: t.name, label: t.name }))
  const actionOptions = FK_ACTIONS.map((a) => ({ value: a, label: a }))

  const openNew = () => {
    setEditingIdx(null)
    setForm({ name: '', columns: [], referencedTable: '', referencedColumns: [], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' })
    setModalOpen(true)
  }

  const openEdit = (i: number) => {
    setEditingIdx(i)
    const fk = foreignKeys[i]
    setForm({ name: fk.name, columns: fk.columns, referencedTable: fk.referencedTable, referencedColumns: fk.referencedColumns, onUpdate: fk.onUpdate, onDelete: fk.onDelete })
    setModalOpen(true)
  }

  const handleSave = () => {
    if (!form.name || form.columns.length === 0 || !form.referencedTable) return
    const fk: ForeignKeyDesign = {
      name: form.name, columns: form.columns, referencedTable: form.referencedTable,
      referencedColumns: form.referencedColumns, onUpdate: form.onUpdate as ForeignKeyDesign['onUpdate'], onDelete: form.onDelete as ForeignKeyDesign['onDelete'],
    }
    if (editingIdx !== null) {
      const next = [...foreignKeys]; next[editingIdx] = fk; onChange(next)
    } else {
      onChange([...foreignKeys, fk])
    }
    setModalOpen(false)
  }

  const remove = (i: number) => onChange(foreignKeys.filter((_, idx) => idx !== i))

  return (
    <div>
      <Button size="small" icon={<PlusOutlined />} onClick={openNew} style={{ marginBottom: 8 }}>添加外键</Button>
      <Table size="small" dataSource={foreignKeys.map((fk, i) => ({ ...fk, _key: i }))} rowKey="_key"
        columns={[
          { title: '名称', dataIndex: 'name', width: 140 },
          { title: '列', dataIndex: 'columns', render: (v: string[]) => v.join(', '), width: 120 },
          { title: '引用表', dataIndex: 'referencedTable', width: 120 },
          { title: '引用列', dataIndex: 'referencedColumns', render: (v: string[]) => v.join(', '), width: 120 },
          { title: 'ON UPDATE', dataIndex: 'onUpdate', width: 100 },
          { title: 'ON DELETE', dataIndex: 'onDelete', width: 100 },
          { title: '', width: 80, render: (_: any, __: any, i: number) => (
            <Space>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(i)} />
              <Popconfirm title="确定删除？" onConfirm={() => remove(i)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>
            </Space>
          )},
        ]}
      />
      <Modal title={editingIdx !== null ? '编辑外键' : '添加外键'} open={modalOpen} onClose={() => setModalOpen(false)} onOk={handleSave}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><label>名称</label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
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
          <div><label>引用表</label><Select value={form.referencedTable || undefined} onChange={(v) => setForm((f) => ({ ...f, referencedTable: v }))} options={tableOptions} placeholder="选择表" /></div>
          <div><label>引用列</label><Input value={form.referencedColumns.join(',')} onChange={(e) => setForm((f) => ({ ...f, referencedColumns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} placeholder="逗号分隔" /></div>
          <div><label>ON UPDATE</label><Select value={form.onUpdate} onChange={(v) => setForm((f) => ({ ...f, onUpdate: v }))} options={actionOptions} /></div>
          <div><label>ON DELETE</label><Select value={form.onDelete} onChange={(v) => setForm((f) => ({ ...f, onDelete: v }))} options={actionOptions} /></div>
        </div>
      </Modal>
    </div>
  )
}
