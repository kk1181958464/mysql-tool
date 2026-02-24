import { useState } from 'react'
import './ui.css'

interface TabItem {
  key: string
  label: React.ReactNode
  children?: React.ReactNode
  disabled?: boolean
}

interface TabsProps {
  items: TabItem[]
  activeKey?: string
  defaultActiveKey?: string
  onChange?: (key: string) => void
  className?: string
  style?: React.CSSProperties
}

export function Tabs({ items, activeKey, defaultActiveKey, onChange, className = '', style }: TabsProps) {
  const [innerKey, setInnerKey] = useState(defaultActiveKey || items[0]?.key)
  const currentKey = activeKey !== undefined ? activeKey : innerKey

  const handleClick = (key: string, disabled?: boolean) => {
    if (disabled) return
    setInnerKey(key)
    onChange?.(key)
  }

  const activeItem = items.find((item) => item.key === currentKey)

  return (
    <div className={`ui-tabs ${className}`} style={style}>
      <div className="ui-tabs-nav" style={{ flexShrink: 0 }}>
        {items.map((item) => (
          <button
            key={item.key}
            className={`ui-tabs-tab ${item.key === currentKey ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
            onClick={() => handleClick(item.key, item.disabled)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="ui-tabs-content" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {items.map((item) => (
          <div key={item.key} style={{ display: item.key === currentKey ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {item.children}
          </div>
        ))}
      </div>
    </div>
  )
}
