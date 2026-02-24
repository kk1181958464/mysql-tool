import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Tag, Select, Switch, Input, Alert, Popconfirm } from '../../components/ui'
import { PlusOutlined, ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { BackupSchedule as ScheduleType } from '../../../../shared/types/table-design'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import { api } from '../../utils/ipc'

interface Props { onBack: () => void }

const PRESETS: Record<string, string> = {
  '每天凌晨2点': '0 2 * * *',
  '每周日凌晨3点': '0 3 * * 0',
  '每月1日凌晨4点': '0 4 1 * *',
}

const BackupSchedule: React.FC<Props> = ({ onBack }) => {
  const [schedules, setSchedules] = useState<ScheduleType[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ id: '', databaseName: '', cronExpression: '0 2 * * *', backupType: 'full', compress: true, retentionDays: 30, isActive: true })
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const connId = useConnectionStore((s) => s.activeConnectionId)
  const databases = useDatabaseStore((s) => connId ? s.databases[connId] ?? [] : [])

  const load = useCallback(async () => {
    if (!connId) return
    setLoading(true)
    try {
      const res = await api.backup.schedule({ connectionId: connId, action: 'list' })
      setSchedules(Array.isArray(res) ? res : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setForm({ id: '', databaseName: '', cronExpression: '0 2 * * *', backupType: 'full', compress: true, retentionDays: 30, isActive: true })
    setEditMode(false)
    setModalOpen(true)
  }

  const openEdit = (s: ScheduleType) => {
    setForm({ id: s.id, databaseName: s.databaseName, cronExpression: s.cronExpression, backupType: s.backupType, compress: s.compress, retentionDays: s.retentionDays, isActive: s.isActive })
    setEditMode(true)
    setModalOpen(true)
  }

  const save = async () => {
    if (!connId || !form.databaseName) return
    try {
      await api.backup.schedule({ connectionId: connId, action: editMode ? 'update' : 'create', ...form })
      setSuccess(editMode ? '更新成功' : '创建成功'); setTimeout(() => setSuccess(null), 2000)
      setModalOpen(false); load()
    } catch (e: any) { setError(e.message || '操作失败') }
  }

  const remove = async (id: string) => {
    await api.backup.schedule({ connectionId: connId!, action: 'delete', id })
    load()
  }

  const toggle = async (id: string, active: boolean) => {
    if (!connId) return
    try {
      await api.backup.schedule({ connectionId: connId, action: 'update', id, isActive: active })
      load()
    } catch (e: any) { setError(e.message || '操作失败') }
  }

  const columns = [
    { title: '数据库', dataIndex: 'databaseName', key: 'databaseName', width: 150 },
    { title: '计划', dataIndex: 'cronExpression', key: 'cronExpression', width: 140 },
    { title: '类型', dataIndex: 'backupType', key: 'backupType', width: 80, render: (v: string) => <Tag>{v}</Tag> },
    { title: '上次执行', dataIndex: 'lastRun', key: 'lastRun', width: 170, render: (v: string | null) => v || '-' },
    { title: '状态', dataIndex: 'isActive', key: 'isActive', width: 80, render: (v: boolean, r: ScheduleType) => <Switch checked={v} onChange={(checked) => toggle(r.id, checked)} /> },
    { title: '操作', key: 'action', width: 140, render: (_: any, r: ScheduleType) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确定删除此定时备份？" onConfirm={() => remove(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ]

  return (
    <div style={{ padding: 16 }}>
      {error && <Alert type="error" message={error} onClose={() => setError(null)} style={{ marginBottom: 12 }} />}
      {success && <Alert type="success" message={success} style={{ marginBottom: 12 }} />}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加定时备份</Button>
      </Space>

      <Table dataSource={schedules} columns={columns} rowKey="id" loading={loading} size="small" />

      <Modal title={editMode ? '编辑定时备份' : '添加定时备份'} open={modalOpen} onClose={() => setModalOpen(false)} onOk={save} width={500}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select style={{ width: '100%' }} value={form.databaseName || undefined} onChange={(v) => setForm((f) => ({ ...f, databaseName: v }))} placeholder="选择数据库"
            options={databases.map((d) => ({ value: d.name, label: d.name }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Select style={{ width: 200 }} value={Object.values(PRESETS).includes(form.cronExpression) ? form.cronExpression : 'custom'}
              onChange={(v) => { if (v !== 'custom') setForm((f) => ({ ...f, cronExpression: v })) }}
              options={[...Object.entries(PRESETS).map(([label, cron]) => ({ value: cron, label })), { value: 'custom', label: '自定义' }]} />
            <Input style={{ flex: 1 }} value={form.cronExpression} onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))} placeholder="cron 表达式" />
          </div>
          <Select style={{ width: '100%' }} value={form.backupType} onChange={(v) => setForm((f) => ({ ...f, backupType: v }))}
            options={[{ value: 'full', label: '完整备份' }, { value: 'structure', label: '仅结构' }, { value: 'data', label: '仅数据' }]} />
          <div><Switch checked={form.compress} onChange={(v) => setForm((f) => ({ ...f, compress: v }))} /> <span style={{ marginLeft: 8 }}>{form.compress ? '压缩' : '不压缩'}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span>保留天数：</span><Input type="number" min={1} max={365} value={form.retentionDays} onChange={(e) => setForm((f) => ({ ...f, retentionDays: parseInt(e.target.value) || 30 }))} style={{ width: 100 }} /></div>
          <div><Switch checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} /> <span style={{ marginLeft: 8 }}>{form.isActive ? '启用' : '禁用'}</span></div>
        </div>
      </Modal>
    </div>
  )
}

export default BackupSchedule
