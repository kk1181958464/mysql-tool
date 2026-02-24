import type * as monaco from 'monaco-editor'

const MYSQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON', 'AS', 'AND', 'OR',
  'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'GRANT', 'REVOKE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
  'UNIQUE', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT', 'NOT NULL', 'CASCADE',
  'TRUNCATE', 'EXPLAIN', 'DESCRIBE', 'SHOW', 'USE', 'ENGINE', 'CHARSET',
  'COLLATE', 'COMMENT', 'PARTITION', 'TRIGGER', 'PROCEDURE', 'FUNCTION',
  'DECLARE', 'CURSOR', 'FETCH', 'OPEN', 'CLOSE', 'HANDLER', 'SIGNAL',
]

const MYSQL_FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'ABS', 'CEIL', 'FLOOR', 'ROUND', 'MOD',
  'NOW', 'CURDATE', 'CURTIME', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY', 'HOUR',
  'MINUTE', 'SECOND', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF',
  'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'SUBSTR', 'LENGTH', 'CHAR_LENGTH',
  'UPPER', 'LOWER', 'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'REVERSE', 'LEFT', 'RIGHT',
  'LPAD', 'RPAD', 'REPEAT', 'SPACE', 'FORMAT', 'INSERT',
  'CAST', 'CONVERT', 'COALESCE', 'NULLIF', 'IFNULL', 'IF', 'GREATEST', 'LEAST',
  'GROUP_CONCAT', 'JSON_EXTRACT', 'JSON_OBJECT', 'JSON_ARRAY', 'JSON_SET',
  'UUID', 'MD5', 'SHA1', 'SHA2', 'HEX', 'UNHEX', 'BASE64',
  'INET_ATON', 'INET_NTOA', 'INET6_ATON', 'INET6_NTOA',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
]

export function registerCompletionProvider(
  monacoInstance: typeof monaco,
  getDatabases: () => string[],
  getTables: () => string[],
  getColumns: (table: string) => string[]
) {
  return monacoInstance.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model, position) {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const suggestions: monaco.languages.CompletionItem[] = []

      // After "tablename.", suggest columns
      const dotMatch = textUntilPosition.match(/(\w+)\.\s*$/)
      if (dotMatch) {
        const tableName = dotMatch[1]
        const cols = getColumns(tableName)
        for (const col of cols) {
          suggestions.push({
            label: col,
            kind: monacoInstance.languages.CompletionItemKind.Field,
            insertText: col,
            range,
          })
        }
        return { suggestions }
      }

      // After FROM/JOIN, suggest tables
      const fromMatch = textUntilPosition.match(/(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+\w*$/i)
      if (fromMatch) {
        for (const t of getTables()) {
          suggestions.push({
            label: t,
            kind: monacoInstance.languages.CompletionItemKind.Struct,
            insertText: t,
            range,
          })
        }
      }

      // Keywords
      for (const kw of MYSQL_KEYWORDS) {
        suggestions.push({
          label: kw,
          kind: monacoInstance.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
        })
      }

      // Functions
      for (const fn of MYSQL_FUNCTIONS) {
        suggestions.push({
          label: fn,
          kind: monacoInstance.languages.CompletionItemKind.Function,
          insertText: fn + '($0)',
          insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })
      }

      // Databases
      for (const db of getDatabases()) {
        suggestions.push({
          label: db,
          kind: monacoInstance.languages.CompletionItemKind.Module,
          insertText: db,
          range,
        })
      }

      // Tables (general context)
      if (!fromMatch) {
        for (const t of getTables()) {
          suggestions.push({
            label: t,
            kind: monacoInstance.languages.CompletionItemKind.Struct,
            insertText: t,
            range,
          })
        }
      }

      return { suggestions }
    },
  })
}
