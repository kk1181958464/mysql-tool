import { describe, expect, it } from 'vitest'
import { formatNavicatDDL } from './navicat-ddl'

describe('SQL dump DDL preservation', () => {
  it.each([
    "COMMENT='用户积分批次(有效期)'",
    String.raw`COMMENT='owner\'s (points); DEFAULT NULL'`,
    "COMMENT='owner''s (points)' ROW_FORMAT=DYNAMIC",
    '/*!50100 PARTITION BY HASH (`id`) PARTITIONS 4 */',
  ])('preserves quoted content and table options: %s', (tail) => {
    const ddl = [
      'CREATE TABLE `points` (',
      '  `id` int unsigned NOT NULL AUTO_INCREMENT,',
      "  `label` varchar(100) DEFAULT 'unsigned decimal(10,2)' COMMENT 'DEFAULT NULL',",
      '  PRIMARY KEY (`id`)',
      `) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 ${tail}`,
    ].join('\n')
    expect(formatNavicatDDL(ddl)).toBe(`${ddl};`)
    expect(formatNavicatDDL(`  ${ddl};\n`)).toBe(`${ddl};`)
  })
})