import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  hasError: boolean
  errorMessage: string
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: '',
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('Renderer error boundary caught an error:', error, info)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'radial-gradient(circle at 50% 0%, var(--accent-bg), transparent 60%), var(--bg-base)',
        color: 'var(--text-primary)',
      }}>
        <div style={{
          width: 'min(720px, 100%)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg)',
          animation: 'modal-in var(--dur-slow) var(--ease-spring)',
          padding: 24,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>界面发生异常</div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: 16 }}>
            已阻止错误继续扩散，避免整个窗口直接白屏。你可以先刷新应用，如果问题可稳定复现，再把下面的错误信息发出来。
          </div>
          <pre style={{
            margin: 0,
            padding: 16,
            borderRadius: 12,
            background: 'var(--bg-inset)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {this.state.errorMessage || 'Unknown renderer error'}
          </pre>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 'none',
                borderRadius: 10,
                padding: '10px 16px',
                background: 'var(--accent-solid)',
                color: 'var(--accent-fg)',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              刷新应用
            </button>
          </div>
        </div>
      </div>
    )
  }
}
