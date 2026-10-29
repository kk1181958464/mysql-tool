import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { Input, Tooltip, Modal, Button } from '../ui'
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
  ApiOutlined,
  CheckOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import logoImg from '../../assets/logo-sidebar.png'
import { useAppStore, OPEN_CONNECTION_MANAGER_EVENT } from '../../stores/app.store'
import { useConnection } from '../../hooks/useConnection'
import { useConnectionStore } from '../../stores/connection.store'
import { useDatabaseStore } from '../../stores/database.store'
import ConnectionTree from '../ConnectionTree'
import { ConnAvatar, type ConnState } from '../ConnAvatar'
import ConnectionManager from '../../pages/ConnectionManager'
import { CreateDatabaseModal } from '../CreateDatabaseModal'
import type { ConnectionConfig } from '../../../../shared/types/connection'

function formatConnHost(conn: ConnectionConfig): string {
  return `${conn.user ? conn.user + '@' : ''}${conn.host}${conn.port && conn.port !== 3306 ? ':' + conn.port : ''}`
}

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
  const [deleteConnConfirm, setDeleteConnConfirm] = useState<ConnectionConfig | null>(null)
  const [deletingConn, setDeletingConn] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [connFilter, setConnFilter] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const connListRef = useRef<HTMLDivElement>(null)
  const scrollHighlightRef = useRef(false)

  useLayoutEffect(() => {
    if (!scrollHighlightRef.current) return
    scrollHighlightRef.current = false
    connListRef.current?.querySelector('.conn-option.highlight')?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex])

  const getConnState = (id: string): ConnState =>
    connectingIds.has(id) ? 'connecting' : connectionStatuses[id]?.connected ? 'connected' : 'idle'

  const keyword = connFilter.trim().toLowerCase()
  const matchedConnections = keyword
    ? connections.filter((c) => [c.name, c.host, c.user, c.groupName].some((v) => v?.toLowerCase().includes(keyword)))
    : connections
  const idleConnections = matchedConnections.filter((c) => getConnState(c.id) === 'idle')
  const hasNamedGroups = idleConnections.some((c) => c.groupName?.trim())
  const idleGroups = new Map<string, ConnectionConfig[]>()
  for (const conn of idleConnections) {
    const label = conn.groupName?.trim() || (hasNamedGroups ? '未分组' : keyword ? '其他匹配' : '其他连接')
    idleGroups.set(label, [...(idleGroups.get(label) ?? []), conn])
  }
  const connGroups = [
    { label: '已连接', items: matchedConnections.filter((c) => getConnState(c.id) !== 'idle') },
    ...Array.from(idleGroups, ([label, items]) => ({ label, items }))
      .sort((a, b) => Number(a.label === '未分组') - Number(b.label === '未分组')),
  ].filter((g) => g.items.length > 0)
  const filteredConnections = connGroups.flatMap((g) => g.items)

  useEffect(() => {
    if (!dropdownOpen) return
    setConnFilter('')
    const activeIndex = filteredConnections.findIndex((c) => c.id === activeConnection?.id)
    scrollHighlightRef.current = true
    setHighlightIndex(Math.max(0, activeIndex))
  }, [dropdownOpen])

  const openConnManager = () => {
    setDropdownOpen(false)
    setEditingConn(null)
    setShowConnManager(true)
  }

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setDropdownOpen(false)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const count = filteredConnections.length
      if (!count) return
      scrollHighlightRef.current = true
      setHighlightIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : count - 1)) % count)
    } else if (e.key === 'Enter') {
      const conn = filteredConnections[highlightIndex]
      if (conn) void handleSelect(conn)
    }
  }

  // 点击外部或滚动时关闭下拉框和右键菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
      setContextMenu(null)
    }
    const handleScroll = (e: Event) => {
      const target = e.target
      const isDropdownScroll = !!(dropdownRef.current && target instanceof Node && dropdownRef.current.contains(target))
      const isSidebarTreeScroll = target instanceof Element && !!target.closest('.sidebar-tree')

      if (!isDropdownScroll && !isSidebarTreeScroll) {
        setDropdownOpen(false)
      }
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

  useEffect(() => {
    const open = (event: Event) => {
      const connId = (event as CustomEvent<{ connectionId?: string }>).detail?.connectionId
      setEditingConn(connId ? useConnectionStore.getState().connections.find((c) => c.id === connId) ?? null : null)
      setShowConnManager(true)
    }
    window.addEventListener(OPEN_CONNECTION_MANAGER_EVENT, open)
    return () => window.removeEventListener(OPEN_CONNECTION_MANAGER_EVENT, open)
  }, [])

  useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('app:close-context-menus', close)
    return () => window.removeEventListener('app:close-context-menus', close)
  }, [])

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
        setDeleteConnConfirm(conn)
        break
      case 'refresh':
        await loadConnections()
        if (connectionStatuses[conn.id]?.connected) {
          await useDatabaseStore.getState().loadDatabases(conn.id, true)
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
          <img src={logoImg} alt="KMysql Logo" className="app-logo-img" />
          <span>KMysql</span>
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
        <button
          type="button"
          className={`conn-selector ${dropdownOpen ? 'open' : ''}`}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          onContextMenu={(e) => activeConnection && handleContextMenu(e, activeConnection)}
        >
          {activeConnection ? (
            <>
              <ConnAvatar conn={activeConnection} status={getConnState(activeConnection.id)} />
              <span className="conn-text">
                <span className="conn-name">{activeConnection.name}</span>
                <span className="conn-host">{formatConnHost(activeConnection)}</span>
              </span>
            </>
          ) : (
            <>
              <span className="conn-avatar conn-avatar-empty"><ApiOutlined /></span>
              <span className="conn-text">
                <span className="conn-name conn-placeholder">选择连接</span>
                <span className="conn-host">{connections.length ? `共 ${connections.length} 个连接` : '还没有连接'}</span>
              </span>
            </>
          )}
          <DownOutlined className="conn-chevron" />
        </button>
        {dropdownOpen && (
          <div className="conn-dropdown" onKeyDown={handleDropdownKeyDown}>
            {connections.length > 0 && (
              <div className="conn-search">
                <SearchOutlined />
                <input
                  autoFocus
                  value={connFilter}
                  onChange={(e) => { setConnFilter(e.target.value); setHighlightIndex(0) }}
                  placeholder="搜索连接名 / 主机"
                />
              </div>
            )}
            <div className="conn-list" ref={connListRef}>
              {connections.length === 0 ? (
                <div className="conn-empty">暂无连接，先新建一个吧</div>
              ) : filteredConnections.length === 0 ? (
                <div className="conn-empty">没有匹配的连接</div>
              ) : (
                connGroups.map((group, groupIndex) => (
                  <div key={`${groupIndex}-${group.label}`}>
                    <div className="conn-group-label">{group.label}<span>{group.items.length}</span></div>
                    {group.items.map((conn) => {
                      const index = filteredConnections.indexOf(conn)
                      const isActive = activeConnection?.id === conn.id
                      return (
                        <div
                          key={conn.id}
                          className={`conn-option ${isActive ? 'active' : ''} ${index === highlightIndex ? 'highlight' : ''}`}
                          style={{ '--i': index } as React.CSSProperties}
                          onClick={() => handleSelect(conn)}
                          onMouseMove={() => {
                            if (index === highlightIndex) return
                            scrollHighlightRef.current = false
                            setHighlightIndex(index)
                          }}
                          onContextMenu={(e) => handleContextMenu(e, conn)}
                        >
                          <ConnAvatar conn={conn} status={getConnState(conn.id)} size="small" />
                          <span className="conn-text">
                            <span className="conn-name">{conn.name}</span>
                            <span className="conn-host">
                              {formatConnHost(conn)}
                              {conn.sshEnabled && <span className="conn-tag">SSH</span>}
                              {conn.sslEnabled && <span className="conn-tag">SSL</span>}
                            </span>
                          </span>
                          {isActive && <CheckOutlined className="conn-check" />}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="conn-footer">
              <button type="button" onClick={openConnManager}>
                <PlusOutlined /> 新建连接
              </button>
              <button type="button" onClick={openConnManager}>
                <SettingOutlined /> 管理
              </button>
            </div>
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
          placeholder="搜索库名或备注"
          prefix={<SearchOutlined style={{ color: 'var(--text-muted)', fontSize: 11 }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
        {activeConnection && connectionStatuses[activeConnection.id]?.connected && (
          <>
            <Tooltip title="新建数据库" placement="bottom">
              <button className="nav-btn sidebar-tool-btn" onClick={() => { setCreateDbConnId(activeConnection.id); setShowCreateDb(true) }}>
                <FolderAddOutlined />
              </button>
            </Tooltip>
            <Tooltip title="刷新数据库列表" placement="bottom">
              <button
                className="nav-btn sidebar-tool-btn"
                onClick={async () => {
                  await useDatabaseStore.getState().loadDatabases(activeConnection.id, true)
                }}
              >
                <ReloadOutlined />
              </button>
            </Tooltip>
          </>
        )}
      </div>

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

      <Modal
        open={!!deleteConnConfirm}
        title="删除连接"
        width={400}
        onClose={() => {
          if (!deletingConn) setDeleteConnConfirm(null)
        }}
        footer={
          <>
            <Button variant="default" disabled={deletingConn} onClick={() => setDeleteConnConfirm(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={deletingConn}
              style={{ background: 'var(--error)' }}
              onClick={async () => {
                if (!deleteConnConfirm) return
                setDeletingConn(true)
                try {
                  await deleteConnection(deleteConnConfirm.id)
                  setDeleteConnConfirm(null)
                } finally {
                  setDeletingConn(false)
                }
              }}
            >
              {deletingConn ? '删除中...' : '确认删除'}
            </Button>
          </>
        }
      >
        <p>确定删除连接 <strong style={{ color: 'var(--error)' }}>{deleteConnConfirm?.name}</strong> 吗？</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>删除后该连接配置会从本地移除。</p>
      </Modal>
    </div>
  )
}
