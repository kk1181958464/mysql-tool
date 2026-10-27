import { useEffect, useRef, useState } from 'react'
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import {
  MenuUnfoldOutlined,
  DashboardOutlined,
  SwapOutlined,
  SaveOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { Tooltip } from '../ui'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import MainTabBar from './MainTabBar'
import TitleBar from './TitleBar'
import { useAppStore } from '../../stores/app.store'
import { useTabStore } from '../../stores/tab.store'
import { useConnectionStore } from '../../stores/connection.store'

const NAV_ITEMS = [
  { key: 'performance' as const, icon: <DashboardOutlined />, label: '性能' },
  { key: 'import-export' as const, icon: <SwapOutlined />, label: '导入导出' },
  { key: 'backup' as const, icon: <SaveOutlined />, label: '备份' },
]

const SIDEBAR_ANIMATION_MS = 340
const BOOT_ANIMATION_MS = 900

const COLLAPSED_NAV = [
  { key: 'expand', icon: <MenuUnfoldOutlined />, label: '展开侧边栏' },
]

export default function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, selectedDatabase } = useAppStore()
  const { addQueryTab, addToolTab } = useTabStore()
  const { activeConnectionId } = useConnectionStore()
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null)
  const [sidebarAnimating, setSidebarAnimating] = useState(false)
  const [lockedSidebarWidth, setLockedSidebarWidth] = useState<number | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement>(null)
  const lastSidebarWidthRef = useRef(240)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), BOOT_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const panel = sidebarPanelRef.current
    if (!panel || panel.isCollapsed() === sidebarCollapsed) return
    const currentWidth = sidebarContentRef.current?.parentElement?.offsetWidth ?? 0
    if (sidebarCollapsed && currentWidth > 0) lastSidebarWidthRef.current = currentWidth
    setLockedSidebarWidth(lastSidebarWidthRef.current)
    setSidebarAnimating(true)
    if (sidebarCollapsed) panel.collapse()
    else panel.expand()
    const timer = window.setTimeout(() => {
      setSidebarAnimating(false)
      setLockedSidebarWidth(null)
    }, SIDEBAR_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [sidebarCollapsed])

  const syncSidebarCollapsed = (collapsed: boolean) => {
    if (useAppStore.getState().sidebarCollapsed !== collapsed) {
      useAppStore.setState({ sidebarCollapsed: collapsed })
    }
  }

  const handleNewQuery = () => {
    addQueryTab(activeConnectionId || undefined, selectedDatabase || undefined)
  }

  return (
    <div className={`app-layout ${booting ? 'app-boot' : ''}`}>
      <TitleBar />
      <div className={`app-body ${sidebarAnimating ? 'sidebar-animating' : ''}`}>
        {sidebarCollapsed && (
          <div className="sidebar-collapsed">
            {COLLAPSED_NAV.map((item) => (
              <Tooltip key={item.key} title={item.label} placement="right">
                <button className="sidebar-collapsed-btn" onClick={toggleSidebar}>
                  {item.icon}
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        <PanelGroup direction="horizontal">
          <Panel
            ref={sidebarPanelRef}
            defaultSize={20}
            minSize={14}
            maxSize={32}
            collapsible
            collapsedSize={0}
            onCollapse={() => syncSidebarCollapsed(true)}
            onExpand={() => syncSidebarCollapsed(false)}
            id="sidebar"
            order={1}
            style={{ overflow: 'hidden' }}
          >
            <div ref={sidebarContentRef} style={{ width: lockedSidebarWidth ?? '100%', height: '100%' }}>
              <Sidebar />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle" disabled={sidebarCollapsed} style={sidebarCollapsed ? { width: 0 } : undefined} />
          <Panel id="content" order={2}>
            <div className="content-area">
              {/* Top Navigation Bar */}
              <div className="content-nav">
                {activeConnectionId && (
                  <Tooltip title="新建查询" placement="bottom">
                    <button className="content-nav-btn" onClick={handleNewQuery}>
                      <PlusOutlined />
                      <span>新建查询</span>
                    </button>
                  </Tooltip>
                )}
                <div style={{ flex: 1 }} />
                {NAV_ITEMS.map((item) => (
                  <Tooltip key={item.key} title={item.label} placement="bottom">
                    <button
                      className="content-nav-btn"
                      onClick={() => addToolTab(item.key)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
              {/* Page Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <MainTabBar />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  )
}
