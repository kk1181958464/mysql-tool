import { create } from 'zustand'
import type { QueryResult } from '../../../shared/types/query'

interface EditorTab {
  id: string
  title: string
  content: string
  connectionId: string | null
  database: string | null
  result: QueryResult | null
  isExecuting: boolean
  error: string | null
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string | null
  addTab: (connectionId?: string, database?: string) => void
  removeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateContent: (id: string, content: string) => void
  setResult: (id: string, result: QueryResult | null) => void
  setExecuting: (id: string, executing: boolean) => void
  setError: (id: string, error: string | null) => void
}

let tabCounter = 1

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (connectionId, database) => {
    const id = `tab-${Date.now()}-${tabCounter++}`
    const tab: EditorTab = {
      id,
      title: `查询 ${tabCounter - 1}`,
      content: '',
      connectionId: connectionId ?? null,
      database: database ?? null,
      result: null,
      isExecuting: false,
      error: null,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  removeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (activeTabId === id) {
        const idx = s.tabs.findIndex((t) => t.id === id)
        activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
      }
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content } : t)),
    }))
  },

  setResult: (id, result) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, result, error: null } : t)),
    }))
  },

  setExecuting: (id, isExecuting) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExecuting } : t)),
    }))
  },

  setError: (id, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, error, isExecuting: false } : t)),
    }))
  },
}))
