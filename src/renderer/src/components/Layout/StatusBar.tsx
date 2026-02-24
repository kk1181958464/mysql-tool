import { useConnectionStore } from '../../stores/connection.store'
import { useEditorStore } from '../../stores/editor.store'
import { useAppStore } from '../../stores/app.store'
import { useTabStore } from '../../stores/tab.store'

export default function StatusBar() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connections = useConnectionStore((s) => s.connections)
  const statuses = useConnectionStore((s) => s.connectionStatuses)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const tabs = useEditorStore((s) => s.tabs)
  const { selectedDatabase } = useAppStore()
  const mainTabs = useTabStore((s) => s.tabs)
  const mainActiveTabId = useTabStore((s) => s.activeTabId)
  const currentTab = mainTabs.find(t => t.id === mainActiveTabId)

  const conn = connections.find((c) => c.id === activeConnectionId)
  const status = activeConnectionId ? statuses[activeConnectionId] : null
  const connected = status?.connected ?? false
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const result = activeTab?.result

  const PAGE_LABELS: Record<string, string> = {
    query: '查询编辑器',
    data: '数据浏览',
    design: '表设计',
    performance: '性能分析',
    'import-export': '导入导出',
    objects: '对象管理',
    backup: '备份恢复',
  }

  return (
    <div className="status-bar">
      <div className="status-section">
        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
        <span className="status-value">
          {conn ? conn.name || `${conn.host}:${conn.port}` : '未连接'}
        </span>
      </div>

      {status?.currentDatabase && (
        <div className="status-section">
          <span className="status-label">DB:</span>
          <span className="status-value">{status.currentDatabase}</span>
        </div>
      )}

      {selectedDatabase && !status?.currentDatabase && (
        <div className="status-section">
          <span className="status-label">DB:</span>
          <span className="status-value">{selectedDatabase}</span>
        </div>
      )}

      <div className="status-section">
        <span className="status-label">{PAGE_LABELS[currentTab?.type || ''] || ''}</span>
      </div>

      <div className="status-spacer" />

      {result && (
        <>
          <div className="status-section">
            <span className="status-label">行数</span>
            <span className="status-value">{result.rowCount.toLocaleString()}</span>
          </div>
          <div className="status-section">
            <span className="status-label">耗时</span>
            <span className="status-value">{result.executionTime}ms</span>
          </div>
        </>
      )}

      {connected && status?.serverVersion && (
        <div className="status-section">
          <span className="status-label">MySQL</span>
          <span className="status-value">{status.serverVersion}</span>
        </div>
      )}
    </div>
  )
}
