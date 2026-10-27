const ICON_SIZE = 96
const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_ICON_LENGTH = 200 * 1024
export const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export async function fileToIconDataUrl(file: File): Promise<string> {
  if (!ICON_ACCEPT.split(',').includes(file.type)) throw new Error('仅支持 PNG / JPG / WebP / GIF 图片')
  if (file.size > MAX_SOURCE_BYTES) throw new Error('图片不能超过 10 MB')

  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法处理图片')
    const side = Math.min(bitmap.width, bitmap.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE)

    let dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > MAX_ICON_LENGTH) dataUrl = canvas.toDataURL('image/webp', 0.85)
    if (dataUrl.length > MAX_ICON_LENGTH) throw new Error('图片处理后仍然过大')
    return dataUrl
  } finally {
    bitmap.close()
  }
}
