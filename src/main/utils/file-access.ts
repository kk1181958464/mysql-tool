import * as path from 'path'
import type { WebContents } from 'electron'

export type FileAccess = 'read' | 'write'

const fileAccessGrants = new WeakMap<WebContents, Record<FileAccess, Set<string>>>()

function normalizeGrantedPath(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function getFileAccessGrants(sender: WebContents): Record<FileAccess, Set<string>> {
  let grants = fileAccessGrants.get(sender)
  if (!grants) {
    grants = { read: new Set(), write: new Set() }
    fileAccessGrants.set(sender, grants)
  }
  return grants
}

export function grantFileAccess(sender: WebContents, access: FileAccess, filePath: string): void {
  getFileAccessGrants(sender)[access].add(normalizeGrantedPath(filePath))
}

export function hasFileAccess(sender: WebContents, access: FileAccess, filePath: unknown): boolean {
  if (typeof filePath !== 'string' || !filePath.trim()) return false
  return getFileAccessGrants(sender)[access].has(normalizeGrantedPath(filePath))
}

export function requireFileAccess(sender: WebContents, access: FileAccess, filePath: unknown): void {
  if (!hasFileAccess(sender, access, filePath)) throw new Error('文件路径未经系统对话框授权，请通过“选择文件”重新选择')
}

export function consumeFileAccess(sender: WebContents, access: FileAccess, filePath: unknown): void {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('文件路径无效')
  }
  if (!getFileAccessGrants(sender)[access].delete(normalizeGrantedPath(filePath))) {
    throw new Error('文件路径未经系统对话框授权')
  }
}
