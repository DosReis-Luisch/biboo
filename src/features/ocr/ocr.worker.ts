import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js'
import { mapOcrResult, type OcrLanguage, type OcrResult } from './ocr'

export interface OcrRequest { kind: 'recognize'; blob: Blob; width: number; height: number; language: OcrLanguage; paths: { workerPath: string; corePath: string; langPath: string } }
export type OcrResponse = { kind: 'progress'; status: string; progress: number } | { kind: 'result'; result: OcrResult } | { kind: 'error'; error: string } | { kind: 'stopped' }
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OcrRequest | { kind: 'cancel' }>) => void) | null
  postMessage: (message: OcrResponse) => void
}
// Tesseract exposes its worker only AFTER initialization. Track the native
// child inside this isolated supervisor so cancellation can terminate it even
// while createWorker is pending. The browser page's Worker is never patched.
const NativeWorker = globalThis.Worker
let child: Worker | undefined
globalThis.Worker = new Proxy(NativeWorker, {
  construct(target, args) {
    const worker = new target(...(args as ConstructorParameters<typeof NativeWorker>))
    child = worker
    return worker
  },
})
let started = false
scope.onmessage = ({ data }) => {
  if (data.kind === 'cancel') { child?.terminate(); scope.postMessage({ kind: 'stopped' }); return }
  if (started) return
  started = true // One page per disposable job, no queue or engine reuse.
  void (async () => {
    let worker: TesseractWorker | undefined
    try {
      worker = await createWorker(data.language, OEM.LSTM_ONLY, {
        ...data.paths, workerBlobURL: false, gzip: true, cacheMethod: 'none',
        logger: ({ status, progress }) => scope.postMessage({ kind: 'progress', status, progress }),
        // Initialization errors in this engine version may not reject createWorker.
        // Report directly; the parent terminates the complete worker job on error.
        errorHandler: (reason: unknown) => scope.postMessage({ kind: 'error', error: String(reason) }),
      })
      const { data: result } = await worker.recognize(data.blob, { rotateAuto: false, rotateRadians: 0 }, { text: true, blocks: true, hocr: false, tsv: false, pdf: false })
      const mapped = mapOcrResult(result, data.width, data.height, data.language)
      await worker.terminate()
      worker = undefined
      scope.postMessage({ kind: 'result', result: mapped })
    } catch (reason) {
      scope.postMessage({ kind: 'error', error: reason instanceof Error ? reason.message : String(reason) })
    } finally { await worker?.terminate().catch(() => undefined) }
  })()
}
