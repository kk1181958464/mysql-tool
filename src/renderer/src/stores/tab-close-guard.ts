import type { Tab } from './tab.store'

export const isTabDirty = (tab: Tab): boolean => {
  if (tab.type === 'design') return tab.isDirty
  if (tab.type === 'query') return tab.content.length > 0
  if (tab.type === 'data') return tab.isDirty
  return false
}

let guardHandler: ((tabs: Tab[]) => Promise<boolean>) | null = null

export const registerTabCloseGuard = (handler: (tabs: Tab[]) => Promise<boolean>) => {
  guardHandler = handler
  return () => {
    if (guardHandler === handler) {
      guardHandler = null
    }
  }
}

export const requestTabCloseGuard = async (tabs: Tab[]): Promise<boolean> => {
  if (!guardHandler) return true
  return guardHandler(tabs)
}
