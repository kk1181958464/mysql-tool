/**
 * 转义 MySQL 标识符（数据库名/表名/列名），防止反引号注入。
 * 将标识符内部的反引号 ` 替换为 ``，再用反引号包裹。
 */
export function quoteId(id: string): string {
  return '`' + String(id).replace(/`/g, '``') + '`'
}
