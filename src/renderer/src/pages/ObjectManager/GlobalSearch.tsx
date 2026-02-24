import React, { useState, useCallback } from 'react'
import { Input, Tag, Checkbox, Space, Empty, Spin } from '../../components/ui'
import { TableOutlined, EyeOutlined, FunctionOutlined, ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { ObjectSearchResult } from '../../../../shared/types/metadata'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

const TYPE_CONFIG: Record<string, { type: string; icon: React.ReactNode }> = {
  TABLE: { type: 'primary', icon: <TableOutlined /> },
  VIEW: { type: 'success', icon: <EyeOutlined /> },
  PROCEDURE: { type: 'warning', icon: <FunctionOutlined /> },
  FUNCTION: { type: 'default', icon: <FunctionOutlined /> },
  TRIGGER: { type: 'warning', icon: <ThunderboltOutlined /> },
  EVENT: { type: 'error', icon: <ClockCircleOutlined /> },
}

const ALL_TYPES = Object.keys(TYPE_CONFIG)

const GlobalSearch: React.FC = () => {
  const [results, setResults] = useState<ObjectSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string[]>(ALL_TYPES)
  const [searchText, setSearchText] = useState('')
  const connId = useConnectionStore((s) => s.activeConnectionId)
  const db = useAppStore((s) => s.selectedDatabase)

  const search = useCallback(async (text: string) => {
    setSearchText(text)
    if (!connId || !db || !text.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const res = await api.object.search(connId, db, text)
      setResults(Array.isArray(res) ? res : [])
    } catch { setResults([]) } finally { setLoading(false) }
  }, [connId, db])

  let debounceTimer: ReturnType<typeof setTimeout>
  const onSearch = (text: string) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => search(text), 300)
  }

  const filtered = results.filter((r) => typeFilter.includes(r.type))
  const grouped = ALL_TYPES.reduce((acc, type) => {
    const items = filtered.filter((r) => r.type === type)
    if (items.length > 0) acc[type] = items
    return acc
  }, {} as Record<string, ObjectSearchResult[]>)

  const toggleType = (type: string, checked: boolean) => {
    setTypeFilter((prev) => checked ? [...prev, type] : prev.filter((t) => t !== type))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Input placeholder="搜索数据库对象..." onChange={(e) => onSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search((e.target as HTMLInputElement).value)} />
      <Space style={{ flexWrap: 'wrap' }}>
        <span>筛选：</span>
        {ALL_TYPES.map((t) => (
          <Checkbox key={t} checked={typeFilter.includes(t)} onChange={(v) => toggleType(t, v)}>
            <Tag type={TYPE_CONFIG[t].type as any}>{TYPE_CONFIG[t].icon} {t}</Tag>
          </Checkbox>
        ))}
      </Space>

      <Spin spinning={loading}>
        {Object.keys(grouped).length > 0 ? (
          Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h4 style={{ margin: '8px 0 4px' }}>
                <Tag type={TYPE_CONFIG[type].type as any}>{TYPE_CONFIG[type].icon} {type}</Tag>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({items.length})</span>
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map((item) => (
                  <div key={item.name} style={{ padding: '8px 12px', background: 'var(--bg-hover)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {TYPE_CONFIG[item.type].icon}
                    <span style={{ fontWeight: 500 }}>{item.name}</span>
                    <Tag type={TYPE_CONFIG[item.type].type as any} style={{ fontSize: 10 }}>{item.type}</Tag>
                    {item.comment && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{item.comment}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          !loading && <Empty description={searchText ? '未找到匹配的对象' : '输入关键词开始搜索'} />
        )}
      </Spin>
    </div>
  )
}

export default GlobalSearch
