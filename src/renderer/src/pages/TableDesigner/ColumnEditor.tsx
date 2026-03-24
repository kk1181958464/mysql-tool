import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button, Input, Select, Checkbox, Space } from '../../components/ui'
import { PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined, KeyOutlined } from '@ant-design/icons'
import type { ColumnDesign } from '../../../../shared/types/table-design'

const TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'JSON', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'ENUM', 'SET',
]

interface Props {
  columns: ColumnDesign[]
  onChange: (columns: ColumnDesign[]) => void
}

type RowSelectState = {
  anchor: number | null
  selected: Set<number>
}

const emptyCol: ColumnDesign = {
  name: '', type: '', length: '', decimals: '',
  nullable: true, defaultValue: '', autoIncrement: false,
  primaryKey: false, unique: false, comment: '',
  unsigned: false, zerofill: false, onUpdateCurrentTimestamp: false,
}

// 根据字段名智能推断类型
const guessTypeByName = (name: string): { type: string; length: string } => {
  const n = name.toLowerCase()
  if (n === 'id' || n.endsWith('_id') || n.endsWith('id')) return { type: 'INT', length: '11' }
  if (n.includes('price') || n.includes('amount') || n.includes('money') || n.includes('cost')) return { type: 'DECIMAL', length: '10,2' }
  if (n.includes('count') || n.includes('num') || n.includes('qty') || n.includes('quantity')) return { type: 'INT', length: '11' }
  if (n.includes('status') || n.includes('type') || n.includes('state') || n.includes('flag')) return { type: 'TINYINT', length: '1' }
  if (n.includes('time') || n === 'created_at' || n === 'updated_at') return { type: 'DATETIME', length: '' }
  if (n.includes('date') || n === 'birthday') return { type: 'DATE', length: '' }
  if (n.includes('content') || n.includes('desc') || n.includes('remark') || n.includes('text')) return { type: 'TEXT', length: '' }
  if (n.includes('json') || n.includes('data') || n.includes('config') || n.includes('extra')) return { type: 'JSON', length: '' }
  if (n.includes('email')) return { type: 'VARCHAR', length: '100' }
  if (n.includes('phone') || n.includes('mobile') || n.includes('tel')) return { type: 'VARCHAR', length: '20' }
  if (n.includes('url') || n.includes('link') || n.includes('path') || n.includes('image') || n.includes('avatar')) return { type: 'VARCHAR', length: '500' }
  if (n.includes('name') || n.includes('title')) return { type: 'VARCHAR', length: '100' }
  return { type: 'VARCHAR', length: '255' }
}

const defaultWidths = [200, 120, 70, 60, 70, 80, 200]

export const ColumnEditor: React.FC<Props> = ({ columns, onChange }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [rowSelect, setRowSelect] = useState<RowSelectState>({ anchor: null, selected: new Set() })
  const [colWidths, setColWidths] = useState<number[]>(defaultWidths)
  const resizing = useRef<{ index: number; startX: number; startWidth: number } | null>(null)
  const resizeHandlersRef = useRef<{ move: ((event: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null })
  const rootRef = useRef<HTMLDivElement | null>(null)

  const selectedCol = selectedIndex !== null ? columns[selectedIndex] : null

  const update = (index: number, field: keyof ColumnDesign, value: any) => {
    const next = columns.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    onChange(next)
  }

  // 名称输入完成时推断类型（onBlur触发，避免每次按键都推断）
  const handleNameBlur = (index: number) => {
    const col = columns[index]
    if (col.name && !col.type) {
      const guess = guessTypeByName(col.name)
      let updates: Partial<ColumnDesign> = { type: guess.type, length: guess.length }
      if (guess.type === 'DECIMAL' && guess.length.includes(',')) {
        const [len, dec] = guess.length.split(',')
        updates.length = len
        updates.decimals = dec
      }
      const next = columns.map((c, i) => (i === index ? { ...c, ...updates } : c))
      onChange(next)
    }
  }

  const updateKey = (index: number, keyType: string) => {
    const next = columns.map((c, i) => {
      if (i !== index) return c
      return {
        ...c,
        primaryKey: keyType === 'PRI',
        unique: keyType === 'UNI',
      }
    })
    onChange(next)
  }

  const updateSelected = (field: keyof ColumnDesign, value: any) => {
    if (selectedIndex === null) return
    update(selectedIndex, field, value)
  }

  const handleRowSelect = (index: number, e: React.MouseEvent) => {
    const isShift = e.shiftKey
    const isCtrl = e.ctrlKey || e.metaKey
    setRowSelect(prev => {
      const next = new Set(prev.selected)
      if (isShift && prev.anchor !== null) {
        const [start, end] = prev.anchor < index ? [prev.anchor, index] : [index, prev.anchor]
        for (let i = start; i <= end; i++) next.add(i)
        return { anchor: prev.anchor, selected: next }
      }
      if (isCtrl) {
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return { anchor: index, selected: next }
      }
      return { anchor: index, selected: new Set([index]) }
    })
    setSelectedIndex(index)
  }

  // Ctrl/Cmd + A：在字段表格内全选所有列
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
      const root = rootRef.current
      // 仅在当前编辑器可见时生效
      if (!root || root.offsetParent === null) return
      e.preventDefault()
      const all = new Set(columns.map((_, i) => i))
      setRowSelect({ anchor: columns.length ? 0 : null, selected: all })
      setSelectedIndex(columns.length ? 0 : null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [columns])

  const add = () => {
    onChange([...columns, { ...emptyCol }])
    const idx = columns.length
    setSelectedIndex(idx)
    setRowSelect({ anchor: idx, selected: new Set([idx]) })
  }

  const remove = (index: number) => {
    onChange(columns.filter((_, i) => i !== index))
    setRowSelect(prev => {
      const next = new Set<number>()
      prev.selected.forEach((i) => {
        if (i === index) return
        next.add(i > index ? i - 1 : i)
      })
      let anchor = prev.anchor
      if (anchor === index) anchor = null
      else if (anchor !== null && anchor > index) anchor = anchor - 1
      return { anchor, selected: next }
    })
    if (selectedIndex === index) setSelectedIndex(null)
    else if (selectedIndex !== null && selectedIndex > index) setSelectedIndex(selectedIndex - 1)
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= columns.length) return
    const next = [...columns]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    setRowSelect(prev => {
      const selected = new Set<number>()
      prev.selected.forEach((i) => {
        if (i === index) selected.add(target)
        else if (i === target) selected.add(index)
        else selected.add(i)
      })
      const anchor = prev.anchor === index ? target : prev.anchor === target ? index : prev.anchor
      return { anchor, selected }
    })
    setSelectedIndex(target)
  }

  const insertColumn = (index: number) => {
    const next = [...columns]
    next.splice(index, 0, { ...emptyCol })
    onChange(next)
    setSelectedIndex(index)
    setRowSelect({ anchor: index, selected: new Set([index]) })
  }

  const handleMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    resizing.current = { index, startX: e.clientX, startWidth: colWidths[index] }
    const handleMouseMove = (e: MouseEvent) => {
      const currentResize = resizing.current
      if (!currentResize) return
      const { index, startX, startWidth } = currentResize
      const diff = e.clientX - startX
      const newWidth = Math.max(40, startWidth + diff)
      setColWidths(prev => {
        const next = [...prev]
        next[index] = newWidth
        return next
      })
    }
    const handleMouseUp = () => {
      resizing.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      resizeHandlersRef.current = { move: null, up: null }
    }
    resizeHandlersRef.current = { move: handleMouseMove, up: handleMouseUp }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [colWidths])

  useEffect(() => {
    return () => {
      resizing.current = null
      if (resizeHandlersRef.current.move) {
        document.removeEventListener('mousemove', resizeHandlersRef.current.move)
      }
      if (resizeHandlersRef.current.up) {
        document.removeEventListener('mouseup', resizeHandlersRef.current.up)
      }
    }
  }, [])

  const headers = ['名称', '类型', '长度', '小数', '不是Null', '键', '注释']

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <Button size="small" icon={<PlusOutlined />} onClick={add}>添加字段</Button>
        <Button size="small" icon={<PlusOutlined />} onClick={() => selectedIndex !== null && insertColumn(selectedIndex)} disabled={selectedIndex === null}>插入字段</Button>
        <Button size="small" icon={<DeleteOutlined />} onClick={() => selectedIndex !== null && remove(selectedIndex)} disabled={selectedIndex === null}>删除字段</Button>
        <Button size="small" icon={<KeyOutlined />} onClick={() => selectedIndex !== null && updateSelected('primaryKey', !selectedCol?.primaryKey)} disabled={selectedIndex === null}>主键</Button>
        <Button size="small" icon={<ArrowUpOutlined />} onClick={() => selectedIndex !== null && move(selectedIndex, -1)} disabled={selectedIndex === null || selectedIndex === 0}>上移</Button>
        <Button size="small" icon={<ArrowDownOutlined />} onClick={() => selectedIndex !== null && move(selectedIndex, 1)} disabled={selectedIndex === null || selectedIndex === columns.length - 1}>下移</Button>
      </div>

      {/* 表格区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', minHeight: 0 }}>
        {/* 表头 */}
        <div style={{ display: 'flex', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {headers.map((h, i) => (
            <div key={i} style={{ width: colWidths[i], minWidth: colWidths[i], padding: '8px 6px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', position: 'relative', boxSizing: 'border-box' }}>
              {h}
              {i < headers.length - 1 && (
                <div
                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', background: 'transparent' }}
                  onMouseDown={(e) => handleMouseDown(e, i)}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--accent)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                />
              )}
            </div>
          ))}
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {columns.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>暂无字段，点击"添加字段"开始</div>
          ) : (
            columns.map((col, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  borderBottom: '1px solid var(--border)',
                  background: rowSelect.selected.has(i) ? 'var(--accent-bg)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={(e) => handleRowSelect(i, e)}
              >
                <div style={{ width: colWidths[0], minWidth: colWidths[0], padding: '4px 6px' }}>
                  <Input size="small" value={col.name} onChange={(e) => update(i, 'name', e.target.value)} onBlur={() => handleNameBlur(i)} style={{ width: '100%' }} onClick={(e) => e.stopPropagation()} />
                </div>
                <div style={{ width: colWidths[1], minWidth: colWidths[1], padding: '4px 6px' }}>
                  <Select size="small" value={col.type} onChange={(v) => update(i, 'type', v)} style={{ width: '100%' }} options={TYPES.map((t) => ({ value: t, label: t }))} />
                </div>
                <div style={{ width: colWidths[2], minWidth: colWidths[2], padding: '4px 6px' }}>
                  <Input size="small" value={col.length} onChange={(e) => update(i, 'length', e.target.value)} style={{ width: '100%' }} onClick={(e) => e.stopPropagation()} />
                </div>
                <div style={{ width: colWidths[3], minWidth: colWidths[3], padding: '4px 6px' }}>
                  <Input size="small" value={col.decimals} onChange={(e) => update(i, 'decimals', e.target.value)} style={{ width: '100%' }} onClick={(e) => e.stopPropagation()} />
                </div>
                <div style={{ width: colWidths[4], minWidth: colWidths[4], padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Checkbox checked={!col.nullable} onChange={(v) => update(i, 'nullable', !v)} />
                </div>
                <div style={{ width: colWidths[5], minWidth: colWidths[5], padding: '4px 6px' }}>
                  <Select
                    size="small"
                    value={col.primaryKey ? 'PRI' : col.unique ? 'UNI' : ''}
                    onChange={(v) => updateKey(i, v as string)}
                    style={{ width: '100%' }}
                    options={[
                      { value: '', label: '-' },
                      { value: 'PRI', label: '🔑' },
                      { value: 'UNI', label: 'UNI' },
                    ]}
                  />
                </div>
                <div style={{ width: colWidths[6], minWidth: colWidths[6], padding: '4px 6px' }}>
                  <Input size="small" value={col.comment} onChange={(e) => update(i, 'comment', e.target.value)} style={{ width: '100%' }} onClick={(e) => e.stopPropagation()} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 下方属性面板 */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '12px 0', marginTop: 8, flexShrink: 0 }}>
        {selectedCol ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>默认:</span>
              <Input
                size="small"
                value={selectedCol.defaultValue}
                onChange={(e) => updateSelected('defaultValue', e.target.value)}
                placeholder="无"
                style={{ width: 200 }}
              />
            </div>
            <Checkbox checked={selectedCol.autoIncrement} onChange={(v) => updateSelected('autoIncrement', v)}>
              自动递增
            </Checkbox>
            <Checkbox checked={selectedCol.unsigned} onChange={(v) => updateSelected('unsigned', v)}>
              无符号
            </Checkbox>
            <Checkbox checked={selectedCol.zerofill} onChange={(v) => updateSelected('zerofill', v)}>
              填充零
            </Checkbox>
            <Checkbox checked={selectedCol.onUpdateCurrentTimestamp} onChange={(v) => updateSelected('onUpdateCurrentTimestamp', v)}>
              更新时自动更新时间戳
            </Checkbox>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>选择一个字段以编辑其属性</div>
        )}
      </div>
    </div>
  )
}
