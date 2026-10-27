import React, { useState } from 'react'
import { ConnAvatar } from '../../components/ConnAvatar'
import { Input, Button, Tag, Popconfirm, Tooltip } from '../../components/ui'
import {
  PlusOutlined,
  CopyOutlined,
  DeleteOutlined,
  LinkOutlined,
  DisconnectOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import type { ConnectionConfig } from '../../../../shared/types/connection'
import { v4 as uuid } from 'uuid'

interface Props {
  onSelect: (conn: ConnectionConfig) => void
  onNew: () => void
  onClose: () => void
  selectedId?: string | null
  previewColor?: string | null
  previewIcon?: string | null
}

export const ConnectionList: React.FC<Props> = ({ onSelect, onNew, onClose, selectedId, previewColor, previewIcon }) => {
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const {
    connections,
    connectionStatuses,
    connect,
    disconnect,
    saveConnection,
    deleteConnection,
  } = useConnectionStore()

  const filtered = connections
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.host.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const grouped = filtered.reduce<Record<string, ConnectionConfig[]>>((acc, c) => {
    const g = c.groupName || '未分组'
    ;(acc[g] ??= []).push(c)
    return acc
  }, {})

  const handleDuplicate = async (c: ConnectionConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    await saveConnection({ ...c, id: uuid(), name: `${c.name} (副本)`, sortOrder: c.sortOrder + 1 })
  }

  const handleToggleConnect = async (c: ConnectionConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    setError('')
    try {
      if (connectionStatuses[c.id]?.connected) {
        await disconnect(c.id)
      } else {
        await connect(c.id)
        onClose()
      }
    } catch (e: any) {
      setError(e.message || '操作失败')
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteConnection(id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索连接..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="primary" onClick={onNew} style={{ width: '100%' }}><PlusOutlined /> 新建</Button>
      </div>
      {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {Object.entries(grouped).map(([group, items]) => (
          <div key={group} style={{ marginBottom: 12 }}>
            <Tag style={{ marginBottom: 8 }}>{group}</Tag>
            {items.map((item) => {
              const connected = connectionStatuses[item.id]?.connected
              const isSelected = selectedId === item.id
              const avatarColor = isSelected && previewColor ? previewColor : item.color
              const avatarIcon = isSelected && previewIcon !== null && previewIcon !== undefined ? previewIcon : item.icon
              return (
                <div
                  key={item.id}
                  onClick={() => onSelect(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: isSelected ? 'var(--accent-bg)' : 'transparent',
                    border: isSelected ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)' : '1px solid transparent',
                    transition: 'background-color var(--transition), border-color var(--transition)',
                    gap: 10,
                  }}
                >
                  <ConnAvatar conn={{ name: item.name, color: avatarColor, icon: avatarIcon }} status={connected ? 'connected' : 'idle'} size="small" />
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{item.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.host}:{item.port}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <Tooltip title={connected ? '断开' : '连接'}>
                      <button className="ui-btn ui-btn-text ui-btn-small" style={{ padding: 4 }} onClick={(e) => handleToggleConnect(item, e)}>
                        {connected ? <DisconnectOutlined /> : <LinkOutlined />}
                      </button>
                    </Tooltip>
                    <Tooltip title="复制">
                      <button className="ui-btn ui-btn-text ui-btn-small" style={{ padding: 4 }} onClick={(e) => handleDuplicate(item, e)}>
                        <CopyOutlined />
                      </button>
                    </Tooltip>
                    <Tooltip title="删除">
                      <button className="ui-btn ui-btn-text ui-btn-small" style={{ padding: 4, color: 'var(--error)' }} onClick={(e) => handleDelete(item.id, e)}>
                        <DeleteOutlined />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
