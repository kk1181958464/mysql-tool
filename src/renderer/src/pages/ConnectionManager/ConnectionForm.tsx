import React, { useEffect, useRef, useState } from 'react'
import { CloseOutlined, DownOutlined, PictureOutlined } from '@ant-design/icons'
import { Tabs, Input, Button, Space, Select, Alert, Toast } from '../../components/ui'
import { ConnAvatar } from '../../components/ConnAvatar'
import { ErrorNotice } from '../../components/ErrorNotice'
import { getErrorMessage } from '../../utils/error-info'
import { ICON_ACCEPT, fileToIconDataUrl } from '../../utils/icon-image'
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
  onPreviewColor?: (color: string) => void
  onPreviewIcon?: (icon: string) => void
}

function GroupInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const connections = useConnectionStore((s) => s.connections)
  const [open, setOpen] = useState(false)
  const groups = Array.from(new Set(connections.map((c) => c.groupName?.trim()).filter(Boolean))) as string[]
  const keyword = value.trim().toLowerCase()
  const exactMatch = groups.some((g) => g.toLowerCase() === keyword)
  const options = keyword && !exactMatch ? groups.filter((g) => g.toLowerCase().includes(keyword)) : groups

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        placeholder={groups.length ? '选择或输入分组' : '留空为未分组'}
        suffix={groups.length ? <DownOutlined style={{ fontSize: 10, transition: 'transform var(--dur-base) var(--ease-spring)', transform: open ? 'rotate(180deg)' : 'none' }} /> : undefined}
      />
      {open && (options.length > 0 || (keyword && !exactMatch)) && (
        <div className="ui-select-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20 }}>
          {keyword && !exactMatch && (
            <div className="ui-select-empty" style={{ padding: '6px 12px', textAlign: 'left', fontSize: 12 }}>
              将创建新分组「{value.trim()}」
            </div>
          )}
          {options.map((group) => (
            <div
              key={group}
              className={`ui-select-option ${group === value.trim() ? 'selected' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onChange(group); setOpen(false) }}
            >
              {group}
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  color: '#5b5bd6',
  icon: '',
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

export const ConnectionForm: React.FC<Props> = ({ editing, onSaved, onClose, onPreviewColor, onPreviewIcon }) => {
  const [form, setForm] = useState<Partial<ConnectionSavePayload>>(defaultValues)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [validationError, setValidationError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeTab, setActiveTab] = useState('general')
  const { saveConnection, testConnection, connect } = useConnectionStore()
  const connectionIdRef = useRef(editing?.id || uuid())
  const iconFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    connectionIdRef.current = editing?.id || uuid()
    if (editing) {
      setForm({ ...defaultValues, ...editing })
    } else {
      setForm({ ...defaultValues })
    }
    setError('')
    setValidationError('')
    setSuccess('')
  }, [editing])

  const updateField = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }))

  const getPayload = (): ConnectionSavePayload => ({
    ...defaultValues,
    ...form,
    id: connectionIdRef.current,
  } as ConnectionSavePayload)

  const updateIcon = (icon: string) => {
    updateField('icon', icon)
    onPreviewIcon?.(icon)
  }

  const handleIconFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      updateIcon(await fileToIconDataUrl(file))
      setError('')
    } catch (err: any) {
      setError(getErrorMessage(err, '图片处理失败'))
    }
  }

  const iconIsImage = (form.icon || '').startsWith('data:image/')

  const validate = () => {
    if (!form.name?.trim()) { setValidationError('请输入连接名称'); return false }
    if (!form.host?.trim()) { setValidationError('请输入主机地址'); return false }
    if (!form.port || form.port < 1 || form.port > 65535) { setValidationError('端口范围 1-65535'); return false }
    if (!Number.isInteger(form.poolMax) || form.poolMax! < 1 || form.poolMax! > 100) { setValidationError('最大连接数范围 1-100'); return false }
    if (!Number.isInteger(form.connectTimeout) || form.connectTimeout! < 1000 || form.connectTimeout! > 300000) { setValidationError('连接超时范围 1000-300000 ms'); return false }
    if (!Number.isInteger(form.idleTimeout) || form.idleTimeout! < 1000 || form.idleTimeout! > 3600000) { setValidationError('空闲超时范围 1000-3600000 ms'); return false }
    if (!/^(?:local|Z|[+-]\d{2}:\d{2})$/.test(form.timezone || '')) { setValidationError('时区格式应为 local、Z 或 ±HH:MM'); return false }
    setValidationError('')
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
      setError(getErrorMessage(e, '测试失败'))
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
      setError(getErrorMessage(e, '保存失败'))
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
      setError(getErrorMessage(e, '操作失败'))
    }
  }

  const COLORS = ['#5b5bd6', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

  const GeneralTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>分组</label>
        <GroupInput value={form.groupName || ''} onChange={(v) => updateField('groupName', v)} />
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
      {/* 公共字段：图标、名称和颜色 */}
      <div className="conn-form-head">
        <button type="button" className="conn-form-avatar" title="上传图标" onClick={() => iconFileRef.current?.click()}>
          <ConnAvatar conn={{ name: form.name || '', color: form.color || '', icon: form.icon || '' }} size="large" />
          <span className="conn-form-avatar-overlay"><PictureOutlined /></span>
          {form.icon ? (
            <span
              role="button"
              className="conn-form-avatar-reset"
              title="恢复默认图标"
              onClick={(e) => { e.stopPropagation(); updateIcon('') }}
            >
              <CloseOutlined />
            </span>
          ) : null}
        </button>
        <input ref={iconFileRef} type="file" accept={ICON_ACCEPT} hidden onChange={handleIconFile} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}><span style={{ color: 'var(--error)' }}>*</span> 连接名称</label>
            <Input value={form.name || ''} onChange={(e) => updateField('name', e.target.value)} placeholder="My Connection" />
          </div>
          <div className="conn-form-meta">
            <span className="conn-form-label">颜色</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`conn-color-swatch ${form.color === c ? 'active' : ''}`}
                  onClick={() => {
                    updateField('color', c)
                    onPreviewColor?.(c)
                  }}
                  style={{ background: c }}
                />
              ))}
            </div>
            <span className="conn-form-label" style={{ marginLeft: 8 }}>图标</span>
            <Input
              size="small"
              value={iconIsImage ? '' : form.icon || ''}
              onChange={(e) => updateIcon(Array.from(e.target.value).slice(0, 2).join(''))}
              placeholder={iconIsImage ? '图片' : '字/emoji'}
              disabled={iconIsImage}
              style={{ width: 72 }}
            />
            <Button size="small" icon={<PictureOutlined />} onClick={() => iconFileRef.current?.click()}>上传</Button>
          </div>
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'general', label: '常规', children: activeTab === 'general' ? GeneralTab : null },
          { key: 'ssl', label: 'SSL', children: activeTab === 'ssl' ? <SSLConfig form={form} updateField={updateField} /> : null },
          { key: 'ssh', label: 'SSH', children: activeTab === 'ssh' ? <SSHConfig form={form} updateField={updateField} /> : null },
          { key: 'advanced', label: '高级', children: activeTab === 'advanced' ? <PoolConfig form={form} updateField={updateField} /> : null },
        ]}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      />
      <div style={{ flexShrink: 0, paddingTop: 12, borderTop: '1px solid var(--border)', marginTop: 12 }}>
        <Toast open={Boolean(success)} message={success} type="success" />
        {validationError && <Alert type="warning" message={validationError} onClose={() => setValidationError('')} style={{ marginBottom: 8 }} />}
        {!validationError && error && <ErrorNotice key={error} error={error} fallbackTitle="连接失败" onClose={() => setError('')} style={{ marginBottom: 8 }} />}
        <Space>
          <Button onClick={handleTest} disabled={testing}>{testing ? '测试中...' : '测试连接'}</Button>
          <Button onClick={handleSave}>保存</Button>
          <Button type="primary" onClick={handleSaveAndConnect}>保存并连接</Button>
        </Space>
      </div>
    </div>
  )
}
