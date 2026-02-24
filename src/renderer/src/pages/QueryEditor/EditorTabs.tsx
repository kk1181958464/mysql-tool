import React, { useState } from 'react'
import { Input, Dropdown } from '../../components/ui'
import { PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { useEditorStore } from '../../stores/editor.store'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore } from '../../stores/app.store'

export const EditorTabs: React.FC = () => {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useEditorStore()
  const { activeConnectionId } = useConnectionStore()
  const { selectedDatabase } = useAppStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  const handleAdd = () => {
    addTab(activeConnectionId || undefined, selectedDatabase || undefined)
  }

  const handleDoubleClick = (id: string, title: string) => {
    setEditingId(id)
    setEditTitle(title)
  }

  const commitRename = () => {
    if (editingId && editTitle.trim()) {
      useEditorStore.setState((s) => ({
        tabs: s.tabs.map((t) => (t.id === editingId ? { ...t, title: editTitle.trim() } : t)),
      }))
    }
    setEditingId(null)
  }

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  const handleMenuSelect = (key: string) => {
    if (!contextMenu) return
    const tabId = contextMenu.tabId
    if (key === 'close') removeTab(tabId)
    else if (key === 'closeOthers') tabs.filter((t) => t.id !== tabId).forEach((t) => removeTab(t.id))
    else if (key === 'closeAll') tabs.forEach((t) => removeTab(t.id))
    else if (key === 'rename') {
      const tab = tabs.find((t) => t.id === tabId)
      if (tab) handleDoubleClick(tabId, tab.title)
    }
    setContextMenu(null)
  }

  return (
    <div className="ui-tabs-nav" style={{ display: 'flex', alignItems: 'center', padding: '0 8px', borderBottom: '1px solid var(--border-color)' }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`ui-tabs-tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => handleDoubleClick(tab.id, tab.title)}
          onContextMenu={(e) => handleContextMenu(e, tab.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}
        >
          {editingId === tab.id ? (
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => e.key === 'Enter' && commitRename()}
              autoFocus
              style={{ width: 80, height: 20, padding: '0 4px' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span>{tab.title}</span>
          )}
          <span
            onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
            style={{ cursor: 'pointer', opacity: 0.6, fontSize: 10 }}
          >
            <CloseOutlined />
          </span>
        </div>
      ))}
      <button className="ui-btn ui-btn-text" onClick={handleAdd} style={{ padding: '4px 8px' }}>
        <PlusOutlined />
      </button>
      {contextMenu && (
        <Dropdown
          items={[
            { key: 'close', label: '关闭' },
            { key: 'closeOthers', label: '关闭其他' },
            { key: 'closeAll', label: '关闭全部' },
            { key: 'rename', label: '重命名' },
          ]}
          onSelect={handleMenuSelect}
          onClose={() => setContextMenu(null)}
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
        />
      )}
    </div>
  )
}
