import { ipcMain } from 'electron'
import { formatErrorMessage } from '../../shared/error-message'

let installed = false

// Electron only forwards `message` across IPC, so fold the MySQL code into it before the error leaves main.
export function installIpcErrorFormatting(): void {
  if (installed) return
  installed = true
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (event, ...args: any[]) => {
      try {
        return await listener(event, ...args)
      } catch (error) {
        throw new Error(formatErrorMessage(error))
      }
    })
}
