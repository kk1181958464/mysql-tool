import { useEffect, useRef } from 'react'
import AppLayout from './components/Layout/AppLayout'
import { useAppStore } from './stores/app.store'
import { reportPerfMetric } from './utils/perf'
import { api } from './utils/ipc'
import { ToastHost } from './components/ui'

const FIRST_INTERACTION_METRIC = 'app.first_interaction_latency'
const LONG_TASK_METRIC = 'app.longtask.duration'
const LONG_GAP_METRIC = 'app.longtask.fallback_gap'
const PERF_METRICS_ENABLED = import.meta.env.DEV
const THEME_TRANSITION_MS = 360

export default function App() {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const accentColor = useAppStore((s) => s.accentColor)
  const firstInteractionReportedRef = useRef(false)
  const themeAppliedRef = useRef(false)

  useEffect(() => {
    const root = document.documentElement
    const changed = root.getAttribute('data-theme') !== resolvedTheme
    let timer: number | undefined
    if (changed && themeAppliedRef.current) {
      root.classList.add('theme-switching')
      timer = window.setTimeout(() => root.classList.remove('theme-switching'), THEME_TRANSITION_MS)
    }
    root.setAttribute('data-theme', resolvedTheme)
    themeAppliedRef.current = true
    api.win.setTheme(resolvedTheme)
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
        root.classList.remove('theme-switching')
      }
    }
  }, [resolvedTheme])

  useEffect(() => {
    const el = document.documentElement.style
    if (accentColor) {
      el.setProperty('--accent', accentColor)
    } else {
      el.removeProperty('--accent')
    }
  }, [accentColor])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !document.querySelector('.context-menu')) return
      window.dispatchEvent(new Event('app:close-context-menus'))
      document.dispatchEvent(new Event('app:close-context-menus'))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    if (!PERF_METRICS_ENABLED) return
    if (firstInteractionReportedRef.current) return

    const reportFirstInteraction = (event: PointerEvent) => {
      if (firstInteractionReportedRef.current) return
      firstInteractionReportedRef.current = true
      const start = performance.now()
      requestAnimationFrame(() => {
        queueMicrotask(() => {
          const latency = performance.now() - start
          reportPerfMetric({
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
    if (!PERF_METRICS_ENABLED) return
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          entries.forEach((entry) => {
            reportPerfMetric({
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
        reportPerfMetric({
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

  return (
    <>
      <AppLayout />
      <ToastHost />
    </>
  )
}
