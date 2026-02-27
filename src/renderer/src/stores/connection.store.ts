import { create } from 'zustand'
import type { ConnectionConfig, ConnectionStatus, ConnectionSavePayload } from '../../../shared/types/connection'
import { api } from '../utils/ipc'
import { useDatabaseStore } from './database.store'
import { useTabStore } from './tab.store'
import { requestTabCloseGuard } from './tab-close-guard'

interface ConnectionState {
  connections: ConnectionConfig[]
  activeConnectionId: string | null
  connectionStatuses: Record<string, ConnectionStatus>
  loadConnections: () => Promise<void>
  saveConnection: (config: ConnectionSavePayload) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  connect: (idOrConfig: string | ConnectionConfig) => Promise<void>
  disconnect: (id: string) => Promise<void>
  testConnection: (config: ConnectionSavePayload) => Promise<ConnectionStatus>
  setActiveConnection: (id: string | null) => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  connectionStatuses: {},

  loadConnections: async () => {
    const connections = await api.connection.list()
    set({ connections })
  },

  saveConnection: async (config) => {
    await api.connection.save(config)
    await get().loadConnections()
  },

  deleteConnection: async (id) => {
    await api.connection.delete(id)
    const { activeConnectionId } = get()
    if (activeConnectionId === id) set({ activeConnectionId: null })
    await get().loadConnections()
  },

  connect: async (idOrConfig) => {
    let config: ConnectionConfig
    let id: string
    if (typeof idOrConfig === 'string') {
      id = idOrConfig
      const { connections } = get()
      const found = connections.find((c) => c.id === id)
      if (!found) throw new Error('连接配置不存在')
      config = found
    } else {
      config = idOrConfig
      id = config.id
    }
    const status = await api.connection.connect(config)
    set((s) => ({
      connectionStatuses: { ...s.connectionStatuses, [id]: status },
      activeConnectionId: id,
    }))
    // 连接成功后自动加载数据库列表
    if (status.connected) {
      useDatabaseStore.getState().loadDatabases(id)
    }
  },

  disconnect: async (id) => {
    const tabStore = useTabStore.getState()
    const relatedTabs = tabStore.getTabsByConnection(id)

    if (relatedTabs.length > 0) {
      const canClose = await requestTabCloseGuard(relatedTabs)
      if (!canClose) return
      tabStore.removeTabsByIds(relatedTabs.map((tab) => tab.id))
    }

    await api.connection.disconnect(id)
    set((s) => {
      const statuses = { ...s.connectionStatuses }
      delete statuses[id]
      return {
        connectionStatuses: statuses,
        activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
      }
    })
  },

  testConnection: async (config) => {
    return api.connection.test(config)
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),
}))
