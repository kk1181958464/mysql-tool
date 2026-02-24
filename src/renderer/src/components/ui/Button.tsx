import { ButtonHTMLAttributes, forwardRef } from 'react'
import './ui.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'default' | 'text' | 'danger'
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'medium', loading, icon, children, className = '', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <span className="ui-btn-spinner" />}
        {!loading && icon && <span className="ui-btn-icon">{icon}</span>}
        {children && <span>{children}</span>}
      </button>
    )
  }
)

Button.displayName = 'Button'
