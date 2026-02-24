import React, { useState } from 'react'
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

const Performance: React.FC = () => {
  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Tabs
        items={[
          { key: 'explain', label: <span><ThunderboltOutlined /> EXPLAIN</span>, children: <ExplainView /> },
          { key: 'history', label: <span><HistoryOutlined /> 查询历史</span>, children: <QueryHistory /> },
          { key: 'monitor', label: <span><DashboardOutlined /> 服务器监控</span>, children: <ServerMonitor /> },
          { key: 'advisor', label: <span><BulbOutlined /> 索引建议</span>, children: <IndexAdvisor /> },
        ]}
      />
    </div>
  )
}

export default Performance
