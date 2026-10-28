import React, { useEffect, useState } from 'react'
import { Input, Switch } from '../../components/ui'
import { FolderOpenOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { SecretInput } from './SecretInput'
import { FormField, FormSection } from './FormField'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

export const SSHConfig: React.FC<Props> = ({ form, updateField }) => {
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password')

  useEffect(() => {
    setAuthMethod(form.sshPrivateKey ? 'key' : 'password')
  }, [form.sshPrivateKey])

  const pickFile = async () => {
    // OpenSSH 私钥（如 id_ed25519 / id_rsa）常无扩展名，因此不设过滤并显示隐藏文件
    const filePath = await window.api.dialog.openFile({ properties: ['openFile', 'showHiddenFiles'] })
    if (filePath) updateField('sshPrivateKey', filePath)
  }

  return (
    <div className="cm-tab-body">
      <label className="cm-toggle">
        <Switch checked={form.sshEnabled || false} onChange={(v) => updateField('sshEnabled', v)} />
        <div>
          <div className="cm-toggle-title">通过 SSH 隧道连接</div>
          <div className="cm-toggle-desc">先登录跳板机，再从跳板机访问 MySQL</div>
        </div>
      </label>
      {form.sshEnabled && (
        <>
          <div className="cm-tip">
            <InfoCircleOutlined />
            <span>「常规」中的主机地址是从 SSH 服务器访问 MySQL 的地址，通常填写 127.0.0.1。</span>
          </div>
          <FormSection title="SSH 服务器" columns={4}>
            <FormField label="SSH 主机" required span={3}>
              <Input value={form.sshHost || ''} onChange={(e) => updateField('sshHost', e.target.value)} placeholder="ssh.example.com" />
            </FormField>
            <FormField label="端口" required>
              <Input type="number" value={String(form.sshPort || 22)} onChange={(e) => updateField('sshPort', Number(e.target.value))} />
            </FormField>
            <FormField label="用户名" required span={4}>
              <Input value={form.sshUser || ''} onChange={(e) => updateField('sshUser', e.target.value)} placeholder="root" />
            </FormField>
          </FormSection>
          <FormSection
            title="认证"
            extra={(
              <div className="cm-segmented">
                <button type="button" className={authMethod === 'password' ? 'active' : ''} onClick={() => setAuthMethod('password')}>密码</button>
                <button type="button" className={authMethod === 'key' ? 'active' : ''} onClick={() => setAuthMethod('key')}>私钥</button>
              </div>
            )}
          >
            {authMethod === 'password' ? (
              <FormField label="SSH 密码" span={2}>
                <SecretInput value={form.sshPassword || ''} onChange={(v) => updateField('sshPassword', v)} placeholder="SSH 密码" />
              </FormField>
            ) : (
              <>
                <FormField label="私钥文件" span={2}>
                  <div className="cm-file-input">
                    <Input value={form.sshPrivateKey || ''} readOnly placeholder="选择私钥文件（如 id_rsa、id_ed25519）" />
                    <button type="button" className="ui-btn ui-btn-default ui-btn-medium" onClick={pickFile}><FolderOpenOutlined /> 选择</button>
                  </div>
                </FormField>
                <FormField label="私钥密码" span={2}>
                  <SecretInput value={form.sshPassphrase || ''} onChange={(v) => updateField('sshPassphrase', v)} placeholder="没有可留空" />
                </FormField>
              </>
            )}
          </FormSection>
        </>
      )}
    </div>
  )
}
