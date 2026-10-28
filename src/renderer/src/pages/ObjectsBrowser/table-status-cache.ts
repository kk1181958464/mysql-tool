import type { TableInfo } from '../../../../shared/types/metadata'

export const tableStatusCache: Record<string, TableInfo[]> = {}

export function clearTableStatusCache(connectionId: string): void {
  for (const key of Object.keys(tableStatusCache)) {
    if (key.startsWith(`${connectionId}:`)) delete tableStatusCache[key]
  }
}
