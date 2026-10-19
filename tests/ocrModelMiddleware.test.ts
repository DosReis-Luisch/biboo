import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ocrModelMiddleware } from '../scripts/ocr-model-middleware'

let root: string
const prefix = '/ocr-assets/0123456789abcdef/'
const compressed = gzipSync('tiny synthetic model bytes')
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'biboo-ocr-model-'))
  await mkdir(join(root, prefix.slice(1)), { recursive: true })
  for (const language of ['nld', 'por']) await writeFile(join(root, prefix.slice(1), `${language}.traineddata.gz`), compressed)
})
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

async function serve(url: string, method = 'GET') {
  const headers = new Map<string, string>()
  const chunks: Buffer[] = []
  let nextCalled = false
  const response = Object.assign(new PassThrough(), {
    statusCode: 200,
    setHeader: (name: string, value: string | number) => { headers.set(name.toLowerCase(), String(value)) },
    removeHeader: (name: string) => { headers.delete(name.toLowerCase()) },
  })
  response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  const finished = once(response, 'finish')
  ocrModelMiddleware(root)({ url, method } as IncomingMessage, response as unknown as ServerResponse, () => { nextCalled = true; response.end() })
  await finished
  return { status: response.statusCode, headers, body: Buffer.concat(chunks), nextCalled }
}

describe('opaque gzip language-model serving before Vite static handling', () => {
  it.each(['nld', 'por'])('serves %s gzip bytes without declaring HTTP gzip encoding', async (language) => {
    const result = await serve(`${prefix}${language}.traineddata.gz?prepare=1`)
    expect(result.status).toBe(200)
    expect(result.nextCalled).toBe(false)
    expect(result.headers.get('content-type')).toBe('application/octet-stream')
    expect(result.headers.get('content-encoding')).toBeUndefined()
    expect(result.headers.get('content-length')).toBe(String(compressed.byteLength))
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.body).toEqual(compressed)
    expect([...result.body.subarray(0, 2)]).toEqual([31, 139])
  })

  it('serves the same representation for the canonical worker/cache URL', async () => {
    const result = await serve(`${prefix}nld.traineddata.gz`)
    expect(result.body).toEqual(compressed)
    expect(result.headers.get('content-encoding')).toBeUndefined()
  })

  it('supports HEAD with the compressed file size and no response body', async () => {
    const result = await serve(`${prefix}por.traineddata.gz`, 'HEAD')
    expect(result.status).toBe(200)
    expect(result.headers.get('content-length')).toBe(String(compressed.byteLength))
    expect(result.body.length).toBe(0)
  })

  it('returns a real 404 for missing packaged models rather than SPA HTML', async () => {
    const result = await serve('/ocr-assets/0000000000000000/nld.traineddata.gz?prepare=1')
    expect(result.status).toBe(404)
    expect(result.nextCalled).toBe(false)
    expect(result.body.toString()).toBe('Packaged OCR model not found.')
  })

  it.each(['/index.html', `${prefix}worker.min.js`, '/ocr-assets/../private.pem', `${prefix}eng.traineddata.gz`])('leaves unrelated/unapproved paths to Vite: %s', async (url) => {
    expect((await serve(url)).nextCalled).toBe(true)
  })
})
