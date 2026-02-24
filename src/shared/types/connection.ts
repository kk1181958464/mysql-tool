export interface ConnectionConfig {
  id: string
  name: string
  groupName: string
  color: string
  host: string
  port: number
  user: string
  password: string
  databaseName: string
  charset: string
  timezone: string
  poolMin: number
  poolMax: number
  connectTimeout: number
  idleTimeout: number
  sslEnabled: boolean
  sslCa: string
  sslCert: string
  sslKey: string
  sslMode: 'DISABLED' | 'REQUIRED' | 'VERIFY_CA' | 'VERIFY_IDENTITY'
  sshEnabled: boolean
  sshHost: string
  sshPort: number
  sshUser: string
  sshPassword: string
  sshPrivateKey: string
  sshPassphrase: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ConnectionStatus {
  id: string
  connected: boolean
  serverVersion?: string
  currentDatabase?: string
  error?: string
}

export type ConnectionSavePayload = Omit<ConnectionConfig, 'createdAt' | 'updatedAt'>
