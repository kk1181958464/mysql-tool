import { InputHTMLAttributes, forwardRef, useState } from 'react'
import './ui.css'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'small' | 'medium' | 'large'
  prefix?: React.ReactNode
  suffix?: React.ReactNode
  allowClear?: boolean
  onClear?: () => void
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'medium', prefix, suffix, allowClear, onClear, className = '', value, onChange, ...props }, ref) => {
    const [innerValue, setInnerValue] = useState(value || '')
    const currentValue = value !== undefined ? value : innerValue

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInnerValue(e.target.value)
      onChange?.(e)
    }

    const handleClear = () => {
      setInnerValue('')
      onClear?.()
      const event = { target: { value: '' } } as React.ChangeEvent<HTMLInputElement>
      onChange?.(event)
    }

    return (
      <div className={`ui-input-wrapper ui-input-${size} ${className}`}>
        {prefix && <span className="ui-input-prefix">{prefix}</span>}
        <input
          ref={ref}
          className="ui-input"
          value={currentValue}
          onChange={handleChange}
          {...props}
        />
        {allowClear && currentValue && (
          <button type="button" className="ui-input-clear" onClick={handleClear}>×</button>
        )}
        {suffix && <span className="ui-input-suffix">{suffix}</span>}
      </div>
    )
  }
)

Input.displayName = 'Input'

// Password Input
interface PasswordProps extends Omit<InputProps, 'type'> {}

export const Password = forwardRef<HTMLInputElement, PasswordProps>((props, ref) => {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      suffix={
        <button type="button" className="ui-input-toggle" onClick={() => setVisible(!visible)}>
          {visible ? '🙈' : '👁'}
        </button>
      }
      {...props}
    />
  )
})

Password.displayName = 'Password'

// Search Input
interface SearchProps extends InputProps {
  onSearch?: (value: string) => void
}

export const Search = forwardRef<HTMLInputElement, SearchProps>(({ onSearch, ...props }, ref) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch?.((e.target as HTMLInputElement).value)
    }
  }
  return <Input ref={ref} onKeyDown={handleKeyDown} suffix={<span>🔍</span>} {...props} />
})

Search.displayName = 'Search'

// TextArea
interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'small' | 'medium' | 'large'
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ size = 'medium', className = '', ...props }, ref) => {
    return <textarea ref={ref} className={`ui-textarea ui-input-${size} ${className}`} {...props} />
  }
)

TextArea.displayName = 'TextArea'
