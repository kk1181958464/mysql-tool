import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { Input, Tooltip } from '../ui'
import {
  MenuFoldOutlined,
  PlusOutlined,
  SearchOutlined,
  LinkOutlined,
  DisconnectOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  DownOutlined,
  LoadingOutlined,
  FolderAddOutlined,
} from '@ant-design/icons'
import logoImg from '../../assets/logo.png'
import { useAppStore } from '../../stores/app.store'
import { useConnection } from '../../hooks/useConnection'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import ConnectionTree from '../ConnectionTree'
import ConnectionManager from '../../pages/ConnectionManager'
import { CreateDatabaseModal } from '../CreateDatabaseModal'
import type { ConnectionConfig } from '../../../../shared/types/connection'

export default function Sidebar() {
  const { toggleSidebar } = useAppStore()
  const { connections, activeConnection, connect, disconnect, setActiveConnection, connectionStatuses, deleteConnection, loadConnections } = useConnection()
  const [showConnManager, setShowConnManager] = useState(false)
  const [editingConn, setEditingConn] = useState<ConnectionConfig | null>(null)
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conn: ConnectionConfig } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const [connectingIds, setConnectingIds] = useState<Set<string>>(new Set())
  const [showCreateDb, setShowCreateDb] = useState(false)
  const [createDbConnId, setCreateDbConnId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部或滚动时关闭下拉框和右键菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
      setContextMenu(null)
    }
    const handleScroll = () => {
      setDropdownOpen(false)
      setContextMenu(null)
    }
    document.addEventListener('click', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return

    const menuEl = contextMenuRef.current
    const rect = menuEl.getBoundingClientRect()
    let nextX = contextMenu.x
    let nextY = contextMenu.y

    if (rect.right > window.innerWidth - 8) {
      nextX = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (rect.bottom > window.innerHeight - 8) {
      nextY = Math.max(8, window.innerHeight - rect.height - 8)
    }

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu({ ...contextMenu, x: nextX, y: nextY })
    }
  }, [contextMenu])

  // 搜索防抖 200ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchText), 200)
    return () => clearTimeout(timer)
  }, [searchText])

  const handleSelect = async (conn: ConnectionConfig) => {
    setActiveConnection(conn.id)
    if (!connectionStatuses[conn.id]?.connected) {
      setConnectingIds(prev => new Set(prev).add(conn.id))
      setDropdownOpen(false)
      try {
        await connect(conn.id)
      } finally {
        setConnectingIds(prev => {
          const next = new Set(prev)
          next.delete(conn.id)
          return next
        })
      }
    } else {
      setDropdownOpen(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, conn: ConnectionConfig) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, conn })
  }

  const handleMenuAction = async (action: string) => {
    if (!contextMenu) return
    const conn = contextMenu.conn
    setContextMenu(null)

    switch (action) {
      case 'connect':
        setActiveConnection(conn.id)
        setConnectingIds(prev => new Set(prev).add(conn.id))
        try {
          await connect(conn.id)
        } finally {
          setConnectingIds(prev => {
            const next = new Set(prev)
            next.delete(conn.id)
            return next
          })
        }
        break
      case 'disconnect':
        await disconnect(conn.id)
        break
      case 'edit':
        setEditingConn(conn)
        setShowConnManager(true)
        break
      case 'delete':
        if (confirm(`确定删除连接 "${conn.name}"？`)) {
          await deleteConnection(conn.id)
        }
        break
      case 'refresh':
        await loadConnections()
        if (connectionStatuses[conn.id]?.connected) {
          useDatabaseStore.getState().loadDatabases(conn.id)
        }
        break
      case 'createDb':
        setCreateDbConnId(conn.id)
        setShowCreateDb(true)
        break
    }
  }

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="app-logo">
          <img src={logoImg} alt="MySQL Tool Logo" className="app-logo-img" />
          <span>MySQL Tool</span>
        </div>
        <div style={{ flex: 1 }} />
        <Tooltip title="管理连接" placement="left">
          <button className="nav-btn" style={{ flex: 'none', width: 26, height: 26 }} onClick={() => { setEditingConn(null); setShowConnManager(true) }}>
            <PlusOutlined style={{ fontSize: 11 }} />
          </button>
        </Tooltip>
        <Tooltip title="收起侧边栏" placement="left">
          <button className="nav-btn" style={{ flex: 'none', width: 26, height: 26 }} onClick={toggleSidebar}>
            <MenuFoldOutlined style={{ fontSize: 11 }} />
          </button>
        </Tooltip>
      </div>

      {/* Connection Selector */}
      <div className="sidebar-connection" ref={dropdownRef}>
        <div
          className="conn-selector"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          {activeConnection ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: activeConnection.color || '#82aaff', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConnection.name}</span>
              <span
                title={connectingIds.has(activeConnection.id) ? '连接中' : connectionStatuses[activeConnection.id]?.connected ? '已连接' : '未连接'}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: connectingIds.has(activeConnection.id)
                    ? 'var(--warning)'
                    : connectionStatuses[activeConnection.id]?.connected
                      ? 'var(--success)'
                      : 'var(--text-muted)',
                }}
              />
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>选择连接...</span>
          )}
          <DownOutlined style={{ fontSize: 10, color: 'var(--text-muted)' }} />
        </div>
        {dropdownOpen && (
          <div className="conn-dropdown">
            {connections.length === 0 ? (
              <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>暂无连接</div>
            ) : (
              connections.map((conn) => {
                const isConnected = connectionStatuses[conn.id]?.connected
                const isConnecting = connectingIds.has(conn.id)
                const isActive = activeConnection?.id === conn.id
                return (
                  <div
                    key={conn.id}
                    className={`conn-option ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelect(conn)}
                    onContextMenu={(e) => handleContextMenu(e, conn)}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: conn.color || '#82aaff', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{conn.name}</span>
                    <span
                      title={isConnecting ? '连接中' : isConnected ? '已连接' : '未连接'}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: isConnecting
                          ? 'var(--warning)'
                          : isConnected
                            ? 'var(--success)'
                            : 'var(--text-muted)',
                      }}
                    />
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" ref={contextMenuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
          {connectionStatuses[contextMenu.conn.id]?.connected ? (
            <div className="context-menu-item" onClick={() => handleMenuAction('disconnect')}>
              <DisconnectOutlined /> 断开连接
            </div>
          ) : (
            <div className="context-menu-item" onClick={() => handleMenuAction('connect')}>
              <LinkOutlined /> 打开连接
            </div>
          )}
          {connectionStatuses[contextMenu.conn.id]?.connected && (
            <div className="context-menu-item" onClick={() => handleMenuAction('createDb')}>
              <FolderAddOutlined /> 新建数据库
            </div>
          )}
          <div className="context-menu-item" onClick={() => handleMenuAction('edit')}>
            <EditOutlined /> 编辑连接
          </div>
          <div className="context-menu-item" onClick={() => handleMenuAction('refresh')}>
            <ReloadOutlined /> 刷新
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item danger" onClick={() => handleMenuAction('delete')}>
            <DeleteOutlined /> 删除连接
          </div>
        </div>
      )}

      {/* Search */}
      <div className="sidebar-search">
        <Input
          size="small"
          placeholder="搜索表..."
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)', fontSize: 11 }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
        {activeConnection && connectionStatuses[activeConnection.id]?.connected && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              className="nav-btn"
              style={{ flex: 1, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12 }}
              onClick={() => { setCreateDbConnId(activeConnection.id); setShowCreateDb(true) }}
            >
              <FolderAddOutlined style={{ fontSize: 12 }} />
              <span>新建数据库</span>
            </button>
            <Tooltip title="刷新数据库列表" placement="left">
              <button
                className="nav-btn"
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => useDatabaseStore.getState().loadDatabases(activeConnection.id)}
              >
                <ReloadOutlined style={{ fontSize: 12 }} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Database Object Tree */}
      <div className="sidebar-tree">
        <ConnectionTree filterText={debouncedSearch} />
      </div>

      <ConnectionManager
        open={showConnManager}
        onClose={() => { setShowConnManager(false); setEditingConn(null) }}
        initialEditing={editingConn}
      />

      <CreateDatabaseModal
        open={showCreateDb}
        connectionId={createDbConnId}
        onClose={() => { setShowCreateDb(false); setCreateDbConnId(null) }}
      />
    </div>
  )
}
