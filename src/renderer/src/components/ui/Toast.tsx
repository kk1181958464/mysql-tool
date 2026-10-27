import { useEffect, useState } from 'react'
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

type ToastType = NonNullable<ToastProps['type']>
interface ToastItem { id: number; type: ToastType; message: string }

const TOAST_DURATION_MS = 3200
let toastSeq = 0
let currentToast: ToastItem | null = null
const toastListeners = new Set<(item: ToastItem | null) => void>()

function showToast(type: ToastType, message: string) {
  const item = { id: ++toastSeq, type, message }
  currentToast = item
  toastListeners.forEach((listener) => listener(item))
  window.setTimeout(() => {
    if (currentToast?.id !== item.id) return
    currentToast = null
    toastListeners.forEach((listener) => listener(null))
  }, TOAST_DURATION_MS)
}

export const toast = {
  success: (message: string) => showToast('success', message),
  error: (message: string) => showToast('error', message),
  warning: (message: string) => showToast('warning', message),
  info: (message: string) => showToast('info', message),
}

export function ToastHost() {
  const [item, setItem] = useState<ToastItem | null>(currentToast)
  useEffect(() => {
    toastListeners.add(setItem)
    return () => { toastListeners.delete(setItem) }
  }, [])
  return item ? <Toast key={item.id} open message={item.message} type={item.type} /> : null
}
