import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as connectionManager from '../services/connection-manager'
import * as localStore from '../services/local-store'
import * as queryExecutor from '../services/query-executor'
import { cancelMultiStatementSql } from '../services/sql-script-executor'
import { validateConnectionConfig, validateConnectionId } from '../utils/connection-config'

export function registerConnectionIPC() {
  ipcMain.handle(IPC.CONNECTION_TEST, async (_e, config) => {
    return connectionManager.testConnection(validateConnectionConfig(config))
  })

  ipcMain.handle(IPC.CONNECTION_CONNECT, async (_e, config) => {
    const validConfig = validateConnectionConfig(config)
    const status = await connectionManager.connect(validConfig)
    if (status.connected) localStore.connections.save(validConfig)
    return status
  })

  ipcMain.handle(IPC.CONNECTION_DISCONNECT, async (_e, id: string) => {
    const validId = validateConnectionId(id)
    cancelMultiStatementSql(validId)
    await queryExecutor.cancel(validId)
    await connectionManager.disconnect(validId)
  })

  ipcMain.handle(IPC.CONNECTION_LIST, async () => {
    return localStore.connections.getAll()
  })

  ipcMain.handle(IPC.CONNECTION_SAVE, async (_e, config) => {
    localStore.connections.save(validateConnectionConfig(config))
  })

  ipcMain.handle(IPC.CONNECTION_DELETE, async (_e, id: string) => {
    const validId = validateConnectionId(id)
    try {
      cancelMultiStatementSql(validId)
      await queryExecutor.cancel(validId)
      await connectionManager.disconnect(validId)
    } catch {}
    localStore.connections.delete(validId)
  })
}
