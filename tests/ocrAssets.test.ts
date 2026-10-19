import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureOcrAsset, OcrAssetError, verifyOcrAsset, type OcrAsset } from '../src/features/ocr/assetPreparation'

const decoded = new TextEncoder().encode('Tiny synthetic language data, not a real OCR model.')
const compressed = new Uint8Array(gzipSync(decoded))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const asset: OcrAsset = { role: 'nld language model', path: '/ocr-assets/0123456789abcdef/nld.traineddata.gz', bytes: compressed.byteLength, sha256: sha256(compressed) }
const signal = () => new AbortController().signal
const goodResponse = () => new Response(compressed, { headers: { 'Content-Type': 'application/octet-stream' } })
function fakeCache(initial?: Response) {
  let saved = initial
  return {
    match: vi.fn(async () => saved?.clone()),
    delete: vi.fn(async () => { saved = undefined; return true }),
    put: vi.fn(async (_key: RequestInfo | URL, response: Response) => { saved = response.clone() }),
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('OCR asset entity bytes and diagnostics', () => {
  it('verifies the compressed payload, not HTTP-decoded model bytes', async () => {
    const verified = await verifyOcrAsset(asset, goodResponse(), 'download')
    expect(new Uint8Array(await verified.arrayBuffer())).toEqual(compressed)
    expect(verified.headers.get('Content-Encoding')).toBeNull()
    // Simulate the entity Fetch exposes when a server marks this .gz payload
    // Content-Encoding:gzip: browsers decode it before arrayBuffer() returns.
    const response = new Response(decoded, { headers: { 'Content-Encoding': 'gzip' } })
    const error = await verifyOcrAsset(asset, response, 'download').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(OcrAssetError)
    if (!(error instanceof Error)) throw new Error('Expected an asset diagnostic')
    for (const detail of [asset.role, asset.path, 'verification failed', 'HTTP 200', `expected ${asset.bytes} bytes`, `received ${decoded.byteLength} bytes`, asset.sha256.slice(0, 16), sha256(decoded).slice(0, 16), 'without Content-Encoding']) expect(error.message).toContain(detail)
  })

  it('detects same-length corruption and reports both checksum prefixes', async () => {
    const corrupt = compressed.slice()
    corrupt[10] ^= 1
    await expect(verifyOcrAsset(asset, new Response(corrupt), 'download')).rejects.toThrow(`SHA-256 ${sha256(corrupt).slice(0, 16)}`)
  })

  it('reports HTTP failures as fetch failures without treating HTML as a bad model', async () => {
    const response = new Response('<html>not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } })
    await expect(verifyOcrAsset(asset, response, 'download')).rejects.toThrow(/fetch failed: download: HTTP 404; type text\/html/)
  })

  it('preserves underlying response-read errors', async () => {
    const response = goodResponse()
    vi.spyOn(response, 'arrayBuffer').mockRejectedValueOnce(new TypeError('Body could not be decoded'))
    await expect(verifyOcrAsset(asset, response, 'download')).rejects.toThrow(/reading response body; HTTP 200.*TypeError: Body could not be decoded/)
  })
})

describe('OCR optional cache reuse and repair', () => {
  it('reuses valid downloaded resources without another request or write', async () => {
    const cache = fakeCache(goodResponse())
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await ensureOcrAsset(cache, asset, signal())
    expect(fetch).not.toHaveBeenCalled()
    expect(cache.delete).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('repairs legacy encoding metadata when the cached bytes are already valid', async () => {
    const cache = fakeCache(new Response(compressed, { headers: { 'Content-Encoding': 'gzip', 'Content-Type': 'application/gzip' } }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await ensureOcrAsset(cache, asset, signal())
    expect(fetch).not.toHaveBeenCalled()
    expect(cache.put).toHaveBeenCalledOnce()
    const saved = await cache.match()
    expect(saved!.headers.get('Content-Encoding')).toBeNull()
    expect(saved!.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(new Uint8Array(await saved!.arrayBuffer())).toEqual(compressed)
  })

  it.each(['nld', 'por'])('refreshes only the invalid %s model entry at the canonical URL', async (language) => {
    const model = { ...asset, role: `${language} language model`, path: asset.path.replace('nld', language) }
    const cache = fakeCache(new Response(decoded))
    const fetch = vi.fn().mockResolvedValue(goodResponse())
    vi.stubGlobal('fetch', fetch)
    await ensureOcrAsset(cache, model, signal())
    expect(cache.delete).toHaveBeenCalledExactlyOnceWith(model.path)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${model.path}?prepare=1`, expect.objectContaining({ mode: 'same-origin', cache: 'no-store', redirect: 'error' }))
    expect(cache.put).toHaveBeenCalledExactlyOnceWith(model.path, expect.any(Response))
    const saved = await cache.match()
    expect(new Uint8Array(await saved!.arrayBuffer())).toEqual(compressed)
  })

  it('does not cache a freshly downloaded response with decoded/wrong bytes', async () => {
    const cache = fakeCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(decoded, { headers: { 'Content-Encoding': 'gzip' } })))
    await expect(ensureOcrAsset(cache, asset, signal())).rejects.toThrow(/verification failed/)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('preserves network exceptions and the asset identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await expect(ensureOcrAsset(fakeCache(), asset, signal())).rejects.toThrow(/nld language model.*fetch failed:.*TypeError: Load failed/)
  })

  it.each(['match', 'delete', 'put'] as const)('identifies a %s cache failure separately from integrity', async (operation) => {
    const cache = fakeCache(operation === 'delete' ? new Response(decoded) : undefined)
    cache[operation].mockRejectedValueOnce(new DOMException('Simulated cache storage failure', 'QuotaExceededError'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(goodResponse()))
    await expect(ensureOcrAsset(cache, asset, signal())).rejects.toThrow(/cache failed:.*QuotaExceededError: Simulated cache storage failure/)
  })

  it('does not evict a cached asset or redownload when the digest API itself fails', async () => {
    const cache = fakeCache(goodResponse())
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new DOMException('Digest unavailable', 'NotSupportedError'))
    await expect(ensureOcrAsset(cache, asset, signal())).rejects.toThrow(/SHA-256 operation;.*NotSupportedError: Digest unavailable/)
    expect(cache.delete).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels before accessing storage or fetching', async () => {
    const controller = new AbortController()
    controller.abort()
    const cache = fakeCache()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(ensureOcrAsset(cache, asset, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache.match).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
