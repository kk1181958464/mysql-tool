import React from 'react'
import { Input } from '../../components/ui'
import { FormField, FormSection } from './FormField'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

export const PoolConfig: React.FC<Props> = ({ form, updateField }) => {
  return (
    <div className="cm-tab-body">
      <FormSection title="连接池">
        <FormField label="最大连接数" hint="1 - 100">
          <Input type="number" min={1} max={100} value={String(form.poolMax || 10)} onChange={(e) => updateField('poolMax', Number(e.target.value))} />
        </FormField>
        <FormField label="时区" hint="local、Z 或 ±HH:MM">
          <Input value={form.timezone || 'local'} onChange={(e) => updateField('timezone', e.target.value)} placeholder="+08:00" />
        </FormField>
      </FormSection>
      <FormSection title="超时">
        <FormField label="连接超时 (ms)" hint="1000 - 300000">
          <Input type="number" min={1000} max={300000} value={String(form.connectTimeout || 10000)} onChange={(e) => updateField('connectTimeout', Number(e.target.value))} />
        </FormField>
        <FormField label="空闲超时 (ms)" hint="空闲连接超过该时间后回收">
          <Input type="number" min={1000} max={3600000} value={String(form.idleTimeout || 60000)} onChange={(e) => updateField('idleTimeout', Number(e.target.value))} />
        </FormField>
      </FormSection>
    </div>
  )
}
