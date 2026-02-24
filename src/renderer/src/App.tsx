import { useEffect } from 'react'
import AppLayout from './components/Layout/AppLayout'
import { useAppStore } from './stores/app.store'

export default function App() {
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const accentColor = useAppStore((s) => s.accentColor)

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

  return <AppLayout />
}
