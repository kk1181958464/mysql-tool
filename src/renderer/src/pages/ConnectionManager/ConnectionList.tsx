import React, { useState } from 'react'
import { ConnAvatar } from '../../components/ConnAvatar'
import { Input, Button, Tooltip, Modal } from '../../components/ui'
import {
  PlusOutlined,
  CopyOutlined,
  DeleteOutlined,
  LinkOutlined,
  DisconnectOutlined,
  SearchOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useConnectionStore } from '../../stores/connection.store'
import type { ConnectionConfig } from '../../../../shared/types/connection'
import { v4 as uuid } from 'uuid'
import { ErrorNotice } from '../../components/ErrorNotice'
import { getErrorMessage } from '../../utils/error-info'


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
  const [pendingDelete, setPendingDelete] = useState<ConnectionConfig | null>(null)
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
    await saveConnection({ ...c, id: uuid(), name: `${c.name} (副本)`, sortOrder: c.sortOrder + 1 }, c.id)
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
      setError(getErrorMessage(e, '操作失败'))
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteConnection(id)
  }

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleGroup = (group: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    return next
  })
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => Number(a === '未分组') - Number(b === '未分组') || a.localeCompare(b))

  return (
    <div className="cm-list">
      <div className="cm-list-head">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索名称或主机"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          onClear={() => setSearch('')}
        />
        <Tooltip title="新建连接" placement="bottom">
          <button type="button" className="cm-new-btn" onClick={onNew}><PlusOutlined /></button>
        </Tooltip>
      </div>
      {error && <ErrorNotice key={error} error={error} onClose={() => setError('')} style={{ margin: '0 12px 8px' }} />}
      <div className="cm-list-body">
        {groupEntries.length === 0 && (
          <div className="cm-list-empty">{search ? '没有匹配的连接' : '还没有连接，点击右上角 + 新建'}</div>
        )}
        {groupEntries.map(([group, items]) => (
          <div key={group} className="cm-group">
            <button type="button" className={`cm-group-head ${collapsed.has(group) ? 'collapsed' : ''}`} onClick={() => toggleGroup(group)}>
              <DownOutlined className="cm-group-arrow" />
              <span className="cm-group-name">{group}</span>
              <span className="cm-group-count">{items.length}</span>
            </button>
            {!collapsed.has(group) && items.map((item) => {
              const connected = connectionStatuses[item.id]?.connected
              const isSelected = selectedId === item.id
              const avatarColor = isSelected && previewColor ? previewColor : item.color
              const avatarIcon = isSelected && previewIcon !== null && previewIcon !== undefined ? previewIcon : item.icon
              return (
                <div
                  key={item.id}
                  className={`cm-item ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelect(item)}
                  onDoubleClick={(e) => { if (!connected) void handleToggleConnect(item, e) }}
                >
                  <ConnAvatar conn={{ name: item.name, color: avatarColor, icon: avatarIcon }} status={connected ? 'connected' : 'idle'} size="small" />
                  <div className="cm-item-text">
                    <span className="cm-item-name">{item.name}</span>
                    <span className="cm-item-host">{item.user ? `${item.user}@` : ''}{item.host}:{item.port}</span>
                  </div>
                  <div className="cm-item-actions">
                    <Tooltip title={connected ? '断开' : '连接'}>
                      <button type="button" onClick={(e) => handleToggleConnect(item, e)}>
                        {connected ? <DisconnectOutlined /> : <LinkOutlined />}
                      </button>
                    </Tooltip>
                    <Tooltip title="复制">
                      <button type="button" onClick={(e) => handleDuplicate(item, e)}><CopyOutlined /></button>
                    </Tooltip>
                    <Tooltip title="删除">
                      <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); setPendingDelete(item) }}><DeleteOutlined /></button>
                    </Tooltip>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="cm-list-foot">共 {connections.length} 个连接{search ? `，匹配 ${filtered.length} 个` : ''}</div>
      <Modal
        open={Boolean(pendingDelete)}
        title="删除连接"
        width={400}
        onClose={() => setPendingDelete(null)}
        footer={(
          <>
            <Button onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="danger" onClick={async (e) => { if (pendingDelete) await handleDelete(pendingDelete.id, e); setPendingDelete(null) }}>删除</Button>
          </>
        )}
      >
        <p style={{ padding: '4px 0' }}>确定删除连接「{pendingDelete?.name}」吗？该连接的查询历史也会一并删除。</p>
      </Modal>
    </div>
  )
}
