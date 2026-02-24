import { useState, useEffect } from 'react'
import { Modal, Button } from '../ui'
import { api } from '../../utils/ipc'
import SettingsModal from '../SettingsModal'

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [remember, setRemember] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    api.win.isMaximized().then(setMaximized)
    const unsub = api.win.onMaximized(setMaximized)
    return unsub
  }, [])

  const handleClose = async () => {
    const saved = localStorage.getItem('closeAction')
    if (saved) {
      if (saved === 'minimize') api.win.minimize()
      else api.win.close()
      return
    }
    setShowClose(true)
  }

  const doClose = (action: 'minimize' | 'quit') => {
    if (remember) localStorage.setItem('closeAction', action)
    setShowClose(false)
    setRemember(false)
    if (action === 'minimize') api.win.minimize()
    else api.win.close()
  }

  return (
    <>
      <div className="title-bar">
        <div className="title-bar-drag">
          <span className="title-bar-text">MySQL 连接工具</span>
        </div>
        <div className="title-bar-controls">
          <button className="title-btn" onClick={() => setShowSettings(true)} title="设置" style={{ fontSize: 14 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.07 0l-.26 1.59a5.97 5.97 0 00-1.5.63L3.98 1.28 2.28 2.98l.94 1.33a5.97 5.97 0 00-.63 1.5L1 6.07v2.4l1.59.26c.14.53.36 1.03.63 1.5l-.94 1.33 1.7 1.7 1.33-.94c.47.27.97.49 1.5.63L7.07 15h2.4l.26-1.59a5.97 5.97 0 001.5-.63l1.33.94 1.7-1.7-.94-1.33c.27-.47.49-.97.63-1.5L15.54 8.93v-2.4l-1.59-.26a5.97 5.97 0 00-.63-1.5l.94-1.33-1.7-1.7-1.33.94a5.97 5.97 0 00-1.5-.63L9.47 0H7.07zM8.27 5a2.73 2.73 0 110 5.46 2.73 2.73 0 010-5.46z"/></svg>
          </button>
          <button className="title-btn" onClick={() => api.win.minimize()} title="最小化">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className="title-btn" onClick={() => api.win.maximize()} title={maximized ? '还原' : '最大化'}>
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 0v2H0v8h8V8h2V0H2zm6 8H1V3h7v5zm1-6H3V1h6v6h-1V2z" fill="currentColor"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" rx="0" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
            )}
          </button>
          <button className="title-btn title-btn-close" onClick={handleClose} title="关闭">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>

      <Modal open={showClose} title="关闭窗口" width={380} onClose={() => setShowClose(false)} footer={null}>
        <div style={{ padding: '8px 0' }}>
          <p style={{ marginBottom: 16 }}>您希望点击关闭按钮时执行什么操作？</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button variant="default" onClick={() => doClose('minimize')}>最小化到托盘</Button>
            <Button variant="primary" onClick={() => doClose('quit')} style={{ background: 'var(--error)' }}>退出程序</Button>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            记住我的选择
          </label>
        </div>
      </Modal>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  )
}
