import { runtimePaths } from './assets'
import type { OcrLanguage, OcrResult } from './ocr'
import type { OcrRequest, OcrResponse } from './ocr.worker'

let running = false
export async function recognizePage(input: { blob: Blob; width: number; height: number }, language: OcrLanguage, signal: AbortSignal, progress: (status: string, fraction: number) => void): Promise<OcrResult> {
  if (running) throw new Error('Another page is already being recognized. Wait or cancel it first.')
  signal.throwIfAborted()
  running = true
  let worker: Worker | undefined
  try {
    return await new Promise<OcrResult>((resolve, reject) => {
      // The supervisor acknowledges explicit termination of its native child,
      // including during initialization, before we dispose of the supervisor.
      const job = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
      worker = job
      let stopping = false
      let failure: unknown
      let stopTimer: number | undefined
      const cleanup = () => { signal.removeEventListener('abort', abort); window.clearTimeout(timeout); window.clearTimeout(stopTimer); job.terminate() }
      const fail = (reason: unknown) => {
        if (stopping) return
        stopping = true
        failure = reason
        window.clearTimeout(timeout)
        job.postMessage({ kind: 'cancel' })
        // A broken/unload-suspended supervisor cannot acknowledge; still release
        // our own worker and promise rather than leave the UI locked indefinitely.
        stopTimer = window.setTimeout(() => { cleanup(); reject(reason) }, 1000)
      }
      const abort = () => fail(new DOMException('OCR canceled.', 'AbortError'))
      const timeout = window.setTimeout(() => fail(new Error('OCR exceeded five minutes. Try a smaller image or close other tabs.')), 5 * 60 * 1000)
      signal.addEventListener('abort', abort, { once: true })
      job.onerror = () => fail(new Error('The local OCR worker could not run. Prepare assets online, check WebAssembly/nested-worker support, and retry.'))
      job.onmessageerror = () => fail(new Error('The OCR worker returned an unreadable result.'))
      job.onmessage = ({ data }: MessageEvent<OcrResponse>) => {
        if (data.kind === 'stopped') { cleanup(); reject(failure ?? new DOMException('OCR canceled.', 'AbortError')); return }
        if (stopping) return
        if (signal.aborted) return
        if (data.kind === 'progress') progress(data.status, data.progress)
        else if (data.kind === 'error') fail(new Error(data.error))
        else { cleanup(); resolve(data.result) }
      }
      try {
        const request: OcrRequest = { kind: 'recognize', ...input, language, paths: runtimePaths(language) }
        job.postMessage(request)
      } catch (reason) { fail(reason) }
    })
  } finally { worker?.terminate(); running = false }
}
