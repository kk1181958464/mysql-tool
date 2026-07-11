import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import mysql, { type Connection } from 'mysql2/promise'

const enabled = process.env.MYSQL_TEST_ENABLED === '1'
const suite = enabled ? describe : describe.skip

suite('MySQL integration', () => {
  let conn: Connection

  beforeAll(async () => {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_TEST_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_TEST_PORT || 3306),
      user: process.env.MYSQL_TEST_USER || 'root',
      password: process.env.MYSQL_TEST_PASSWORD || '',
      database: process.env.MYSQL_TEST_DATABASE || 'test',
      multipleStatements: true,
    })
  })

  afterAll(async () => {
    await conn?.end()
  })

  it('keeps session variables across statements', async () => {
    const [results] = await conn.query('SET @codex_value := 42; SELECT @codex_value AS value')
    const sets = results as unknown[]
    expect((sets[1] as Array<{ value: number }>)[0].value).toBe(42)
  })

  it('returns independent result sets', async () => {
    const [results] = await conn.query('SELECT 1 AS first_value; SELECT 2 AS second_value')
    const sets = results as unknown[]
    expect((sets[0] as Array<{ first_value: number }>)[0].first_value).toBe(1)
    expect((sets[1] as Array<{ second_value: number }>)[0].second_value).toBe(2)
  })

  it('rolls back an atomic import transaction', async () => {
    await conn.query('CREATE TEMPORARY TABLE codex_import_test (id INT PRIMARY KEY)')
    await conn.beginTransaction()
    await conn.query('INSERT INTO codex_import_test VALUES (1)')
    await conn.rollback()
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM codex_import_test')
    expect(Number((rows as Array<{ total: number }>)[0].total)).toBe(0)
  })
})
