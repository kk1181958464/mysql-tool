import { create } from 'zustand'
import { api } from '../utils/ipc'
import {
  HEARTBEAT_SETTING_KEY,
  TABLE_ROWS_PER_PAGE_SETTING_KEY,
  normalizeHeartbeatSeconds,
  normalizeTableRowsPerPage,
} from '../../../shared/constants'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

const getSystemTheme = (): ResolvedTheme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

const resolveTheme = (mode: ThemeMode): ResolvedTheme =>
  mode === 'system' ? getSystemTheme() : mode

const savedThemeMode = (localStorage.getItem('themeMode') as ThemeMode) || 'system'
const savedAccentColor = localStorage.getItem('accentColor') || ''
const savedHeartbeatInterval = normalizeHeartbeatSeconds(localStorage.getItem(HEARTBEAT_SETTING_KEY))
const savedRowsPerPage = normalizeTableRowsPerPage(localStorage.getItem(TABLE_ROWS_PER_PAGE_SETTING_KEY))

interface AppState {
  sidebarCollapsed: boolean
  selectedDatabase: string | null
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  accentColor: string
  heartbeatIntervalSeconds: number
  rowsPerPage: number
  toggleSidebar: () => void
  setSelectedDatabase: (db: string | null) => void
  setThemeMode: (mode: ThemeMode) => void
  setAccentColor: (color: string) => void
  setHeartbeatIntervalSeconds: (seconds: number) => Promise<void>
  setRowsPerPage: (value: number) => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  selectedDatabase: null,
  themeMode: savedThemeMode,
  resolvedTheme: resolveTheme(savedThemeMode),
  accentColor: savedAccentColor,
  heartbeatIntervalSeconds: savedHeartbeatInterval,
  rowsPerPage: savedRowsPerPage,
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
    const normalized = normalizeHeartbeatSeconds(seconds)
    localStorage.setItem(HEARTBEAT_SETTING_KEY, String(normalized))
    set({ heartbeatIntervalSeconds: normalized })
    try {
      await api.store.saveSettings(HEARTBEAT_SETTING_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save heartbeat setting failed', error)
    }
  },
  setRowsPerPage: async (value) => {
    const normalized = normalizeTableRowsPerPage(value)
    localStorage.setItem(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
    set({ rowsPerPage: normalized })
    try {
      await api.store.saveSettings(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save rows per page setting failed', error)
    }
  },
}))

void (async () => {
  try {
    const saved = await api.store.getSettings(HEARTBEAT_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setHeartbeatIntervalSeconds(savedHeartbeatInterval)
    } else {
      const normalized = normalizeHeartbeatSeconds(saved)
      localStorage.setItem(HEARTBEAT_SETTING_KEY, String(normalized))
      useAppStore.setState({ heartbeatIntervalSeconds: normalized })

      if (String(normalized) !== saved) {
        await api.store.saveSettings(HEARTBEAT_SETTING_KEY, String(normalized))
      }
    }
  } catch (error) {
    console.warn('[app.store] load heartbeat setting failed', error)
  }

  try {
    const saved = await api.store.getSettings(TABLE_ROWS_PER_PAGE_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setRowsPerPage(savedRowsPerPage)
      return
    }

    const normalized = normalizeTableRowsPerPage(saved)
    localStorage.setItem(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
    useAppStore.setState({ rowsPerPage: normalized })

    if (String(normalized) !== saved) {
      await api.store.saveSettings(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
    }
  } catch (error) {
    console.warn('[app.store] load rows per page setting failed', error)
  }
})()

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { themeMode } = useAppStore.getState()
  if (themeMode === 'system') {
    useAppStore.setState({ resolvedTheme: getSystemTheme() })
  }
})
