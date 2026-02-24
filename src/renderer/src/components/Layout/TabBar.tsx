import { PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { useEditorStore } from '../../stores/editor.store'
import { useConnectionStore } from '../../stores/connection.store'
import SqlEditor from '../SqlEditor'

export default function TabBar() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useEditorStore()
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="ui-tabs" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="ui-tabs-nav" style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`ui-tabs-tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8 }}
          >
            <span>{tab.title}</span>
            <span
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); removeTab(tab.id) }}
              style={{ cursor: 'pointer', opacity: 0.6, fontSize: 10 }}
            >
              <CloseOutlined />
            </span>
          </div>
        ))}
        <button
          className="ui-btn ui-btn-text"
          onClick={() => addTab(activeConnectionId ?? undefined)}
          style={{ padding: '4px 8px', marginLeft: 4 }}
        >
          <PlusOutlined />
        </button>
      </div>
      <div className="ui-tabs-content" style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SqlEditor
              value={activeTab.content}
              onChange={(v) => useEditorStore.getState().updateContent(activeTab.id, v)}
              onExecute={() => {}}
              connectionId={activeTab.connectionId}
              database={activeTab.database}
            />
            {activeTab.error && (
              <div style={{ padding: 8, color: 'var(--color-red)', fontSize: 12 }}>{activeTab.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
