import React from 'react'
import { Input } from '../../components/ui'

interface Props {
  form: Record<string, any>
  updateField: (key: string, value: any) => void
}

export const PoolConfig: React.FC<Props> = ({ form, updateField }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>最大连接数</label>
        <Input type="number" min={1} max={100} value={String(form.poolMax || 10)} onChange={(e) => updateField('poolMax', Number(e.target.value))} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>连接超时 (ms)</label>
        <Input type="number" min={1000} max={300000} value={String(form.connectTimeout || 10000)} onChange={(e) => updateField('connectTimeout', Number(e.target.value))} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>空闲超时 (ms)</label>
        <Input type="number" min={1000} max={3600000} value={String(form.idleTimeout || 60000)} onChange={(e) => updateField('idleTimeout', Number(e.target.value))} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>时区</label>
        <Input value={form.timezone || 'local'} onChange={(e) => updateField('timezone', e.target.value)} placeholder="local / Z / +08:00" />
      </div>
    </div>
  )
}
