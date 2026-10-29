import React, { useEffect, useMemo, useState } from 'react'
import { Button, Tooltip, toast } from '../../components/ui'
import { CloseOutlined, LeftOutlined, RightOutlined, CopyOutlined } from '@ant-design/icons'
import type { ColumnDetail } from '../../../../shared/types/metadata'

interface Props {
  record: Record<string, unknown> | null
  rowLabel: string
  columns: { name: string; type?: string }[]
  details: Map<string, ColumnDetail>
  pending?: Record<string, unknown>
  editable: boolean
  formatValue: (value: unknown, columnName: string) => string
  isBinary: (value: unknown) => boolean
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onChange: (columnName: string, value: unknown) => void
  onClose: () => void
}

const LONG_TEXT = /text|json|blob|longtext|mediumtext/i

const tryFormatJson = (text: string): string | null => {
  const t = text.trim()
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

export function RowDetailPanel({ record, rowLabel, columns, details, pending, editable, formatValue, isBinary, hasPrev, hasNext, onPrev, onNext, onChange, onClose }: Props) {
  const [keyword, setKeyword] = useState('')

  const shown = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return columns
    return columns.filter((c) => c.name.toLowerCase().includes(k) || (details.get(c.name)?.comment || '').toLowerCase().includes(k))
  }, [columns, details, keyword])

  const copyJson = async () => {
    if (!record) return
    const obj = Object.fromEntries(columns.map((c) => {
      const v = pending && c.name in pending ? pending[c.name] : record[c.name]
      return [c.name, v === null || v === undefined ? null : isBinary(v) ? formatValue(v, c.name) : typeof v === 'object' ? v : formatValue(v, c.name)]
    }))
    await window.api.clipboard.writeText(JSON.stringify(obj, null, 2))
    toast.success('已复制当前行 JSON')
  }

  return (
    <aside className="db-detail">
      <div className="db-detail-head">
        <div className="db-detail-title">
          <span>行详情</span>
          <span className="db-detail-sub">{record ? rowLabel : '未选择'}</span>
        </div>
        <Tooltip title="上一行" placement="bottom"><Button size="small" variant="text" icon={<LeftOutlined />} disabled={!hasPrev} onClick={onPrev} /></Tooltip>
        <Tooltip title="下一行" placement="bottom"><Button size="small" variant="text" icon={<RightOutlined />} disabled={!hasNext} onClick={onNext} /></Tooltip>
        <Tooltip title="复制为 JSON" placement="bottom"><Button size="small" variant="text" icon={<CopyOutlined />} disabled={!record} onClick={copyJson} /></Tooltip>
        <Tooltip title="关闭" placement="bottom"><Button size="small" variant="text" icon={<CloseOutlined />} onClick={onClose} /></Tooltip>
      </div>
      {record ? (
        <>
          <div className="db-detail-search">
            <input className="db-detail-search-input" value={keyword} placeholder="查找字段…" onChange={(e) => setKeyword(e.target.value)} />
          </div>
          {!editable && <div className="db-detail-readonly">该表没有主键，已有数据只读</div>}
          <div className="db-detail-fields">
            {shown.map((c) => {
              const value = pending && c.name in pending ? pending[c.name] : record[c.name]
              return (
                <DetailField
                  key={c.name}
                  name={c.name}
                  detail={details.get(c.name)}
                  value={value}
                  dirty={Boolean(pending && c.name in pending)}
                  editable={editable && !isBinary(value)}
                  text={value === null || value === undefined ? '' : formatValue(value, c.name)}
                  onChange={(v) => onChange(c.name, v)}
                />
              )
            })}
            {shown.length === 0 && <div className="db-detail-empty">没有匹配的字段</div>}
          </div>
        </>
      ) : (
        <div className="db-detail-empty">点击任意单元格查看该行的全部字段</div>
      )}
    </aside>
  )
}

function DetailField({ name, detail, value, text, dirty, editable, onChange }: {
  name: string
  detail?: ColumnDetail
  value: unknown
  text: string
  dirty: boolean
  editable: boolean
  onChange: (value: unknown) => void
}) {
  const isNull = value === null || value === undefined
  const json = useMemo(() => tryFormatJson(text), [text])
  const multiline = LONG_TEXT.test(detail?.dataType || '') || text.length > 60 || text.includes('\n') || json !== null
  const [draft, setDraft] = useState(json ?? text)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(json ?? text)
  }, [text, json, focused])

  const commit = () => {
    setFocused(false)
    const original = json ?? text
    if (draft === original) return
    if (json !== null) {
      const compact = tryFormatJson(draft)
      onChange(compact !== null ? JSON.stringify(JSON.parse(draft)) : draft)
      return
    }
    onChange(draft)
  }

  const common = {
    value: draft,
    disabled: !editable,
    placeholder: isNull ? 'NULL' : '',
    spellCheck: false,
    onFocus: () => setFocused(true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
  }

  return (
    <div className={`db-field ${dirty ? 'dirty' : ''}`}>
      <div className="db-field-head">
        {detail?.primaryKey && <span className="td-pk">PK</span>}
        <span className="db-field-name" title={name}>{name}</span>
        <span className="db-field-type">{detail?.columnType || ''}</span>
        {editable && detail?.nullable !== false && (
          <button type="button" className={`db-field-null ${isNull ? 'active' : ''}`} onClick={() => onChange(isNull ? '' : null)} title={isNull ? '改为空字符串' : '设为 NULL'}>NULL</button>
        )}
      </div>
      {detail?.comment && <div className="db-field-comment">{detail.comment}</div>}
      {multiline ? (
        <textarea {...common} className={`db-field-input db-field-textarea ${isNull ? 'is-null' : ''}`} rows={json ? Math.min(12, draft.split('\n').length) : 3} />
      ) : (
        <input {...common} className={`db-field-input ${isNull ? 'is-null' : ''}`} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      )}
    </div>
  )
}
