import { useRef, useCallback, useEffect } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useDatabaseStore } from '../stores/database.store'
import { useAppStore } from '../stores/app.store'

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute: (sql: string) => void
  connectionId: string | null
  database: string | null
}

export default function SqlEditor({ value, onChange, onExecute, connectionId, database }: SqlEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Ctrl+Enter: execute current statement
    editor.addAction({
      id: 'execute-current',
      label: 'Execute Current Statement',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: (ed) => {
        const selection = ed.getSelection()
        const model = ed.getModel()
        if (!model) return
        const sql = selection && !selection.isEmpty()
          ? model.getValueInRange(selection)
          : model.getValue()
        onExecute(sql.trim())
      },
    })

    // F5: execute all
    editor.addAction({
      id: 'execute-all',
      label: 'Execute All',
      keybindings: [monaco.KeyCode.F5],
      run: (ed) => {
        const sql = ed.getModel()?.getValue() ?? ''
        onExecute(sql.trim())
      },
    })

    // Ctrl+Shift+F: format
    editor.addAction({
      id: 'format-sql',
      label: 'Format SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: async (ed) => {
        const sql = ed.getModel()?.getValue() ?? ''
        try {
          const formatted = await window.api.query.format(sql)
          ed.getModel()?.setValue(formatted)
        } catch {}
      },
    })

    // Register completion provider
    const disposable = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const suggestions: any[] = []
        const state = useDatabaseStore.getState()

        // Add database names
        if (connectionId && state.databases[connectionId]) {
          for (const db of state.databases[connectionId]) {
            suggestions.push({
              label: db.name,
              kind: monaco.languages.CompletionItemKind.Module,
              insertText: db.name,
              range,
            })
          }
        }

        // Add table names for current database
        if (connectionId && database) {
          const tbls = state.tables[`${connectionId}:${database}`] ?? []
          for (const t of tbls) {
            suggestions.push({
              label: t.name,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: t.name,
              detail: t.type,
              range,
            })
          }

          // Add column names for all loaded tables in this db
          for (const t of tbls) {
            const cols = state.columns[`${connectionId}:${database}:${t.name}`] ?? []
            for (const c of cols) {
              suggestions.push({
                label: c.name,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: c.name,
                detail: `${t.name}.${c.columnType}`,
                range,
              })
            }
          }
        }

        return { suggestions }
      },
    })

    return () => disposable.dispose()
  }, [connectionId, database, onExecute])

  return (
    <Editor
      height="100%"
      defaultLanguage="sql"
      theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: 'on',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        suggestOnTriggerCharacters: true,
      }}
    />
  )
}
