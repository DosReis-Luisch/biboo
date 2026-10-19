import { createRectifier, outputDimensions, validateCorners } from './geometry'
import type { CorrectionDraft, CorrectionResult } from './correction'
import type { RectifyRequest, RectifyResponse } from './correction.worker'

function check(signal: AbortSignal) { if (signal.aborted) throw new DOMException('Processing stopped.', 'AbortError') }
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('This browser could not encode the corrected image.')), 'image/jpeg', 0.92))
}

async function sample(input: RectifyRequest, signal: AbortSignal, progress: (fraction: number) => void): Promise<Uint8ClampedArray<ArrayBuffer>> {
  check(signal)
  if (typeof Worker !== 'undefined') {
    let worker: Worker | undefined
    try { worker = new Worker(new URL('./correction.worker.ts', import.meta.url), { type: 'module' }) }
    catch { /* Native chunked fallback if worker construction is unsupported. */ }
    if (worker) {
      const runningWorker = worker
      return new Promise((resolve, reject) => {
        const cleanup = () => { runningWorker.terminate(); signal.removeEventListener('abort', abort) }
        const abort = () => { cleanup(); reject(new DOMException('Processing stopped.', 'AbortError')) }
        signal.addEventListener('abort', abort, { once: true })
        runningWorker.onmessage = ({ data }: MessageEvent<RectifyResponse>) => {
          if ('progress' in data) { progress(data.progress); return }
          cleanup()
          if ('error' in data) reject(new Error(data.error))
          else resolve(new Uint8ClampedArray(data.pixels))
        }
        runningWorker.onerror = () => { cleanup(); reject(new Error('The correction worker could not load or process the image. Reopen Biboo and try again.')) }
        runningWorker.onmessageerror = () => { cleanup(); reject(new Error('The browser could not transfer correction pixels. Try a smaller original image.')) }
        try { runningWorker.postMessage(input, [input.pixels]) }
        catch (reason) { cleanup(); reject(reason) }
      })
    }
  }
  const job = createRectifier({ data: new Uint8ClampedArray(input.pixels), width: input.sourceWidth, height: input.sourceHeight }, input.corners, input.width, input.height)
  for (let row = 0; row < input.height; row += 16) {
    check(signal)
    job.renderRows(row, row + 16)
    progress(Math.min(1, (row + 16) / input.height))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }
  return job.data
}

export async function processCorrection(image: HTMLImageElement, draft: CorrectionDraft, widthMm: number, heightMm: number, signal: AbortSignal, progress: (percent: number) => void): Promise<CorrectionResult> {
  validateCorners(draft.corners)
  check(signal)
  await new Promise((resolve) => window.setTimeout(resolve, 0))
  check(signal)
  const { width, height } = outputDimensions(widthMm, heightMm)
  const scale = Math.min(1, 3000 / Math.max(image.naturalWidth, image.naturalHeight))
  const source = document.createElement('canvas')
  const output = document.createElement('canvas')
  const thumbnail = document.createElement('canvas')
  try {
    source.width = Math.max(2, Math.round(image.naturalWidth * scale))
    source.height = Math.max(2, Math.round(image.naturalHeight * scale))
    const sourceContext = source.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) throw new Error('Canvas pixel processing is unavailable in this browser.')
    sourceContext.drawImage(image, 0, 0, source.width, source.height)
    const input = sourceContext.getImageData(0, 0, source.width, source.height)
    const request: RectifyRequest = { pixels: input.data.buffer, sourceWidth: source.width, sourceHeight: source.height, corners: draft.corners, width, height }
    source.width = source.height = 0
    progress(5)
    const pixels = await sample(request, signal, (fraction) => progress(5 + Math.round(fraction * 85)))
    check(signal)
    output.width = width
    output.height = height
    const context = output.getContext('2d')
    if (!context) throw new Error('The corrected image canvas is unavailable.')
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
    const encoded = await encode(output)
    check(signal)
    const thumbScale = Math.min(1, 480 / Math.max(width, height))
    thumbnail.width = Math.max(1, Math.round(width * thumbScale))
    thumbnail.height = Math.max(1, Math.round(height * thumbScale))
    const thumbContext = thumbnail.getContext('2d')
    if (!thumbContext) throw new Error('Thumbnail processing is unavailable.')
    thumbContext.drawImage(output, 0, 0, thumbnail.width, thumbnail.height)
    const thumb = await encode(thumbnail)
    check(signal)
    progress(100)
    return { image: encoded, thumbnail: thumb, width, height }
  } finally {
    source.width = source.height = output.width = output.height = thumbnail.width = thumbnail.height = 0
  }
}
