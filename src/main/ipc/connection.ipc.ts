import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as connectionManager from '../services/connection-manager'
import * as localStore from '../services/local-store'
import * as queryExecutor from '../services/query-executor'
import { cancelMultiStatementSql } from '../services/sql-script-executor'

export function registerConnectionIPC() {
  ipcMain.handle(IPC.CONNECTION_TEST, async (_e, config) => {
    return connectionManager.testConnection(config)
  })

  ipcMain.handle(IPC.CONNECTION_CONNECT, async (_e, config) => {
    const status = await connectionManager.connect(config)
    if (status.connected) localStore.connections.save(config)
    return status
  })

  ipcMain.handle(IPC.CONNECTION_DISCONNECT, async (_e, id: string) => {
    cancelMultiStatementSql(id)
    await queryExecutor.cancel(id)
    await connectionManager.disconnect(id)
  })

  ipcMain.handle(IPC.CONNECTION_LIST, async () => {
    return localStore.connections.getAll()
  })

  ipcMain.handle(IPC.CONNECTION_SAVE, async (_e, config) => {
    localStore.connections.save(config)
  })

  ipcMain.handle(IPC.CONNECTION_DELETE, async (_e, id: string) => {
    try {
      cancelMultiStatementSql(id)
      await queryExecutor.cancel(id)
      await connectionManager.disconnect(id)
    } catch {}
    localStore.connections.delete(id)
  })
}
