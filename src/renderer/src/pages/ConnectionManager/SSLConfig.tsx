import React from 'react'
import { Input, Switch, Select } from '../../components/ui'
import { FolderOpenOutlined } from '@ant-design/icons'
import { FormField, FormSection } from './FormField'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

const SSL_MODES = [
  { value: 'REQUIRED', label: 'REQUIRED — 加密，不校验证书' },
  { value: 'VERIFY_CA', label: 'VERIFY_CA — 校验 CA 证书' },
  { value: 'VERIFY_IDENTITY', label: 'VERIFY_IDENTITY — 校验证书和主机名' },
]

const CERT_FIELDS: { field: string; label: string; placeholder: string }[] = [
  { field: 'sslCa', label: 'CA 证书', placeholder: '校验服务器证书时需要' },
  { field: 'sslCert', label: '客户端证书', placeholder: '双向认证时需要' },
  { field: 'sslKey', label: '客户端密钥', placeholder: '双向认证时需要' },
]

export const SSLConfig: React.FC<Props> = ({ form, updateField }) => {
  const pickFile = async (field: string) => {
    const filePath = await window.api.dialog.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'key', 'ca', 'cer'] }],
    })
    if (filePath) updateField(field, filePath)
  }

  return (
    <div className="cm-tab-body">
      <label className="cm-toggle">
        <Switch
          checked={form.sslEnabled || false}
          onChange={(v) => {
            updateField('sslEnabled', v)
            if (v && (!form.sslMode || form.sslMode === 'DISABLED')) updateField('sslMode', 'REQUIRED')
          }}
        />
        <div>
          <div className="cm-toggle-title">使用 SSL 加密连接</div>
          <div className="cm-toggle-desc">云数据库或跨公网访问时建议开启</div>
        </div>
      </label>
      {form.sslEnabled && (
        <FormSection title="证书">
          <FormField label="SSL 模式" span={2}>
            <Select value={form.sslMode === 'DISABLED' ? 'REQUIRED' : form.sslMode || 'REQUIRED'} onChange={(v) => updateField('sslMode', v)} options={SSL_MODES} style={{ width: '100%' }} />
          </FormField>
          {CERT_FIELDS.map(({ field, label, placeholder }) => (
            <FormField key={field} label={label} span={2}>
              <div className="cm-file-input">
                <Input value={form[field] || ''} readOnly placeholder={placeholder} />
                {form[field] ? (
                  <button type="button" className="ui-btn ui-btn-text ui-btn-medium" onClick={() => updateField(field, '')}>清除</button>
                ) : null}
                <button type="button" className="ui-btn ui-btn-default ui-btn-medium" onClick={() => pickFile(field)}><FolderOpenOutlined /> 选择</button>
              </div>
            </FormField>
          ))}
        </FormSection>
      )}
    </div>
  )
}
