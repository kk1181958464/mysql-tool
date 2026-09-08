import { CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { createPortal } from 'react-dom'
import './ui.css'

interface ToastProps {
  open: boolean
  message: React.ReactNode
  type?: 'success' | 'error' | 'warning' | 'info'
}

const ICONS = {
  success: <CheckCircleOutlined />,
  error: <CloseCircleOutlined />,
  warning: <WarningOutlined />,
  info: <InfoCircleOutlined />,
}

export function Toast({ open, message, type = 'success' }: ToastProps) {
  if (!open) return null

  return createPortal(
    <div className={`ui-toast ui-toast-${type}`} role="status" aria-live="polite">
      <span className="ui-toast-icon">{ICONS[type]}</span>
      <span className="ui-toast-message">{message}</span>
    </div>,
    document.body,
  )
}
