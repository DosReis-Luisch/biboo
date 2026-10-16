import type { PreparedPageImage } from './page'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_PIXELS = 60_000_000
const THUMBNAIL_EDGE = 480
const extensionTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
}

export class ImageImportError extends Error {}

export async function preparePageImage(file: File): Promise<PreparedPageImage> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = file.type.toLowerCase() || extensionTypes[extension] || ''
  if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml' || extension === 'svg' || extension === 'svgz') {
    throw new ImageImportError('Choose a photograph or raster image, such as JPEG or PNG. SVG and non-image files are not supported.')
  }
  if (!file.size) throw new ImageImportError('This file is empty.')
  if (file.size > MAX_FILE_BYTES) throw new ImageImportError('This image exceeds the 50 MiB per-file limit. Choose a smaller image.')

  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  try {
    image.src = url
    try { await image.decode() }
    catch {
      throw new ImageImportError('This browser could not decode the image. It may be damaged or use an unsupported format (such as HEIC/HEIF). Export it as JPEG or PNG and try again.')
    }
    const widthPx = image.naturalWidth
    const heightPx = image.naturalHeight
    if (!widthPx || !heightPx || widthPx * heightPx > MAX_PIXELS) {
      throw new ImageImportError('This image has invalid dimensions or exceeds the 60 megapixel processing limit. Choose a smaller image.')
    }
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(widthPx, heightPx))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(widthPx * scale))
    canvas.height = Math.max(1, Math.round(heightPx * scale))
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new ImageImportError('This browser could not create a thumbnail. Try another browser or a smaller image.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const thumbnail = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ImageImportError('Thumbnail creation failed. Try a smaller JPEG or PNG image.')), 'image/jpeg', 0.8)
      })
      return {
        original: file.slice(0, file.size, mimeType), thumbnail,
        originalFilename: file.name || undefined, widthPx, heightPx, mimeType,
      }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  } finally {
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
  }
}

export function isQuotaError(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false
  return reason.name === 'QuotaExceededError' || ('inner' in reason && reason.inner instanceof Error && reason.inner.name === 'QuotaExceededError')
}

export function pageError(reason: unknown): string {
  if (isQuotaError(reason)) return 'Device storage is full. Free some space before importing more pages. Previously saved pages are safe.'
  if (reason instanceof ImageImportError) return reason.message
  if (reason instanceof Error && reason.name === 'Error') return reason.message
  return 'The page could not be saved or updated. Check that site storage is allowed and try again.'
}
