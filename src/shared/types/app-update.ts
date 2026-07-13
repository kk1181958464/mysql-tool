export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'unsupported'
  | 'error'

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  version?: string
  releaseName?: string
  releaseNotes?: string
  progress?: AppUpdateProgress
  error?: string
  portable: boolean
}
