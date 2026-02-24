import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import './ui.css'

interface ModalProps {
  open: boolean
  title?: React.ReactNode
  width?: number | string
  onClose?: () => void
  onOk?: () => void
  okText?: string
  cancelText?: string
  footer?: React.ReactNode | null
  children?: React.ReactNode
  className?: string
}

export function Modal({
  open,
  title,
  width = 520,
  onClose,
  onOk,
  okText = '确定',
  cancelText = '取消',
  footer,
  children,
  className = '',
}: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose?.()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  const modalContent = (
    <div className="ui-modal-overlay">
      <div
        className={`ui-modal ${className}`}
        style={{ width }}
      >
        {title && (
          <div className="ui-modal-header">
            <span className="ui-modal-title">{title}</span>
            <button className="ui-modal-close" onClick={onClose}>×</button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer !== null && (
          <div className="ui-modal-footer">
            {footer !== undefined ? footer : (
              <>
                <Button variant="default" onClick={onClose}>{cancelText}</Button>
                <Button variant="primary" onClick={onOk}>{okText}</Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
