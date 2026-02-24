import { create } from 'zustand'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const resolveTheme = (mode: ThemeMode): ResolvedTheme =>
  mode === 'system' ? getSystemTheme() : mode

const savedThemeMode = (localStorage.getItem('themeMode') as ThemeMode) || 'system'
const savedAccentColor = localStorage.getItem('accentColor') || ''

interface AppState {
  sidebarCollapsed: boolean
  selectedDatabase: string | null
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  accentColor: string
  toggleSidebar: () => void
  setSelectedDatabase: (db: string | null) => void
  setThemeMode: (mode: ThemeMode) => void
  setAccentColor: (color: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  selectedDatabase: null,
  themeMode: savedThemeMode,
  resolvedTheme: resolveTheme(savedThemeMode),
  accentColor: savedAccentColor,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedDatabase: (selectedDatabase) => set({ selectedDatabase }),
  setThemeMode: (mode) => {
    localStorage.setItem('themeMode', mode)
    set({ themeMode: mode, resolvedTheme: resolveTheme(mode) })
  },
  setAccentColor: (color) => {
    localStorage.setItem('accentColor', color)
    set({ accentColor: color })
  },
}))

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { themeMode } = useAppStore.getState()
  if (themeMode === 'system') {
    useAppStore.setState({ resolvedTheme: getSystemTheme() })
  }
})
