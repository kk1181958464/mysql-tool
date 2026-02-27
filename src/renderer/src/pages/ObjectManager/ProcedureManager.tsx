import React, { useEffect, useState, useCallback } from 'react'
import { Table, Button, Modal, Space, Tag, Input, Select, Alert, Popconfirm, Tabs } from '../../components/ui'
import { PlusOutlined, EyeOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { ProcedureInfo } from '../../../../shared/types/metadata'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const PARAM_TYPES = ['VARCHAR(255)', 'INT', 'BIGINT', 'TEXT', 'DECIMAL(10,2)', 'DATE', 'DATETIME', 'BOOLEAN']
interface ParamDef { name: string; type: string; direction: 'IN' | 'OUT' | 'INOUT' }

const ProcedureManager: React.FC = () => {
  const [procedures, setProcedures] = useState<ProcedureInfo[]>([])
  const [functions, setFunctions] = useState<ProcedureInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [execModal, setExecModal] = useState(false)
  const [viewSql, setViewSql] = useState<string | null>(null)
  const [execTarget, setExecTarget] = useState<ProcedureInfo | null>(null)
  const [execParams, setExecParams] = useState<Record<string, string>>({})
  const [execResult, setExecResult] = useState<{ rows: unknown[] } | null>(null)
  const [form, setForm] = useState({ name: '', type: 'PROCEDURE' as 'PROCEDURE' | 'FUNCTION', params: [] as ParamDef[], returns: '', body: '' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const load = useCallback(async () => {
    if (!connId || !db) return
    setLoading(true)
    try {
      const [procs, funcs] = await Promise.all([api.meta.procedures(connId, db), api.meta.functions(connId, db)])
      setProcedures(Array.isArray(procs) ? procs : [])
      setFunctions(Array.isArray(funcs) ? funcs : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [connId, db])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm({ name: '', type: 'PROCEDURE', params: [], returns: '', body: '' }); setModalOpen(true) }
  const addParam = () => setForm((f) => ({ ...f, params: [...f.params, { name: '', type: 'VARCHAR(255)', direction: 'IN' }] }))
  const removeParam = (i: number) => setForm((f) => ({ ...f, params: f.params.filter((_, idx) => idx !== i) }))
  const updateParam = (i: number, field: keyof ParamDef, val: string) => setForm((f) => ({ ...f, params: f.params.map((p, idx) => idx === i ? { ...p, [field]: val } : p) }))

  const save = async () => {
    if (!connId || !db || !form.name || !form.body) return
    try {
      const paramStr = form.params.map((p) => `${p.direction} \`${p.name}\` ${p.type}`).join(', ')
      const sql = form.type === 'FUNCTION'
        ? `CREATE FUNCTION \`${form.name}\`(${paramStr}) RETURNS ${form.returns || 'VARCHAR(255)'}\nBEGIN\n${form.body}\nEND`
        : `CREATE PROCEDURE \`${form.name}\`(${paramStr})\nBEGIN\n${form.body}\nEND`
      await api.object.createProcedure(connId, db, sql)
      setSuccess('保存成功'); setTimeout(() => setSuccess(null), 2000)
      setModalOpen(false); load()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '保存失败') }
  }

  const openExec = (p: ProcedureInfo) => { setExecTarget(p); setExecParams({}); setExecResult(null); setExecModal(true) }

  const executeProc = async () => {
    if (!connId || !db || !execTarget) return
    try {
      const params = parseParamNames(execTarget.paramList).map((name) => execParams[name] || '')
      const res = await api.object.execRoutine(connId, db, execTarget.name, execTarget.type as 'PROCEDURE' | 'FUNCTION', params)
      setExecResult(res)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '执行失败') }
  }

  const drop = async (name: string, type: string) => { await api.object.drop(connId!, db!, type, name); load() }

  const parseParamNames = (paramList: string): string[] => {
    if (!paramList) return []
    return paramList.split(',').map((p) => p.trim().split(/\s+/).filter((s) => !['IN', 'OUT', 'INOUT'].includes(s.toUpperCase()))[0] || '').filter(Boolean)
  }

  const makeColumns = (type: string) => [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '定义者', dataIndex: 'definer', key: 'definer', width: 160 },
    { title: '创建时间', dataIndex: 'created', key: 'created', width: 170 },
    { title: '操作', key: 'action', width: 220, render: (_value: unknown, r: ProcedureInfo) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewSql(r.body)}>查看</Button>
        <Button size="small" icon={<PlayCircleOutlined />} onClick={() => openExec(r)}>执行</Button>
        <Popconfirm title={`确定删除 ${type} ${r.name}？`} onConfirm={() => drop(r.name, type)}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ]

  return (
    <div>
      {error && <Alert type="error" message={error} onClose={() => setError(null)} style={{ marginBottom: 12 }} />}
      {success && <Alert type="success" message={success} style={{ marginBottom: 12 }} />}
      <div style={{ marginBottom: 12 }}><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button></div>
      <Tabs items={[
        { key: 'proc', label: '存储过程', children: <Table dataSource={procedures} columns={makeColumns('PROCEDURE')} rowKey="name" loading={loading} size="small" /> },
        { key: 'func', label: '函数', children: <Table dataSource={functions} columns={makeColumns('FUNCTION')} rowKey="name" loading={loading} size="small" /> },
      ]} />

      <Modal title="新建存储过程/函数" open={modalOpen} onClose={() => setModalOpen(false)} onOk={save} width={700}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}><span>名称</span><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <Select value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} style={{ width: 150 }}
              options={[{ value: 'PROCEDURE', label: 'PROCEDURE' }, { value: 'FUNCTION', label: 'FUNCTION' }]} />
          </div>
          {form.type === 'FUNCTION' && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span>返回类型</span><Input value={form.returns} onChange={(e) => setForm((f) => ({ ...f, returns: e.target.value }))} placeholder="VARCHAR(255)" /></div>}
          <div><label>参数：</label><Button size="small" onClick={addParam} style={{ marginLeft: 8 }}>添加参数</Button></div>
          {form.params.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Select value={p.direction} onChange={(v) => updateParam(i, 'direction', v)} style={{ width: 90 }} options={[{ value: 'IN', label: 'IN' }, { value: 'OUT', label: 'OUT' }, { value: 'INOUT', label: 'INOUT' }]} />
              <Input value={p.name} onChange={(e) => updateParam(i, 'name', e.target.value)} placeholder="参数名" style={{ width: 120 }} />
              <Select value={p.type} onChange={(v) => updateParam(i, 'type', v)} style={{ width: 160 }} options={PARAM_TYPES.map((t) => ({ value: t, label: t }))} />
              <Button size="small" danger onClick={() => removeParam(i)}>删除</Button>
            </div>
          ))}
          <textarea className="ui-input" rows={10} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="-- 过程体 (不含 BEGIN/END)" style={{ fontFamily: 'monospace' }} />
        </div>
      </Modal>

      <Modal title={`执行 ${execTarget?.name}`} open={execModal} onClose={() => setExecModal(false)} footer={<Button type="primary" onClick={executeProc}>执行</Button>} width={600}>
        {execTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {parseParamNames(execTarget.paramList).map((name) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 100 }}>{name}</span><Input value={execParams[name] || ''} onChange={(e) => setExecParams((p) => ({ ...p, [name]: e.target.value }))} /></div>
            ))}
            {execResult && <pre style={{ maxHeight: 300, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 12 }}>{JSON.stringify(execResult.rows ?? execResult, null, 2)}</pre>}
          </div>
        )}
      </Modal>

      <Modal title="代码" open={!!viewSql} onClose={() => setViewSql(null)} footer={null} width={600}>
        <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-hover)', padding: 12, borderRadius: 6, fontSize: 13 }}>{viewSql}</pre>
      </Modal>
    </div>
  )
}

export default ProcedureManager
