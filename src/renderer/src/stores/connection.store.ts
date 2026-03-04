import { create } from 'zustand'
import type { ConnectionConfig, ConnectionStatus, ConnectionSavePayload } from '../../../shared/types/connection'
import { api } from '../utils/ipc'
import { useDatabaseStore } from './database.store'
import { useTabStore } from './tab.store'
import { requestTabCloseGuard } from './tab-close-guard'

const logConnectionDebug = (event: string, payload?: unknown) => {
  console.info(`[ConnectionStore] ${event}`, payload)
}

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

    logConnectionDebug('connect.request', {
      id,
      name: config.name,
      host: config.host,
      port: config.port,
      sshEnabled: config.sshEnabled,
      databaseName: config.databaseName || null,
    })

    const startedAt = performance.now()
    const status = await api.connection.connect(config)
    logConnectionDebug('connect.result', {
      id,
      connected: status.connected,
      serverVersion: status.serverVersion,
      currentDatabase: status.currentDatabase,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    })

    set((s) => ({
      connectionStatuses: { ...s.connectionStatuses, [id]: status },
      activeConnectionId: id,
    }))
    // 连接成功后自动加载数据库列表
    if (status.connected) {
      void useDatabaseStore.getState().loadDatabases(id)
    }
  },

  disconnect: async (id) => {
    const tabStore = useTabStore.getState()
    const relatedTabs = tabStore.getTabsByConnection(id)

    logConnectionDebug('disconnect.request', {
      id,
      relatedTabs: relatedTabs.length,
      activeConnectionId: get().activeConnectionId,
    })

    if (relatedTabs.length > 0) {
      const canClose = await requestTabCloseGuard(relatedTabs)
      logConnectionDebug('disconnect.guard', { id, canClose, relatedTabs: relatedTabs.length })
      if (!canClose) return
      tabStore.removeTabsByIds(relatedTabs.map((tab) => tab.id))
    }

    await api.connection.disconnect(id)
    logConnectionDebug('disconnect.api.done', { id })
    set((s) => {
      const statuses = { ...s.connectionStatuses }
      delete statuses[id]
      const nextActiveConnectionId = s.activeConnectionId === id ? null : s.activeConnectionId
      logConnectionDebug('disconnect.state.updated', {
        id,
        nextActiveConnectionId,
        remainingStatusCount: Object.keys(statuses).length,
      })
      return {
        connectionStatuses: statuses,
        activeConnectionId: nextActiveConnectionId,
      }
    })
  },

  testConnection: async (config) => {
    return api.connection.test(config)
  },

  setActiveConnection: (id) => set({ activeConnectionId: id }),
}))
