import { createReadStream, stat } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

// These .gz files are opaque application payloads, not HTTP content codings.
// Vite's static server otherwise infers Content-Encoding:gzip from the suffix,
// causing Fetch to decode bytes that the manifest hashes in compressed form.
export function ocrModelMiddleware(root: string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = request.url?.split('?')[0] ?? ''
    if (!/^\/ocr-assets\/[a-f0-9]{16}\/(?:nld|por)\.traineddata\.gz$/.test(pathname)
      || !['GET', 'HEAD'].includes(request.method ?? '')) { next(); return }
    // The complete pathname is allowlisted above; no arbitrary filesystem paths.
    const file = join(root, pathname.slice(1))
    stat(file, (error, info) => {
      if (response.destroyed) return
      if (error || !info.isFile()) {
        response.statusCode = 404
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end('Packaged OCR model not found.')
        return
      }
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/octet-stream')
      response.setHeader('Content-Length', info.size)
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Cache-Control', 'no-cache')
      response.removeHeader('Content-Encoding')
      if (request.method === 'HEAD') { response.end(); return }
      const stream = createReadStream(file)
      stream.on('error', () => response.destroy())
      response.on('close', () => stream.destroy())
      stream.pipe(response)
    })
  }
}
