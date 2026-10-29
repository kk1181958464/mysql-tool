import { useState } from 'react'
import { CloseCircleFilled, CloseOutlined, CopyOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button } from './ui'
import { describeError } from '../utils/error-info'

interface Props {
  error: unknown
  fallbackTitle?: string
  onRetry?: () => void | Promise<void>
  onClose?: () => void
  actions?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function ErrorNotice({ error, fallbackTitle = '操作失败', onRetry, onClose, actions, className = '', style }: Props) {
  const [retrying, setRetrying] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [copied, setCopied] = useState(false)
  const info = describeError(error, fallbackTitle)
  const showDetailToggle = info.detail !== info.hint || Boolean(info.code)

  const retry = async () => {
    if (!onRetry) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  const copy = async () => {
    await window.api.clipboard.writeText(info.detail)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`err-notice ${className}`} style={style} role="alert">
      <div className="err-notice-head">
        <CloseCircleFilled className="err-notice-icon" />
        <div className="err-notice-title">{info.title}</div>
        {info.errno ? <span className="err-notice-code">{info.errno}</span> : null}
        {onClose && (
          <button type="button" className="err-notice-close" onClick={onClose} title="关闭">
            <CloseOutlined />
          </button>
        )}
      </div>
      <div className="err-notice-hint">{info.hint}</div>
      {(onRetry || actions) && (
        <div className="err-notice-actions">
          {onRetry && <Button size="small" variant="primary" loading={retrying} icon={<ReloadOutlined />} onClick={retry}>重试</Button>}
          {actions}
        </div>
      )}
      {showDetailToggle && (
        <>
          <button type="button" className={`err-notice-toggle ${showDetail ? 'open' : ''}`} onClick={() => setShowDetail((v) => !v)}>
            <DownOutlined /> 详细信息
          </button>
          {showDetail && (
            <div className="err-notice-detail">
              <pre>{info.detail}</pre>
              <button type="button" className="err-notice-copy" onClick={copy}>
                <CopyOutlined /> {copied ? '已复制' : '复制'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
