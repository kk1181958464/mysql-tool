import { useState } from 'react'
import { useConnectionStore } from '../stores/connection.store'

// Wizards stay bound to the connection that was active when they opened, so switching
// the sidebar mid-way can never point a destructive import/restore at another server.
export function useWizardConnection() {
  const [connId] = useState(() => useConnectionStore.getState().activeConnectionId)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connectionName = useConnectionStore((s) => s.connections.find((c) => c.id === connId)?.name ?? '')
  return { connId, connectionName, switched: Boolean(connId && activeConnectionId !== connId) }
}
