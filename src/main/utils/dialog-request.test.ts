import { describe, expect, it } from 'vitest'
import { validateFileContent, validateOpenDialogOptions, validateSaveDialogOptions } from './dialog-request'

describe('dialog request validation', () => {
  it('validates save dialog filters', () => {
    expect(validateSaveDialogOptions({ defaultPath: 'export.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] })).toEqual({
      defaultPath: 'export.sql', filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
    expect(() => validateSaveDialogOptions({ filters: [{ name: 'bad', extensions: ['../exe'] }] })).toThrow()
  })

  it('allows only safe open dialog properties', () => {
    expect(validateOpenDialogOptions({ properties: ['showHiddenFiles'] }).properties).toEqual(['showHiddenFiles', 'openFile'])
    expect(() => validateOpenDialogOptions({ properties: ['openDirectory'] })).toThrow()
  })

  it('rejects invalid defaults and filter counts', () => {
    expect(() => validateSaveDialogOptions({ defaultPath: 'bad\0path' })).toThrow()
    expect(() => validateSaveDialogOptions({ filters: new Array(21).fill({ name: 'Any', extensions: ['txt'] }) })).toThrow()
  })

  it('limits text file content to 16 MiB', () => {
    expect(validateFileContent('hello')).toBe('hello')
    expect(() => validateFileContent(Buffer.alloc(16 * 1024 * 1024 + 1).toString())).toThrow()
    expect(() => validateFileContent(Buffer.from('x'))).toThrow()
  })
})
