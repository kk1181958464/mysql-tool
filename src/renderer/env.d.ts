/// <reference types="vite/client" />

import type { ElectronAPI } from '../preload/types'

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
