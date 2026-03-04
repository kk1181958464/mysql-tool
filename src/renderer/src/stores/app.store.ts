import { create } from 'zustand'
import { api } from '../utils/ipc'
import {
  HEARTBEAT_SETTING_KEY,
  HEARTBEAT_TIMEOUT_SETTING_KEY,
  HEARTBEAT_CONCURRENCY_SETTING_KEY,
  HEARTBEAT_AUTOTUNE_SETTING_KEY,
  PAGINATION_MODE_SETTING_KEY,
  TABLE_ROWS_PER_PAGE_SETTING_KEY,
  normalizeHeartbeatSeconds,
  normalizeHeartbeatTimeoutMs,
  normalizeHeartbeatConcurrency,
  normalizeHeartbeatAutoTuneEnabled,
  normalizePaginationMode,
  normalizeTableRowsPerPage,
  type PaginationMode,
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
const savedHeartbeatTimeoutMs = normalizeHeartbeatTimeoutMs(localStorage.getItem(HEARTBEAT_TIMEOUT_SETTING_KEY))
const savedHeartbeatConcurrency = normalizeHeartbeatConcurrency(localStorage.getItem(HEARTBEAT_CONCURRENCY_SETTING_KEY))
const savedHeartbeatAutoTuneEnabled = normalizeHeartbeatAutoTuneEnabled(localStorage.getItem(HEARTBEAT_AUTOTUNE_SETTING_KEY))
const savedRowsPerPage = normalizeTableRowsPerPage(localStorage.getItem(TABLE_ROWS_PER_PAGE_SETTING_KEY))
const savedPaginationMode = normalizePaginationMode(localStorage.getItem(PAGINATION_MODE_SETTING_KEY))

interface AppState {
  sidebarCollapsed: boolean
  selectedDatabase: string | null
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  accentColor: string
  heartbeatIntervalSeconds: number
  heartbeatTimeoutMs: number
  heartbeatMaxConcurrency: number
  heartbeatAutoTuneEnabled: boolean
  rowsPerPage: number
  paginationMode: PaginationMode
  toggleSidebar: () => void
  setSelectedDatabase: (db: string | null) => void
  setThemeMode: (mode: ThemeMode) => void
  setAccentColor: (color: string) => void
  setHeartbeatIntervalSeconds: (seconds: number) => Promise<void>
  setHeartbeatTimeoutMs: (timeoutMs: number) => Promise<void>
  setHeartbeatMaxConcurrency: (concurrency: number) => Promise<void>
  setHeartbeatAutoTuneEnabled: (enabled: boolean) => Promise<void>
  setRowsPerPage: (value: number) => Promise<void>
  setPaginationMode: (mode: PaginationMode) => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  selectedDatabase: null,
  themeMode: savedThemeMode,
  resolvedTheme: resolveTheme(savedThemeMode),
  accentColor: savedAccentColor,
  heartbeatIntervalSeconds: savedHeartbeatInterval,
  heartbeatTimeoutMs: savedHeartbeatTimeoutMs,
  heartbeatMaxConcurrency: savedHeartbeatConcurrency,
  heartbeatAutoTuneEnabled: savedHeartbeatAutoTuneEnabled,
  rowsPerPage: savedRowsPerPage,
  paginationMode: savedPaginationMode,
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
  setHeartbeatTimeoutMs: async (timeoutMs) => {
    const normalized = normalizeHeartbeatTimeoutMs(timeoutMs)
    localStorage.setItem(HEARTBEAT_TIMEOUT_SETTING_KEY, String(normalized))
    set({ heartbeatTimeoutMs: normalized })
    try {
      await api.store.saveSettings(HEARTBEAT_TIMEOUT_SETTING_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save heartbeat timeout setting failed', error)
    }
  },
  setHeartbeatMaxConcurrency: async (concurrency) => {
    const normalized = normalizeHeartbeatConcurrency(concurrency)
    localStorage.setItem(HEARTBEAT_CONCURRENCY_SETTING_KEY, String(normalized))
    set({ heartbeatMaxConcurrency: normalized })
    try {
      await api.store.saveSettings(HEARTBEAT_CONCURRENCY_SETTING_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save heartbeat concurrency setting failed', error)
    }
  },
  setHeartbeatAutoTuneEnabled: async (enabled) => {
    const normalized = normalizeHeartbeatAutoTuneEnabled(enabled)
    localStorage.setItem(HEARTBEAT_AUTOTUNE_SETTING_KEY, String(normalized))
    set({ heartbeatAutoTuneEnabled: normalized })
    try {
      await api.store.saveSettings(HEARTBEAT_AUTOTUNE_SETTING_KEY, String(normalized))
    } catch (error) {
      console.warn('[app.store] save heartbeat auto-tune setting failed', error)
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
  setPaginationMode: async (mode) => {
    const normalized = normalizePaginationMode(mode)
    localStorage.setItem(PAGINATION_MODE_SETTING_KEY, normalized)
    set({ paginationMode: normalized })
    try {
      await api.store.saveSettings(PAGINATION_MODE_SETTING_KEY, normalized)
    } catch (error) {
      console.warn('[app.store] save pagination mode setting failed', error)
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
    const saved = await api.store.getSettings(HEARTBEAT_TIMEOUT_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setHeartbeatTimeoutMs(savedHeartbeatTimeoutMs)
    } else {
      const normalized = normalizeHeartbeatTimeoutMs(saved)
      localStorage.setItem(HEARTBEAT_TIMEOUT_SETTING_KEY, String(normalized))
      useAppStore.setState({ heartbeatTimeoutMs: normalized })

      if (String(normalized) !== saved) {
        await api.store.saveSettings(HEARTBEAT_TIMEOUT_SETTING_KEY, String(normalized))
      }
    }
  } catch (error) {
    console.warn('[app.store] load heartbeat timeout setting failed', error)
  }

  try {
    const saved = await api.store.getSettings(HEARTBEAT_CONCURRENCY_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setHeartbeatMaxConcurrency(savedHeartbeatConcurrency)
    } else {
      const normalized = normalizeHeartbeatConcurrency(saved)
      localStorage.setItem(HEARTBEAT_CONCURRENCY_SETTING_KEY, String(normalized))
      useAppStore.setState({ heartbeatMaxConcurrency: normalized })

      if (String(normalized) !== saved) {
        await api.store.saveSettings(HEARTBEAT_CONCURRENCY_SETTING_KEY, String(normalized))
      }
    }
  } catch (error) {
    console.warn('[app.store] load heartbeat concurrency setting failed', error)
  }

  try {
    const saved = await api.store.getSettings(HEARTBEAT_AUTOTUNE_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setHeartbeatAutoTuneEnabled(savedHeartbeatAutoTuneEnabled)
    } else {
      const normalized = normalizeHeartbeatAutoTuneEnabled(saved)
      localStorage.setItem(HEARTBEAT_AUTOTUNE_SETTING_KEY, String(normalized))
      useAppStore.setState({ heartbeatAutoTuneEnabled: normalized })

      if (String(normalized) !== saved) {
        await api.store.saveSettings(HEARTBEAT_AUTOTUNE_SETTING_KEY, String(normalized))
      }
    }
  } catch (error) {
    console.warn('[app.store] load heartbeat auto-tune setting failed', error)
  }

  try {
    const saved = await api.store.getSettings(TABLE_ROWS_PER_PAGE_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setRowsPerPage(savedRowsPerPage)
    } else {
      const normalized = normalizeTableRowsPerPage(saved)
      localStorage.setItem(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
      useAppStore.setState({ rowsPerPage: normalized })

      if (String(normalized) !== saved) {
        await api.store.saveSettings(TABLE_ROWS_PER_PAGE_SETTING_KEY, String(normalized))
      }
    }
  } catch (error) {
    console.warn('[app.store] load rows per page setting failed', error)
  }

  try {
    const saved = await api.store.getSettings(PAGINATION_MODE_SETTING_KEY)
    if (saved === null) {
      await useAppStore.getState().setPaginationMode(savedPaginationMode)
      return
    }

    const normalized = normalizePaginationMode(saved)
    localStorage.setItem(PAGINATION_MODE_SETTING_KEY, normalized)
    useAppStore.setState({ paginationMode: normalized })

    if (normalized !== saved) {
      await api.store.saveSettings(PAGINATION_MODE_SETTING_KEY, normalized)
    }
  } catch (error) {
    console.warn('[app.store] load pagination mode setting failed', error)
  }
})()

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { themeMode } = useAppStore.getState()
  if (themeMode === 'system') {
    useAppStore.setState({ resolvedTheme: getSystemTheme() })
  }
})
