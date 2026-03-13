import React, { useState } from 'react'
import { Input, Switch } from '../../components/ui'
import { FolderOpenOutlined } from '@ant-design/icons'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

export const SSHConfig: React.FC<Props> = ({ form, updateField }) => {
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password')

  const pickFile = async () => {
    try {
      const filePath = await (window as any).api.dialog.openFile({
        filters: [{ name: 'Private Key', extensions: ['pem', 'ppk', 'key'] }],
      })
      if (filePath) {
        updateField('sshPrivateKey', filePath)
      }
    } catch {
      /* cancelled */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch checked={form.sshEnabled || false} onChange={(v) => updateField('sshEnabled', v)} />
        <span>启用 SSH 隧道</span>
      </div>
      {form.sshEnabled && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 4 }}>
            💡 MySQL 连接信息（主机/端口/用户名/密码）请在「常规」标签页填写。启用 SSH 后，MySQL 主机地址通常填 127.0.0.1（从 SSH 服务器视角）。
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SSH 主机</label>
            <Input value={form.sshHost || ''} onChange={(e) => updateField('sshHost', e.target.value)} placeholder="ssh.example.com" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SSH 端口</label>
            <Input type="number" value={String(form.sshPort || 22)} onChange={(e) => updateField('sshPort', Number(e.target.value))} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SSH 用户名</label>
            <Input value={form.sshUser || ''} onChange={(e) => updateField('sshUser', e.target.value)} placeholder="root" />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>认证方式</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="radio" checked={authMethod === 'password'} onChange={() => setAuthMethod('password')} /> 密码
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="radio" checked={authMethod === 'key'} onChange={() => setAuthMethod('key')} /> 私钥
              </label>
            </div>
          </div>
          {authMethod === 'password' ? (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SSH 密码</label>
              <Input type="password" value={form.sshPassword || ''} onChange={(e) => updateField('sshPassword', e.target.value)} placeholder="SSH 密码" />
            </div>
          ) : (
            <>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>私钥文件</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input value={form.sshPrivateKey || ''} readOnly placeholder="选择私钥文件" style={{ flex: 1 }} />
                  <button className="ui-btn ui-btn-default ui-btn-small" onClick={pickFile}><FolderOpenOutlined /></button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>私钥密码</label>
                <Input type="password" value={form.sshPassphrase || ''} onChange={(e) => updateField('sshPassphrase', e.target.value)} placeholder="可选" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
