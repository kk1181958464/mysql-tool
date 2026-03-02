import { useState, lazy, Suspense, useEffect, useCallback, useRef } from 'react'
import { CloseOutlined, CodeOutlined, TableOutlined, LayoutOutlined, DatabaseOutlined, DashboardOutlined, SwapOutlined, SaveOutlined } from '@ant-design/icons'
import { useTabStore, Tab } from '../../stores/tab.store'
import { isTabDirty, registerTabCloseGuard } from '../../stores/tab-close-guard'
import { Modal, Button } from '../../components/ui'
import DataBrowser from '../../pages/DataBrowser'
import TableDesigner from '../../pages/TableDesigner'
import { ObjectsBrowser } from '../../pages/ObjectsBrowser'
import Performance from '../../pages/Performance'
import ImportExport from '../../pages/ImportExport'
import Backup from '../../pages/Backup'

const QueryEditor = lazy(() => import('../../pages/QueryEditor'))

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

  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null)

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

  const closeWithGuard = useCallback(async (targetTabs: Tab[]) => {
    if (targetTabs.length === 0) return
    const ok = await requestCloseTabs(targetTabs)
    if (!ok) return
    removeTabsByIds(targetTabs.map((tab) => tab.id))
  }, [removeTabsByIds, requestCloseTabs])

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

  const renderTabContent = (tab: Tab) => {
    switch (tab.type) {
      case 'query':
        return (
          <Suspense fallback={<div style={{ padding: 20, color: 'var(--text-muted)' }}>查询编辑器加载中...</div>}>
            <QueryEditor tabId={tab.id} />
          </Suspense>
        )
      case 'data':
        return <DataBrowser tabId={tab.id} />
      case 'design':
        return <TableDesigner tabId={tab.id} />
      case 'objects':
        if (!tab.connectionId || !tab.database) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>无效的数据库连接</div>
        return <ObjectsBrowser connectionId={tab.connectionId} database={tab.database} />
      case 'performance':
        return <Performance />
      case 'import-export':
        return <ImportExport />
      case 'backup':
        return <Backup />
      default:
        return null
    }
  }

  if (tabs.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', position: 'relative' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📋</div>
          <div>点击左侧数据库树打开表，或点击"新建查询"开始</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 标签栏 */}
      <div className="main-tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`main-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
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
      </div>
      {/* 标签内容 — 缓存所有 tab，非活跃 display:none */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{
            display: tab.id === activeTabId ? 'flex' : 'none',
            flexDirection: 'column', height: '100%',
          }} className="tab-content-pane">
            {renderTabContent(tab)}
          </div>
        ))}
      </div>

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
