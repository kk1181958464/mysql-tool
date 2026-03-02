import React, { useCallback, useRef, useEffect } from 'react'
import { Button, Select, Space, Tooltip } from '../../components/ui'
import {
  CaretRightOutlined,
  FileSearchOutlined,
  FormatPainterOutlined,
  SnippetsOutlined,
} from '@ant-design/icons'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { ResultPanel } from './ResultPanel'
import { SnippetManager } from './SnippetManager'
import { useTabStore, QueryTab } from '../../stores/tab.store'
import { useDatabaseStore } from '../../stores/database.store'
import { useAppStore } from '../../stores/app.store'
import { api } from '../../utils/ipc'

// QueryEditor 首次加载时再初始化 Monaco，避免主入口首包引入
if (!(self as any).__MYSQL_TOOL_MONACO_READY__) {
  ;(self as any).MonacoEnvironment = {
    getWorker() {
      return new editorWorker()
    }
  }
  loader.config({ monaco })
  ;(self as any).__MYSQL_TOOL_MONACO_READY__ = true
}

// SQL 关键字
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'ALTER', 'DROP', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'PRIMARY', 'KEY',
  'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'DEFAULT', 'NULL', 'AUTO_INCREMENT',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'AS', 'DISTINCT',
  'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'ALL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'IF', 'IFNULL', 'COALESCE', 'CONCAT',
  'VARCHAR', 'INT', 'BIGINT', 'TEXT', 'DATETIME', 'TIMESTAMP', 'DECIMAL', 'BOOLEAN',
]

// 全局存储表和字段信息
let globalTables: string[] = []
let globalColumns: Map<string, string[]> = new Map()

const COLUMN_LOAD_LIMIT = 20
const COLUMN_LOAD_CONCURRENCY = 4
const COLUMN_LOAD_TIMEOUT_MS = 5000

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('load columns timeout')), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

const runWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  if (!items.length) return
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) break
      await worker(items[index])
    }
  })
  await Promise.allSettled(workers)
}

// 获取光标前的上下文
const getContext = (textBefore: string): 'select' | 'from' | 'where' | 'join' | 'set' | 'other' => {
  const upper = textBefore.toUpperCase()
  // 找最后一个关键字
  const selectIdx = upper.lastIndexOf('SELECT')
  const fromIdx = upper.lastIndexOf('FROM')
  const whereIdx = upper.lastIndexOf('WHERE')
  const joinIdx = Math.max(upper.lastIndexOf('JOIN'), upper.lastIndexOf('ON'))
  const setIdx = upper.lastIndexOf('SET')
  const orderIdx = upper.lastIndexOf('ORDER BY')
  const groupIdx = upper.lastIndexOf('GROUP BY')

  const maxIdx = Math.max(selectIdx, fromIdx, whereIdx, joinIdx, setIdx, orderIdx, groupIdx)
  if (maxIdx === -1) return 'other'
  if (maxIdx === selectIdx) return 'select'
  if (maxIdx === fromIdx || maxIdx === joinIdx) return 'from'
  if (maxIdx === whereIdx || maxIdx === setIdx || maxIdx === orderIdx || maxIdx === groupIdx) return 'where'
  return 'other'
}

// 注册 SQL 补全提供者（只注册一次）
let completionProviderRegistered = false
const registerSqlCompletion = () => {
  if (completionProviderRegistered) return
  completionProviderRegistered = true

  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', ','],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // 获取光标前的文本
      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      const context = getContext(textBefore)
      const suggestions: monaco.languages.CompletionItem[] = []

      // 始终提供关键字
      SQL_KEYWORDS.forEach(kw => {
        suggestions.push({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
          sortText: '9',
        })
      })

      // 根据上下文提供优先补全
      if (context === 'select') {
        // SELECT 后面：字段、*、函数优先
        suggestions.push({
          label: '*',
          kind: monaco.languages.CompletionItemKind.Operator,
          insertText: '*',
          detail: '所有字段',
          range,
          sortText: '0',
        })
        globalColumns.forEach((cols, table) => {
          cols.forEach(col => {
            suggestions.push({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col,
              detail: table,
              range,
              sortText: '1',
            })
          })
        })
        ;['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT'].forEach(fn => {
          suggestions.push({
            label: fn,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn + '()',
            detail: '函数',
            range,
            sortText: '2',
          })
        })
      } else if (context === 'from') {
        // FROM/JOIN 后面：表名优先
        globalTables.forEach(table => {
          suggestions.push({
            label: table,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: table,
            detail: '表',
            range,
            sortText: '0',
          })
        })
      } else if (context === 'where') {
        // WHERE/SET/ORDER BY 后面：字段优先
        globalColumns.forEach((cols, table) => {
          cols.forEach(col => {
            suggestions.push({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col,
              detail: table,
              range,
              sortText: '0',
            })
          })
        })
      } else {
        // 其他情况：表名也提示
        globalTables.forEach(table => {
          suggestions.push({
            label: table,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: table,
            detail: '表',
            range,
            sortText: '1',
          })
        })
      }

      return { suggestions }
    }
  })
}

// 更新补全数据
const updateCompletionData = (tables: string[], columns: Map<string, string[]>) => {
  globalTables = tables
  globalColumns = columns
}

interface Props {
  tabId: string
}

const QueryEditor: React.FC<Props> = ({ tabId }) => {
  const [snippetOpen, setSnippetOpen] = React.useState(false)
  const editorRef = useRef<any>(null)
  const { tabs, setQueryResult, setQueryExecuting, setQueryError, updateQueryContent, setQueryDatabase } = useTabStore()
  const { databases, tables, isDatabaseOpen } = useDatabaseStore()
  const { resolvedTheme } = useAppStore()

  const tab = tabs.find((t) => t.id === tabId) as QueryTab | undefined

  const activeConnectionId = tab?.connectionId ?? null
  const activeDatabase = tab?.database ?? null

  const openDbOptions = activeConnectionId
    ? (databases[activeConnectionId] || [])
        .filter((d) => isDatabaseOpen(activeConnectionId, d.name))
        .map((d) => ({ value: d.name, label: d.name }))
    : []

  const databaseInOpenList = !!activeDatabase && openDbOptions.some((opt) => opt.value === activeDatabase)
  const hasSelectedDatabase = !!activeDatabase
  const hasValidDatabase = hasSelectedDatabase && databaseInOpenList
  const hasSql = !!tab?.content.trim()
  const executeBlockedReason = !hasSelectedDatabase
    ? '请先选择数据库'
    : !hasValidDatabase
      ? `当前数据库「${activeDatabase}」已关闭或不可用`
      : ''

  const dbOptions = activeDatabase && !databaseInOpenList
    ? [{ value: activeDatabase, label: `${activeDatabase}（已关闭）`, disabled: true }, ...openDbOptions]
    : openDbOptions


  // 注册 SQL 补全
  useEffect(() => {
    registerSqlCompletion()

    if (!activeConnectionId || !activeDatabase) {
      updateCompletionData([], new Map())
      return
    }

    const key = `${activeConnectionId}:${activeDatabase}`
    const tableList = tables[key] || []
    const tableNames = tableList.map(t => t.name)
    const columnsMap = new Map<string, string[]>()
    let canceled = false

    // 基础补全优先可用
    updateCompletionData(tableNames, columnsMap)

    const loadColumns = async () => {
      const targets = tableList.slice(0, COLUMN_LOAD_LIMIT)

      await runWithConcurrency(targets, COLUMN_LOAD_CONCURRENCY, async (t) => {
        if (canceled) return
        try {
          const cols = await withTimeout(
            api.meta.columns(activeConnectionId, activeDatabase, t.name),
            COLUMN_LOAD_TIMEOUT_MS
          )
          if (canceled) return
          columnsMap.set(t.name, cols.map(c => c.name))
          updateCompletionData(tableNames, new Map(columnsMap))
        } catch {
          // 单表失败不阻断整体补全
        }
      })

      if (!canceled) {
        updateCompletionData(tableNames, new Map(columnsMap))
      }
    }

    loadColumns()

    return () => {
      canceled = true
    }
  }, [activeConnectionId, activeDatabase, tables])


  const handleEditorMount = (editor: any) => {
    editorRef.current = editor
  }

  const handleExecute = useCallback(async () => {
    if (!tab || !activeConnectionId || !hasSql) return
    if (!hasValidDatabase) {
      setQueryError(tab.id, executeBlockedReason || '请先选择有效数据库后再执行')
      return
    }
    setQueryExecuting(tab.id, true)
    try {
      const result = await api.query.execute(activeConnectionId, tab.content, activeDatabase || '')
      setQueryResult(tab.id, result)
    } catch (e: any) {
      setQueryError(tab.id, e.message || '执行失败')
    }
  }, [tab, activeConnectionId, activeDatabase, hasSql, hasValidDatabase, executeBlockedReason, setQueryError, setQueryExecuting, setQueryResult])

  const handleExplain = useCallback(async () => {
    if (!tab || !activeConnectionId || !hasSql) return
    if (!hasValidDatabase) {
      setQueryError(tab.id, executeBlockedReason || '请先选择有效数据库后再执行')
      return
    }
    setQueryExecuting(tab.id, true)
    try {
      const explainRows = await api.query.explain(activeConnectionId, tab.content, activeDatabase || '')
      // 转换为 QueryResult 格式
      const result = {
        columns: [
          { name: 'id', type: 'INT', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'select_type', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'table', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'type', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'possible_keys', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'key', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'rows', type: 'BIGINT', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'filtered', type: 'DECIMAL', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
          { name: 'Extra', type: 'VARCHAR', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false, comment: '' },
        ],
        rows: explainRows.map(r => ({
          id: r.id,
          select_type: r.selectType,
          table: r.table,
          type: r.type,
          possible_keys: r.possibleKeys,
          key: r.key,
          rows: r.rows,
          filtered: r.filtered,
          Extra: r.extra,
        })),
        affectedRows: 0,
        insertId: 0,
        executionTime: 0,
        rowCount: explainRows.length,
        sql: `EXPLAIN ${tab.content}`,
        isSelect: true,
      }
      setQueryResult(tab.id, result)
    } catch (e: any) {
      setQueryError(tab.id, e.message || '执行失败')
    }
  }, [tab, activeConnectionId, activeDatabase, hasSql, hasValidDatabase, executeBlockedReason, setQueryError, setQueryExecuting, setQueryResult])

  const handleFormat = useCallback(async () => {
    if (!tab || !tab.content.trim()) return
    try {
      const formatted = await api.query.format(tab.content)
      updateQueryContent(tab.id, formatted)
    } catch {
      // ignore
    }
  }, [tab])

  if (!tab) return null

  return (
    <div className="query-editor">
      <div className="query-editor-toolbar">
        {!hasValidDatabase && (
          <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 12, marginRight: 8 }}>
            {executeBlockedReason}
          </span>
        )}
        <Space>
          <Tooltip title={executeBlockedReason || '执行 (F5)'}>
            <Button
              type="primary"
              size="small"
              onClick={handleExecute}
              disabled={tab.isExecuting || !hasSql || !hasValidDatabase}
              loading={tab.isExecuting}
            >
              <CaretRightOutlined /> 执行
            </Button>
          </Tooltip>
          <Tooltip title={executeBlockedReason || 'Explain'}>
            <Button size="small" onClick={handleExplain} disabled={tab.isExecuting || !hasSql || !hasValidDatabase}>
              <FileSearchOutlined /> Explain
            </Button>
          </Tooltip>
          <Tooltip title="格式化">
            <Button size="small" onClick={handleFormat}>
              <FormatPainterOutlined /> 格式化
            </Button>
          </Tooltip>
          <Tooltip title="代码片段">
            <Button size="small" onClick={() => setSnippetOpen(true)}>
              <SnippetsOutlined /> 片段
            </Button>
          </Tooltip>
          <Select
            style={{ width: 200 }}
            placeholder="选择数据库"
            value={activeDatabase}
            onChange={(value) => tab && setQueryDatabase(tab.id, value as string)}
            options={dbOptions}
          />
        </Space>
      </div>

      <div className="query-editor-main">
        <div className="query-editor-monaco">
          <Editor
            height="100%"
            width="100%"
            language="sql"
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
            value={tab.content}
            onChange={(value) => updateQueryContent(tab.id, value || '')}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
            }}
          />
        </div>

        <div className="query-editor-result">
          <ResultPanel tabId={tabId} />
        </div>
      </div>

      <SnippetManager
        open={snippetOpen}
        onClose={() => setSnippetOpen(false)}
        onInsert={(sql) => {
          updateQueryContent(tab.id, tab.content + '\n' + sql)
          setSnippetOpen(false)
        }}
      />
    </div>
  )
}

export default QueryEditor
