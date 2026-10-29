import React from 'react'
import { Button, Tooltip } from '../../components/ui'
import { ReloadOutlined, TableOutlined, EditOutlined, DatabaseOutlined, CodeOutlined } from '@ant-design/icons'
import { TableData } from './TableData'
import { TableStructure } from './TableStructure'
import { useTabStore, DataTab } from '../../stores/tab.store'
import { useDatabaseStore } from '../../stores/database.store'
import { formatBytes } from '../../utils/export-utils'

interface Props {
  tabId: string
}

const DataBrowser: React.FC<Props> = ({ tabId }) => {
  const tabFromStore = useTabStore((s) => s.tabs.find((t) => t.id === tabId))
  const addDesignTab = useTabStore((s) => s.addDesignTab)
  const addQueryTab = useTabStore((s) => s.addQueryTab)
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [activeKey, setActiveKey] = React.useState<'data' | 'structure'>('data')

  const tab = tabFromStore as DataTab | undefined
  const tableKey = tab ? `${tab.connectionId}:${tab.database}` : ''
  const info = useDatabaseStore((s) => s.tables[tableKey]?.find((t) => t.name === tab?.table))
  const loadTables = useDatabaseStore((s) => s.loadTables)

  React.useEffect(() => {
    if (tab?.connectionId && tab.database) loadTables(tab.connectionId, tab.database).catch(() => {})
  }, [tab?.connectionId, tab?.database])

  if (!tab) {
    return <div className="db-placeholder">标签页不存在</div>
  }

  if (!tab.connectionId || !tab.database) {
    return <div className="db-placeholder">无效的数据库连接</div>
  }

  const refresh = () => {
    setRefreshKey((k) => k + 1)
    loadTables(tab.connectionId, tab.database, true).catch(() => {})
  }

  const meta = [
    info?.engine,
    info && Number.isFinite(Number(info.rows)) ? `约 ${Number(info.rows).toLocaleString()} 行` : '',
    info && info.dataLength + info.indexLength > 0 ? formatBytes(info.dataLength + info.indexLength) : '',
  ].filter(Boolean)

  return (
    <div className="db-page">
      <div className="db-header">
        <div className="td-header-icon db-header-icon">
          <TableOutlined />
        </div>
        <div className="db-header-main">
          <div className="db-header-title">
            <span className="db-header-name" title={tab.table}>{tab.table}</span>
            {info?.type === 'VIEW' && <span className="td-chip">视图</span>}
            {info?.comment && <span className="db-header-comment" title={info.comment}>{info.comment}</span>}
          </div>
          <div className="db-header-meta">
            <span className="td-meta-db"><DatabaseOutlined /> {tab.database}</span>
            {meta.map((m) => (
              <React.Fragment key={m}>
                <span className="td-meta-dot" />
                <span>{m}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="db-segmented" role="tablist">
          {(['data', 'structure'] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={activeKey === key} className={activeKey === key ? 'active' : ''} onClick={() => setActiveKey(key)}>
              {key === 'data' ? '数据' : '结构'}
            </button>
          ))}
        </div>
        <div className="db-header-actions">
          <Tooltip title="刷新" placement="bottom">
            <Button size="small" variant="text" icon={<ReloadOutlined />} onClick={refresh} />
          </Tooltip>
          <Tooltip title="新建查询" placement="bottom">
            <Button size="small" variant="text" icon={<CodeOutlined />} onClick={() => addQueryTab(tab.connectionId, tab.database, `SELECT * FROM \`${tab.table.replace(/`/g, '``')}\` LIMIT 100;`)} />
          </Tooltip>
          {info?.type !== 'VIEW' && (
            <Button size="small" icon={<EditOutlined />} onClick={() => addDesignTab(tab.connectionId, tab.database, tab.table)}>设计表</Button>
          )}
        </div>
      </div>

      <div className="db-body">
        <div className="db-pane" style={{ display: activeKey === 'data' ? 'flex' : 'none' }}>
          <TableData tabId={tab.id} connectionId={tab.connectionId} database={tab.database} table={tab.table} refreshVersion={refreshKey} />
        </div>
        {activeKey === 'structure' && (
          <div className="db-pane">
            <TableStructure key={`structure-${refreshKey}`} connectionId={tab.connectionId} database={tab.database} table={tab.table} />
          </div>
        )}
      </div>
    </div>
  )
}

export default DataBrowser
