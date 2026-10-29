import React, { useState, useRef, useEffect } from 'react'
import { Button, Input, Select, Switch, Tooltip } from '../../components/ui'
import {
  PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, KeyOutlined,
  InsertRowAboveOutlined, ThunderboltOutlined, TableOutlined,
} from '@ant-design/icons'
import type { ColumnDesign } from '../../../../shared/types/table-design'

const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: '整数', types: ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'] },
  { label: '小数', types: ['DECIMAL', 'FLOAT', 'DOUBLE'] },
  { label: '字符串', types: ['VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET'] },
  { label: '日期时间', types: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'] },
  { label: '其他', types: ['BOOLEAN', 'BIT', 'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY'] },
]
const TYPE_OPTIONS = TYPE_GROUPS.flatMap((g) => g.types.map((t) => ({ value: t, label: t })))
const NUMERIC_TYPES = new Set(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'])
const INTEGER_TYPES = new Set(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT'])
const SCALE_TYPES = new Set(['DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'])
const TIME_TYPES = new Set(['DATETIME', 'TIMESTAMP'])
const LIST_TYPES = new Set(['ENUM', 'SET'])

interface Props {
  columns: ColumnDesign[]
  original?: ColumnDesign[] | null
  onChange: (columns: ColumnDesign[]) => void
}

const emptyCol: ColumnDesign = {
  name: '', type: '', length: '', decimals: '',
  nullable: true, defaultValue: '', autoIncrement: false,
  primaryKey: false, unique: false, comment: '',
  unsigned: false, zerofill: false, onUpdateCurrentTimestamp: false,
}

const col = (overrides: Partial<ColumnDesign>): ColumnDesign => ({ ...emptyCol, ...overrides })

const COMMON_COLUMNS: ColumnDesign[] = [
  col({ name: 'id', type: 'BIGINT', nullable: false, autoIncrement: true, primaryKey: true, unsigned: true, comment: '主键' }),
  col({ name: 'created_at', type: 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '创建时间' }),
  col({ name: 'updated_at', type: 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', onUpdateCurrentTimestamp: true, comment: '更新时间' }),
]

// 根据字段名智能推断类型
const guessTypeByName = (name: string): { type: string; length: string; decimals?: string } => {
  const n = name.toLowerCase()
  if (n === 'id' || n.endsWith('_id')) return { type: 'BIGINT', length: '' }
  if (n.includes('price') || n.includes('amount') || n.includes('money') || n.includes('cost')) return { type: 'DECIMAL', length: '10', decimals: '2' }
  if (n.includes('count') || n.includes('num') || n.includes('qty') || n.includes('quantity') || n === 'sort') return { type: 'INT', length: '' }
  if (n.includes('status') || n.includes('type') || n.includes('state') || n.includes('flag') || n.startsWith('is_')) return { type: 'TINYINT', length: '' }
  if (n.includes('time') || n.endsWith('_at')) return { type: 'DATETIME', length: '' }
  if (n.includes('date') || n === 'birthday') return { type: 'DATE', length: '' }
  if (n.includes('content') || n.includes('desc') || n.includes('remark') || n.includes('text')) return { type: 'TEXT', length: '' }
  if (n.includes('json') || n.includes('config') || n.includes('extra')) return { type: 'JSON', length: '' }
  if (n.includes('email')) return { type: 'VARCHAR', length: '128' }
  if (n.includes('phone') || n.includes('mobile') || n.includes('tel')) return { type: 'VARCHAR', length: '20' }
  if (n.includes('url') || n.includes('link') || n.includes('path') || n.includes('image') || n.includes('avatar') || n.includes('icon')) return { type: 'VARCHAR', length: '500' }
  if (n.includes('name') || n.includes('title')) return { type: 'VARCHAR', length: '64' }
  return { type: 'VARCHAR', length: '255' }
}

const typeLabel = (c: ColumnDesign) => {
  if (!c.type) return ''
  if (LIST_TYPES.has(c.type)) return `${c.type}(…)`
  if (c.length) return `${c.type}(${c.length}${c.decimals ? `,${c.decimals}` : ''})`
  return c.type
}

const sameColumn = (a: ColumnDesign, b: ColumnDesign) => {
  const strip = ({ originalName: _o, ...rest }: ColumnDesign) => rest
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

export const ColumnEditor: React.FC<Props> = ({ columns, original, onChange }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(columns.length ? 0 : null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nameInputs = useRef<Map<number, HTMLInputElement>>(new Map())
  const focusNameRef = useRef<number | null>(null)

  const selectedCol = selectedIndex !== null ? columns[selectedIndex] ?? null : null
  const originalByName = new Map((original ?? []).map((c) => [c.name, c]))

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= columns.length) setSelectedIndex(columns.length ? columns.length - 1 : null)
  }, [columns.length, selectedIndex])

  useEffect(() => {
    if (focusNameRef.current === null) return
    nameInputs.current.get(focusNameRef.current)?.focus()
    focusNameRef.current = null
  })

  const update = (index: number, patch: Partial<ColumnDesign>) => {
    onChange(columns.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const updateSelected = (patch: Partial<ColumnDesign>) => {
    if (selectedIndex !== null) update(selectedIndex, patch)
  }

  const changeType = (index: number, type: string) => {
    const c = columns[index]
    const patch: Partial<ColumnDesign> = { type }
    if (!NUMERIC_TYPES.has(type)) Object.assign(patch, { unsigned: false, zerofill: false, autoIncrement: false })
    if (!SCALE_TYPES.has(type)) patch.decimals = ''
    if (!TIME_TYPES.has(type)) patch.onUpdateCurrentTimestamp = false
    if (type === 'VARCHAR' && !c.length) patch.length = '255'
    if (LIST_TYPES.has(c.type) !== LIST_TYPES.has(type)) patch.length = type === 'VARCHAR' ? '255' : ''
    update(index, patch)
  }

  const handleNameBlur = (index: number) => {
    const c = columns[index]
    if (!c?.name || c.type) return
    const guess = guessTypeByName(c.name)
    update(index, { type: guess.type, length: guess.length, decimals: guess.decimals ?? '' })
  }

  const insertAt = (index: number, items: ColumnDesign[] = [{ ...emptyCol }]) => {
    const next = [...columns]
    next.splice(index, 0, ...items)
    onChange(next)
    setSelectedIndex(index)
    focusNameRef.current = index
  }

  const remove = (index: number) => {
    onChange(columns.filter((_, i) => i !== index))
    setSelectedIndex(columns.length > 1 ? Math.min(index, columns.length - 2) : null)
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= columns.length) return
    const next = [...columns]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    setSelectedIndex(target)
  }

  const addCommonColumns = () => {
    const existing = new Set(columns.map((c) => c.name))
    const missing = COMMON_COLUMNS.filter((c) => !existing.has(c.name)).map((c) => ({ ...c }))
    if (!missing.length) return
    const hasPk = columns.some((c) => c.primaryKey)
    const items = missing.map((c) => (hasPk && c.primaryKey ? { ...c, primaryKey: false } : c))
    const ids = items.filter((c) => c.name === 'id')
    const rest = items.filter((c) => c.name !== 'id')
    onChange([...ids, ...columns, ...rest])
    setSelectedIndex(0)
  }

  // 字段区域内的快捷键：Alt+↑/↓ 移动，Ctrl+Enter 新增
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current
      if (!root || root.offsetParent === null || !root.contains(document.activeElement)) return
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedIndex !== null) {
        e.preventDefault()
        move(selectedIndex, e.key === 'ArrowUp' ? -1 : 1)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        insertAt(selectedIndex === null ? columns.length : selectedIndex + 1)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  const rowState = (c: ColumnDesign): 'new' | 'changed' | null => {
    if (!original) return null
    const prev = c.originalName ? originalByName.get(c.originalName) : undefined
    if (!prev) return 'new'
    return sameColumn(prev, c) ? null : 'changed'
  }

  const pkCount = columns.filter((c) => c.primaryKey).length

  return (
    <div ref={rootRef} className="td-columns">
      <div className="td-toolbar">
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => insertAt(columns.length)}>添加字段</Button>
        <Tooltip title="在选中字段下方插入" placement="bottom">
          <Button size="small" variant="text" icon={<InsertRowAboveOutlined />} disabled={selectedIndex === null} onClick={() => selectedIndex !== null && insertAt(selectedIndex + 1)}>插入</Button>
        </Tooltip>
        <span className="td-toolbar-sep" />
        <Tooltip title="上移 (Alt+↑)" placement="bottom">
          <Button size="small" variant="text" icon={<ArrowUpOutlined />} disabled={selectedIndex === null || selectedIndex === 0} onClick={() => selectedIndex !== null && move(selectedIndex, -1)} />
        </Tooltip>
        <Tooltip title="下移 (Alt+↓)" placement="bottom">
          <Button size="small" variant="text" icon={<ArrowDownOutlined />} disabled={selectedIndex === null || selectedIndex === columns.length - 1} onClick={() => selectedIndex !== null && move(selectedIndex, 1)} />
        </Tooltip>
        <Tooltip title="设为 / 取消主键" placement="bottom">
          <Button size="small" variant="text" icon={<KeyOutlined />} disabled={selectedIndex === null} onClick={() => selectedCol && updateSelected({ primaryKey: !selectedCol.primaryKey, nullable: selectedCol.primaryKey ? selectedCol.nullable : false })}>主键</Button>
        </Tooltip>
        <Tooltip title="删除字段" placement="bottom">
          <Button size="small" variant="text" className="danger-text-btn" icon={<DeleteOutlined />} disabled={selectedIndex === null} onClick={() => selectedIndex !== null && remove(selectedIndex)} />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Button size="small" variant="text" icon={<ThunderboltOutlined />} onClick={addCommonColumns}>添加常用字段</Button>
      </div>

      <div className="td-body">
        <div className="td-grid-wrap">
          <div className="td-grid td-grid-head">
            <span />
            <span>字段名</span>
            <span>类型</span>
            <span>长度</span>
            <span title="不允许为 NULL">非空</span>
            <span>默认值</span>
            <span>注释</span>
          </div>
          <div className="td-grid-rows">
            {columns.length === 0 ? (
              <div className="td-empty">
                <TableOutlined className="td-empty-icon" />
                <div className="td-empty-title">还没有字段</div>
                <div className="td-empty-desc">可以逐个添加，也可以先放入主键和创建 / 更新时间字段</div>
                <div className="td-empty-actions">
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => insertAt(0)}>添加字段</Button>
                  <Button icon={<ThunderboltOutlined />} onClick={addCommonColumns}>添加 id / created_at / updated_at</Button>
                </div>
              </div>
            ) : columns.map((c, i) => {
              const state = rowState(c)
              return (
                <div
                  key={i}
                  className={`td-grid td-row ${selectedIndex === i ? 'selected' : ''} ${state ? `is-${state}` : ''}`}
                  onMouseDown={() => setSelectedIndex(i)}
                >
                  <span className="td-cell-key" title={c.primaryKey ? '主键' : c.unique ? '唯一' : undefined}>
                    {c.primaryKey ? <span className="td-pk">PK</span> : c.unique ? <span className="td-uni">U</span> : <span className="td-row-no">{i + 1}</span>}
                  </span>
                  <input
                    ref={(el) => { if (el) nameInputs.current.set(i, el); else nameInputs.current.delete(i) }}
                    className="td-input td-input-name"
                    value={c.name}
                    placeholder="字段名"
                    spellCheck={false}
                    onChange={(e) => update(i, { name: e.target.value })}
                    onBlur={() => handleNameBlur(i)}
                  />
                  <Select size="small" value={c.type || undefined} placeholder="类型" onChange={(v) => changeType(i, v as string)} options={TYPE_OPTIONS} style={{ width: '100%' }} />
                  <input
                    className="td-input"
                    value={LIST_TYPES.has(c.type) ? '…' : c.length + (c.decimals ? `,${c.decimals}` : '')}
                    disabled={LIST_TYPES.has(c.type)}
                    title={LIST_TYPES.has(c.type) ? '在右侧面板中编辑取值' : undefined}
                    placeholder="-"
                    onChange={(e) => {
                      const [length, decimals = ''] = e.target.value.replace(/[^\d,]/g, '').split(',')
                      update(i, { length, decimals: SCALE_TYPES.has(c.type) ? decimals : '' })
                    }}
                  />
                  <span className="td-cell-center">
                    <input type="checkbox" className="td-check" checked={!c.nullable} disabled={c.primaryKey} onChange={(e) => update(i, { nullable: !e.target.checked })} />
                  </span>
                  <input className="td-input td-input-mono" value={c.autoIncrement ? 'AUTO_INCREMENT' : c.defaultValue} disabled={c.autoIncrement} placeholder={c.nullable ? 'NULL' : '无'} spellCheck={false} onChange={(e) => update(i, { defaultValue: e.target.value })} />
                  <input className="td-input" value={c.comment} placeholder="注释" onChange={(e) => update(i, { comment: e.target.value })} />
                </div>
              )
            })}
          </div>
        </div>

        <aside className="td-props">
          {selectedCol ? (
            <ColumnProperties
              key={selectedIndex}
              column={selectedCol}
              pkCount={pkCount}
              onChange={updateSelected}
              onTypeChange={(type) => selectedIndex !== null && changeType(selectedIndex, type)}
            />
          ) : (
            <div className="td-props-empty">选择一个字段查看和编辑它的全部属性</div>
          )}
        </aside>
      </div>
    </div>
  )
}

function ColumnProperties({ column: c, pkCount, onChange, onTypeChange }: {
  column: ColumnDesign
  pkCount: number
  onChange: (patch: Partial<ColumnDesign>) => void
  onTypeChange: (type: string) => void
}) {
  const isNumeric = NUMERIC_TYPES.has(c.type)
  const isInteger = INTEGER_TYPES.has(c.type)
  const isTime = TIME_TYPES.has(c.type)
  const isList = LIST_TYPES.has(c.type)
  const defaultPresets = [
    ...(c.nullable ? ['NULL'] : []),
    ...(isTime ? ['CURRENT_TIMESTAMP'] : []),
    ...(isNumeric ? ['0'] : []),
    ...(!isNumeric && !isTime ? ["''"] : []),
  ]

  return (
    <div className="td-props-inner">
      <div className="td-props-head">
        <span className="td-props-name">{c.name || '未命名字段'}</span>
        <span className="td-props-type">{typeLabel(c) || '未选择类型'}</span>
      </div>

      <div className="td-props-section">
        <label className="td-prop">
          <span>字段名</span>
          <Input size="small" value={c.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="td-prop">
          <span>类型</span>
          <Select size="small" value={c.type || undefined} placeholder="选择类型" onChange={(v) => onTypeChange(v as string)} options={TYPE_OPTIONS} style={{ width: '100%' }} />
        </label>
        {isList ? (
          <label className="td-prop">
            <span>可选值</span>
            <Input size="small" value={c.length} onChange={(e) => onChange({ length: e.target.value })} placeholder="'a','b','c'" />
          </label>
        ) : (
          <div className="td-prop-row">
            <label className="td-prop">
              <span>{isTime ? '秒精度' : '长度'}</span>
              <Input size="small" value={c.length} onChange={(e) => onChange({ length: e.target.value.replace(/\D/g, '') })} placeholder="默认" />
            </label>
            {SCALE_TYPES.has(c.type) && (
              <label className="td-prop">
                <span>小数位</span>
                <Input size="small" value={c.decimals} onChange={(e) => onChange({ decimals: e.target.value.replace(/\D/g, '') })} placeholder="0" />
              </label>
            )}
          </div>
        )}
      </div>

      <div className="td-props-section">
        <label className="td-prop">
          <span>默认值</span>
          <Input
            size="small"
            className="td-input-mono"
            value={c.defaultValue}
            disabled={c.autoIncrement}
            onChange={(e) => onChange({ defaultValue: e.target.value })}
            placeholder={c.autoIncrement ? '自增字段无默认值' : '无默认值'}
          />
        </label>
        {!c.autoIncrement && (
          <div className="td-presets">
            {defaultPresets.map((p) => (
              <button key={p} type="button" className={c.defaultValue === p ? 'active' : ''} onClick={() => onChange({ defaultValue: c.defaultValue === p ? '' : p })}>{p}</button>
            ))}
          </div>
        )}
        <div className="td-hint">文本请带引号，例如 'active'；表达式直接填写，例如 CURRENT_TIMESTAMP</div>
      </div>

      <div className="td-props-section td-switches">
        <SwitchRow label="允许 NULL" checked={c.nullable} disabled={c.primaryKey} onChange={(v) => onChange({ nullable: v, defaultValue: !v && c.defaultValue === 'NULL' ? '' : c.defaultValue })} />
        <SwitchRow label="主键" desc={pkCount > 1 && c.primaryKey ? `联合主键（共 ${pkCount} 列）` : undefined} checked={c.primaryKey} onChange={(v) => onChange({ primaryKey: v, unique: v ? false : c.unique, nullable: v ? false : c.nullable })} />
        <SwitchRow label="唯一" checked={c.unique} disabled={c.primaryKey} onChange={(v) => onChange({ unique: v })} />
        {isInteger && <SwitchRow label="自动递增" checked={c.autoIncrement} onChange={(v) => onChange({ autoIncrement: v, defaultValue: v ? '' : c.defaultValue, nullable: v ? false : c.nullable })} />}
        {isNumeric && <SwitchRow label="无符号" checked={c.unsigned} onChange={(v) => onChange({ unsigned: v })} />}
        {isNumeric && <SwitchRow label="填充零" checked={c.zerofill} onChange={(v) => onChange({ zerofill: v })} />}
        {isTime && <SwitchRow label="更新时自动刷新时间" checked={c.onUpdateCurrentTimestamp} onChange={(v) => onChange({ onUpdateCurrentTimestamp: v })} />}
      </div>

      <div className="td-props-section">
        <label className="td-prop">
          <span>注释</span>
          <textarea className="ui-textarea td-textarea" rows={3} value={c.comment} onChange={(e) => onChange({ comment: e.target.value })} placeholder="说明这个字段的用途" />
        </label>
      </div>
    </div>
  )
}

function SwitchRow({ label, desc, checked, disabled, onChange }: { label: string; desc?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`td-switch-row ${disabled ? 'disabled' : ''}`}>
      <div>
        <div>{label}</div>
        {desc && <div className="td-hint">{desc}</div>}
      </div>
      <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}
