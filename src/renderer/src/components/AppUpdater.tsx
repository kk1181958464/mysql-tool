import { useEffect, useRef, useState } from 'react'
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DownloadOutlined,
  ReloadOutlined,
  RocketOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { AppUpdateState } from '../../../shared/types/app-update'
import { api } from '../utils/ipc'
import { Button, Modal } from './ui'

const initialState: AppUpdateState = {
  status: 'idle',
  currentVersion: '',
  portable: false,
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / Math.pow(1024, index)
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export default function AppUpdater() {
  const [state, setState] = useState<AppUpdateState>(initialState)
  const [open, setOpen] = useState(false)
  const autoOpenedRef = useRef('')

  useEffect(() => {
    let active = true
    void api.updater.getState().then((next) => {
      if (active) setState(next)
    })
    const unsubscribe = api.updater.onStateChanged((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (state.status !== 'available' && state.status !== 'downloaded') return
    const key = `${state.status}:${state.version || ''}`
    if (autoOpenedRef.current === key) return
    autoOpenedRef.current = key
    setOpen(true)
  }, [state.status, state.version])

  const openUpdater = () => {
    setOpen(true)
    if (state.status === 'idle' || state.status === 'not-available' || state.status === 'error') {
      void api.updater.check()
    }
  }

  const hasUpdate = state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
  const progress = Math.max(0, Math.min(100, state.progress?.percent || 0))

  const renderContent = () => {
    if (state.status === 'checking' || state.status === 'idle') {
      return (
        <div className="app-update-message">
          <CloudDownloadOutlined className="app-update-hero-icon" />
          <strong>正在检查更新</strong>
          <span>当前版本 {state.currentVersion || '-'}</span>
        </div>
      )
    }

    if (state.status === 'available') {
      return (
        <div className="app-update-content">
          <div className="app-update-heading">
            <RocketOutlined className="app-update-hero-icon" />
            <div>
              <strong>发现新版本 {state.version}</strong>
              <span>当前版本 {state.currentVersion}</span>
            </div>
          </div>
          {state.releaseNotes && <div className="app-update-notes">{state.releaseNotes}</div>}
        </div>
      )
    }

    if (state.status === 'downloading') {
      return (
        <div className="app-update-content">
          <div className="app-update-heading">
            <DownloadOutlined className="app-update-hero-icon" />
            <div>
              <strong>正在下载 {state.version}</strong>
              <span>{formatBytes(state.progress?.transferred || 0)} / {formatBytes(state.progress?.total || 0)}</span>
            </div>
          </div>
          <div className="app-update-progress" aria-label={`下载进度 ${progress.toFixed(0)}%`}>
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="app-update-progress-meta">
            <span>{progress.toFixed(0)}%</span>
            <span>{formatBytes(state.progress?.bytesPerSecond || 0)}/s</span>
          </div>
        </div>
      )
    }

    if (state.status === 'downloaded') {
      return (
        <div className="app-update-message">
          <CheckCircleOutlined className="app-update-hero-icon app-update-success" />
          <strong>新版本 {state.version} 已准备好</strong>
          <span>重启后将自动完成安装</span>
        </div>
      )
    }

    if (state.status === 'not-available') {
      return (
        <div className="app-update-message">
          <CheckCircleOutlined className="app-update-hero-icon app-update-success" />
          <strong>当前已是最新版本</strong>
          <span>版本 {state.currentVersion}</span>
        </div>
      )
    }

    if (state.status === 'unsupported') {
      return (
        <div className="app-update-message">
          <WarningOutlined className="app-update-hero-icon app-update-warning" />
          <strong>{state.portable ? '便携版不支持自动覆盖安装' : '开发环境不执行在线升级'}</strong>
          <span>{state.portable ? '可前往 GitHub Release 下载最新版' : `当前版本 ${state.currentVersion || '-'}`}</span>
        </div>
      )
    }

    return (
      <div className="app-update-message">
        <WarningOutlined className="app-update-hero-icon app-update-warning" />
        <strong>检查更新失败</strong>
        <span className="app-update-error">{state.error || '请稍后重试'}</span>
      </div>
    )
  }

  const renderFooter = () => {
    if (state.status === 'available') {
      return (
        <>
          <Button onClick={() => setOpen(false)}>稍后提醒</Button>
          <Button variant="primary" icon={<DownloadOutlined />} onClick={() => void api.updater.download()}>下载更新</Button>
        </>
      )
    }
    if (state.status === 'downloaded') {
      return (
        <>
          <Button onClick={() => setOpen(false)}>稍后重启</Button>
          <Button variant="primary" icon={<RocketOutlined />} onClick={() => void api.updater.install()}>重启并安装</Button>
        </>
      )
    }
    if (state.status === 'downloading' || state.status === 'checking' || state.status === 'idle') {
      return <Button onClick={() => setOpen(false)}>后台运行</Button>
    }
    return (
      <>
        {(state.status === 'unsupported' || state.status === 'error') && (
          <Button onClick={() => void api.updater.openRelease()}>查看 Release</Button>
        )}
        {state.status !== 'unsupported' && (
          <Button variant="primary" icon={<ReloadOutlined />} onClick={() => void api.updater.check()}>重新检查</Button>
        )}
        <Button onClick={() => setOpen(false)}>关闭</Button>
      </>
    )
  }

  return (
    <>
      <button
        className={`title-btn app-update-trigger ${hasUpdate ? 'has-update' : ''}`}
        onClick={openUpdater}
        title={hasUpdate ? `发现新版本 ${state.version || ''}` : '检查更新'}
      >
        <CloudDownloadOutlined />
        {hasUpdate && <span className="app-update-dot" />}
      </button>
      <Modal
        open={open}
        title="应用更新"
        width={460}
        onClose={() => setOpen(false)}
        footer={renderFooter()}
      >
        {renderContent()}
      </Modal>
    </>
  )
}
