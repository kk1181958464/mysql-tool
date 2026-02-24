const timestamp = () => new Date().toISOString()

export const info = (msg: string, ...args: unknown[]) =>
  console.log(`[${timestamp()}] [INFO] ${msg}`, ...args)

export const warn = (msg: string, ...args: unknown[]) =>
  console.warn(`[${timestamp()}] [WARN] ${msg}`, ...args)

export const error = (msg: string, ...args: unknown[]) =>
  console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args)

export const debug = (msg: string, ...args: unknown[]) =>
  console.debug(`[${timestamp()}] [DEBUG] ${msg}`, ...args)
