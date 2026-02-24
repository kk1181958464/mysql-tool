import React, { useEffect, useState } from 'react'
import { Tabs, Input, Button, Space, Select, Alert } from '../../components/ui'
import { useConnectionStore } from '../../stores/connection.store'
import { SSLConfig } from './SSLConfig'
import { SSHConfig } from './SSHConfig'
import { PoolConfig } from './PoolConfig'
import type { ConnectionConfig, ConnectionSavePayload } from '../../../../shared/types/connection'
import { v4 as uuid } from 'uuid'

interface Props {
  editing: ConnectionConfig | null
  onSaved: () => void
  onClose: () => void
}

const defaultValues: Partial<ConnectionSavePayload> = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  databaseName: '',
  charset: 'utf8mb4',
  timezone: '+00:00',
  groupName: '',
  color: '#3b82f6',
  poolMin: 1,
  poolMax: 10,
  connectTimeout: 10000,
  idleTimeout: 60000,
  sslEnabled: false,
  sslMode: 'DISABLED',
  sslCa: '',
  sslCert: '',
  sslKey: '',
  sshEnabled: false,
  sshHost: '',
  sshPort: 22,
  sshUser: '',
  sshPassword: '',
  sshPrivateKey: '',
  sshPassphrase: '',
  sortOrder: 0,
}

export const ConnectionForm: React.FC<Props> = ({ editing, onSaved, onClose }) => {
  const [form, setForm] = useState<Partial<ConnectionSavePayload>>(defaultValues)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const { saveConnection, testConnection, connect } = useConnectionStore()

  useEffect(() => {
    if (editing) {
      setForm({ ...defaultValues, ...editing })
    } else {
      setForm({ ...defaultValues })
    }
    setError('')
    setSuccess('')
  }, [editing])

  const updateField = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }))

  const getPayload = (): ConnectionSavePayload => ({
    ...defaultValues,
    ...form,
    id: editing?.id || uuid(),
  } as ConnectionSavePayload)

  const validate = () => {
    if (!form.name?.trim()) { setError('请输入连接名称'); return false }
    if (!form.host?.trim()) { setError('请输入主机地址'); return false }
    if (!form.port || form.port < 1 || form.port > 65535) { setError('端口范围 1-65535'); return false }
    setError('')
    return true
  }

  const handleTest = async () => {
    if (!validate()) return
    setTesting(true)
    setSuccess('')
    try {
      const status = await testConnection(getPayload())
      if (status.connected) {
        setError('')
        setSuccess(`连接成功！MySQL ${status.serverVersion}`)
        setTimeout(() => setSuccess(''), 5000)
      } else {
        setError(status.error || '连接失败')
      }
    } catch (e: any) {
      setError(e.message || '测试失败')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!validate()) return
    try {
      await saveConnection(getPayload())
      onSaved()
    } catch (e: any) {
      setError(e.message || '保存失败')
    }
  }

  const handleSaveAndConnect = async () => {
    if (!validate()) return
    const payload = getPayload()
    try {
      await saveConnection(payload)
      await connect(payload as any)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message || '操作失败')
    }
  }

  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

  const GeneralTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>分组</label>
        <Input value={form.groupName || ''} onChange={(e) => updateField('groupName', e.target.value)} placeholder="默认分组" />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}><span style={{ color: 'var(--error)' }}>*</span> 主机</label>
        <Input value={form.host || ''} onChange={(e) => updateField('host', e.target.value)} placeholder="127.0.0.1" />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}><span style={{ color: 'var(--error)' }}>*</span> 端口</label>
        <Input type="number" value={String(form.port || 3306)} onChange={(e) => updateField('port', Number(e.target.value))} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>用户名</label>
        <Input value={form.user || ''} onChange={(e) => updateField('user', e.target.value)} placeholder="root" />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>密码</label>
        <Input type="password" value={form.password || ''} onChange={(e) => updateField('password', e.target.value)} placeholder="密码" />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>字符集</label>
        <Select value={form.charset || 'utf8mb4'} onChange={(v) => updateField('charset', v)} options={[
          { value: 'utf8mb4', label: 'utf8mb4' },
          { value: 'utf8', label: 'utf8' },
          { value: 'latin1', label: 'latin1' },
          { value: 'gbk', label: 'gbk' },
        ]} style={{ width: '100%' }} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 公共字段：名称和颜色 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}><span style={{ color: 'var(--error)' }}>*</span> 连接名称</label>
          <Input value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} placeholder="My Connection" />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>颜色</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {COLORS.map((c) => (
              <button key={c} onClick={() => updateField('color', c)} style={{ width: 22, height: 22, borderRadius: 4, background: c, border: form.color === c ? '2px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </div>
      <Tabs
        items={[
          { key: 'general', label: '常规', children: GeneralTab },
          { key: 'ssl', label: 'SSL', children: <SSLConfig form={form} updateField={updateField} /> },
          { key: 'ssh', label: 'SSH', children: <SSHConfig form={form} updateField={updateField} /> },
          { key: 'advanced', label: '高级', children: <PoolConfig form={form} updateField={updateField} /> },
        ]}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
      <div style={{ flexShrink: 0, paddingTop: 12, borderTop: '1px solid var(--border)', marginTop: 12 }}>
        {success && <Alert type="success" message={success} style={{ marginBottom: 8 }} />}
        {error && <Alert type="error" message={error} style={{ marginBottom: 8 }} />}
        <Space>
          <Button onClick={handleTest} disabled={testing}>{testing ? '测试中...' : '测试连接'}</Button>
          <Button onClick={handleSave}>保存</Button>
          <Button type="primary" onClick={handleSaveAndConnect}>保存并连接</Button>
        </Space>
      </div>
    </div>
  )
}
