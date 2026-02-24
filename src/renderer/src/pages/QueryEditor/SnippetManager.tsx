import React, { useEffect, useState } from 'react'
import { Modal, Input, Button, Space, Tag, Select, Empty, Popconfirm } from '../../components/ui'
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { api } from '../../utils/ipc'
import type { Snippet } from '../../../../shared/types/query'
import { v4 as uuid } from 'uuid'

interface Props {
  open: boolean
  onClose: () => void
  onInsert: (sql: string) => void
}

const CATEGORIES = ['DQL', 'DML', 'DDL', 'Custom']

export const SnippetManager: React.FC<Props> = ({ open, onClose, onInsert }) => {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'Custom', description: '', sqlText: '' })

  const load = async () => {
    try {
      const list = await api.store.getSnippets()
      setSnippets(list || [])
    } catch {
      setSnippets([])
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const filtered = snippets.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.sqlText.toLowerCase().includes(search.toLowerCase())
  )

  const handleSave = async () => {
    if (!form.name || !form.sqlText) return
    const snippet: Snippet = {
      id: editing?.id || uuid(),
      name: form.name,
      category: form.category,
      sqlText: form.sqlText,
      description: form.description || '',
      createdAt: editing?.createdAt || new Date().toISOString(),
    }
    await api.store.saveSnippet(snippet)
    setFormOpen(false)
    setEditing(null)
    setForm({ name: '', category: 'Custom', description: '', sqlText: '' })
    load()
  }

  const handleDelete = async (id: string) => {
    const remaining = snippets.filter((s) => s.id !== id)
    for (const s of remaining) {
      await api.store.saveSnippet(s)
    }
    load()
  }

  const openEdit = (s: Snippet) => {
    setEditing(s)
    setForm({ name: s.name, category: s.category, description: s.description, sqlText: s.sqlText })
    setFormOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', category: 'Custom', description: '', sqlText: '' })
    setFormOpen(true)
  }

  return (
    <Modal title="代码片段" open={open} onClose={onClose} width={640} footer={null}>
      <Space style={{ marginBottom: 12, width: '100%' }}>
        <Input
          placeholder="搜索片段..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 300 }}
        />
        <Button onClick={openNew}><PlusOutlined /> 新建</Button>
      </Space>

      {formOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>名称 *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>分类 *</label>
            <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>描述</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SQL *</label>
            <textarea
              className="ui-input"
              rows={6}
              style={{ fontFamily: 'monospace', width: '100%', resize: 'vertical' }}
              value={form.sqlText}
              onChange={(e) => setForm({ ...form, sqlText: e.target.value })}
            />
          </div>
          <Space>
            <Button type="primary" onClick={handleSave}>保存</Button>
            <Button onClick={() => { setFormOpen(false); setEditing(null) }}>取消</Button>
          </Space>
        </div>
      ) : filtered.length === 0 ? (
        <Empty description="暂无片段" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((item) => (
            <div
              key={item.id}
              style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => onInsert(item.sqlText)}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{item.name} <Tag>{item.category}</Tag></div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {item.sqlText.substring(0, 80)}{item.sqlText.length > 80 ? '...' : ''}
                </div>
              </div>
              <Space>
                <Button size="small" onClick={(e) => { e.stopPropagation(); openEdit(item) }}><EditOutlined /></Button>
                <Popconfirm title="确定删除？" onConfirm={() => handleDelete(item.id)}>
                  <Button size="small" type="danger" onClick={(e) => e.stopPropagation()}><DeleteOutlined /></Button>
                </Popconfirm>
              </Space>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
