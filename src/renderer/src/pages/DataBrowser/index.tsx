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
  const tabFromStore = useTabStore((s) => s.tabs.find((t) => t.id === tabId))
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [activeKey, setActiveKey] = React.useState('data')

  const tab = tabFromStore as DataTab | undefined

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
      <div style={{ flex: 1, minHeight: 0 }}>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          extra={(
            <>
              <span className="data-browser-title">{tab.database}.{tab.table}</span>
              <Button size="small" variant="text" icon={<ReloadOutlined />} onClick={() => setRefreshKey((k) => k + 1)}>刷新</Button>
            </>
          )}
          items={[
            {
              key: 'data',
              label: '数据',
              children: <TableData tabId={tab.id} connectionId={tab.connectionId} database={tab.database} table={tab.table} refreshVersion={refreshKey} />,
            },
            {
              key: 'structure',
              label: '结构',
              children: activeKey === 'structure'
                ? <TableStructure key={`structure-${refreshKey}`} connectionId={tab.connectionId} database={tab.database} table={tab.table} />
                : null,
            },
          ]}
          style={{ height: '100%' }}
        />
      </div>
    </div>
  )
}

export default DataBrowser
