import React from 'react'
import { Select, Input } from '../../components/ui'
import type { TableDesign } from '../../../../shared/types/table-design'

interface Props {
  design: TableDesign
  onChange: (design: TableDesign) => void
}

export const TableOptions: React.FC<Props> = ({ design, onChange }) => {
  const update = (field: keyof TableDesign, value: any) => {
    onChange({ ...design, [field]: value })
  }

  return (
    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4 }}>引擎</label>
        <Select value={design.engine} onChange={(v) => update('engine', v)} style={{ width: '100%' }}
          options={[
            { value: 'InnoDB', label: 'InnoDB' },
            { value: 'MyISAM', label: 'MyISAM' },
            { value: 'MEMORY', label: 'MEMORY' },
            { value: 'CSV', label: 'CSV' },
            { value: 'ARCHIVE', label: 'ARCHIVE' },
          ]} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4 }}>字符集</label>
        <Select value={design.charset} onChange={(v) => update('charset', v)} style={{ width: '100%' }}
          options={[
            { value: 'utf8mb4', label: 'utf8mb4' },
            { value: 'utf8', label: 'utf8' },
            { value: 'latin1', label: 'latin1' },
            { value: 'gbk', label: 'gbk' },
            { value: 'binary', label: 'binary' },
          ]} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4 }}>排序规则</label>
        <Select value={design.collation} onChange={(v) => update('collation', v)} style={{ width: '100%' }}
          options={[
            { value: 'utf8mb4_general_ci', label: 'utf8mb4_general_ci' },
            { value: 'utf8mb4_unicode_ci', label: 'utf8mb4_unicode_ci' },
            { value: 'utf8mb4_bin', label: 'utf8mb4_bin' },
            { value: 'utf8_general_ci', label: 'utf8_general_ci' },
            { value: 'latin1_swedish_ci', label: 'latin1_swedish_ci' },
          ]} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: 4 }}>注释</label>
        <textarea className="ui-input" rows={3} value={design.comment} onChange={(e) => update('comment', e.target.value)} style={{ width: '100%', resize: 'vertical', border: '1px solid var(--border)' }} />
      </div>
    </div>
  )
}
