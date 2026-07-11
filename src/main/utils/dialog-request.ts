export type DialogFilter = { name: string; extensions: string[] }
export type SaveDialogRequest = { defaultPath?: string; filters?: DialogFilter[] }
export type OpenDialogRequest = SaveDialogRequest & { properties: Array<'openFile' | 'showHiddenFiles'> }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件对话框选项必须是对象')
  return value as Record<string, unknown>
}
function optionalPath(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 32767 || value.includes('\0')) throw new Error('默认文件路径无效')
  return value
}
function filters(value: unknown): DialogFilter[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 20) throw new Error('文件过滤器不能超过 20 组')
  return value.map((item) => {
    const v = object(item)
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 128) throw new Error('文件过滤器名称无效')
    if (!Array.isArray(v.extensions) || !v.extensions.length || v.extensions.length > 20) throw new Error('文件扩展名列表无效')
    const extensions = v.extensions.map((ext) => {
      if (typeof ext !== 'string' || !/^[A-Za-z0-9*]+$/.test(ext) || ext.length > 16) throw new Error('文件扩展名无效')
      return ext
    })
    return { name: v.name, extensions }
  })
}

export function validateSaveDialogOptions(value: unknown): SaveDialogRequest {
  const v = object(value)
  return { defaultPath: optionalPath(v.defaultPath), filters: filters(v.filters) }
}

export function validateOpenDialogOptions(value: unknown): OpenDialogRequest {
  const v = object(value)
  let properties: Array<'openFile' | 'showHiddenFiles'> = ['openFile']
  if (v.properties !== undefined) {
    if (!Array.isArray(v.properties) || v.properties.length > 2) throw new Error('文件对话框属性无效')
    properties = v.properties.map((property) => {
      if (property !== 'openFile' && property !== 'showHiddenFiles') throw new Error('不支持的文件对话框属性')
      return property
    })
    if (!properties.includes('openFile')) properties.push('openFile')
  }
  return { defaultPath: optionalPath(v.defaultPath), filters: filters(v.filters), properties: [...new Set(properties)] }
}

export function validateFileContent(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 16 * 1024 * 1024) throw new Error('文件内容必须是文本且不能超过 16 MiB')
  return value
}
