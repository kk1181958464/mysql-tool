import { describe, expect, it } from 'vitest'
import { validateExportOptions, validateFilePathString, validateImportOptions, validateTableList } from './import-export-request'

describe('import and export request validation', () => {
  it('keeps only supported import options', () => {
    expect(validateImportOptions({
      batchSize: 1000,
      ignoreErrors: true,
      truncate: true,
      atomic: false,
      columnMapping: { source: 'target', skipped: '' },
    })).toEqual({
      batchSize: 1000,
      ignoreErrors: true,
      truncate: true,
      atomic: false,
      columnMapping: { source: 'target', skipped: '' },
    })
  })

  it.each([{ batchSize: 99 }, { batchSize: 10001 }, { batchSize: 100.5 }, { ignoreErrors: 'true' }])('rejects invalid import options: %j', (options) => {
    expect(() => validateImportOptions(options)).toThrow()
  })

  it('rejects invalid column mappings', () => {
    expect(() => validateImportOptions({ columnMapping: { source: 123 } })).toThrow()
    expect(() => validateImportOptions({ columnMapping: { first: 'target', second: 'target' } })).toThrow('多个源列')
  })

  it('rejects incompatible transaction options', () => {
    expect(() => validateImportOptions({ atomic: true, ignoreErrors: true })).toThrow('不能同时')
  })

  it('validates table lists', () => {
    expect(validateTableList(['users', '订单'])).toEqual(['users', '订单'])
    expect(() => validateTableList(['users', 'users'])).toThrow()
    expect(() => validateTableList([''])).toThrow()
  })

  it('validates SQL and Excel export options', () => {
    expect(validateExportOptions({ tables: ['users'], insertStyle: 'multi', sheetName: 'Data', extra: true })).toMatchObject({
      tables: ['users'], insertStyle: 'multi', sheetName: 'Data',
    })
    expect(() => validateExportOptions({ insertStyle: 'raw' })).toThrow()
    expect(() => validateExportOptions({ sheetName: 'bad/name' })).toThrow()
    expect(() => validateExportOptions({ includeData: 1 })).toThrow()
    expect(validateExportOptions({ delimiter: ';', quote: "'", headers: false, pretty: false, arrayMode: false })).toMatchObject({
      delimiter: ';', quote: "'", headers: false, pretty: false, arrayMode: false,
    })
    expect(() => validateExportOptions({ delimiter: '||' })).toThrow()
  })

  it('rejects empty paths and null bytes', () => {
    expect(validateFilePathString('D:\\exports\\data.sql')).toContain('data.sql')
    expect(() => validateFilePathString('')).toThrow()
    expect(() => validateFilePathString('bad\0path')).toThrow()
  })
})
