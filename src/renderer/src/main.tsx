import React from 'react'
import ReactDOM from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import App from './App'
import './global.css'

// 配置 Monaco worker
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

// 使用本地 monaco-editor
loader.config({ monaco })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
