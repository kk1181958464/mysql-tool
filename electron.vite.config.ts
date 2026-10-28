import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'ssh2']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          manualChunks(id) {
            // Rollup helpers must not land in the monaco chunk, or every lazy import pulls monaco in at startup.
            if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers') || id.startsWith('\0')) return 'vendor'
            if (!id.includes('node_modules')) return undefined
            if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'vendor-monaco'
            if (id.includes('@ant-design/icons')) return 'vendor-icons'
            if (/node_modules[\/](?:react|react-dom|scheduler)[\/]/.test(id)) return 'vendor-react'
            if (id.includes('zustand')) return 'vendor-state'
            if (id.includes('lodash') || id.includes('dayjs') || id.includes('xlsx')) return 'vendor-utils'
            return 'vendor'
          },
        },
      }
    },
    plugins: [react()],
    optimizeDeps: {
      exclude: ['monaco-editor']
    }
  }
})
