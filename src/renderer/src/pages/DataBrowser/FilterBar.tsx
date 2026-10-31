import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FilterOutlined, PlusOutlined, CloseOutlined, CodeOutlined, SearchOutlined, CheckOutlined } from '@ant-design/icons'
import { Button, DateTimePicker, Tooltip } from '../../components/ui'
import {
  appendConditionWithJoin,
  findCommonParent,
  groupFilterNodes,
  ungroupFilterNode,
  getDefaultSimpleFilter,
  isDateLikeType,
  normalizeFilterTree,
  removeFilterNode,
  replaceFilterNode,
  toggleGroupJoin,
  type FilterMode,
  type SimpleFilterJoin,
  type SimpleFilterCondition,
  type SimpleFilterGroup,
  type SimpleFilterNode,
} from './table-filter'

interface ColumnOption {
  name: string
  type: string
  comment: string
}

interface Props {
  columns: ColumnOption[]
  mode: FilterMode
  tree: SimpleFilterGroup
  where: string
  /** 当前生效的筛选 SQL，用于切换到 WHERE 模式时预填 */
  filterSql: string
  getOperatorOptions: (column: string) => Array<{ value: string | number; label: React.ReactNode }>
  onApply: (mode: FilterMode, tree: SimpleFilterGroup, where: string) => void
  extra?: React.ReactNode
  onClearAll?: () => void
}

const OPERATOR_TEXT: Record<string, string> = {
  '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤',
  contains: '包含', startsWith: '开头是', endsWith: '结尾是', like: 'LIKE', notLike: 'NOT LIKE',
  between: '介于', notBetween: '不介于', IN: '属于', 'NOT IN': '不属于', 'IS NULL': '为空', 'IS NOT NULL': '不为空',
}

const NO_VALUE = new Set(['IS NULL', 'IS NOT NULL'])
const RANGE = new Set(['between', 'notBetween'])

const conditionText = (c: SimpleFilterCondition) => {
  const op = OPERATOR_TEXT[c.operator] ?? c.operator
  if (NO_VALUE.has(c.operator)) return { op, value: '' }
  if (RANGE.has(c.operator)) return { op, value: `${c.value} ~ ${c.secondValue ?? ''}` }
  if (c.operator === 'IN' || c.operator === 'NOT IN') return { op, value: `[${c.value}]` }
  return { op, value: c.value }
}


// edit: 修改条件；add: 向某一层追加
type Editing = { kind: 'edit' | 'add'; target: string; left: number }

const countConditions = (group: SimpleFilterGroup): number =>
  group.children.reduce((n, c) => n + (c.type === 'condition' ? 1 : countConditions(c)), 0)
const editingKey = (e: Pick<Editing, 'kind' | 'target'>) => `${e.kind}:${e.target}`

export function FilterBar({ columns, mode, tree, where, filterSql, getOperatorOptions, onApply, extra, onClearAll }: Props) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const root = normalizeFilterTree(tree)
  const hasConditions = root.children.length > 0
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const selectionParent = selected.length ? findCommonParent(root, selected) : null
  const canGroup = selected.length >= 2 && Boolean(selectionParent)

  const toggleSelect = (id: string) => {
    setEditing(null)
    setSelecting(true)
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  const exitSelect = () => { setSelecting(false); setSelected([]) }

  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitSelect() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting])

  // 条件被删除或刷新后，清掉已不存在的选择
  useEffect(() => {
    const exists = (g: SimpleFilterGroup, id: string): boolean => g.children.some((c) => c.id === id || (c.type === 'group' && exists(c, id)))
    setSelected((prev) => {
      const next = prev.filter((id) => exists(root, id))
      return next.length === prev.length ? prev : next
    })
  }, [tree])

  const groupSelected = () => {
    if (!canGroup) return
    apply(groupFilterNodes(root, selected))
    exitSelect()
  }

  const selectHint = selected.length === 0
    ? '点击条件或括号，选出要放进同一个括号里的项'
    : !selectionParent
      ? '只能把同一层的项放进一个括号，请取消其他层的选择'
      : selected.length === 1
        ? '再选至少 1 项（需在同一层）'
        : `已选 ${selected.length} 项，点击「加括号」把它们括起来`

  const openEditor = (kind: Editing['kind'], target: string, el: HTMLElement) => {
    const bar = barRef.current
    if (!bar) return
    const left = Math.max(0, Math.min(el.getBoundingClientRect().left - bar.getBoundingClientRect().left, bar.clientWidth - 360))
    setEditing((prev) => (prev && editingKey(prev) === `${kind}:${target}` ? null : { kind, target, left }))
  }

  const apply = (next: SimpleFilterGroup) => onApply('simple', next, where)

  const findGroup = (group: SimpleFilterGroup, id: string): SimpleFilterGroup | undefined => {
    if (group.id === id) return group
    for (const child of group.children) {
      if (child.type !== 'group') continue
      const found = findGroup(child, id)
      if (found) return found
    }
    return undefined
  }
  const addTarget = editing?.kind === 'add' ? findGroup(root, editing.target) : undefined

  const saveCondition = (condition: SimpleFilterCondition, join?: SimpleFilterJoin) => {
    if (!editing) return
    if (editing.kind === 'edit') apply(replaceFilterNode(root, editing.target, condition))
    else apply(appendConditionWithJoin(root, editing.target, condition, join ?? addTarget?.join ?? 'AND'))
    setEditing(null)
  }

  const removeNode = (id: string) => {
    apply(removeFilterNode(root, id))
    setEditing(null)
  }

  const findCondition = (group: SimpleFilterGroup, id: string): SimpleFilterCondition | undefined => {
    for (const child of group.children) {
      if (child.type === 'condition' && child.id === id) return child
      if (child.type === 'group') {
        const found = findCondition(child, id)
        if (found) return found
      }
    }
    return undefined
  }
  const editingCondition = editing?.kind === 'edit' ? findCondition(root, editing.target) : undefined

  const joinButton = (group: SimpleFilterGroup) => (
    <button
      type="button"
      className={`fb-join ${group.join === 'OR' ? 'or' : ''}`}
      title={group.join === 'AND'
        ? '且：本层条件需同时满足，点击改为 或（作用于本层所有连接）'
        : '或：本层条件满足其一即可，点击改为 且（作用于本层所有连接）'}
      onClick={() => apply(toggleGroupJoin(root, group.id))}
    >
      {group.join === 'AND' ? '且' : '或'}
    </button>
  )

  const renderCondition = (node: SimpleFilterCondition) => {
    const { op, value } = conditionText(node)
    const active = editing && editing.target === node.id
    const isSelected = selected.includes(node.id)
    return (
      <span className={`fb-tag ${active ? 'editing' : ''} ${isSelected ? 'selected' : ''} ${selecting ? 'selectable' : ''}`}>
        {isSelected && <CheckOutlined className="fb-check" />}
        <button
          type="button"
          className="fb-tag-body"
          title={selecting ? '点击选择 / 取消选择' : '点击修改；Ctrl+点击可多选后加括号'}
          onClick={(e) => {
            if (selecting || e.ctrlKey || e.metaKey) toggleSelect(node.id)
            else openEditor('edit', node.id, e.currentTarget)
          }}
        >
          <span className="fb-tag-col">{node.column}</span>
          <span className="fb-tag-op">{op}</span>
          {value && <span className="fb-tag-val">{value}</span>}
        </button>
        {!selecting && <button type="button" className="fb-tag-x" title="移除" onClick={() => removeNode(node.id)}><CloseOutlined /></button>}
      </span>
    )
  }

  const renderChildren = (group: SimpleFilterGroup) => group.children.map((child, index) => (
    <React.Fragment key={child.id}>
      {index > 0 && joinButton(group)}
      {child.type === 'condition' ? renderCondition(child) : (
        <span
          className={`fb-group ${child.join === 'OR' ? 'is-or' : ''} ${selected.includes(child.id) ? 'selected' : ''} ${selecting ? 'selectable' : ''}`}
          onClick={(e) => {
            // 选择模式下点括号的空白处 / 边框即选中整个括号
            if (selecting && e.target === e.currentTarget) toggleSelect(child.id)
          }}
        >
          <button
            type="button"
            className="fb-group-handle"
            title={selecting ? '选择 / 取消选择整个括号' : '选择整个括号（可与其他项一起再加括号）'}
            onClick={() => toggleSelect(child.id)}
          >
            {selected.includes(child.id) ? <CheckOutlined /> : '('}
          </button>
          {renderChildren(child)}
          <span className="fb-group-close" aria-hidden>)</span>
          {!selecting && (
            <>
              <button type="button" className="fb-group-add" title="在此括号内添加条件" onClick={(e) => openEditor('add', child.id, e.currentTarget)}><PlusOutlined /></button>
              <button type="button" className="fb-group-unwrap" title="去掉括号，里面的条件保留" onClick={() => apply(ungroupFilterNode(root, child.id))}>去括号</button>
              <button type="button" className="fb-group-x" title="删除整个括号及其中的条件" onClick={() => removeNode(child.id)}><CloseOutlined /></button>
            </>
          )}
        </span>
      )}
    </React.Fragment>
  ))

  if (mode === 'advanced') {
    return (
      <div className="fb-bar fb-bar-where" ref={barRef}>
        <WhereInput
          value={where}
          columns={columns}
          onApply={(sql) => onApply('advanced', tree, sql)}
        />
        {extra}
        <Tooltip title="切换回条件筛选（WHERE 条件将被清除）" placement="left">
          <button type="button" className="fb-mode active" onClick={() => onApply('simple', tree, '')}>
            <CodeOutlined /> WHERE
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="fb-bar" ref={barRef}>
      <span className={`fb-label ${hasConditions ? 'active' : ''}`}><FilterOutlined /></span>
      <div className={`fb-items ${selecting ? 'is-selecting' : ''}`}>
      {renderChildren(root)}
      {!selecting && (
        <button
          type="button"
          className={`fb-add ${editing?.kind === 'add' && editing.target === root.id ? 'editing' : ''}`}
          disabled={!columns.length}
          onClick={(e) => openEditor('add', root.id, e.currentTarget)}
        >
          <PlusOutlined /> {hasConditions ? '添加' : '添加筛选条件'}
        </button>
      )}
      {!selecting && countConditions(root) >= 2 && (
        <button type="button" className="fb-add fb-add-group" title="选出几个条件或括号，把它们放进同一个括号" onClick={() => { setEditing(null); setSelecting(true) }}>
          <span className="fb-paren">( )</span> 加括号
        </button>
      )}
      {!selecting && extra}
      {selecting && (
        <div className="fb-select-strip">
          <span className={`fb-select-hint ${selected.length >= 2 && !selectionParent ? 'warn' : ''}`}>{selectHint}</span>
          <Button size="small" onClick={exitSelect}>取消</Button>
          <Button size="small" type="primary" disabled={!canGroup} onClick={groupSelected}>
            <span className="fb-paren">( )</span> 加括号
          </Button>
        </div>
      )}
      </div>
      {onClearAll && <button type="button" className="db-link" onClick={onClearAll}>清除全部</button>}
      <Tooltip title="直接编写 WHERE 条件" placement="left">
        <button type="button" className="fb-mode" onClick={() => { setEditing(null); onApply('advanced', tree, filterSql) }}>
          <CodeOutlined /> WHERE
        </button>
      </Tooltip>

      {editing && (
        <ConditionEditor
          key={editingKey(editing)}
          left={editing.left}
          columns={columns}
          initial={editingCondition}
          joinScope={addTarget && addTarget.children.length > 0
            ? { join: addTarget.join, count: addTarget.children.length, isRoot: addTarget.id === root.id }
            : undefined}
          getOperatorOptions={getOperatorOptions}
          onSave={saveCondition}
          onClose={() => setEditing(null)}
          barRef={barRef}
        />
      )}
    </div>
  )
}

function ConditionEditor({ left, columns, initial, joinScope, getOperatorOptions, onSave, onClose, barRef }: {
  left: number
  columns: ColumnOption[]
  initial?: SimpleFilterCondition
  /** 追加条件时：所在层当前的 且/或 和已有项数 */
  joinScope?: { join: SimpleFilterJoin; count: number; isRoot: boolean }
  getOperatorOptions: Props['getOperatorOptions']
  onSave: (c: SimpleFilterCondition, join?: SimpleFilterJoin) => void
  onClose: () => void
  barRef: React.RefObject<HTMLDivElement>
}) {
  const [draft, setDraft] = useState<SimpleFilterCondition>(() => initial ? { ...initial } : getDefaultSimpleFilter())
  const [picking, setPicking] = useState(!initial)
  const [keyword, setKeyword] = useState('')
  const [active, setActive] = useState(0)
  const [join, setJoin] = useState<SimpleFilterJoin>(joinScope?.join ?? 'AND')
  const popRef = useRef<HTMLDivElement | null>(null)
  const valueRef = useRef<HTMLInputElement | null>(null)
  const secondRef = useRef<HTMLInputElement | null>(null)
  const [picker, setPicker] = useState<{ field: 'value' | 'secondValue'; rect: { left: number; right: number; top: number; bottom: number } } | null>(null)
  // 日期选择器默认与锚点右对齐，这里让它在输入框下方左对齐
  const anchorOf = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.left + 280, top: r.top, bottom: r.bottom + 4 }
  }

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (popRef.current?.contains(target)) return
      if ((target as Element).closest?.('.ui-dtp-panel')) return
      // 点击栏上的标签/按钮由各自的 onClick 处理切换
      if (barRef.current?.contains(target) && (target as Element).closest?.('.fb-tag, .fb-add, .fb-group-add')) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose, barRef])

  useLayoutEffect(() => {
    if (!picking) valueRef.current?.focus({ preventScroll: true })
  }, [picking])

  const matches = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return k ? columns.filter((c) => c.name.toLowerCase().includes(k) || c.comment.toLowerCase().includes(k)) : columns
  }, [columns, keyword])

  const column = columns.find((c) => c.name === draft.column)
  const operators = draft.column ? getOperatorOptions(draft.column) : []
  const needsValue = !NO_VALUE.has(draft.operator)
  const isRange = RANGE.has(draft.operator)
  const placeholder = draft.operator === 'IN' || draft.operator === 'NOT IN'
    ? '多个值用逗号分隔'
    : column && isDateLikeType(column.type) ? 'YYYY-MM-DD HH:mm:ss' : draft.operator === 'like' || draft.operator === 'notLike' ? '可用 % 和 _ 通配' : '输入值'
  // 日期/时间类字段用选择器；TIME、YEAR 和「属于」列表仍然手动输入
  const dateKind = column && isDateLikeType(column.type) && !/^(time|year)/i.test(column.type) && draft.operator !== 'IN' && draft.operator !== 'NOT IN'
    ? (/^date\b(?!time)/i.test(column.type) ? 'date' : 'datetime')
    : null
  const openPicker = (field: 'value' | 'secondValue', el: HTMLInputElement | null) => {
    if (!dateKind || !el) return
    setPicker({ field, rect: anchorOf(el) })
  }
  const canSave = Boolean(draft.column) && (!needsValue || (draft.value.trim() && (!isRange || draft.secondValue?.trim())))

  const pick = (name: string) => {
    const ops = getOperatorOptions(name)
    const keepOperator = ops.some((o) => o.value === draft.operator) && draft.column
    setDraft((d) => ({ ...d, column: name, operator: keepOperator ? d.operator : String(ops[0]?.value ?? '=') }))
    setPicking(false)
    setKeyword('')
  }

  const save = () => { if (canSave) onSave(draft, joinScope ? join : undefined) }
  const willWrap = Boolean(joinScope && joinScope.count >= 2 && join !== joinScope.join)

  const onValueKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fb-pop"
      ref={popRef}
      style={{ left }}
      onKeyDown={(e) => {
        if (picking || (e.target as HTMLElement).tagName === 'INPUT') return
        if (e.key === 'Enter') { e.preventDefault(); save() }
        if (e.key === 'Escape') onClose()
      }}
    >
      {joinScope && (
        <div className="fb-pop-join">
          <span>与{joinScope.isRoot ? '已有条件' : '括号内条件'}</span>
          <div className="fb-pop-join-seg">
            {(['AND', 'OR'] as const).map((j) => (
              <button key={j} type="button" className={`${join === j ? 'active' : ''} ${j === 'OR' ? 'or' : ''}`} onClick={() => setJoin(j)}>
                {j === 'AND' ? '且' : '或'}
              </button>
            ))}
          </div>
          <span className="fb-pop-join-hint">
            {willWrap ? `已有条件将整体加括号` : join === 'AND' ? '同时满足' : '满足其一'}
          </span>
        </div>
      )}
      {picking ? (
        <>
          <div className="fb-pop-search">
            <SearchOutlined />
            <input
              ref={(el) => el?.focus({ preventScroll: true })}
              value={keyword}
              placeholder="搜索字段名或注释"
              onChange={(e) => { setKeyword(e.target.value); setActive(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
                if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active].name) }
                if (e.key === 'Escape') { if (draft.column) setPicking(false); else onClose() }
              }}
            />
          </div>
          <div className="fb-pop-list">
            {matches.map((c, i) => (
              <button
                key={c.name}
                type="button"
                className={`fb-pop-col ${i === active ? 'active' : ''} ${c.name === draft.column ? 'current' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c.name)}
              >
                <span className="fb-pop-col-name">{c.name}</span>
                {c.comment && <span className="fb-pop-col-comment">{c.comment}</span>}
                <span className="fb-pop-col-type">{c.type}</span>
              </button>
            ))}
            {matches.length === 0 && <div className="fb-pop-empty">没有匹配的字段</div>}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="fb-pop-field" onClick={() => setPicking(true)} title="更换字段">
            <span className="fb-pop-col-name">{draft.column}</span>
            {column?.comment && <span className="fb-pop-col-comment">{column.comment}</span>}
            <span className="fb-pop-change">更换</span>
          </button>
          <div className="fb-pop-ops">
            {operators.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                className={draft.operator === o.value ? 'active' : ''}
                onClick={() => {
                  setDraft((d) => ({ ...d, operator: String(o.value) }))
                  valueRef.current?.focus({ preventScroll: true })
                }}
              >
                {OPERATOR_TEXT[String(o.value)] ?? o.label}
              </button>
            ))}
          </div>
          {needsValue && (
            <div className={`fb-pop-values ${dateKind ? 'is-date' : ''}`}>
              <input
                ref={valueRef}
                className="fb-pop-input"
                value={draft.value}
                placeholder={dateKind ? (isRange ? '开始时间' : '选择时间') : isRange ? '起始值' : placeholder}
                spellCheck={false}
                onClick={(e) => openPicker('value', e.currentTarget)}
                onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                onKeyDown={onValueKey}
              />
              {isRange && (
                <>
                  <span className="fb-pop-tilde">~</span>
                  <input
                    ref={secondRef}
                    className="fb-pop-input"
                    value={draft.secondValue ?? ''}
                    placeholder={dateKind ? '结束时间' : '结束值'}
                    spellCheck={false}
                    onClick={(e) => openPicker('secondValue', e.currentTarget)}
                    onChange={(e) => setDraft((d) => ({ ...d, secondValue: e.target.value }))}
                    onKeyDown={onValueKey}
                  />
                </>
              )}
            </div>
          )}
          {picker && dateKind && (
            <DateTimePicker
              key={picker.field}
              value={(picker.field === 'value' ? draft.value : draft.secondValue) || undefined}
              dateOnly={dateKind === 'date'}
              anchorRect={picker.rect}
              onConfirm={(val) => {
                const field = picker.field
                setDraft((d) => ({ ...d, [field]: val }))
                // 选完开始时间后接着选结束时间
                if (field === 'value' && isRange && !draft.secondValue) {
                  const el = secondRef.current
                  setPicker(el ? { field: 'secondValue', rect: anchorOf(el) } : null)
                } else {
                  setPicker(null)
                }
              }}
              onCancel={() => setPicker(null)}
            />
          )}
          <div className="fb-pop-foot">
            <span className="fb-pop-hint">Enter 应用 · Esc 取消</span>
            <Button size="small" onClick={onClose}>取消</Button>
            <Button size="small" type="primary" disabled={!canSave} onClick={save}>{initial ? '更新' : '应用'}</Button>
          </div>
        </>
      )}
    </div>
  )
}

function WhereInput({ value, columns, onApply }: { value: string; columns: ColumnOption[]; onApply: (sql: string) => void }) {
  const [text, setText] = useState(value)
  const [suggest, setSuggest] = useState<{ items: ColumnOption[]; start: number; active: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const caretRef = useRef<number | null>(null)

  useEffect(() => { setText(value) }, [value])

  // 补全后在同一帧内放置光标，避免紧接着输入的字符落到错误位置
  useLayoutEffect(() => {
    if (caretRef.current === null || !inputRef.current) return
    inputRef.current.setSelectionRange(caretRef.current, caretRef.current)
    caretRef.current = null
  }, [text])

  const updateSuggest = (next: string, caret: number) => {
    const token = next.slice(0, caret).match(/[A-Za-z0-9_$一-龥]+$/)
    if (!token) { setSuggest(null); return }
    const k = token[0].toLowerCase()
    const items = columns.filter((c) => c.name.toLowerCase().startsWith(k) && c.name.toLowerCase() !== k).slice(0, 8)
    setSuggest(items.length ? { items, start: caret - token[0].length, active: 0 } : null)
  }

  const accept = (name: string) => {
    const el = inputRef.current
    if (!el || !suggest) return
    const caret = el.selectionStart ?? text.length
    const insert = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name}\``
    const next = text.slice(0, suggest.start) + insert + text.slice(caret)
    caretRef.current = suggest.start + insert.length
    setText(next)
    setSuggest(null)
  }

  const dirty = text.trim() !== value.trim()

  return (
    <div className={`fb-where ${dirty ? 'dirty' : ''}`}>
      <span className="fb-where-kw">WHERE</span>
      <input
        ref={(el) => {
          if (el && inputRef.current !== el) el.focus({ preventScroll: true })
          inputRef.current = el
        }}
        value={text}
        spellCheck={false}
        placeholder="例如 status = 1 AND create_time >= '2026-01-01'"
        onChange={(e) => { setText(e.target.value); updateSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length) }}
        onBlur={() => window.setTimeout(() => setSuggest(null), 120)}
        onKeyDown={(e) => {
          if (suggest) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSuggest({ ...suggest, active: Math.min(suggest.active + 1, suggest.items.length - 1) }); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSuggest({ ...suggest, active: Math.max(suggest.active - 1, 0) }); return }
            if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(suggest.items[suggest.active].name); return }
            if (e.key === 'Escape') { setSuggest(null); return }
          }
          if (e.key === 'Enter') onApply(text.trim())
          if (e.key === 'Escape') setText(value)
        }}
      />
      {dirty && <span className="fb-where-hint">回车应用</span>}
      {value && <button type="button" className="fb-tag-x" title="清除条件" onClick={() => { setText(''); onApply('') }}><CloseOutlined /></button>}
      {suggest && (
        <div className="fb-suggest">
          {suggest.items.map((c, i) => (
            <button
              key={c.name}
              type="button"
              className={i === suggest.active ? 'active' : ''}
              onMouseDown={(e) => { e.preventDefault(); accept(c.name) }}
            >
              <span className="fb-pop-col-name">{c.name}</span>
              {c.comment && <span className="fb-pop-col-comment">{c.comment}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
