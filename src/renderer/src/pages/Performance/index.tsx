import React, { useMemo, useState } from 'react'
import { Tabs } from '../../components/ui'
import {
  ThunderboltOutlined,
  HistoryOutlined,
  DashboardOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import ExplainView from './ExplainView'
import QueryHistory from './QueryHistory'
import ServerMonitor from './ServerMonitor'
import IndexAdvisor from './IndexAdvisor'

interface Props {
  active?: boolean
}

const Performance: React.FC<Props> = ({ active = true }) => {
  const [activeKey, setActiveKey] = useState('explain')
  const items = useMemo(() => [
    { key: 'explain', label: <span><ThunderboltOutlined /> EXPLAIN</span>, children: activeKey === 'explain' ? <ExplainView /> : null },
    { key: 'history', label: <span><HistoryOutlined /> 查询历史</span>, children: activeKey === 'history' ? <QueryHistory active={active} /> : null },
    { key: 'monitor', label: <span><DashboardOutlined /> 服务器监控</span>, children: activeKey === 'monitor' ? <ServerMonitor active={active} /> : null },
    { key: 'advisor', label: <span><BulbOutlined /> 索引建议</span>, children: activeKey === 'advisor' ? <IndexAdvisor /> : null },
  ], [activeKey, active])

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={items}
      />
    </div>
  )
}

export default Performance
