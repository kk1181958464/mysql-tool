const mode = localStorage.getItem('themeMode') || 'system'
const theme = mode === 'system'
  ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : mode

document.documentElement.setAttribute('data-theme', theme)
