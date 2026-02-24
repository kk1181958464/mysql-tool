import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Tag, Input, Select, Alert, Popconfirm } from '../../components/ui'
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ViewInfo } from '../../../../shared/types/metadata'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const ViewManager: React.FC = () => {
  const [views, setViews] = useState<ViewInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewSql, setViewSql] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', definition: '', algorithm: 'UNDEFINED', security: 'DEFINER' })
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const load = useCallback(async () => {
    if (!connId || !db) return
    setLoading(true)
    try {
      const res = await api.meta.views(connId, db)
      setViews(Array.isArray(res) ? res : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId, db])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setForm({ name: '', definition: '', algorithm: 'UNDEFINED', security: 'DEFINER' })
    setEditMode(false)
    setModalOpen(true)
  }

  const openEdit = (v: ViewInfo) => {
    setForm({ name: v.name, definition: v.definition, algorithm: 'UNDEFINED', security: v.security || 'DEFINER' })
    setEditMode(true)
    setModalOpen(true)
  }

  const save = async () => {
    if (!connId || !db || !form.name || !form.definition) return
    try {
      const prefix = editMode ? 'CREATE OR REPLACE' : 'CREATE'
      const sql = `${prefix} ALGORITHM=${form.algorithm} SQL SECURITY ${form.security} VIEW \`${form.name}\` AS ${form.definition}`
      await api.object.createView(connId, db, sql)
      setSuccess('视图保存成功')
      setTimeout(() => setSuccess(null), 2000)
      setModalOpen(false)
      load()
    } catch (e: any) {
      setError(e.message || '保存失败')
    }
  }

  const drop = async (name: string) => {
    await api.object.drop(connId!, db!, 'VIEW', name)
    load()
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '定义者', dataIndex: 'definer', key: 'definer', width: 180 },
    { title: '安全类型', dataIndex: 'security', key: 'security', width: 120, render: (v: string) => <Tag>{v}</Tag> },
    { title: '操作', key: 'action', width: 200, render: (_: any, r: ViewInfo) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewSql(r.definition)}>查看</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`确定删除视图 ${r.name}？`} onConfirm={() => drop(r.name)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ]

  return (
    <div>
      {error && <Alert type="error" message={error} onClose={() => setError(null)} style={{ marginBottom: 12 }} />}
      {success && <Alert type="success" message={success} style={{ marginBottom: 12 }} />}
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建视图</Button>
      </div>
      <Table dataSource={views} columns={columns} rowKey="name" loading={loading} size="small" />

      <Modal title={editMode ? '编辑视图' : '新建视图'} open={modalOpen} onClose={() => setModalOpen(false)} onOk={save} width={700}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>视图名</span><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={editMode} style={{ flex: 1 }} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select style={{ width: 200 }} value={form.algorithm} onChange={(v) => setForm((f) => ({ ...f, algorithm: v }))}
              options={[{ value: 'UNDEFINED', label: 'UNDEFINED' }, { value: 'MERGE', label: 'MERGE' }, { value: 'TEMPTABLE', label: 'TEMPTABLE' }]} />
            <Select style={{ width: 200 }} value={form.security} onChange={(v) => setForm((f) => ({ ...f, security: v }))}
              options={[{ value: 'DEFINER', label: 'DEFINER' }, { value: 'INVOKER', label: 'INVOKER' }]} />
          </div>
          <textarea className="ui-input" rows={10} value={form.definition} onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
            placeholder="SELECT ..." style={{ fontFamily: 'monospace' }} />
        </div>
      </Modal>

      <Modal title="视图定义" open={!!viewSql} onClose={() => setViewSql(null)} footer={null} width={600}>
        <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 13 }}>{viewSql}</pre>
      </Modal>
    </div>
  )
}

export default ViewManager
