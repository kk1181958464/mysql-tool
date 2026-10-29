import React from 'react'
import { Select } from '../../components/ui'
import type { TableDesign } from '../../../../shared/types/table-design'

interface Props {
  design: TableDesign
  onChange: (design: TableDesign) => void
}

const ENGINES = [
  { value: 'InnoDB', label: 'InnoDB', desc: '默认引擎，支持事务、行锁和外键' },
  { value: 'MyISAM', label: 'MyISAM', desc: '不支持事务和外键，适合只读的历史数据' },
  { value: 'MEMORY', label: 'MEMORY', desc: '数据保存在内存中，重启后丢失' },
  { value: 'ARCHIVE', label: 'ARCHIVE', desc: '高压缩比，只支持插入和查询' },
  { value: 'CSV', label: 'CSV', desc: '以 CSV 文件存储，便于与外部交换' },
]

const COLLATIONS: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  binary: ['binary'],
}

export const TableOptions: React.FC<Props> = ({ design, onChange }) => {
  const update = (patch: Partial<TableDesign>) => onChange({ ...design, ...patch })
  const charsets = COLLATIONS[design.charset] ? Object.keys(COLLATIONS) : [design.charset, ...Object.keys(COLLATIONS)]
  const collations = COLLATIONS[design.charset] ?? []
  const collationOptions = (collations.includes(design.collation) ? collations : [design.collation, ...collations]).map((c) => ({ value: c, label: c }))
  const engine = ENGINES.find((e) => e.value === design.engine)

  return (
    <div className="td-panel td-options">
      <section className="td-option-card">
        <div className="td-option-title">存储引擎</div>
        <div className="td-engine-grid">
          {ENGINES.map((e) => (
            <button key={e.value} type="button" className={`td-engine ${design.engine === e.value ? 'active' : ''}`} onClick={() => update({ engine: e.value })}>
              <span className="td-engine-name">{e.label}</span>
              <span className="td-engine-desc">{e.desc}</span>
            </button>
          ))}
          {!engine && (
            <button type="button" className="td-engine active">
              <span className="td-engine-name">{design.engine}</span>
              <span className="td-engine-desc">当前表使用的引擎</span>
            </button>
          )}
        </div>
      </section>

      <section className="td-option-card">
        <div className="td-option-title">字符集</div>
        <div className="cm-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div className="cm-field">
            <label className="cm-label">字符集</label>
            <Select value={design.charset} style={{ width: '100%' }} options={charsets.map((c) => ({ value: c, label: c }))}
              onChange={(v) => update({ charset: v as string, collation: COLLATIONS[v as string]?.[0] ?? design.collation })} />
          </div>
          <div className="cm-field">
            <label className="cm-label">排序规则</label>
            <Select value={design.collation} style={{ width: '100%' }} options={collationOptions} onChange={(v) => update({ collation: v as string })} />
          </div>
        </div>
        <div className="td-hint">已有字段不会自动转换；修改字符集只影响新字段和表的默认值</div>
      </section>

      <section className="td-option-card">
        <div className="td-option-title">表注释</div>
        <textarea className="ui-textarea td-textarea" rows={3} value={design.comment} placeholder="说明这张表存放什么数据" onChange={(e) => update({ comment: e.target.value })} />
      </section>
    </div>
  )
}
