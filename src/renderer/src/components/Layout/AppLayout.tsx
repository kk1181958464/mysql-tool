import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
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

const COLLAPSED_NAV = [
  { key: 'expand', icon: <MenuUnfoldOutlined />, label: '展开侧边栏' },
]

export default function AppLayout() {
  const { sidebarCollapsed, toggleSidebar, selectedDatabase } = useAppStore()
  const { addQueryTab, addToolTab } = useTabStore()
  const { activeConnectionId } = useConnectionStore()

  const handleNewQuery = () => {
    addQueryTab(activeConnectionId || undefined, selectedDatabase || undefined)
  }

  return (
    <div className="app-layout">
      <TitleBar />
      <div className="app-body">
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
          {!sidebarCollapsed && (
            <>
              <Panel defaultSize={20} minSize={14} maxSize={32} id="sidebar">
                <Sidebar />
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}
          <Panel id="content">
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
