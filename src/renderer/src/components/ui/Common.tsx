import { useState } from 'react'
import './ui.css'

// Tag
interface TagProps {
  color?: 'default' | 'primary' | 'success' | 'warning' | 'error' | string
  children?: React.ReactNode
  className?: string
}

export function Tag({ color = 'default', children, className = '' }: TagProps) {
  const isPreset = ['default', 'primary', 'success', 'warning', 'error'].includes(color)
  return (
    <span
      className={`ui-tag ${isPreset ? `ui-tag-${color}` : ''} ${className}`}
      style={!isPreset ? { background: color, color: '#fff' } : undefined}
    >
      {children}
    </span>
  )
}

// Space
interface SpaceProps {
  direction?: 'horizontal' | 'vertical'
  size?: 'small' | 'medium' | 'large' | number
  wrap?: boolean
  align?: 'start' | 'center' | 'end' | 'baseline'
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Space({ direction = 'horizontal', size = 'small', wrap, align, children, className = '', style }: SpaceProps) {
  const gap = typeof size === 'number' ? size : { small: 8, medium: 16, large: 24 }[size]
  return (
    <div
      className={`ui-space ui-space-${direction} ${wrap ? 'wrap' : ''} ${className}`}
      style={{ gap, alignItems: align, ...style }}
    >
      {children}
    </div>
  )
}

// Card
interface CardProps {
  title?: React.ReactNode
  extra?: React.ReactNode
  size?: 'small' | 'default'
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Card({ title, extra, size = 'default', children, className = '', style }: CardProps) {
  return (
    <div className={`ui-card ui-card-${size} ${className}`} style={style}>
      {(title || extra) && (
        <div className="ui-card-header">
          {title && <div className="ui-card-title">{title}</div>}
          {extra && <div className="ui-card-extra">{extra}</div>}
        </div>
      )}
      <div className="ui-card-body">{children}</div>
    </div>
  )
}

// Empty
interface EmptyProps {
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function Empty({ description = '暂无数据', children, className = '' }: EmptyProps) {
  return (
    <div className={`ui-empty ${className}`}>
      <div className="ui-empty-icon">📭</div>
      <div className="ui-empty-description">{description}</div>
      {children}
    </div>
  )
}

// Alert
interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error'
  message: React.ReactNode
  description?: React.ReactNode
  closable?: boolean
  onClose?: () => void
  className?: string
}

export function Alert({ type = 'info', message, description, closable, onClose, className = '' }: AlertProps) {
  return (
    <div className={`ui-alert ui-alert-${type} ${className}`}>
      <div className="ui-alert-content">
        <div className="ui-alert-message">{message}</div>
        {description && <div className="ui-alert-description">{description}</div>}
      </div>
      {closable && <button className="ui-alert-close" onClick={onClose}>×</button>}
    </div>
  )
}

// Tooltip
interface TooltipProps {
  title: React.ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  children: React.ReactElement
}

export function Tooltip({ title, placement = 'top', children }: TooltipProps) {
  return (
    <div className="ui-tooltip-wrapper">
      {children}
      <div className={`ui-tooltip ui-tooltip-${placement}`}>{title}</div>
    </div>
  )
}

// Switch
interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  checkedChildren?: React.ReactNode
  unCheckedChildren?: React.ReactNode
  size?: 'small' | 'default'
}

export function Switch({
  checked,
  defaultChecked,
  disabled,
  onChange,
  checkedChildren,
  unCheckedChildren,
  size = 'default',
}: SwitchProps) {
  const [innerChecked, setInnerChecked] = useState(defaultChecked ?? false)
  const isChecked = checked !== undefined ? checked : innerChecked

  const handleClick = () => {
    if (disabled) return
    const newValue = !isChecked
    setInnerChecked(newValue)
    onChange?.(newValue)
  }

  return (
    <button
      type="button"
      className={`ui-switch ui-switch-${size} ${isChecked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
    >
      <span className="ui-switch-inner">{isChecked ? checkedChildren : unCheckedChildren}</span>
      <span className="ui-switch-handle" />
    </button>
  )
}

// Checkbox
interface CheckboxProps {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  children?: React.ReactNode
}

export function Checkbox({ checked, defaultChecked, disabled, onChange, children }: CheckboxProps) {
  const [innerChecked, setInnerChecked] = useState(defaultChecked ?? false)
  const isChecked = checked !== undefined ? checked : innerChecked

  const handleChange = () => {
    if (disabled) return
    const newValue = !isChecked
    setInnerChecked(newValue)
    onChange?.(newValue)
  }

  return (
    <label className={`ui-checkbox ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={isChecked} onChange={handleChange} disabled={disabled} />
      <span className={`ui-checkbox-inner ${isChecked ? 'checked' : ''}`} />
      {children && <span className="ui-checkbox-label">{children}</span>}
    </label>
  )
}

// Spin
interface SpinProps {
  spinning?: boolean
  tip?: string
  children?: React.ReactNode
}

export function Spin({ spinning = true, tip, children }: SpinProps) {
  if (!spinning) return <>{children}</>
  return (
    <div className="ui-spin-wrapper">
      {children && <div className="ui-spin-blur">{children}</div>}
      <div className="ui-spin">
        <div className="ui-spin-dot" />
        {tip && <div className="ui-spin-tip">{tip}</div>}
      </div>
    </div>
  )
}

// Popconfirm
interface PopconfirmProps {
  title: React.ReactNode
  onConfirm?: () => void
  onCancel?: () => void
  okText?: string
  cancelText?: string
  children: React.ReactElement
}

export function Popconfirm({ title, onConfirm, onCancel, okText = '确定', cancelText = '取消', children }: PopconfirmProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="ui-popconfirm-wrapper">
      <div onClick={() => setVisible(!visible)}>{children}</div>
      {visible && (
        <div className="ui-popconfirm">
          <div className="ui-popconfirm-message">{title}</div>
          <div className="ui-popconfirm-buttons">
            <button className="ui-btn ui-btn-small ui-btn-default" onClick={() => { setVisible(false); onCancel?.() }}>{cancelText}</button>
            <button className="ui-btn ui-btn-small ui-btn-primary" onClick={() => { setVisible(false); onConfirm?.() }}>{okText}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Dropdown
interface DropdownItem {
  key: string
  label: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}

interface DropdownProps {
  menu: { items: DropdownItem[] }
  trigger?: ('click' | 'hover')[]
  children: React.ReactElement
}

export function Dropdown({ menu, trigger = ['hover'], children }: DropdownProps) {
  const [visible, setVisible] = useState(false)
  const isHover = trigger.includes('hover')
  const isClick = trigger.includes('click')

  return (
    <div
      className="ui-dropdown-wrapper"
      onMouseEnter={() => isHover && setVisible(true)}
      onMouseLeave={() => isHover && setVisible(false)}
      onClick={() => isClick && setVisible(!visible)}
    >
      {children}
      {visible && (
        <div className="ui-dropdown-menu">
          {menu.items.map((item) => (
            <div
              key={item.key}
              className={`ui-dropdown-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`}
              onClick={() => { if (!item.disabled) { item.onClick?.(); setVisible(false) } }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Row & Col
interface RowProps {
  gutter?: number | [number, number]
  align?: 'top' | 'middle' | 'bottom'
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around'
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Row({ gutter = 0, align, justify, children, className = '', style }: RowProps) {
  const [hGap, vGap] = Array.isArray(gutter) ? gutter : [gutter, 0]
  return (
    <div
      className={`ui-row ${className}`}
      style={{
        gap: `${vGap}px ${hGap}px`,
        alignItems: align === 'top' ? 'flex-start' : align === 'bottom' ? 'flex-end' : align === 'middle' ? 'center' : undefined,
        justifyContent: justify === 'start' ? 'flex-start' : justify === 'end' ? 'flex-end' : justify,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

interface ColProps {
  span?: number
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Col({ span = 24, children, className = '', style }: ColProps) {
  return (
    <div className={`ui-col ${className}`} style={{ flex: `0 0 ${(span / 24) * 100}%`, maxWidth: `${(span / 24) * 100}%`, ...style }}>
      {children}
    </div>
  )
}

// Statistic
interface StatisticProps {
  title: React.ReactNode
  value: React.ReactNode
  valueStyle?: React.CSSProperties
  prefix?: React.ReactNode
  suffix?: React.ReactNode
}

export function Statistic({ title, value, valueStyle, prefix, suffix }: StatisticProps) {
  return (
    <div className="ui-statistic">
      <div className="ui-statistic-title">{title}</div>
      <div className="ui-statistic-value" style={valueStyle}>
        {prefix && <span className="ui-statistic-prefix">{prefix}</span>}
        {value}
        {suffix && <span className="ui-statistic-suffix">{suffix}</span>}
      </div>
    </div>
  )
}
