import { useEffect, useRef } from 'react'
import AppLayout from './components/Layout/AppLayout'
import { useAppStore } from './stores/app.store'
import { api } from './utils/ipc'

const FIRST_INTERACTION_METRIC = 'app.first_interaction_latency'
const LONG_TASK_METRIC = 'app.longtask.duration'
const LONG_GAP_METRIC = 'app.longtask.fallback_gap'

export default function App() {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const accentColor = useAppStore((s) => s.accentColor)
  const firstInteractionReportedRef = useRef(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    const el = document.documentElement.style
    if (accentColor) {
      el.setProperty('--accent', accentColor)
      el.setProperty('--accent-hover', accentColor)
      el.setProperty('--accent-bg', accentColor + '1a')
      el.setProperty('--color-primary', accentColor)
      el.setProperty('--color-primary-bg', accentColor + '1a')
    } else {
      el.removeProperty('--accent')
      el.removeProperty('--accent-hover')
      el.removeProperty('--accent-bg')
      el.removeProperty('--color-primary')
      el.removeProperty('--color-primary-bg')
    }
  }, [accentColor, resolvedTheme])

  useEffect(() => {
    if (firstInteractionReportedRef.current) return

    const reportFirstInteraction = (event: PointerEvent) => {
      if (firstInteractionReportedRef.current) return
      firstInteractionReportedRef.current = true
      const start = performance.now()
      requestAnimationFrame(() => {
        queueMicrotask(() => {
          const latency = performance.now() - start
          void api.perf.reportMetric({
            name: FIRST_INTERACTION_METRIC,
            value: Number(latency.toFixed(2)),
            tags: {
              eventType: event.pointerType || 'pointer',
              page: 'app',
            },
            ts: Date.now(),
          })
        })
      })
      window.removeEventListener('pointerdown', reportFirstInteraction, true)
    }

    window.addEventListener('pointerdown', reportFirstInteraction, true)
    return () => window.removeEventListener('pointerdown', reportFirstInteraction, true)
  }, [])

  useEffect(() => {
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((entry) => {
            void api.perf.reportMetric({
              name: LONG_TASK_METRIC,
              value: Number(entry.duration.toFixed(2)),
              tags: {
                page: 'app',
              },
              ts: Date.now(),
            })
          })
        })
        observer.observe({ entryTypes: ['longtask'] })
        return () => observer.disconnect()
      } catch {
        // fallback below
      }
    }

    let last = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const drift = now - last - 1000
      if (drift > 50) {
        void api.perf.reportMetric({
          name: LONG_GAP_METRIC,
          value: Number(drift.toFixed(2)),
          tags: {
            page: 'app',
          },
          ts: Date.now(),
        })
      }
      last = now
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  return <AppLayout />
}
