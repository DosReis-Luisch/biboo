export interface OcrAsset { role: string; path: string; bytes: number; sha256: string }
type Stage = 'fetch' | 'verification' | 'cache'
type AssetCache = Pick<Cache, 'match' | 'delete' | 'put'>

const exception = (reason: unknown) => {
  if (reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string') {
    const name = 'name' in reason && typeof reason.name === 'string' ? reason.name : 'Error'
    return `${name}: ${reason.message.slice(0, 200)}`
  }
  return typeof reason === 'string' ? reason.slice(0, 200) : 'Unknown browser exception'
}
const responseInfo = (response: Response) => `HTTP ${response.status}; type ${response.headers.get('Content-Type') || '(missing)'}; encoding ${response.headers.get('Content-Encoding') || 'none'}`

export class OcrAssetError extends Error {
  override name = 'OcrAssetError'
  readonly invalidResponse: boolean
  constructor(asset: Pick<OcrAsset, 'role' | 'path'>, stage: Stage, detail: string, invalidResponse = false) {
    super(`OCR ${asset.role} (${asset.path}) — ${stage} failed: ${detail}`)
    this.invalidResponse = invalidResponse
  }
}

export async function verifyOcrAsset(asset: OcrAsset, response: Response, source: 'download' | 'cached copy'): Promise<Response> {
  if (!response.ok) throw new OcrAssetError(asset, 'fetch', `${source}: ${responseInfo(response)}.`, true)
  let bytes: ArrayBuffer
  try { bytes = await response.arrayBuffer() }
  catch (reason) { throw new OcrAssetError(asset, 'verification', `${source}: reading response body; ${responseInfo(response)}; ${exception(reason)}.`, true) }
  let digest: string
  try { digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('') }
  catch (reason) { throw new OcrAssetError(asset, 'verification', `${source}: SHA-256 operation; ${responseInfo(response)}; ${exception(reason)}.`) }
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
    throw new OcrAssetError(asset, 'verification', `${source}: ${responseInfo(response)}; expected ${asset.bytes} bytes, SHA-256 ${asset.sha256.slice(0, 16)}; received ${bytes.byteLength} bytes, SHA-256 ${digest.slice(0, 16)}.${asset.path.endsWith('.gz') && response.headers.has('Content-Encoding') ? ' The gzip model must be served as an opaque file without Content-Encoding; HTTP decoding changes its bytes.' : ''}`, true)
  }
  // Cache exactly the verified entity bytes. A Fetch Response can retain HTTP
  // encoding/length headers even though its body was decoded by the browser.
  const headers = new Headers(response.headers)
  headers.delete('Content-Encoding')
  headers.set('Content-Length', String(bytes.byteLength))
  if (asset.path.endsWith('.gz')) {
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('X-Content-Type-Options', 'nosniff')
  }
  return new Response(bytes, { status: 200, headers })
}

export async function ensureOcrAsset(cache: AssetCache, asset: OcrAsset, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  let saved: Response | undefined
  try { saved = await cache.match(asset.path) }
  catch (reason) { throw new OcrAssetError(asset, 'cache', `reading cached copy; ${exception(reason)}.`) }
  let verified: Response | undefined
  let mustWrite = false
  if (saved) {
    try {
      // This also repairs legacy encoding metadata on an otherwise valid body.
      verified = await verifyOcrAsset(asset, saved, 'cached copy')
      mustWrite = saved.headers.has('Content-Encoding') || (asset.path.endsWith('.gz') && saved.headers.get('Content-Type') !== 'application/octet-stream')
    } catch (reason) {
      signal.throwIfAborted()
      if (!(reason instanceof OcrAssetError) || !reason.invalidResponse) throw reason
      // Only this optional asset is removed. Never clear IndexedDB or the library.
      try { await cache.delete(asset.path) }
      catch (reason) { throw new OcrAssetError(asset, 'cache', `removing invalid cached copy; ${exception(reason)}.`) }
    }
  }
  if (!verified) {
    let response: Response
    try {
      // Bypass the SW CacheFirst route and HTTP cache; canonical URL is unchanged.
      response = await fetch(`${asset.path}?prepare=1`, { signal, cache: 'no-store', mode: 'same-origin', redirect: 'error' })
    } catch (reason) {
      signal.throwIfAborted()
      throw new OcrAssetError(asset, 'fetch', `connect online and check this local resource; ${exception(reason)}.`)
    }
    verified = await verifyOcrAsset(asset, response, 'download')
    mustWrite = true
  }
  signal.throwIfAborted()
  if (mustWrite) {
    try { await cache.put(asset.path, verified) }
    catch (reason) { throw new OcrAssetError(asset, 'cache', `writing verified asset (HTTP ${verified.status}); ${exception(reason)}.`) }
  }
}
