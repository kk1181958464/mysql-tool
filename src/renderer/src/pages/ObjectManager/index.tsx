import React, { useState } from 'react'
import { Tabs } from '../../components/ui'
import { EyeOutlined, FunctionOutlined, ThunderboltOutlined, ClockCircleOutlined, SearchOutlined } from '@ant-design/icons'
import ViewManager from './ViewManager'
import ProcedureManager from './ProcedureManager'
import TriggerManager from './TriggerManager'
import EventManager from './EventManager'
import GlobalSearch from './GlobalSearch'

const ObjectManager: React.FC = () => {
  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <Tabs items={[
        { key: 'views', label: <span><EyeOutlined /> 视图</span>, children: <ViewManager /> },
        { key: 'procedures', label: <span><FunctionOutlined /> 存储过程/函数</span>, children: <ProcedureManager /> },
        { key: 'triggers', label: <span><ThunderboltOutlined /> 触发器</span>, children: <TriggerManager /> },
        { key: 'events', label: <span><ClockCircleOutlined /> 事件</span>, children: <EventManager /> },
        { key: 'search', label: <span><SearchOutlined /> 全局搜索</span>, children: <GlobalSearch /> },
      ]} />
    </div>
  )
}

export default ObjectManager
