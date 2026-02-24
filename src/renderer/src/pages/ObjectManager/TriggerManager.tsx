import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Tag, Input, Select, Alert, Popconfirm } from '../../components/ui'
import { PlusOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons'
import type { TriggerInfo } from '../../../../shared/types/metadata'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

const TriggerManager: React.FC = () => {
  const [triggers, setTriggers] = useState<TriggerInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewSql, setViewSql] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', table: '', timing: 'BEFORE', event: 'INSERT', body: '' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)
  const tables = useDatabaseStore((s) => connId && db ? s.tables[`${connId}:${db}`] ?? [] : [])

  const load = useCallback(async () => {
    if (!connId || !db) return
    setLoading(true)
    try {
      const res = await api.meta.triggers(connId, db)
      setTriggers(Array.isArray(res) ? res : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId, db])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (connId && db) useDatabaseStore.getState().loadTables(connId, db) }, [connId, db])

  const save = async () => {
    if (!connId || !db || !form.name || !form.table || !form.body) return
    try {
      const sql = `CREATE TRIGGER \`${form.name}\` ${form.timing} ${form.event} ON \`${form.table}\` FOR EACH ROW\nBEGIN\n${form.body}\nEND`
      await api.object.createTrigger(connId, db, sql)
      setSuccess('触发器创建成功'); setTimeout(() => setSuccess(null), 2000)
      setModalOpen(false); load()
    } catch (e: any) { setError(e.message || '创建失败') }
  }

  const drop = async (name: string) => { await api.object.drop(connId!, db!, 'TRIGGER', name); load() }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '事件', dataIndex: 'event', key: 'event', width: 100, render: (v: string) => <Tag type="primary">{v}</Tag> },
    { title: '时机', dataIndex: 'timing', key: 'timing', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '表', dataIndex: 'table', key: 'table', width: 150 },
    { title: '定义者', dataIndex: 'definer', key: 'definer', width: 160 },
    { title: '操作', key: 'action', width: 160, render: (_: any, r: TriggerInfo) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewSql(r.statement)}>查看</Button>
        <Popconfirm title={`确定删除触发器 ${r.name}？`} onConfirm={() => drop(r.name)}>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setForm({ name: '', table: '', timing: 'BEFORE', event: 'INSERT', body: '' }); setModalOpen(true) }}>新建触发器</Button>
      </div>
      <Table dataSource={triggers} columns={columns} rowKey="name" loading={loading} size="small" />

      <Modal title="新建触发器" open={modalOpen} onClose={() => setModalOpen(false)} onOk={save} width={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>名称</span><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select style={{ flex: 1 }} value={form.table || undefined} onChange={(v) => setForm((f) => ({ ...f, table: v }))} placeholder="选择表"
              options={tables.map((t) => ({ value: t.name, label: t.name }))} />
            <Select style={{ width: 120 }} value={form.timing} onChange={(v) => setForm((f) => ({ ...f, timing: v }))}
              options={[{ value: 'BEFORE', label: 'BEFORE' }, { value: 'AFTER', label: 'AFTER' }]} />
            <Select style={{ width: 120 }} value={form.event} onChange={(v) => setForm((f) => ({ ...f, event: v }))}
              options={[{ value: 'INSERT', label: 'INSERT' }, { value: 'UPDATE', label: 'UPDATE' }, { value: 'DELETE', label: 'DELETE' }]} />
          </div>
          <textarea className="ui-input" rows={10} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="-- 触发器体 (不含 BEGIN/END)" style={{ fontFamily: 'monospace' }} />
        </div>
      </Modal>

      <Modal title="触发器代码" open={!!viewSql} onClose={() => setViewSql(null)} footer={null} width={600}>
        <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 13 }}>{viewSql}</pre>
      </Modal>
    </div>
  )
}

export default TriggerManager
