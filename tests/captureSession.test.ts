import { describe, expect, it, vi, afterEach } from 'vitest'
import { CaptureSession } from '../src/features/scanner/captureSession'
import { cameraCapture, cameraError, frameDimensions, requestCamera, stopStream } from '../src/features/scanner/camera'
import type { BookPage, PageRole, PreparedPageImage } from '../src/features/pages/page'
import { bookId, timestamp } from './fixtures'

const file = () => new File(['camera bytes'], 'capture.jpg', { type: 'image/jpeg' })
const image = (): PreparedPageImage => ({ original: file(), thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }), widthPx: 4032, heightPx: 3024, mimeType: 'image/jpeg' })
function saved(id: string, order = 1): BookPage {
  return { id, bookId, readingOrder: order, createdAt: timestamp, widthPx: 4032, heightPx: 3024, mimeType: 'image/jpeg', role: 'interior' }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('serial progressive capture', () => {
  it('prepares and saves each capture before accepting the next, with distinct IDs', async () => {
    const prepare = vi.fn(async () => image())
    let order = 0
    const save = vi.fn(async (_image: PreparedPageImage, _role: PageRole, id: string) => saved(id, ++order))
    const session = new CaptureSession(prepare, save)
    const progress = vi.fn()
    const first = await session.capture(async () => file(), 'cover', progress)
    const second = await session.capture(async () => file(), 'interior', progress)
    expect(first.id).not.toBe(second.id)
    expect([first.readingOrder, second.readingOrder]).toEqual([1, 2])
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual(['capturing', 'processing', 'saving', 'capturing', 'processing', 'saving'])
    expect(save.mock.calls[0][1]).toBe('cover')
    expect(session.hasPending).toBe(false)
  })

  it('retains exactly the same prepared image and ID across save retries', async () => {
    const prepared = image()
    const prepare = vi.fn(async () => prepared)
    const save = vi.fn(async (_image: PreparedPageImage, _role: PageRole, id: string) => saved(id))
      .mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    const session = new CaptureSession(prepare, save)
    await expect(session.capture(async () => file(), 'interior', vi.fn())).rejects.toThrow('Full')
    expect(session.hasPending).toBe(true)
    await expect(session.capture(async () => file(), 'interior', vi.fn())).rejects.toThrow('Retry or discard')
    const result = await session.retry(vi.fn())
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1])
    expect(save.mock.calls[1][0]).toBe(prepared)
    expect(result.id).toBe(save.mock.calls[0][2])
    expect(session.hasPending).toBe(false)
  })

  it('can retry decoding, or discard the failed image without saving it', async () => {
    const prepare = vi.fn(async () => image()).mockRejectedValueOnce(new Error('Decode failed'))
    const save = vi.fn(async (_image: PreparedPageImage, _role: PageRole, id: string) => saved(id))
    const session = new CaptureSession(prepare, save)
    await expect(session.capture(async () => file(), 'interior', vi.fn())).rejects.toThrow('Decode failed')
    expect(save).not.toHaveBeenCalled()
    await session.retry(vi.fn())
    expect(prepare).toHaveBeenCalledTimes(2)
    save.mockRejectedValueOnce(new Error('Storage failed'))
    await expect(session.capture(async () => file(), 'interior', vi.fn())).rejects.toThrow('Storage failed')
    session.discard()
    expect(session.hasPending).toBe(false)
    await expect(session.retry(vi.fn())).rejects.toThrow('no unsaved photograph')
  })

  it('blocks double shutter, retry and discard while a photo is in flight', async () => {
    let resolve!: (file: File) => void
    const take = new Promise<File>((done) => { resolve = done })
    const session = new CaptureSession(async () => image(), async (_image, _role, id) => saved(id))
    const first = session.capture(() => take, 'interior', vi.fn())
    await expect(session.capture(async () => file(), 'interior', vi.fn())).rejects.toThrow('Wait')
    await expect(session.retry(vi.fn())).rejects.toThrow('Wait')
    expect(() => session.discard()).toThrow('Wait')
    resolve(file())
    await first
    expect(session.hasPending).toBe(false)
  })

  it('does not create a retry slot when the shutter itself fails', async () => {
    const prepare = vi.fn(async () => image())
    const session = new CaptureSession(prepare, async (_image, _role, id) => saved(id))
    await expect(session.capture(async () => { throw new Error('Camera ended') }, 'interior', vi.fn())).rejects.toThrow('Camera ended')
    expect(session.hasPending).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
  })
})

describe('native camera frame and lifecycle contracts', () => {
  it('preserves native still bytes without allocating a video canvas', async () => {
    const original = new Blob([new Uint8Array([255, 216, 3, 255, 217])], { type: 'image/jpeg' })
    const takePhoto = vi.fn(async () => original)
    vi.stubGlobal('ImageCapture', class { takePhoto = takePhoto })
    const track = { readyState: 'live' }
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream
    const result = await cameraCapture({} as HTMLVideoElement, stream)()
    expect(result.method).toBe('photo')
    expect(result.file.type).toBe(original.type)
    expect(new Uint8Array(await result.file.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()))
    expect(takePhoto).toHaveBeenCalledTimes(1)
  })

  it('falls back to native video pixels, encodes once, and releases the canvas', async () => {
    vi.stubGlobal('ImageCapture', class { async takePhoto(): Promise<Blob> { throw new Error('Unsupported still capture') } })
    const drawImage = vi.fn()
    const toBlob = vi.fn<(done: BlobCallback, type: string, quality: number) => void>((done) => done(new Blob(['frame'], { type: 'image/jpeg' })))
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob }
    vi.stubGlobal('document', { createElement: () => canvas })
    const video = { videoWidth: 3840, videoHeight: 2160, clientWidth: 320, clientHeight: 180, paused: false, readyState: 4 } as HTMLVideoElement
    const stream = { getVideoTracks: () => [{ readyState: 'live', muted: false }] } as unknown as MediaStream
    const take = cameraCapture(video, stream)
    const result = await take()
    expect(result.method).toBe('video-frame')
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 3840, 2160)
    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(toBlob.mock.calls[0].slice(1)).toEqual(['image/jpeg', 0.95])
    expect([canvas.width, canvas.height]).toEqual([0, 0])
    await take()
    expect(drawImage).toHaveBeenCalledTimes(2)
  })

  it('uses native pixel dimensions in either orientation without resizing', () => {
    expect(frameDimensions(4032, 3024)).toEqual({ width: 4032, height: 3024 })
    expect(frameDimensions(3024, 4032)).toEqual({ width: 3024, height: 4032 })
    for (const [width, height] of [[0, 720], [NaN, 1], [-1, 2], [1.5, 2], [10000, 10000]]) expect(() => frameDimensions(width, height)).toThrow()
  })

  it('distinguishes permissions and interruptions from database errors', () => {
    expect(cameraError(new DOMException('Denied', 'NotAllowedError'))).toContain('Camera access was denied')
    expect(cameraError(new DOMException('Busy', 'NotReadableError'))).toContain('Saved pages are safe')
    expect(cameraError(new DOMException('Missing', 'NotFoundError'))).toContain('No suitable camera')
  })

  it('stops every track, including a stream granted after an aborted permission request', async () => {
    const stopVideo = vi.fn(), stopOther = vi.fn()
    const stream = { getTracks: () => [{ stop: stopVideo }, { stop: stopOther }] } as unknown as MediaStream
    stopStream(stream)
    expect(stopVideo).toHaveBeenCalledTimes(1)
    expect(stopOther).toHaveBeenCalledTimes(1)
    let grant!: (stream: MediaStream) => void
    const permission = new Promise<MediaStream>((resolve) => { grant = resolve })
    const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() => permission)
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const controller = new AbortController()
    const request = requestCamera(controller.signal)
    controller.abort()
    grant(stream)
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(stopVideo).toHaveBeenCalledTimes(2)
    expect(stopOther).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } })
  })
})
