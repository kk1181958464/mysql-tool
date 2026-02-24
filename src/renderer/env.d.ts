/// <reference types="vite/client" />

import type { ElectronAPI } from '../preload/types'

interface Window {
  api: ElectronAPI
}
