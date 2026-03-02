import { create } from 'zustand'
import type { QueryResult } from '../../../shared/types/query'
import type { TableDesign } from '../../../shared/types/table-design'

// 标签页类型
export type TabType = 'query' | 'data' | 'design' | 'objects' | 'performance' | 'import-export' | 'backup'

// 基础标签
interface BaseTab {
  id: string
  type: TabType
  title: string
  connectionId: string | null
  database: string | null
  closable?: boolean  // 是否可关闭，默认true
}

// 查询标签
export interface QueryTab extends BaseTab {
  type: 'query'
  content: string
  result: QueryResult | null
  isExecuting: boolean
  error: string | null
}

// 数据浏览标签
export interface DataTab extends BaseTab {
  type: 'data'
  table: string
  isDirty: boolean
}

// 表设计标签
export interface DesignTab extends BaseTab {
  type: 'design'
  table: string | null  // null = 新建表
  design: TableDesign | null
  isDirty: boolean
  isSaved: boolean  // 是否已保存过（用于显示绿点）
}

// 对象列表标签（数据库概览）
export interface ObjectsTab extends BaseTab {
  type: 'objects'
  closable: false
}

// 工具标签（性能/导入导出/备份）
export interface ToolTab extends BaseTab {
  type: 'performance' | 'import-export' | 'backup'
}

export type Tab = QueryTab | DataTab | DesignTab | ObjectsTab | ToolTab

interface TabState {
  tabs: Tab[]
  activeTabId: string | null

  // 通用操作
  setActiveTab: (id: string) => void
  removeTab: (id: string) => void
  removeTabsByIds: (ids: string[]) => void
  getTabsByConnection: (connectionId: string) => Tab[]
  updateTabTitle: (id: string, title: string) => void

  // 查询标签操作
  addQueryTab: (connectionId?: string, database?: string, initialSql?: string) => void
  updateQueryContent: (id: string, content: string) => void
  setQueryResult: (id: string, result: QueryResult | null) => void
  setQueryExecuting: (id: string, executing: boolean) => void
  setQueryError: (id: string, error: string | null) => void
  setQueryDatabase: (id: string, database: string | null) => void
  clearQueryDatabaseByConnectionAndDb: (connectionId: string, dbName: string) => void

  // 数据浏览标签操作
  addDataTab: (connectionId: string, database: string, table: string) => void
  setDataDirty: (id: string, dirty: boolean) => void

  // 表设计标签操作
  addDesignTab: (connectionId: string, database: string, table?: string | null) => void
  updateDesign: (id: string, design: TableDesign) => void
  setDesignDirty: (id: string, dirty: boolean) => void
  renameTable: (connectionId: string, database: string, oldName: string, newName: string) => void

  // 对象列表标签
  addObjectsTab: (connectionId: string, database: string) => void

  // 工具标签（性能/导入导出/备份）
  addToolTab: (type: 'performance' | 'import-export' | 'backup') => void
}

let tabCounter = 1

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  setActiveTab: (id) => set({ activeTabId: id }),

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

  removeTabsByIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((s) => {
      const tabs = s.tabs.filter((t) => !idSet.has(t.id))
      let activeTabId = s.activeTabId
      if (activeTabId && idSet.has(activeTabId)) {
        const activeIndex = s.tabs.findIndex((t) => t.id === activeTabId)
        activeTabId = tabs[Math.min(activeIndex, tabs.length - 1)]?.id ?? null
      }
      return { tabs, activeTabId }
    })
  },

  getTabsByConnection: (connectionId) => {
    return get().tabs.filter((t) => t.connectionId === connectionId)
  },

  updateTabTitle: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }))
  },

  // 查询标签
  addQueryTab: (connectionId, database, initialSql) => {
    const id = `query-${Date.now()}-${tabCounter++}`
    const existing = get().tabs.filter(t => t.type === 'query').map(t => {
      const m = t.title.match(/^查询 (\d+)$/)
      return m ? parseInt(m[1]) : 0
    })
    let n = 1
    while (existing.includes(n)) n++
    const tab: QueryTab = {
      id,
      type: 'query',
      title: `查询 ${n}`,
      content: initialSql || '',
      connectionId: connectionId ?? null,
      database: database ?? null,
      result: null,
      isExecuting: false,
      error: null,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  updateQueryContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'query' ? { ...t, content } : t)),
    }))
  },

  setQueryResult: (id, result) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'query' ? { ...t, result, error: null, isExecuting: false } : t)),
    }))
  },

  setQueryExecuting: (id, isExecuting) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'query' ? { ...t, isExecuting } : t)),
    }))
  },

  setQueryError: (id, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'query' ? { ...t, error, isExecuting: false } : t)),
    }))
  },

  setQueryDatabase: (id, database) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'query' ? { ...t, database } : t)),
    }))
  },

  clearQueryDatabaseByConnectionAndDb: (connectionId, dbName) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.type === 'query' && t.connectionId === connectionId && t.database === dbName) {
          return { ...t, database: null }
        }
        return t
      }),
    }))
  },

  // 数据浏览标签
  addDataTab: (connectionId, database, table) => {
    // 检查是否已存在相同的数据标签
    const existing = get().tabs.find(
      (t) => t.type === 'data' && t.connectionId === connectionId && t.database === database && (t as DataTab).table === table
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }

    const id = `data-${Date.now()}-${tabCounter++}`
    const tab: DataTab = {
      id,
      type: 'data',
      title: `${table}`,
      connectionId,
      database,
      table,
      isDirty: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  setDataDirty: (id, isDirty) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'data' ? { ...t, isDirty } : t)),
    }))
  },

  // 表设计标签
  addDesignTab: (connectionId, database, table = null) => {
    // 检查是否已存在相同的设计标签
    const existing = get().tabs.find(
      (t) => t.type === 'design' && t.connectionId === connectionId && t.database === database && (t as DesignTab).table === table
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }

    const id = `design-${Date.now()}-${tabCounter++}`
    const tab: DesignTab = {
      id,
      type: 'design',
      title: table ? `设计: ${table}` : '新建表',
      connectionId,
      database,
      table,
      design: null,
      isDirty: false,
      isSaved: false,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  updateDesign: (id, design) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'design' ? { ...t, design, isDirty: true } : t)),
    }))
  },

  setDesignDirty: (id, isDirty) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id && t.type === 'design' ? { ...t, isDirty, isSaved: !isDirty ? (t as DesignTab).isSaved || true : (t as DesignTab).isSaved } : t)),
    }))
  },

  renameTable: (connectionId, database, oldName, newName) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.connectionId === connectionId && t.database === database) {
          if (t.type === 'design' && (t as DesignTab).table === oldName) {
            return { ...t, table: newName, title: `设计: ${newName}` }
          }
          if (t.type === 'data' && (t as DataTab).table === oldName) {
            return { ...t, table: newName, title: newName }
          }
        }
        return t
      }),
    }))
  },

  // 对象列表标签
  addObjectsTab: (connectionId, database) => {
    // 检查是否已存在相同的对象标签
    const existing = get().tabs.find(
      (t) => t.type === 'objects' && t.connectionId === connectionId && t.database === database
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }

    const id = `objects-${connectionId}-${database}`
    const tab: ObjectsTab = {
      id,
      type: 'objects',
      title: `对象`,
      connectionId,
      database,
      closable: false,
    }
    // 插入到最前面
    set((s) => ({ tabs: [tab, ...s.tabs.filter(t => t.type !== 'objects' || t.connectionId !== connectionId)], activeTabId: id }))
  },

  // 工具标签
  addToolTab: (type) => {
    const existing = get().tabs.find((t) => t.type === type)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const titles = { performance: '性能', 'import-export': '导入导出', backup: '备份' }
    const id = `${type}-${Date.now()}`
    const tab: ToolTab = { id, type, title: titles[type], connectionId: null, database: null }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },
}))
