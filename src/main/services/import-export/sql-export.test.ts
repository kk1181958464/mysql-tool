import { describe, expect, it, vi } from 'vitest'
import { PassThrough, Readable } from 'stream'
import { splitSqlStatements } from '../../../shared/sql-splitter'

const queries: string[] = []

const tableDdl: Record<string, string> = {
  a: 'CREATE TABLE `a` (\n  `id` int NOT NULL,\n  `name` varchar(10) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB',
  b: 'CREATE TABLE `b` (\n  `k` varchar(10) DEFAULT NULL,\n  `v` int DEFAULT NULL\n) ENGINE=InnoDB',
}
const viewDdl: Record<string, string> = {
  v_top: 'CREATE VIEW `v_top` AS select * from `v_base`',
  v_base: 'CREATE VIEW `v_base` AS select * from `a`',
}
const aRows = [{ id: 1, name: "it's" }, { id: 2, name: null }]
const bRows = [{ k: 'x', v: 1 }, { k: 'x', v: 1 }, { k: 'x', v: 2 }]

const fakeConn = {
  connection: {
    query: (sql: string) => {
      queries.push(`STREAM ${sql}`)
      return { stream: () => Readable.from(/`b`/.test(sql) ? bRows : []) }
    },
  },
  release: () => { queries.push('RELEASE') },
  commit: async () => {},
  rollback: async () => {},
  query: async (sql: string) => {
    queries.push(sql)
    if (/^SELECT @@session\.time_zone/.test(sql)) return [[{ tz: '+08:00' }]]
    if (/^SELECT VERSION/.test(sql)) return [[{ version: '8.0.36' }]]
    if (/^SHOW FULL TABLES/.test(sql)) {
      return [[
        { Tables_in_db: 'a', Table_type: 'BASE TABLE' },
        { Tables_in_db: 'b', Table_type: 'BASE TABLE' },
        { Tables_in_db: 'v_top', Table_type: 'VIEW' },
        { Tables_in_db: 'v_base', Table_type: 'VIEW' },
      ]]
    }
    const view = sql.match(/^SHOW CREATE (?:VIEW|TABLE) `(v_\w+)`/)
    if (view) return [[{ View: view[1], 'Create View': viewDdl[view[1]] }]]
    const table = sql.match(/^SHOW CREATE TABLE `(\w+)`/)
    if (table) return [[{ Table: table[1], 'Create Table': tableDdl[table[1]] }]]
    if (/^SHOW COLUMNS FROM `a`/.test(sql)) return [[{ Field: 'id', Type: 'int' }, { Field: 'name', Type: 'varchar(10)' }]]
    if (/^SHOW COLUMNS FROM `b`/.test(sql)) return [[{ Field: 'k', Type: 'varchar(10)' }, { Field: 'v', Type: 'int' }]]
    if (/^SHOW KEYS FROM `a`/.test(sql)) return [[{ Column_name: 'id', Seq_in_index: 1 }]]
    if (/^SHOW KEYS FROM `b`/.test(sql)) return [[]]
    if (/FROM `a` ORDER BY `id` ASC LIMIT/.test(sql)) return [aRows]
    if (/FROM `a` WHERE `id` > \?/.test(sql)) return [[]]
    if (/information_schema\.TRIGGERS/.test(sql)) return [[{ name: 'trg_a', tbl: 'a' }, { name: 'trg_b', tbl: 'b' }]]
    if (/information_schema\.ROUTINES/.test(sql)) return [[{ name: 'p1' }]]
    if (/information_schema\.EVENTS/.test(sql)) return [[]]
    const trg = sql.match(/^SHOW CREATE TRIGGER `(\w+)`/)
    if (trg) return [[{ 'SQL Original Statement': `CREATE TRIGGER ${trg[1]} BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.x = 1; END` }]]
    if (/^SHOW CREATE PROCEDURE/.test(sql)) return [[{ 'Create Procedure': 'CREATE PROCEDURE `p1`() BEGIN SELECT 1; END' }]]
    return [[]]
  },
}

vi.mock('../connection-manager', () => ({
  getConnection: async () => fakeConn,
  ensureConnection: async () => fakeConn,
  getConnectionConfig: () => ({ name: 'test' }),
  isConnectionLostError: () => false,
}))
vi.mock('../sql-script-executor', () => ({ cancelMultiStatementSql: () => {}, executeSqlFile: async () => ({}) }))

const { exportToSqlWritable } = await import('./index')

const runExport = async (tables: string[], options: Record<string, unknown>) => {
  queries.length = 0
  const out = new PassThrough()
  let text = ''
  out.on('data', (chunk) => { text += chunk.toString() })
  await exportToSqlWritable('c1', 'db', tables, out, options)
  out.end()
  return text.replace(/\r\n/g, '\n')
}

describe('exportToSqlWritable', () => {
  it('整库导出：视图按依赖排序、触发器和存储过程完整、时区固定并恢复', async () => {
    const sql = await runExport([], {})
    expect(sql.indexOf('CREATE VIEW `v_base`')).toBeLessThan(sql.indexOf('CREATE VIEW `v_top`'))
    expect(sql).toContain('trg_a')
    expect(sql).toContain('trg_b')
    expect(sql).toContain('CREATE PROCEDURE `p1`')
    expect(sql).toContain("/*!40103 SET TIME_ZONE = '+00:00' */;")
    expect(queries).toContain("SET time_zone = '+00:00'")
    expect(queries.filter((q) => q.startsWith('SET time_zone = ?'))).toHaveLength(1)
    expect(queries[queries.length - 1]).toBe('RELEASE')
  })

  it('无主键表用流式读取，重复行不丢', async () => {
    const sql = await runExport(['b'], {})
    expect(queries.some((q) => q.startsWith('STREAM SELECT `k`, `v` FROM `b`'))).toBe(true)
    expect(sql.match(/INSERT INTO `b`/g)).toHaveLength(3)
  })

  it('只导部分表时只带这些表的触发器，不带存储过程', async () => {
    const sql = await runExport(['a'], {})
    expect(sql).toContain('trg_a')
    expect(sql).not.toContain('trg_b')
    expect(sql).not.toContain('PROCEDURE')
  })

  it('不含 CREATE 时不会输出 DROP，也不输出触发器', async () => {
    const sql = await runExport(['a'], { createTable: false, dropTable: true })
    expect(sql).not.toMatch(/DROP TABLE/)
    expect(sql).not.toContain('TRIGGER')
    expect(sql).toContain('INSERT INTO `a`')
  })

  it.each([
    ['multi', /INSERT INTO `a` \(`id`, `name`\) VALUES \(1, 'it\\'s'\), \(2, NULL\);/],
    ['ignore', /INSERT IGNORE INTO `a`/],
    ['replace', /REPLACE INTO `a`/],
  ])('INSERT 风格 %s', async (style, pattern) => {
    expect(await runExport(['a'], { insertStyle: style })).toMatch(pattern)
  })

  it('一致性快照包住整个导出', async () => {
    await runExport(['a', 'b'], { consistentSnapshot: true })
    expect(queries.filter((q) => q === 'START TRANSACTION WITH CONSISTENT SNAPSHOT')).toHaveLength(1)
    expect(queries.indexOf('COMMIT')).toBeGreaterThan(queries.findIndex((q) => /FROM `b`/.test(q)))
  })

  it('导出文件能被切分器正确识别', async () => {
    const statements = splitSqlStatements(await runExport([], {}))
    expect(statements.filter((s) => /^CREATE TRIGGER/.test(s))).toHaveLength(2)
    expect(statements.find((s) => /^CREATE PROCEDURE/.test(s))).toBe('CREATE PROCEDURE `p1`() BEGIN SELECT 1; END')
    expect(statements).toContain("/*!40103 SET TIME_ZONE = '+00:00' */")
  })
})
