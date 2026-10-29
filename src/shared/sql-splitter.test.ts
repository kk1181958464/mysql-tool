import { describe, expect, it } from 'vitest'
import { SqlStatementScanner, findStatementAt, splitSqlStatements } from './sql-splitter'

const streamed = (sql: string, chunk: (s: string) => string[]) => {
  const scanner = new SqlStatementScanner()
  const out = [...chunk(sql).flatMap((part) => scanner.feed(part)), ...scanner.finish()]
  return out.filter((s) => !s.empty && s.text).map((s) => s.text)
}

const at = (sqlWithCursor: string) => {
  const offset = sqlWithCursor.indexOf('|')
  return findStatementAt(sqlWithCursor.replace('|', ''), offset)
}

const proc = (body: string) => `CREATE PROCEDURE p()\nBEGIN\n${body}\nEND`

describe('splitSqlStatements', () => {
  it.each([
    ['单条', 'SELECT 1', ['SELECT 1']],
    ['末尾分号', 'SELECT 1;', ['SELECT 1']],
    ['同一行多条', 'SELECT 1; SELECT 2', ['SELECT 1', 'SELECT 2']],
    ['空语句', ';;SELECT 1;;', ['SELECT 1']],
    ['字符串和标识符中的分号', "SELECT 'a;b', \"c;d\", `e;f`, 'it''s;', 'x\\';y'", ["SELECT 'a;b', \"c;d\", `e;f`, 'it''s;', 'x\\';y'"]],
    ['以反斜杠结尾的字符串', "SELECT 'a\\\\'; SELECT 2", ["SELECT 'a\\\\'", 'SELECT 2']],
    ['注释中的分号', '-- c;\nSELECT 1; # x;\n/* ; */ SELECT 2', ['-- c;\nSELECT 1', '# x;\n/* ; */ SELECT 2']],
    ['字符串里的注释符号', "SELECT '#a', \"--b\" FROM t; SELECT 2", ["SELECT '#a', \"--b\" FROM t", 'SELECT 2']],
    ['-- 后无空格是运算符', 'SELECT 5--3; SELECT 2', ['SELECT 5--3', 'SELECT 2']],
    ['末尾纯注释不算语句', 'SELECT 1;\n-- done\n/* end */', ['SELECT 1']],
    ['纯注释', '-- only\n/* c */', []],
    ['可执行注释', '/*!40101 SET NAMES utf8mb4 */;\nSELECT 1', ['/*!40101 SET NAMES utf8mb4 */', 'SELECT 1']],
    ['事务', 'START TRANSACTION;\nUPDATE t SET a = 1;\nBEGIN;\nCOMMIT;', ['START TRANSACTION', 'UPDATE t SET a = 1', 'BEGIN', 'COMMIT']],
  ])('%s', (_name, sql, expected) => {
    expect(splitSqlStatements(sql)).toEqual(expected)
  })

  it('DELIMITER 自定义分隔符（含 CRLF 与缩进）', () => {
    const sql = 'DELIMITER $$\r\nCREATE PROCEDURE p()\r\nBEGIN\r\n  SELECT 1;\r\nEND$$\r\n  DELIMITER ;\r\nCALL p();'
    expect(splitSqlStatements(sql)).toEqual(['CREATE PROCEDURE p()\r\nBEGIN\r\n  SELECT 1;\r\nEND', 'CALL p()'])
  })

  it.each([
    ['WHILE', '  DECLARE i INT DEFAULT 0;\n  WHILE i < 3 DO\n    SET i = i + 1;\n  END WHILE;'],
    ['IF (条件) THEN', '  IF (1 > 0) THEN\n    SELECT 1;\n  ELSEIF (2 > 1) THEN\n    SELECT 2;\n  END IF;\n  SELECT 3;'],
    ['WHILE (条件) DO', '  DECLARE i INT DEFAULT 0;\n  WHILE (i < 3) DO\n    SET i = i + 1;\n  END WHILE;'],
    ['IF() 与 REPEAT() 函数', "  DROP TABLE IF EXISTS tmp;\n  SELECT IF(1 > 0, REPEAT('x', 3), 'y');"],
    ['REPEAT 循环', '  DECLARE i INT DEFAULT 0;\n  REPEAT\n    SET i = i + 1;\n  UNTIL i > 3 END REPEAT;'],
    ['CASE 表达式与语句', '  SELECT CASE WHEN 1 THEN 1 ELSE 0 END;\n  CASE 1 WHEN 1 THEN SELECT 1; END CASE;'],
    ['带标签的 LOOP', '  l1: LOOP\n    LEAVE l1;\n  END LOOP l1;'],
    ['嵌套 BEGIN', '  BEGIN\n    SELECT 1;\n  END;\n  SELECT 2;'],
  ])('无 DELIMITER 的存储过程：%s', (_name, body) => {
    expect(splitSqlStatements(`${proc(body)};\nSELECT 9;`)).toEqual([proc(body), 'SELECT 9'])
  })

  it('存储过程前有注释', () => {
    expect(splitSqlStatements(`-- note\n/* x */\n${proc('  SELECT 1;')};\nSELECT 2;`)).toEqual([`-- note\n/* x */\n${proc('  SELECT 1;')}`, 'SELECT 2'])
  })

  it('函数 / 触发器 / 事件 / DEFINER', () => {
    const fn = 'CREATE FUNCTION f(x INT) RETURNS INT DETERMINISTIC\nBEGIN\n  RETURN x + 1;\nEND'
    const trg = 'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW\nBEGIN\n  IF NEW.x IS NULL THEN SET NEW.x = 1; END IF;\nEND'
    const ev = 'CREATE EVENT e ON SCHEDULE EVERY 1 DAY DO\nBEGIN\n  DELETE FROM t;\nEND'
    const def = "CREATE DEFINER=`root`@`%` PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND"
    const simple = 'CREATE TRIGGER t2 BEFORE INSERT ON a FOR EACH ROW SET NEW.x = 1'
    expect(splitSqlStatements([fn, trg, ev, def, simple, 'SELECT 1'].join(';\n'))).toEqual([fn, trg, ev, def, simple, 'SELECT 1'])
  })

  it('逐行和逐字符输入与整段结果一致', () => {
    const sql = [
      '-- dump',
      '/*!40101 SET NAMES utf8mb4 */;',
      "INSERT INTO t VALUES (1, 'a;\nb'), (2, 'it''s');",
      'DELIMITER ;;',
      'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW BEGIN IF NEW.x IS NULL THEN SET NEW.x = 1; END IF; END ;;',
      'DELIMITER ;',
      proc('  IF (1 > 0) THEN SELECT 1; END IF;') + ';',
      'SELECT 9',
    ].join('\n')
    const whole = splitSqlStatements(sql)
    expect(whole).toHaveLength(5)
    expect(streamed(sql, (s) => s.split(/(?<=\n)/))).toEqual(whole)
    expect(streamed(sql, (s) => s.split(''))).toEqual(whole)
  })
})

describe('findStatementAt', () => {
  it('普通语句', () => {
    expect(at('SELECT 1;| SELECT 2;')).toBe('SELECT 1')
    expect(at('SELECT 1;\nSELECT |2;\nSELECT 3;')).toBe('SELECT 2')
    expect(at('DELETE FROM t;\nSELECT 1;\n|')).toBe('SELECT 1')
    expect(at('SELECT 1; -- c|')).toBe('SELECT 1')
    expect(at('-- nothing here\n|')).toBe('')
  })

  it('光标在存储过程内部时取整个过程', () => {
    expect(at(`${proc('  SELECT |1;\n  SELECT 2;')};\nSELECT 9;`)).toBe(proc('  SELECT 1;\n  SELECT 2;'))
    expect(at('DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT |1;\nEND$$\nDELIMITER ;\nSELECT 5;')).toBe('CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND')
    expect(at('DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;\nSELECT |5;')).toBe('SELECT 5')
  })

  it('可执行注释语句', () => {
    expect(at('/*!40101 SET NAMES utf8mb4 */;|\nSELECT 1')).toBe('/*!40101 SET NAMES utf8mb4 */')
  })
})
