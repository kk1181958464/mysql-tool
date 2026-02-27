import { create } from 'zustand'
import { api } from '../utils/ipc'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const HEARTBEAT_KEY = 'heartbeatIntervalSeconds'
const HEARTBEAT_DEFAULT_SECONDS = 20
const HEARTBEAT_MIN_SECONDS = 5
const HEARTBEAT_MAX_SECONDS = 120

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const resolveTheme = (mode: ThemeMode): ResolvedTheme =>
  mode === 'system' ? getSystemTheme() : mode

function normalizeHeartbeatInterval(raw: unknown): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return HEARTBEAT_DEFAULT_SECONDS
  const rounded = Math.round(num)
  return Math.min(HEARTBEAT_MAX_SECONDS, Math.max(HEARTBEAT_MIN_SECONDS, rounded))
}

const savedThemeMode = (localStorage.getItem('themeMode') as ThemeMode) || 'system'
const savedAccentColor = localStorage.getItem('accentColor') || ''
const savedHeartbeatInterval = normalizeHeartbeatInterval(localStorage.getItem(HEARTBEAT_KEY))

interface AppState {
  sidebarCollapsed: boolean
  selectedDatabase: string | null
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  accentColor: string
  heartbeatIntervalSeconds: number
  toggleSidebar: () => void
  setSelectedDatabase: (db: string | null) => void
  setThemeMode: (mode: ThemeMode) => void
  setAccentColor: (color: string) => void
  setHeartbeatIntervalSeconds: (seconds: number) => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  selectedDatabase: null,
  themeMode: savedThemeMode,
  resolvedTheme: resolveTheme(savedThemeMode),
  accentColor: savedAccentColor,
  heartbeatIntervalSeconds: savedHeartbeatInterval,
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
  setHeartbeatIntervalSeconds: async (seconds) => {
    const normalized = normalizeHeartbeatInterval(seconds)
    localStorage.setItem(HEARTBEAT_KEY, String(normalized))
    set({ heartbeatIntervalSeconds: normalized })
    try {
      await api.store.saveSettings(HEARTBEAT_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save heartbeat setting failed', error)
    }
  },
}))

void (async () => {
  try {
    const saved = await api.store.getSettings(HEARTBEAT_KEY)
    if (saved === null) {
      await useAppStore.getState().setHeartbeatIntervalSeconds(savedHeartbeatInterval)
      return
    }

    const normalized = normalizeHeartbeatInterval(saved)
    localStorage.setItem(HEARTBEAT_KEY, String(normalized))
    useAppStore.setState({ heartbeatIntervalSeconds: normalized })

    if (String(normalized) !== saved) {
      await api.store.saveSettings(HEARTBEAT_KEY, String(normalized))
    }
  } catch (error) {
    console.warn('[app.store] load heartbeat setting failed', error)
  }
})()

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { themeMode } = useAppStore.getState()
  if (themeMode === 'system') {
    useAppStore.setState({ resolvedTheme: getSystemTheme() })
  }
})
