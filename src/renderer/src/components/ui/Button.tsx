import { ButtonHTMLAttributes, forwardRef } from 'react'
import './ui.css'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'default' | 'text' | 'danger'
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'] | 'primary' | 'default' | 'text' | 'danger'
  danger?: boolean
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, type, danger, size = 'medium', loading, icon, children, className = '', disabled, ...props }, ref) => {
    const buttonType = type === 'submit' || type === 'reset' || type === 'button' ? type : 'button'
    const visualVariant = danger ? 'danger' : variant || (type === 'primary' || type === 'text' || type === 'danger' ? type : 'default')
    return (
      <button
        ref={ref}
        type={buttonType}
        className={`ui-btn ui-btn-${visualVariant} ui-btn-${size} ${className}`}
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
