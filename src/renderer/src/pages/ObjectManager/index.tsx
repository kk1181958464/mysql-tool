import React, { useState } from 'react'
import { Tabs } from '../../components/ui'
import { EyeOutlined, FunctionOutlined, ThunderboltOutlined, ClockCircleOutlined, SearchOutlined } from '@ant-design/icons'
import ViewManager from './ViewManager'
import ProcedureManager from './ProcedureManager'
import TriggerManager from './TriggerManager'
import EventManager from './EventManager'
import GlobalSearch from './GlobalSearch'

const ObjectManager: React.FC = () => {
  const [activeKey, setActiveKey] = useState('views')

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          { key: 'views', label: <span><EyeOutlined /> 视图</span>, children: activeKey === 'views' ? <ViewManager /> : null },
          { key: 'procedures', label: <span><FunctionOutlined /> 存储过程/函数</span>, children: activeKey === 'procedures' ? <ProcedureManager /> : null },
          { key: 'triggers', label: <span><ThunderboltOutlined /> 触发器</span>, children: activeKey === 'triggers' ? <TriggerManager /> : null },
          { key: 'events', label: <span><ClockCircleOutlined /> 事件</span>, children: activeKey === 'events' ? <EventManager /> : null },
          { key: 'search', label: <span><SearchOutlined /> 全局搜索</span>, children: activeKey === 'search' ? <GlobalSearch /> : null },
        ]}
      />
    </div>
  )
}

export default ObjectManager
