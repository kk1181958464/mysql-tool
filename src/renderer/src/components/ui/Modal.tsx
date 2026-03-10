import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import './ui.css'

const MODAL_ANIMATION_MS = 180

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
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    if (open) {
      setMounted(true)
      setLeaving(false)
      return
    }

    if (mounted) {
      setLeaving(true)
      closeTimerRef.current = window.setTimeout(() => {
        setMounted(false)
        setLeaving(false)
        closeTimerRef.current = null
      }, MODAL_ANIMATION_MS)
    }
  }, [mounted, open])

  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [mounted])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose?.()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  if (!mounted) return null

  const overlayClassName = `ui-modal-overlay ${leaving ? 'ui-modal-overlay-leave' : 'ui-modal-overlay-enter'}`
  const modalClassName = `ui-modal ${leaving ? 'ui-modal-leave' : 'ui-modal-enter'} ${className}`.trim()

  const modalContent = (
    <div className={overlayClassName}>
      <div
        className={modalClassName}
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
