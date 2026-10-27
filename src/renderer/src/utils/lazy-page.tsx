import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { ErrorNotice } from '../components/ErrorNotice'

export type PageComponent<P> = ComponentType<P & { fallback: ReactNode }> & { preload: () => Promise<void> }

// Unlike React.lazy + Suspense, this re-renders itself when the module arrives, so it never depends on a Suspense retry ping.
export function lazyPage<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): PageComponent<P> {
  let Loaded: ComponentType<P> | null = null
  let pending: Promise<void> | null = null

  const preload = () => {
    pending ??= load().then(
      (module) => { Loaded = module.default },
      (error) => { pending = null; throw error },
    )
    return pending
  }

  function LazyPage({ fallback, ...props }: P & { fallback: ReactNode }) {
    const [, setReady] = useState(Boolean(Loaded))
    const [error, setError] = useState<unknown>(null)

    useEffect(() => {
      if (Loaded) return
      let active = true
      preload().then(
        () => { if (active) setReady(true) },
        (e) => { if (active) setError(e) },
      )
      return () => { active = false }
    }, [])

    if (Loaded) return <Loaded {...(props as P)} />
    if (error) {
      return (
        <div style={{ padding: 16, maxWidth: 560 }}>
          <ErrorNotice error={error} fallbackTitle="页面加载失败" onRetry={() => { setError(null); preload().then(() => setReady(true), setError) }} />
        </div>
      )
    }
    return <>{fallback}</>
  }

  return Object.assign(LazyPage, { preload }) as PageComponent<P>
}
