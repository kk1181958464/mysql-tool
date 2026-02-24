import React from 'react'
import { Input, Switch, Select } from '../../components/ui'
import { FolderOpenOutlined } from '@ant-design/icons'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

export const SSLConfig: React.FC<Props> = ({ form, updateField }) => {
  const pickFile = async (field: string) => {
    try {
      const result = await (window as any).api.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'key', 'ca'] }],
      })
      if (result && !result.canceled && result.filePaths?.[0]) {
        updateField(field, result.filePaths[0])
      }
    } catch { /* cancelled */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch checked={form.sslEnabled || false} onChange={(v) => updateField('sslEnabled', v)} />
        <span>启用 SSL</span>
      </div>
      {form.sslEnabled && (
        <>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>SSL 模式</label>
            <Select
              value={form.sslMode || 'DISABLED'}
              onChange={(v) => updateField('sslMode', v)}
              options={[
                { value: 'DISABLED', label: 'DISABLED' },
                { value: 'REQUIRED', label: 'REQUIRED' },
                { value: 'VERIFY_CA', label: 'VERIFY_CA' },
                { value: 'VERIFY_IDENTITY', label: 'VERIFY_IDENTITY' },
              ]}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>CA 证书</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={form.sslCa || ''} readOnly placeholder="选择 CA 证书文件" style={{ flex: 1 }} />
              <button className="ui-btn ui-btn-default ui-btn-small" onClick={() => pickFile('sslCa')}><FolderOpenOutlined /></button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>客户端证书</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={form.sslCert || ''} readOnly placeholder="选择客户端证书" style={{ flex: 1 }} />
              <button className="ui-btn ui-btn-default ui-btn-small" onClick={() => pickFile('sslCert')}><FolderOpenOutlined /></button>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>客户端密钥</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={form.sslKey || ''} readOnly placeholder="选择客户端密钥" style={{ flex: 1 }} />
              <button className="ui-btn ui-btn-default ui-btn-small" onClick={() => pickFile('sslKey')}><FolderOpenOutlined /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
