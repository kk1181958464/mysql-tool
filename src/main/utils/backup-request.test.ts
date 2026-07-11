import { describe, expect, it } from 'vitest'
import { validateBackupCreateRequest, validateBackupRestoreOptions, validateBackupScheduleRequest } from './backup-request'

describe('backup request validation', () => {
  it('accepts a multi-database backup request', () => {
    expect(validateBackupCreateRequest({ connectionId: 'c1', databases: ['app', 'logs'], backupType: 'full', compress: true })).toMatchObject({
      connectionId: 'c1', databases: ['app', 'logs'], backupType: 'full', compress: true,
    })
  })

  it.each([
    { connectionId: 'c1', databases: [], backupType: 'full', compress: true },
    { connectionId: 'c1', databases: ['app', 'app'], backupType: 'full', compress: true },
    { connectionId: 'c1', databaseName: 'app', backupType: 'raw', compress: true },
    { connectionId: 'c1', databaseName: 'app', backupType: 'full', compress: 'yes' },
  ])('rejects invalid create requests: %j', (request) => {
    expect(() => validateBackupCreateRequest(request)).toThrow()
  })

  it('validates restore targets', () => {
    expect(validateBackupRestoreOptions({ targetDb: 'app', dropExisting: true })).toEqual({ targetDb: 'app', newDbName: undefined, createNew: undefined, dropExisting: true })
    expect(validateBackupRestoreOptions({ createNew: true, newDbName: 'restored' })).toMatchObject({ createNew: true, newDbName: 'restored' })
    expect(() => validateBackupRestoreOptions({ createNew: true })).toThrow()
    expect(() => validateBackupRestoreOptions({})).toThrow()
  })

  it('validates schedule actions and values', () => {
    expect(validateBackupScheduleRequest({ action: 'list', connectionId: 'c1', injected: true })).toEqual({ action: 'list', connectionId: 'c1' })
    expect(validateBackupScheduleRequest({ action: 'create', connectionId: 'c1', databaseName: 'app', cronExpression: '0 2 * * *', backupType: 'full', compress: true, retentionDays: 30, isActive: true })).toMatchObject({ action: 'create', retentionDays: 30 })
    expect(() => validateBackupScheduleRequest({ action: 'delete', connectionId: 'c1' })).toThrow()
    expect(() => validateBackupScheduleRequest({ action: 'unknown', connectionId: 'c1' })).toThrow()
    expect(() => validateBackupScheduleRequest({ action: 'create', connectionId: 'c1', databaseName: 'app', cronExpression: '0 2 * * *', backupType: 'full', compress: true, retentionDays: 366, isActive: true })).toThrow()
  })
})
