import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { CloseOutlined, CodeOutlined, TableOutlined, LayoutOutlined, DatabaseOutlined, DashboardOutlined, SwapOutlined, SaveOutlined, PlusOutlined, ApiOutlined } from '@ant-design/icons'
import { useTabStore, Tab } from '../../stores/tab.store'
import { isTabDirty, registerTabCloseGuard } from '../../stores/tab-close-guard'
import { Modal, Button, Table } from '../../components/ui'
import { useConnectionStore } from '../../stores/connection.store'
import { useAppStore, OPEN_CONNECTION_MANAGER_EVENT } from '../../stores/app.store'
import { lazyPage } from '../../utils/lazy-page'

const QueryEditor = lazyPage(() => import('../../pages/QueryEditor'))
const DataBrowser = lazyPage(() => import('../../pages/DataBrowser'))
const TableDesigner = lazyPage(() => import('../../pages/TableDesigner'))
const ObjectsBrowser = lazyPage(() => import('../../pages/ObjectsBrowser').then((module) => ({ default: module.ObjectsBrowser })))
const Performance = lazyPage(() => import('../../pages/Performance'))
const ImportExport = lazyPage(() => import('../../pages/ImportExport'))
const Backup = lazyPage(() => import('../../pages/Backup'))
const PAGES = [QueryEditor, DataBrowser, TableDesigner, ObjectsBrowser, Performance, ImportExport, Backup]
const MAX_KEEP_ALIVE_BACKGROUND_TABS = 8
const TAB_CLOSE_ANIMATION_MS = 200
const MAX_ANIMATED_CLOSE_TABS = 6

const PageLoading = ({ label }: { label: string }) => (
  <div className="page-skeleton" aria-busy="true" aria-label={`${label}加载中`}>
    <div className="page-skeleton-toolbar">
      {[88, 64, 64, 120].map((w, i) => <span key={i} className="ui-table-skeleton-line" style={{ width: w }} />)}
    </div>
    <Table loading columns={[]} dataSource={[]} size="small" style={{ flex: 1, minHeight: 0 }} />
  </div>
)

function Welcome() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const selectedDatabase = useAppStore((s) => s.selectedDatabase)
  const addQueryTab = useTabStore((s) => s.addQueryTab)

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <svg className="welcome-art" viewBox="0 0 132 108" fill="none" aria-hidden="true">
          <ellipse cx="66" cy="100" rx="38" ry="5" fill="currentColor" opacity="0.08" />
          <g className="welcome-float">
            <path d="M34 22c0-7 14.3-12 32-12s32 5 32 12v52c0 7-14.3 12-32 12s-32-5-32-12V22Z" fill="currentColor" opacity="0.1" />
            <ellipse cx="66" cy="22" rx="32" ry="12" fill="currentColor" opacity="0.22" />
            <path d="M34 39c0 7 14.3 12 32 12s32-5 32-12M34 56c0 7 14.3 12 32 12s32-5 32-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
            <path d="M34 22v52c0 7 14.3 12 32 12s32-5 32-12V22" stroke="currentColor" strokeWidth="2" opacity="0.6" />
            <ellipse cx="66" cy="22" rx="32" ry="12" stroke="currentColor" strokeWidth="2" opacity="0.6" />
            <circle cx="104" cy="74" r="13" fill="var(--bg-base)" stroke="currentColor" strokeWidth="2" />
            <path d="M99 74h10M104 69v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </g>
        </svg>
        <div className="welcome-title">{activeConnectionId ? '准备就绪' : '欢迎使用 kMysql'}</div>
        <div className="welcome-desc">
          {activeConnectionId ? '在左侧数据库树中打开表，或新建一个查询开始工作' : '先添加一个 MySQL 连接，开始浏览和管理你的数据'}
        </div>
        <div className="welcome-actions">
          {activeConnectionId ? (
            <Button variant="primary" icon={<PlusOutlined />} onClick={() => addQueryTab(activeConnectionId, selectedDatabase || undefined)}>
              新建查询
            </Button>
          ) : null}
          <Button
            variant={activeConnectionId ? 'default' : 'primary'}
            icon={<ApiOutlined />}
            onClick={() => window.dispatchEvent(new Event(OPEN_CONNECTION_MANAGER_EVENT))}
          >
            {activeConnectionId ? '管理连接' : '新建连接'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const isAlwaysKeptAlive = (tab: Tab) => {
  if (tab.type === 'query') return true
  if (tab.type === 'design') return true
  if (tab.type === 'data') return tab.isDirty
  return false
}

const isCacheManagedTab = (tab: Tab) => !isAlwaysKeptAlive(tab)

const TAB_ICONS: Record<string, React.ReactNode> = {
  query: <CodeOutlined />,
  data: <TableOutlined />,
  design: <LayoutOutlined />,
  objects: <DatabaseOutlined />,
  performance: <DashboardOutlined />,
  'import-export': <SwapOutlined />,
  backup: <SaveOutlined />,
}

export default function MainTabBar() {
  const { tabs, activeTabId, setActiveTab, removeTabsByIds } = useTabStore()
  const [confirmCloseIds, setConfirmCloseIds] = useState<string[] | null>(null)
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => new Set())
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(() => new Set())
  const tabBarRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)

  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null)
  const lastUsedAtRef = useRef<Record<string, number>>({})

  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null)

  useEffect(() => {
    const preloadAll = () => { PAGES.forEach((page) => { page.preload().catch(() => {}) }) }
    const id = window.requestIdleCallback ? window.requestIdleCallback(preloadAll, { timeout: 3000 }) : window.setTimeout(preloadAll, 1500)
    return () => { window.cancelIdleCallback ? window.cancelIdleCallback(id) : window.clearTimeout(id) }
  }, [])

  const requestCloseTabs = useCallback(async (targetTabs: Tab[]) => {
    if (targetTabs.length === 0) return true
    const hasDirty = targetTabs.some(isTabDirty)
    if (!hasDirty) return true

    return new Promise<boolean>((resolve) => {
      setConfirmCloseIds(targetTabs.map((tab) => tab.id))
      pendingResolveRef.current = resolve
    })
  }, [])

  useEffect(() => {
    const unregister = registerTabCloseGuard(requestCloseTabs)
    return () => {
      unregister()
      if (pendingResolveRef.current) {
        pendingResolveRef.current(false)
        pendingResolveRef.current = null
      }
    }
  }, [requestCloseTabs])

  // 点击外部、滚动、或全局关闭事件时关闭右键菜单
  useEffect(() => {
    const isInsideContextMenu = (target: EventTarget | null): boolean => {
      if (!target || !(target instanceof Node)) return false
      return tabContextMenuRef.current?.contains(target) ?? false
    }

    const handlePointerDownCapture = (event: PointerEvent | MouseEvent) => {
      if (isInsideContextMenu(event.target)) return
      setTabContextMenu(null)
    }
    const handleScroll = () => setTabContextMenu(null)
    const handleGlobalClose = () => setTabContextMenu(null)

    window.addEventListener('pointerdown', handlePointerDownCapture, true)
    document.addEventListener('mousedown', handlePointerDownCapture, true)
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('app:close-context-menus', handleGlobalClose as EventListener)
    document.addEventListener('app:close-context-menus', handleGlobalClose as EventListener)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDownCapture, true)
      document.removeEventListener('mousedown', handlePointerDownCapture, true)
      document.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('app:close-context-menus', handleGlobalClose as EventListener)
      document.removeEventListener('app:close-context-menus', handleGlobalClose as EventListener)
    }
  }, [])

  // 溢出修正：避免菜单贴边/出屏（参考 ConnectionTree 的处理方式）
  useLayoutEffect(() => {
    if (!tabContextMenu || !tabContextMenuRef.current) return

    const menuEl = tabContextMenuRef.current
    const rect = menuEl.getBoundingClientRect()
    let nextX = tabContextMenu.x
    let nextY = tabContextMenu.y

    if (rect.right > window.innerWidth - 8) {
      nextX = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (rect.bottom > window.innerHeight - 8) {
      nextY = Math.max(8, window.innerHeight - rect.height - 8)
    }

    if (nextX !== tabContextMenu.x || nextY !== tabContextMenu.y) {
      setTabContextMenu({ ...tabContextMenu, x: nextX, y: nextY })
    }
  }, [tabContextMenu])

  const closeWithGuard = useCallback(async (targetTabs: Tab[]) => {
    if (targetTabs.length === 0) return
    const ok = await requestCloseTabs(targetTabs)
    if (!ok) return
    const ids = targetTabs.map((tab) => tab.id)
    if (ids.length > MAX_ANIMATED_CLOSE_TABS) {
      removeTabsByIds(ids)
      return
    }
    setClosingTabIds((prev) => new Set([...prev, ...ids]))
    window.setTimeout(() => {
      removeTabsByIds(ids)
      setClosingTabIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
    }, TAB_CLOSE_ANIMATION_MS)
  }, [removeTabsByIds, requestCloseTabs])

  useLayoutEffect(() => {
    const bar = tabBarRef.current
    const indicator = indicatorRef.current
    if (!bar || !indicator) return
    const activeEl = bar.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId || '')}"]`)

    const place = () => {
      if (!activeEl || closingTabIds.has(activeTabId || '')) {
        indicator.style.opacity = '0'
        return
      }
      indicator.style.opacity = '1'
      indicator.style.width = `${activeEl.offsetWidth}px`
      indicator.style.transform = `translateX(${activeEl.offsetLeft}px)`
    }

    place()
    activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    if (!activeEl) return
    const observer = new ResizeObserver(place)
    observer.observe(activeEl)
    return () => observer.disconnect()
  }, [activeTabId, tabs, closingTabIds])

  const getClosableTabs = useCallback((inputTabs: Tab[]) => {
    // objects tab / 固定 tab 永不可关闭
    return inputTabs.filter((t) => t.closable !== false && String(t.type) !== 'objects')
  }, [])

  useEffect(() => {
    const tabIds = new Set(tabs.map((tab) => tab.id))
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const now = Date.now()

    for (const id of Object.keys(lastUsedAtRef.current)) {
      if (!tabIds.has(id)) {
        delete lastUsedAtRef.current[id]
      }
    }

    if (activeTabId) {
      lastUsedAtRef.current[activeTabId] = now
    }

    setMountedTabIds((prev) => {
      const next = new Set<string>()

      for (const tab of tabs) {
        if (tab.id === activeTabId || isAlwaysKeptAlive(tab)) {
          next.add(tab.id)
        }
      }

      for (const id of prev) {
        const tab = tabs.find((item) => item.id === id)
        if (!tab) continue
        if (tab.id === activeTabId || isAlwaysKeptAlive(tab) || isCacheManagedTab(tab)) {
          next.add(id)
        }
      }

      if (activeTab && isCacheManagedTab(activeTab)) {
        next.add(activeTab.id)
      }

      const managedBackgroundIds = Array.from(next)
        .filter((id) => id !== activeTabId)
        .filter((id) => {
          const tab = tabs.find((item) => item.id === id)
          return tab ? isCacheManagedTab(tab) : false
        })
        .sort((a, b) => (lastUsedAtRef.current[b] || 0) - (lastUsedAtRef.current[a] || 0))

      for (const id of managedBackgroundIds.slice(MAX_KEEP_ALIVE_BACKGROUND_TABS)) {
        next.delete(id)
      }

      return next
    })
  }, [tabs, activeTabId])

  const handleTabContextMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    e.stopPropagation()

    // 打开前，先广播关闭其他菜单（与 ConnectionTree 一致的全局约定）
    window.dispatchEvent(new Event('app:close-context-menus'))

    // 右键目标 tab：更符合预期，直接切换为 active
    setActiveTab(tab.id)

    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
  }

  const handleCloseCurrentFromMenu = async () => {
    if (!tabContextMenu) return
    const target = tabs.find((t) => t.id === tabContextMenu.tabId)
    setTabContextMenu(null)
    if (!target) return
    const closable = getClosableTabs([target])
    if (closable.length === 0) return
    await closeWithGuard(closable)
  }

  const handleCloseOthersFromMenu = async () => {
    if (!tabContextMenu) return
    const targetId = tabContextMenu.tabId
    setTabContextMenu(null)

    const otherTabs = tabs.filter((t) => t.id !== targetId)
    const toClose = getClosableTabs(otherTabs)
    await closeWithGuard(toClose)
  }

  const handleCloseAllFromMenu = async () => {
    setTabContextMenu(null)
    const toClose = getClosableTabs(tabs)
    await closeWithGuard(toClose)
  }

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    void closeWithGuard([tab])
  }

  const handleCancelClose = () => {
    setConfirmCloseIds(null)
    pendingResolveRef.current?.(false)
    pendingResolveRef.current = null
  }

  const handleConfirmClose = () => {
    setConfirmCloseIds(null)
    pendingResolveRef.current?.(true)
    pendingResolveRef.current = null
  }

  const renderTabContent = (tab: Tab, isActive: boolean) => {
    switch (tab.type) {
      case 'query':
        return (
          <QueryEditor tabId={tab.id} fallback={<PageLoading label="查询编辑器" />} />
        )
      case 'data':
        return (
          <DataBrowser tabId={tab.id} fallback={<PageLoading label="数据浏览" />} />
        )
      case 'design':
        return (
          <TableDesigner tabId={tab.id} fallback={<PageLoading label="表设计" />} />
        )
      case 'objects':
        if (!tab.connectionId || !tab.database) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>无效的数据库连接</div>
        return (
          <ObjectsBrowser connectionId={tab.connectionId} database={tab.database} fallback={<PageLoading label="对象浏览" />} />
        )
      case 'performance':
        return (
          <Performance active={isActive} fallback={<PageLoading label="性能工具" />} />
        )
      case 'import-export':
        return (
          <ImportExport fallback={<PageLoading label="导入导出" />} />
        )
      case 'backup':
        return (
          <Backup fallback={<PageLoading label="备份" />} />
        )
      default:
        return null
    }
  }

  if (tabs.length === 0) {
    return <Welcome />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 标签栏 */}
      <div className="main-tab-bar" ref={tabBarRef}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`main-tab ${tab.id === activeTabId ? 'active' : ''} ${closingTabIds.has(tab.id) ? 'closing' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => handleTabContextMenu(e, tab)}
          >
            <span className="main-tab-icon">{TAB_ICONS[tab.type]}</span>
            <span className="main-tab-title">{tab.title}</span>
            {tab.type === 'design' && (
              tab.isDirty
                ? <span className="main-tab-dirty main-tab-dirty-pulse" style={{ color: 'var(--warning)' }}>●</span>
                : tab.isSaved
                  ? <span className="main-tab-dirty" style={{ color: 'var(--success)' }}>●</span>
                  : null
            )}
            {tab.type === 'query' && isTabDirty(tab) && <span className="main-tab-dirty main-tab-dirty-pulse" style={{ color: 'var(--warning)' }}>●</span>}
            {tab.type === 'data' && tab.isDirty && <span className="main-tab-dirty main-tab-dirty-pulse" style={{ color: 'var(--warning)' }}>●</span>}
            {tab.closable !== false && (
              <button className="main-tab-close" onClick={(e) => handleClose(e, tab.id)}>
                <CloseOutlined />
              </button>
            )}
          </div>
        ))}
        <div className="main-tab-indicator" ref={indicatorRef} />
      </div>
      {/* 标签内容 — 缓存所有 tab，非活跃 display:none */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.filter((tab) => tab.id === activeTabId || mountedTabIds.has(tab.id)).map((tab) => (
          <div key={tab.id} style={{
            display: tab.id === activeTabId ? 'flex' : 'none',
            flexDirection: 'column', height: '100%',
          }} className="tab-content-pane">
            {renderTabContent(tab, tab.id === activeTabId)}
          </div>
        ))}
      </div>
      {/* Tab 右键菜单 */}
      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          className="context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onClick={() => setTabContextMenu(null)}
        >
          {(() => {
            const target = tabs.find((t) => t.id === tabContextMenu.tabId)
            const canCloseCurrent = !!target && getClosableTabs([target]).length > 0
            return (
              <>
                <div
                  className="context-menu-item"
                  style={canCloseCurrent ? undefined : { opacity: 0.5, pointerEvents: 'none' }}
                  onClick={(e) => {
                    if (!canCloseCurrent) {
                      e.stopPropagation()
                      return
                    }
                    void handleCloseCurrentFromMenu()
                  }}
                >
                  关闭当前
                </div>
                <div className="context-menu-divider" />
                <div
                  className="context-menu-item"
                  onClick={() => {
                    void handleCloseOthersFromMenu()
                  }}
                >
                  关闭其他
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    void handleCloseAllFromMenu()
                  }}
                >
                  关闭所有
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* 关闭确认弹窗 */}
      <Modal
        open={!!confirmCloseIds}
        title="关闭标签页"
        width={400}
        onClose={handleCancelClose}
        footer={
          <>
            <Button variant="default" onClick={handleCancelClose}>取消</Button>
            <Button variant="primary" onClick={handleConfirmClose} style={{ background: 'var(--warning)' }}>
              不保存并关闭
            </Button>
          </>
        }
      >
        <div style={{ padding: '8px 0' }}>
          <p>{confirmCloseIds && confirmCloseIds.length > 1 ? '存在未保存的标签页，确定要不保存并关闭这些标签页吗？' : '当前标签页有未保存的内容，确定要关闭吗？'}</p>
        </div>
      </Modal>
    </div>
  )
}
