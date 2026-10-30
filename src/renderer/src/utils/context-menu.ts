const MARGIN = 8

// 作为 ref 回调使用：菜单渲染后按实际尺寸移回可视区域（offsetWidth/Height 不受弹出动画的 scale 影响）
export const fitMenuToViewport = (el: HTMLElement | null) => {
  if (!el) return
  const left = parseFloat(el.style.left) || 0
  const top = parseFloat(el.style.top) || 0
  const maxLeft = window.innerWidth - el.offsetWidth - MARGIN
  const maxTop = window.innerHeight - el.offsetHeight - MARGIN
  if (left > maxLeft) el.style.left = `${Math.max(MARGIN, maxLeft)}px`
  if (top > maxTop) {
    el.style.top = `${Math.max(MARGIN, maxTop)}px`
    el.style.transformOrigin = 'bottom left'
  }
}
