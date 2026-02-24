import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import './ui.css'

interface Option {
  value: string | number
  label: React.ReactNode
  disabled?: boolean
}

interface SelectProps {
  value?: string | number
  defaultValue?: string | number
  options?: Option[]
  placeholder?: string
  disabled?: boolean
  size?: 'small' | 'medium' | 'large'
  allowClear?: boolean
  onChange?: (value: string | number) => void
  className?: string
  style?: React.CSSProperties
}

export function Select({
  value,
  defaultValue,
  options = [],
  placeholder = '请选择',
  disabled,
  size = 'medium',
  allowClear,
  onChange,
  className = '',
  style,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [innerValue, setInnerValue] = useState(defaultValue)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const currentValue = value !== undefined ? value : innerValue
  const selectedOption = options.find((o) => o.value === currentValue)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsOpen(false)
      }
    }
    const handleScroll = (e: Event) => {
      // 忽略下拉框内部滚动
      if (dropdownRef.current?.contains(e.target as Node)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  useEffect(() => {
    if (isOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        zIndex: 9999,
      })
    }
  }, [isOpen])

  const handleSelect = (opt: Option) => {
    if (opt.disabled) return
    setInnerValue(opt.value)
    onChange?.(opt.value)
    setIsOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setInnerValue(undefined)
    onChange?.('' as any)
  }

  return (
    <div ref={ref} className={`ui-select ui-select-${size} ${disabled ? 'disabled' : ''} ${className}`} style={style}>
      <div className="ui-select-trigger" onClick={() => !disabled && setIsOpen(!isOpen)}>
        <span className={`ui-select-value ${!selectedOption ? 'placeholder' : ''}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {allowClear && currentValue && (
          <button type="button" className="ui-select-clear" onClick={handleClear}>×</button>
        )}
        <span className={`ui-select-arrow ${isOpen ? 'open' : ''}`}>▾</span>
      </div>
      {isOpen && createPortal(
        <div ref={dropdownRef} className="ui-select-dropdown" style={dropdownStyle} onClick={(e) => e.stopPropagation()}>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`ui-select-option ${opt.value === currentValue ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
              onClick={() => handleSelect(opt)}
            >
              {opt.label}
            </div>
          ))}
          {options.length === 0 && <div className="ui-select-empty">无数据</div>}
        </div>,
        document.body
      )}
    </div>
  )
}
