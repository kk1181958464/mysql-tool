import { ipcMain } from 'electron'
import { IPC } from '../../shared/types/ipc-channels'
import * as connectionManager from '../services/connection-manager'
import * as localStore from '../services/local-store'
import * as queryExecutor from '../services/query-executor'
import { cancelMultiStatementSql } from '../services/sql-script-executor'
import { validateConnectionConfig, validateConnectionId } from '../utils/connection-config'
import { maskConnectionSecrets, resolveConnectionSecrets } from '../utils/connection-secrets'
import { hasFileAccess } from '../utils/file-access'
import type { ConnectionConfig } from '../../shared/types/connection'

const KEY_PATH_FIELDS = ['sshPrivateKey', 'sslCa', 'sslCert', 'sslKey'] as const

function prepareConfig(sender: Electron.WebContents, raw: unknown, sourceId?: unknown): ConnectionConfig {
  const config = validateConnectionConfig(raw)
  const stored = localStore.connections.getById(typeof sourceId === 'string' && sourceId ? sourceId : config.id)
  const resolved = resolveConnectionSecrets(config, stored)
  for (const field of KEY_PATH_FIELDS) {
    const value = resolved[field]
    if (!value || value.includes('-----BEGIN') || value === stored?.[field]) continue
    if (!hasFileAccess(sender, 'read', value)) throw new Error('证书或私钥文件需要通过“选择文件”重新选择')
  }
  return resolved
}

export function registerConnectionIPC() {
  ipcMain.handle(IPC.CONNECTION_TEST, async (e, config) => {
    return connectionManager.testConnection(prepareConfig(e.sender, config))
  })

  ipcMain.handle(IPC.CONNECTION_CONNECT, async (e, config) => {
    const validConfig = prepareConfig(e.sender, config)
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
    return localStore.connections.getAll().map(maskConnectionSecrets)
  })

  ipcMain.handle(IPC.CONNECTION_SAVE, async (e, config, sourceId?: string) => {
    localStore.connections.save(prepareConfig(e.sender, config, sourceId))
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
