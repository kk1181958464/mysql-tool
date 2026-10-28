import { describe, expect, it, vi } from 'vitest'

vi.mock('./connection-manager', () => ({}))
vi.mock('./local-store', () => ({}))
vi.mock('../utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }))

const { splitStatementsWithProgress } = await import('./sql-script-executor')

describe('splitStatementsWithProgress', () => {
  it('does not swallow the rest of the script after IF() and DROP TABLE IF EXISTS in a routine', async () => {
    const sql = [
      'CREATE PROCEDURE p() BEGIN',
      '  DROP TABLE IF EXISTS tmp;',
      '  SELECT IF(1 > 0, REPEAT(\'x\', 3), \'y\');',
      'END;',
      'SELECT 2;',
    ].join('\n')
    const statements = await splitStatementsWithProgress(sql)
    expect(statements).toHaveLength(2)
    expect(statements[1]).toBe('SELECT 2')
  })

  it('splits on a custom delimiter without block tracking', async () => {
    const sql = 'DELIMITER ;;\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN IF NEW.x IS NULL THEN SET NEW.x = 1; END IF; END;;\nDELIMITER ;\nSELECT 1;'
    const statements = await splitStatementsWithProgress(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('END IF; END')
    expect(statements[1]).toBe('SELECT 1')
  })

  it('treats -- without a following space as an operator', async () => {
    expect(await splitStatementsWithProgress('SELECT 5--3; SELECT 4;')).toEqual(['SELECT 5--3', 'SELECT 4'])
  })
})
