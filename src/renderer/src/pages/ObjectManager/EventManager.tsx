import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Tag, Input, Select, Switch, Alert, Popconfirm } from '../../components/ui'
import { PlusOutlined, EyeOutlined, DeleteOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { EventInfo } from '../../../../shared/types/metadata'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const UNITS = ['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']

const EventManager: React.FC = () => {
  const [events, setEvents] = useState<EventInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewSql, setViewSql] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', type: 'RECURRING' as 'ONE TIME' | 'RECURRING', atDatetime: '', everyInterval: 1, everyUnit: 'DAY', starts: '', ends: '', body: '', enabled: true })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const load = useCallback(async () => {
    if (!connId || !db) return
    setLoading(true)
    try {
      const res = await api.meta.events(connId, db)
      setEvents(Array.isArray(res) ? res : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId, db])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!connId || !db || !form.name || !form.body) return
    try {
      let schedule: string
      if (form.type === 'ONE TIME') {
        schedule = `AT '${form.atDatetime}'`
      } else {
        schedule = `EVERY ${form.everyInterval} ${form.everyUnit}`
        if (form.starts) schedule += ` STARTS '${form.starts}'`
        if (form.ends) schedule += ` ENDS '${form.ends}'`
      }
      const sql = `CREATE EVENT \`${form.name}\` ON SCHEDULE ${schedule} ${form.enabled ? 'ENABLE' : 'DISABLE'} DO\nBEGIN\n${form.body}\nEND`
      await api.object.createEvent(connId, db, sql)
      setSuccess('事件创建成功'); setTimeout(() => setSuccess(null), 2000)
      setModalOpen(false); load()
    } catch (e: any) { setError(e.message || '创建失败') }
  }

  const toggleEvent = async (name: string, enable: boolean) => {
    if (!connId || !db) return
    try {
      await api.query.execute(connId, `ALTER EVENT \`${name}\` ${enable ? 'ENABLE' : 'DISABLE'}`, db)
      load()
    } catch (e: any) { setError(e.message || '操作失败') }
  }

  const drop = async (name: string) => { await api.object.drop(connId!, db!, 'EVENT', name); load() }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type', width: 120, render: (v: string) => <Tag type={v === 'RECURRING' ? 'primary' : 'success'}>{v}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => <Tag type={v === 'ENABLED' ? 'success' : 'default'}>{v}</Tag> },
    { title: '间隔', dataIndex: 'interval', key: 'interval', width: 120 },
    { title: '操作', key: 'action', width: 220, render: (_: any, r: EventInfo) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewSql(r.body)}>查看</Button>
        <Button size="small" icon={r.status === 'ENABLED' ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={() => toggleEvent(r.name, r.status !== 'ENABLED')}>{r.status === 'ENABLED' ? '禁用' : '启用'}</Button>
        <Popconfirm title={`确定删除事件 ${r.name}？`} onConfirm={() => drop(r.name)}>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          setForm({ name: '', type: 'RECURRING', atDatetime: '', everyInterval: 1, everyUnit: 'DAY', starts: '', ends: '', body: '', enabled: true })
          setModalOpen(true)
        }}>新建事件</Button>
      </div>
      <Table dataSource={events} columns={columns} rowKey="name" loading={loading} size="small" />

      <Modal title="新建事件" open={modalOpen} onClose={() => setModalOpen(false)} onOk={save} width={600}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>名称</span><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ flex: 1 }} /></div>
          <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} style={{ width: '100%' }}
            options={[{ value: 'ONE TIME', label: '一次性 (ONE TIME)' }, { value: 'RECURRING', label: '循环 (RECURRING)' }]} />
          {form.type === 'ONE TIME' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>执行时间</span><Input value={form.atDatetime} onChange={(e) => setForm((f) => ({ ...f, atDatetime: e.target.value }))} placeholder="YYYY-MM-DD HH:mm:ss" style={{ flex: 1 }} /></div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>每</span>
                <Input type="number" min={1} value={form.everyInterval} onChange={(e) => setForm((f) => ({ ...f, everyInterval: parseInt(e.target.value) || 1 }))} style={{ width: 80 }} />
                <Select value={form.everyUnit} onChange={(v) => setForm((f) => ({ ...f, everyUnit: v }))} style={{ width: 120 }}
                  options={UNITS.map((u) => ({ value: u, label: u }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>开始时间</span><Input value={form.starts} onChange={(e) => setForm((f) => ({ ...f, starts: e.target.value }))} placeholder="可选 YYYY-MM-DD HH:mm:ss" style={{ flex: 1 }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>结束时间</span><Input value={form.ends} onChange={(e) => setForm((f) => ({ ...f, ends: e.target.value }))} placeholder="可选 YYYY-MM-DD HH:mm:ss" style={{ flex: 1 }} /></div>
            </>
          )}
          <div><Switch checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} /> <span style={{ marginLeft: 8 }}>{form.enabled ? '启用' : '禁用'}</span></div>
          <textarea className="ui-input" rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="-- 事件体 (不含 BEGIN/END)" style={{ fontFamily: 'monospace' }} />
        </div>
      </Modal>

      <Modal title="事件代码" open={!!viewSql} onClose={() => setViewSql(null)} footer={null} width={600}>
        <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 13 }}>{viewSql}</pre>
      </Modal>
    </div>
  )
}

export default EventManager
