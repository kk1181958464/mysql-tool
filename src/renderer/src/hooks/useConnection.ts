import { useEffect } from 'react'
import { useConnectionStore } from '../stores/connection.store'

export function useConnection() {
  const store = useConnectionStore()

  useEffect(() => {
    store.loadConnections()
  }, [])

  const activeConnection = store.connections.find((c) => c.id === store.activeConnectionId) ?? null
  const activeStatus = store.activeConnectionId
    ? store.connectionStatuses[store.activeConnectionId] ?? null
    : null

  return {
    connections: store.connections,
    activeConnection,
    activeConnectionId: store.activeConnectionId,
    activeStatus,
    connectionStatuses: store.connectionStatuses,
    connect: store.connect,
    disconnect: store.disconnect,
    testConnection: store.testConnection,
    saveConnection: store.saveConnection,
    deleteConnection: store.deleteConnection,
    setActiveConnection: store.setActiveConnection,
    loadConnections: store.loadConnections,
  }
}
