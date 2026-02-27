import { useEffect, useState } from 'react'
import { Modal, Button } from './ui'
import { SunOutlined, MoonOutlined, LaptopOutlined, ExportOutlined, ImportOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app.store'
import { useConnectionStore } from '../stores/connection.store'
import { api } from '../utils/ipc'

const ACCENT_COLORS = [
  { label: '蓝色', value: '' },
  { label: '紫色', value: '#8b5cf6' },
  { label: '绿色', value: '#22c55e' },
  { label: '橙色', value: '#f97316' },
  { label: '粉色', value: '#ec4899' },
  { label: '青色', value: '#06b6d4' },
  { label: '红色', value: '#ef4444' },
  { label: '黄色', value: '#eab308' },
]

const HEARTBEAT_MIN_SECONDS = 5
const HEARTBEAT_MAX_SECONDS = 120
const HEARTBEAT_DEFAULT_SECONDS = 20

interface Props {
  open: boolean
  onClose: () => void
}

function normalizeHeartbeat(raw: unknown): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return HEARTBEAT_DEFAULT_SECONDS
  const rounded = Math.round(value)
  return Math.min(HEARTBEAT_MAX_SECONDS, Math.max(HEARTBEAT_MIN_SECONDS, rounded))
}

export default function SettingsModal({ open, onClose }: Props) {
  const {
    themeMode,
    setThemeMode,
    accentColor,
    setAccentColor,
    heartbeatIntervalSeconds,
    setHeartbeatIntervalSeconds,
  } = useAppStore()
  const [msg, setMsg] = useState('')
  const [heartbeatInput, setHeartbeatInput] = useState(String(heartbeatIntervalSeconds))

  useEffect(() => {
    if (open) {
      setHeartbeatInput(String(heartbeatIntervalSeconds))
    }
  }, [open, heartbeatIntervalSeconds])

  const applyHeartbeat = async (raw: string) => {
    const normalized = normalizeHeartbeat(raw)
    setHeartbeatInput(String(normalized))

    if (normalized !== Number(raw)) {
      setMsg(`⚠ 心跳时间已自动修正为 ${normalized} 秒（允许范围 ${HEARTBEAT_MIN_SECONDS}-${HEARTBEAT_MAX_SECONDS}）`)
    }

    try {
      await setHeartbeatIntervalSeconds(normalized)
      if (normalized === Number(raw)) {
        setMsg('✓ 心跳时间已保存')
      }
    } catch (e: any) {
      setMsg('✗ ' + (e.message || '心跳时间保存失败'))
    }
  }

  const handleExport = async () => {
    const filePath = await api.dialog.saveFile({
      defaultPath: 'mysql-tool-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!filePath) return
    try {
      const connections = await api.connection.list()
      const remarks = await api.store.getSettings('db-remarks')
      const data = {
        version: 1,
        connections,
        remarks: remarks ? JSON.parse(remarks) : {},
        themeMode,
        accentColor,
        heartbeatIntervalSeconds,
      }
      await api.dialog.writeFile(filePath, JSON.stringify(data, null, 2))
      setMsg('✓ 导出成功')
    } catch (e: any) {
      setMsg('✗ ' + (e.message || '导出失败'))
    }
  }

  const handleImport = async () => {
    const filePath = await api.dialog.openFile({
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!filePath) return
    try {
      const raw = await api.dialog.readFile(filePath)
      const data = JSON.parse(raw)
      if (data.connections?.length) {
        for (const conn of data.connections) {
          await api.connection.save(conn)
        }
      }
      if (data.remarks && Object.keys(data.remarks).length) {
        await api.store.saveSettings('db-remarks', JSON.stringify(data.remarks))
      }
      if (data.themeMode) setThemeMode(data.themeMode)
      if (data.accentColor !== undefined) setAccentColor(data.accentColor)
      if (data.heartbeatIntervalSeconds !== undefined) {
        await setHeartbeatIntervalSeconds(normalizeHeartbeat(data.heartbeatIntervalSeconds))
      }
      await useConnectionStore.getState().loadConnections()
      setMsg(`✓ 导入成功，共 ${data.connections?.length || 0} 个连接`)
    } catch (e: any) {
      setMsg('✗ ' + (e.message || '导入失败'))
    }
  }

  return (
    <Modal open={open} title="设置" width={480} onClose={onClose} footer={
      <Button variant="default" onClick={onClose}>关闭</Button>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 主题模式 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>主题模式</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([['light', '浅色', <SunOutlined />], ['system', '跟随系统', <LaptopOutlined />], ['dark', '深色', <MoonOutlined />]] as const).map(([mode, label, icon]) => (
              <button key={mode} onClick={() => setThemeMode(mode)} style={{
                flex: 1, padding: '8px 0', border: `1px solid ${themeMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6, background: themeMode === mode ? 'var(--accent-bg)' : 'transparent',
                color: themeMode === mode ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13,
              }}>{icon} {label}</button>
            ))}
          </div>
        </div>

        {/* 主题色 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>主题色</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACCENT_COLORS.map((c) => (
              <button key={c.label} onClick={() => setAccentColor(c.value)} title={c.label} style={{
                width: 32, height: 32, borderRadius: '50%', border: `2px solid ${(accentColor || '') === c.value ? 'var(--text-primary)' : 'var(--border)'}`,
                background: c.value || '#3b82f6', cursor: 'pointer', transition: 'all 0.15s',
              }} />
            ))}
          </div>
        </div>

        {/* 心跳设置 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>心跳时间（秒）</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="number"
              min={HEARTBEAT_MIN_SECONDS}
              max={HEARTBEAT_MAX_SECONDS}
              step={1}
              value={heartbeatInput}
              onChange={(e) => setHeartbeatInput(e.target.value)}
              onBlur={() => applyHeartbeat(heartbeatInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void applyHeartbeat(heartbeatInput)
                }
              }}
              style={{
                width: 140,
                height: 32,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                padding: '0 10px',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              建议 {HEARTBEAT_MIN_SECONDS}-{HEARTBEAT_MAX_SECONDS} 秒，默认 {HEARTBEAT_DEFAULT_SECONDS} 秒
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            无响应不一定是连接挂掉，也可能是数据库负载、锁等待或网络抖动导致。系统会先尝试探测并重建连接。
          </div>
        </div>

        {/* 导入导出 */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>配置迁移</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="default" onClick={handleExport} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ExportOutlined /> 导出配置
            </Button>
            <Button variant="default" onClick={handleImport} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ImportOutlined /> 导入配置
            </Button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>导出/导入连接信息、数据库备注、主题设置</div>
          {msg && <div style={{ fontSize: 12, marginTop: 6, color: msg.startsWith('✓') ? 'var(--success)' : msg.startsWith('⚠') ? 'var(--warning, #f59e0b)' : 'var(--error)' }}>{msg}</div>}
        </div>
      </div>
    </Modal>
  )
}
