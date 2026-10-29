import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'stream'

const executed: string[] = []

vi.mock('mysql2/promise', () => ({
  default: {
    createConnection: async () => ({
      query: async (sql: string) => {
        executed.push(sql)
        if (/@@max_allowed_packet/.test(sql)) return [[{ packet: 200 * 1024 }]]
        if (/^\s*SELECT/i.test(sql)) return [[{ v: 1 }], [{ name: 'v' }]]
        return [{ affectedRows: (sql.match(/\),\s*\(/g)?.length ?? 0) + 1, insertId: 0 }]
      },
      end: async () => {},
      destroy: () => {},
    }),
  },
}))
vi.mock('./connection-manager', () => ({ getScriptConnectionOptions: () => ({}) }))
vi.mock('./local-store', () => ({}))
vi.mock('../utils/logger', () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }))

const { executeSqlFile } = await import('./sql-script-executor')

describe('executeSqlFile', () => {
  it('去掉 BOM、按 max_allowed_packet 合并 INSERT、跳过末尾注释', async () => {
    executed.length = 0
    const big = 'x'.repeat(60 * 1024)
    const lines = [
      '﻿/* header */',
      'SET NAMES utf8mb4;',
      ...Array.from({ length: 6 }, (_, i) => `INSERT INTO t (a) VALUES ('${big}${i}');`),
      'DELIMITER ;;',
      'CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.a = 1; END;;',
      'DELIMITER ;',
      '-- end of dump',
    ]
    const result = await executeSqlFile('c1', Readable.from([lines.join('\r\n')]), 'db', { optimizeInserts: true })
    const user = executed.filter((q) => !/^(USE|SET SQL_MODE|SET FOREIGN_KEY_CHECKS|SET NAMES utf8mb4$|SELECT @@max)/.test(q))
    expect(result.errors).toBe(0)
    expect(user[0]).toBe('/* header */\nSET NAMES utf8mb4')
    const inserts = user.filter((q) => q.startsWith('INSERT'))
    expect(inserts.length).toBeGreaterThan(1)
    expect(Math.max(...inserts.map((q) => q.length))).toBeLessThanOrEqual(100 * 1024)
    expect(inserts.join('').match(/VALUES|\),\s*\(/g)).toHaveLength(6)
    expect(user.find((q) => q.startsWith('CREATE TRIGGER'))).toBe('CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.a = 1; END')
    expect(user.some((q) => q.includes('end of dump'))).toBe(false)
  })
})
