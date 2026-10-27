import type * as Monaco from 'monaco-editor'

const DARK_THEME = 'kmysql-dark'
const LIGHT_THEME = 'kmysql-light'

export function defineMonacoThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'a5a7ff' },
      { token: 'string', foreground: '7ee0a1' },
      { token: 'number', foreground: 'f0a33a' },
      { token: 'comment', foreground: '6d6d84', fontStyle: 'italic' },
      { token: 'predefined', foreground: '4cc9dc' },
      { token: 'operator', foreground: 'c0c0d0' },
    ],
    colors: {
      'editor.background': '#111116',
      'editor.lineHighlightBackground': '#1b1b23',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#8b8dff40',
      'editor.inactiveSelectionBackground': '#8b8dff22',
      'editorCursor.foreground': '#8b8dff',
      'editorLineNumber.foreground': '#4b4b60',
      'editorLineNumber.activeForeground': '#a3a3b8',
      'editorWidget.background': '#23232e',
      'editorWidget.border': '#2c2c3a',
      'editorSuggestWidget.background': '#23232e',
      'editorSuggestWidget.border': '#2c2c3a',
      'editorSuggestWidget.selectedBackground': '#8b8dff2e',
      'editorSuggestWidget.highlightForeground': '#a5a7ff',
      'scrollbarSlider.background': '#6d6d8440',
      'scrollbarSlider.hoverBackground': '#6d6d8470',
    },
  })

  monaco.editor.defineTheme(LIGHT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '5b5bd6' },
      { token: 'string', foreground: '18804a' },
      { token: 'number', foreground: 'c26a00' },
      { token: 'comment', foreground: '8c8ca6', fontStyle: 'italic' },
      { token: 'predefined', foreground: '0e8ba0' },
      { token: 'operator', foreground: '4b4b66' },
    ],
    colors: {
      'editor.background': '#fbfbfd',
      'editor.lineHighlightBackground': '#f0f0f6',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#5b5bd633',
      'editor.inactiveSelectionBackground': '#5b5bd61f',
      'editorCursor.foreground': '#5b5bd6',
      'editorLineNumber.foreground': '#b4b4c8',
      'editorLineNumber.activeForeground': '#4b4b66',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e1e1ea',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e1e1ea',
      'editorSuggestWidget.selectedBackground': '#5b5bd61f',
      'editorSuggestWidget.highlightForeground': '#5b5bd6',
      'scrollbarSlider.background': '#8c8ca633',
      'scrollbarSlider.hoverBackground': '#8c8ca666',
    },
  })
}

export function getMonacoTheme(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? DARK_THEME : LIGHT_THEME
}
