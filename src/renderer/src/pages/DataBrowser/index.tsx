import React from 'react'
import { Tabs, Space, Button } from '../../components/ui'
import { ReloadOutlined } from '@ant-design/icons'
import { TableData } from './TableData'
import { TableStructure } from './TableStructure'
import { useTabStore, DataTab } from '../../stores/tab.store'

interface Props {
  tabId: string
}

const DataBrowser: React.FC<Props> = ({ tabId }) => {
  const { tabs } = useTabStore()
  const [refreshKey, setRefreshKey] = React.useState(0)

  const tab = tabs.find((t) => t.id === tabId) as DataTab | undefined

  if (!tab) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        标签页不存在
      </div>
    )
  }

  if (!tab.connectionId || !tab.database) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        无效的数据库连接
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Space style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)' }}>
        <span style={{ fontWeight: 500 }}>{tab.table}</span>
        <Button size="small" onClick={() => setRefreshKey((k) => k + 1)}>
          <ReloadOutlined /> 刷新
        </Button>
      </Space>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Tabs
          defaultActiveKey="data"
          items={[
            { key: 'data', label: '数据', children: <TableData key={refreshKey} tabId={tab.id} connectionId={tab.connectionId} database={tab.database} table={tab.table} /> },
            { key: 'structure', label: '结构', children: <TableStructure key={refreshKey} connectionId={tab.connectionId} database={tab.database} table={tab.table} /> },
          ]}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}

export default DataBrowser
