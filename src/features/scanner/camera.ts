import { insecureContextMessage } from '../../app/secureContext'

interface StillCapture { takePhoto(): Promise<Blob> }
interface StillCaptureConstructor { new(track: MediaStreamTrack): StillCapture }
export interface CameraCapture { file: File; method: 'photo' | 'video-frame' }

// Actual source pixels, never CSS preview dimensions. A future frame analyzer
// can use these dimensions with normalized corners without changing capture.
export function frameDimensions(width: number, height: number) {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0) || width * height > 60_000_000) {
    throw new Error('No usable camera frame is available, or it exceeds 60 megapixels. Resume the camera or take a single photo instead.')
  }
  return { width, height }
}

export function cameraError(reason: unknown): string {
  const name = reason && typeof reason === 'object' && 'name' in reason ? reason.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was denied or blocked. Allow camera access in the browser’s site settings, then try again. You can also import photos or take a single photo.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No suitable camera is available. Import photos or use Take single photo.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera was interrupted or is in use by another app. Saved pages are safe. Resume the camera or use Take single photo.'
  return reason instanceof Error ? reason.message : 'The camera could not start. Try again or use photo import.'
}

export function stopStream(stream: MediaStream) { stream.getTracks().forEach((track) => track.stop()) }

export async function requestCamera(signal: AbortSignal): Promise<MediaStream> {
  if (!globalThis.isSecureContext) throw new Error(insecureContextMessage)
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Continuous capture is unavailable in this browser. Use Take single photo or import photos in the gallery.')
  signal.throwIfAborted()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
  })
  // getUserMedia cannot be canceled while the native permission prompt is open.
  if (signal.aborted) { stopStream(stream); signal.throwIfAborted() }
  return stream
}

function photoFile(blob: Blob): File {
  if (!blob.size) throw new Error('The camera returned an empty photograph. Try again.')
  const type = blob.type || 'image/jpeg'
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/heic' ? 'heic' : type === 'image/heif' ? 'heif' : 'jpg'
  return new File([blob], `scan-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type })
}

async function nativePhoto(track: MediaStreamTrack, Constructor: StillCaptureConstructor): Promise<Blob> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Constructor(track).takePhoto(),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Still capture timed out.')), 15_000) }),
    ])
  } finally { clearTimeout(timeout) }
}

export function cameraCapture(video: HTMLVideoElement, stream: MediaStream) {
  // If a device advertises ImageCapture but rejects it, use video frames for the
  // rest of this camera session rather than repeating a broken native operation.
  let useNativePhoto = true
  return async (): Promise<CameraCapture> => {
    const track = stream.getVideoTracks()[0]
    if (!track || track.readyState !== 'live') throw new Error('The camera is no longer active. Resume it before capturing.')
    const Constructor = (globalThis as unknown as { ImageCapture?: StillCaptureConstructor }).ImageCapture
    if (Constructor && useNativePhoto) {
      try { return { file: photoFile(await nativePhoto(track, Constructor)), method: 'photo' } }
      catch { useNativePhoto = false }
    }
    if (track.readyState !== 'live' || track.muted || video.paused || video.readyState < 2) throw new Error('The video feed is interrupted. Resume the camera before trying again.')
    const { width, height } = frameDimensions(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    try {
      const context = canvas.getContext('2d')
      if (!context) throw new Error('The browser could not allocate a camera frame. Try a single photo instead.')
      context.drawImage(video, 0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The camera frame could not be encoded. Try a single photo.')), 'image/jpeg', 0.95))
      return { file: photoFile(blob), method: 'video-frame' }
    } finally { canvas.width = canvas.height = 0 }
  }
}
