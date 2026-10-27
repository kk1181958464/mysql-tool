const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*/i
const ERROR_NAME_PREFIX = /^(?:[A-Z][A-Za-z]*Error|Error):\s*/
const CODE_SUFFIX = /\s\[(ER_[A-Z0-9_]+|[A-Z][A-Z0-9_]{2,})(?: (\d+))?\]$/

export function stripIpcErrorPrefix(message: string): string {
  let result = message.replace(IPC_PREFIX, '')
  while (ERROR_NAME_PREFIX.test(result)) result = result.replace(ERROR_NAME_PREFIX, '')
  return result.trim()
}

export function formatErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error === null || error === undefined || error === '') return fallback
  if (typeof error === 'string') return stripIpcErrorPrefix(error) || fallback
  if (typeof error !== 'object') return String(error)

  const err = error as { message?: unknown; sqlMessage?: unknown; code?: unknown; errno?: unknown }
  const base = typeof err.sqlMessage === 'string' && err.sqlMessage
    ? err.sqlMessage
    : typeof err.message === 'string' && err.message
      ? stripIpcErrorPrefix(err.message)
      : ''
  if (!base) return fallback
  if (CODE_SUFFIX.test(base)) return base

  const code = typeof err.code === 'string' && /^ER_/.test(err.code) ? err.code : ''
  const errno = typeof err.errno === 'number' && err.errno > 0 && code ? err.errno : null
  return code ? `${base} [${code}${errno ? ` ${errno}` : ''}]` : base
}

export function parseErrorCode(message: string): { message: string; code?: string; errno?: number } {
  const match = message.match(CODE_SUFFIX)
  if (!match) return { message }
  return { message: message.slice(0, match.index).trim(), code: match[1], errno: match[2] ? Number(match[2]) : undefined }
}
