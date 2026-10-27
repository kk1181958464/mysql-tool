import type { ConnectionConfig } from '../../../shared/types/connection'

export type ConnState = 'connected' | 'connecting' | 'idle'

const CONN_STATE_LABEL: Record<ConnState, string> = { connected: '已连接', connecting: '连接中', idle: '未连接' }

interface Props {
  conn: Pick<ConnectionConfig, 'name' | 'color' | 'icon'>
  status?: ConnState
  size?: 'small' | 'medium' | 'large'
}

export function ConnAvatar({ conn, status, size = 'medium' }: Props) {
  const icon = conn.icon?.trim() || ''
  const isImage = icon.startsWith('data:image/')
  const fallback = Array.from((conn.name || '').trim())[0]?.toUpperCase() || '?'

  return (
    <span
      className={`conn-avatar conn-avatar-${size} ${isImage ? 'conn-avatar-image' : ''}`}
      style={{ '--conn-color': conn.color || 'var(--accent)' } as React.CSSProperties}
    >
      {isImage ? <img src={icon} alt="" draggable={false} /> : <span className="conn-avatar-text">{icon || fallback}</span>}
      {status && <span className={`conn-status conn-status-${status}`} title={CONN_STATE_LABEL[status]} />}
    </span>
  )
}
