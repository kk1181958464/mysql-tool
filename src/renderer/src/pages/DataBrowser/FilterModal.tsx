import React, { useState } from 'react'
import { Modal, Select, Input, Button, Tag } from '../../components/ui'
import { FilterOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'

export type FilterMode = 'simple' | 'advanced'
export type SimpleFilterJoin = 'AND' | 'OR'
export type SimpleFilterNode = SimpleFilterGroup | SimpleFilterCondition

export interface SimpleFilterCondition {
  id: string
  type: 'condition'
  column: string
  operator: string
  value: string
  secondValue?: string
}

export interface SimpleFilterGroup {
  id: string
  type: 'group'
  join: SimpleFilterJoin
  children: SimpleFilterNode[]
}

interface Option {
  value: string | number
  label: React.ReactNode
  disabled?: boolean
}

interface Props {
  open: boolean
  filterMode: FilterMode
  simpleFilterTree: SimpleFilterGroup
  whereInput: string
  effectiveWhere: string
  columnOptions: Option[]
  onClose: () => void
  onApply: () => void
  onFilterModeChange: (mode: FilterMode) => void
  onGroupJoinChange: (groupId: string, join: SimpleFilterJoin) => void
  onConditionColumnChange: (conditionId: string, column: string) => void
  onConditionChange: (conditionId: string, field: keyof Omit<SimpleFilterCondition, 'id' | 'type'>, value: string) => void
  onAddCondition: (groupId: string) => void
  onAddGroup: (groupId: string) => void
  onRemoveNode: (nodeId: string) => void
  onMoveNode: (groupId: string, fromIndex: number, toIndex: number) => void
  onWhereInputChange: (value: string) => void
  getOperatorOptions: (columnName: string) => Option[]
}

const isNullOperator = (operator: string) => ['IS NULL', 'IS NOT NULL'].includes(operator)
const isBetweenOperator = (operator: string) => ['between', 'notBetween'].includes(operator)
const isListOperator = (operator: string) => ['IN', 'NOT IN'].includes(operator)

interface GroupEditorProps extends Pick<Props,
  | 'columnOptions'
  | 'onGroupJoinChange'
  | 'onConditionColumnChange'
  | 'onConditionChange'
  | 'onAddCondition'
  | 'onAddGroup'
  | 'onRemoveNode'
  | 'onMoveNode'
  | 'getOperatorOptions'> {
  group: SimpleFilterGroup
  depth: number
  isRoot?: boolean
}

const joinLabelMap: Record<SimpleFilterJoin, string> = {
  AND: 'AND',
  OR: 'OR',
}

const parseListInput = (raw: string): string[] => {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const formatListInput = (items: string[]): string => items.join(', ')

interface ListValueEditorProps {
  value: string
  onChange: (value: string) => void
}

const ListValueEditor: React.FC<ListValueEditorProps> = ({ value, onChange }) => {
  const [draft, setDraft] = useState('')
  const items = parseListInput(value)

  const appendDraftValues = () => {
    const nextDraftItems = parseListInput(draft)
    if (nextDraftItems.length === 0) return
    const nextItems = Array.from(new Set([...items, ...nextDraftItems]))
    onChange(formatListInput(nextItems))
    setDraft('')
  }

  const removeItem = (target: string, index: number) => {
    const nextItems = items.filter((item, itemIndex) => !(item === target && itemIndex === index))
    onChange(formatListInput(nextItems))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260, flex: 1 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="输入单个值后回车，或逗号分隔多个值"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            appendDraftValues()
          }}
          style={{ width: 260 }}
        />
        <Button variant="default" size="small" onClick={appendDraftValues}>
          添加值
        </Button>
        {items.length > 0 && (
          <Button variant="default" size="small" onClick={() => onChange('')}>
            清空列表
          </Button>
        )}
      </div>
      {items.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {items.map((item, index) => (
            <div
              key={`${item}_${index}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 999,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                padding: '2px 8px',
              }}
            >
              <Tag>{item}</Tag>
              <button
                type="button"
                onClick={() => removeItem(item, index)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  lineHeight: 1,
                }}
                title="移除此值"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无列表项，添加后会作为独立值参与 IN / NOT IN。</div>
      )}
    </div>
  )
}

const GroupEditor: React.FC<GroupEditorProps> = ({
  group,
  depth,
  isRoot = false,
  columnOptions,
  onGroupJoinChange,
  onConditionColumnChange,
  onConditionChange,
  onAddCondition,
  onAddGroup,
  onRemoveNode,
  onMoveNode,
  getOperatorOptions,
}) => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: depth % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-surface)',
        marginLeft: isRoot ? 0 : 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="default" size="small" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? '展开组' : '折叠组'}
          </Button>
          <span style={{ fontSize: 12, fontWeight: 600 }}>条件组</span>
          <Select
            value={group.join}
            onChange={(value) => onGroupJoinChange(group.id, value as SimpleFilterJoin)}
            options={[
              { value: 'AND', label: 'AND（组内全部满足）' },
              { value: 'OR', label: 'OR（组内满足任一）' },
            ]}
            style={{ width: 190 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {isRoot ? '根组决定最外层组合方式' : `此组会自动加括号，当前 ${joinLabelMap[group.join]}`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="default" size="small" onClick={() => onAddCondition(group.id)} icon={<PlusOutlined />}>
            新增条件
          </Button>
          <Button variant="default" size="small" onClick={() => onAddGroup(group.id)} icon={<PlusOutlined />}>
            新增子组
          </Button>
          {!isRoot && (
            <Button variant="default" size="small" onClick={() => onRemoveNode(group.id)} icon={<DeleteOutlined />}>
              删除组
            </Button>
          )}
        </div>
      </div>

      {collapsed ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          已折叠，当前组内节点数：{group.children.length}
        </div>
      ) : group.children.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>此组暂无条件，可继续添加条件或子组。</div>
      ) : (
        group.children.map((child, index) => {
          if (child.type === 'group') {
            return (
              <div key={child.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {index > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginLeft: 4 }}>{group.join}</div>
                )}
                <GroupEditor
                  group={child}
                  depth={depth + 1}
                  columnOptions={columnOptions}
                  onGroupJoinChange={onGroupJoinChange}
                  onConditionColumnChange={onConditionColumnChange}
                  onConditionChange={onConditionChange}
                  onAddCondition={onAddCondition}
                  onAddGroup={onAddGroup}
                  onRemoveNode={onRemoveNode}
                  onMoveNode={onMoveNode}
                  getOperatorOptions={getOperatorOptions}
                />
                <div style={{ display: 'flex', gap: 6, marginLeft: 20 }}>
                  <Button variant="default" size="small" disabled={index === 0} onClick={() => onMoveNode(group.id, index, index - 1)}>
                    上移
                  </Button>
                  <Button variant="default" size="small" disabled={index === group.children.length - 1} onClick={() => onMoveNode(group.id, index, index + 1)}>
                    下移
                  </Button>
                </div>
              </div>
            )
          }

          const operatorOptions = getOperatorOptions(child.column)
          const operatorNeedsValue = !isNullOperator(child.operator)
          const isBetween = isBetweenOperator(child.operator)
          const isList = isListOperator(child.operator)

          return (
            <div key={child.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {index > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginLeft: 4 }}>{group.join}</div>
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  padding: 12,
                  border: '1px dashed var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-elevated, var(--bg-surface))',
                }}
              >
                <div style={{ minWidth: 64, fontSize: 12, color: 'var(--text-muted)' }}>条件</div>
                <Select
                  value={child.column || undefined}
                  onChange={(value) => onConditionColumnChange(child.id, value as string)}
                  options={columnOptions}
                  placeholder="字段"
                  style={{ width: 180 }}
                />
                <Select
                  value={child.operator}
                  onChange={(value) => onConditionChange(child.id, 'operator', value as string)}
                  options={operatorOptions}
                  placeholder="操作符"
                  style={{ width: 150 }}
                  disabled={!child.column}
                />
                {isList ? (
                  <ListValueEditor
                    value={child.value}
                    onChange={(nextValue) => onConditionChange(child.id, 'value', nextValue)}
                  />
                ) : (
                  <Input
                    value={child.value}
                    onChange={(e) => onConditionChange(child.id, 'value', e.target.value)}
                    placeholder={
                      operatorNeedsValue
                        ? isBetween
                          ? '起始值'
                          : '筛选值'
                        : '该操作符无需输入值'
                    }
                    disabled={!operatorNeedsValue}
                    style={{ width: 240 }}
                  />
                )}
                {isBetween && (
                  <Input
                    value={child.secondValue || ''}
                    onChange={(e) => onConditionChange(child.id, 'secondValue', e.target.value)}
                    placeholder="结束值"
                    style={{ width: 220 }}
                  />
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button variant="default" size="small" disabled={index === 0} onClick={() => onMoveNode(group.id, index, index - 1)}>
                    上移
                  </Button>
                  <Button variant="default" size="small" disabled={index === group.children.length - 1} onClick={() => onMoveNode(group.id, index, index + 1)}>
                    下移
                  </Button>
                </div>
                <Button variant="default" size="small" onClick={() => onRemoveNode(child.id)} icon={<DeleteOutlined />}>
                  删除条件
                </Button>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

export const FilterModal: React.FC<Props> = ({
  open,
  filterMode,
  simpleFilterTree,
  whereInput,
  effectiveWhere,
  columnOptions,
  onClose,
  onApply,
  onFilterModeChange,
  onGroupJoinChange,
  onConditionColumnChange,
  onConditionChange,
  onAddCondition,
  onAddGroup,
  onRemoveNode,
  onMoveNode,
  onWhereInputChange,
  getOperatorOptions,
}) => {
  return (
    <Modal
      open={open}
      title="筛选"
      width={980}
      onClose={onClose}
      footer={(
        <>
          <Button variant="default" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={onApply}>应用筛选</Button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>筛选模式</span>
            <Select
              value={filterMode}
              onChange={(value) => onFilterModeChange(value as FilterMode)}
              options={[
                { value: 'simple', label: '简单筛选' },
                { value: 'advanced', label: '高级 WHERE' },
              ]}
              style={{ width: 160 }}
            />
          </div>
          {effectiveWhere ? (
            <Tag color="primary">当前已应用：{effectiveWhere}</Tag>
          ) : (
            <Tag>当前未应用筛选</Tag>
          )}
        </div>

        {filterMode === 'simple' ? (
          <GroupEditor
            group={simpleFilterTree}
            depth={0}
            isRoot
            columnOptions={columnOptions}
            onGroupJoinChange={onGroupJoinChange}
            onConditionColumnChange={onConditionColumnChange}
            onConditionChange={onConditionChange}
            onAddCondition={onAddCondition}
            onAddGroup={onAddGroup}
            onRemoveNode={onRemoveNode}
            onMoveNode={onMoveNode}
            getOperatorOptions={getOperatorOptions}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              输入原始 WHERE 条件，不需要包含 WHERE 关键字。
            </div>
            <Input
              prefix={<FilterOutlined />}
              placeholder="例如：status = 'active' AND id > 10"
              value={whereInput}
              onChange={(e) => onWhereInputChange(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
