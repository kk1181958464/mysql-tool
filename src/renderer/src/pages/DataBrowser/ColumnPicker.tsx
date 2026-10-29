import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox } from '../../components/ui'
import { InsertRowRightOutlined } from '@ant-design/icons'

interface Props {
  columns: { name: string }[]
  comments: Map<string, string>
  visible: Set<string>
  onChange: (next: Set<string>) => void
}

export function ColumnPicker({ columns, comments, visible, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return columns
    return columns.filter((c) => c.name.toLowerCase().includes(k) || (comments.get(c.name) || '').toLowerCase().includes(k))
  }, [columns, comments, keyword])

  const hidden = columns.length - visible.size
  const toggle = (name: string, checked: boolean) => {
    const next = new Set(visible)
    if (checked) next.add(name)
    else next.delete(name)
    onChange(next)
  }

  return (
    <div className="db-popover-anchor" ref={rootRef}>
      <Button size="small" icon={<InsertRowRightOutlined />} className={hidden > 0 ? 'db-btn-active' : ''} onClick={() => setOpen((v) => !v)}>
        列{hidden > 0 ? ` ${visible.size}/${columns.length}` : ''}
      </Button>
      {open && (
        <div className="db-popover db-colpicker">
          <div className="db-colpicker-head">
            <input className="db-detail-search-input" autoFocus value={keyword} placeholder="搜索字段名或注释" onChange={(e) => setKeyword(e.target.value)} />
            <button type="button" className="db-link" onClick={() => onChange(new Set(columns.map((c) => c.name)))}>全选</button>
            <button type="button" className="db-link" onClick={() => onChange(new Set())}>清空</button>
          </div>
          <div className="db-colpicker-list">
            {items.map((c) => {
              const comment = comments.get(c.name)
              return (
                <label key={c.name} className="db-colpicker-item" title={comment ? `${c.name} - ${comment}` : c.name}>
                  <Checkbox checked={visible.has(c.name)} onChange={(checked) => toggle(c.name, checked)} />
                  <span className="db-colpicker-name">{c.name}</span>
                  {comment && <span className="db-colpicker-comment">{comment}</span>}
                </label>
              )
            })}
            {items.length === 0 && <div className="db-detail-empty">没有匹配字段</div>}
          </div>
          <div className="db-colpicker-foot">已显示 {visible.size} / {columns.length} 列</div>
        </div>
      )}
    </div>
  )
}
