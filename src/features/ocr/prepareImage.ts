export async function prepareOcrImage(blob: Blob, expectedWidth: number, expectedHeight: number, signal: AbortSignal) {
  if (!blob.type.startsWith('image/') || blob.type.startsWith('image/svg') || blob.size === 0 || blob.size > 50 * 1024 * 1024) throw new Error('OCR requires a supported raster image no larger than 50 MiB. Try JPEG or PNG.')
  if (expectedWidth * expectedHeight > 20_000_000) throw new Error('This OCR proof of concept accepts up to 20 megapixels. Use a saved correction or import a smaller photograph.')
  const image = new Image()
  const url = URL.createObjectURL(blob)
  const canvas = document.createElement('canvas')
  const abort = () => { image.removeAttribute('src') }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    image.src = url
    try { await image.decode() } catch { signal.throwIfAborted(); throw new Error('This browser cannot decode the page image. Try JPEG or PNG, or use a saved correction.') }
    signal.throwIfAborted()
    const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight
    if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > 20_000_000) throw new Error('The decoded image exceeds the 20 megapixel OCR limit. Use a saved correction or smaller photograph.')
    const scale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight))
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not allocate an OCR working image. Close other tabs and retry.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const working = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The OCR working image could not be encoded.')), 'image/png'))
    signal.throwIfAborted()
    return { blob: working, width: canvas.width, height: canvas.height, sourceWidth, sourceHeight }
  } finally {
    signal.removeEventListener('abort', abort)
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
    canvas.width = canvas.height = 0
  }
}
