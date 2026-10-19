import manifest from 'virtual:biboo-ocr-assets'
import type { OcrLanguage } from './ocr'
import { ensureOcrAsset, OcrAssetError, verifyOcrAsset } from './assetPreparation'

const cacheName = 'biboo-ocr-v1'
export function runtimePaths(language: OcrLanguage) {
  const absolute = (path: string) => {
    const url = new URL(path, window.location.origin)
    if (url.origin !== window.location.origin || !/^\/ocr-assets\/[a-f0-9]{16}\//.test(url.pathname)) throw new Error('Invalid local OCR asset path.')
    return url.href
  }
  return { workerPath: absolute(manifest.worker.path), corePath: absolute(manifest.core.path), langPath: new URL('.', absolute(manifest.languages[language].path)).href }
}
const required = (language: OcrLanguage) => [
  { ...manifest.worker, role: 'worker script' }, { ...manifest.core, role: 'LSTM core script' },
  { ...manifest.wasm, role: 'LSTM WebAssembly' }, { ...manifest.languages[language], role: `${language} language model` },
]
export async function hasOcrAssets(language: OcrLanguage) {
  if (!('caches' in window)) return false
  const cache = await caches.open(cacheName)
  // Cache membership alone does not establish offline readiness after an older
  // worker/browser cached a decoded or otherwise incompatible model response.
  for (const asset of required(language)) {
    const saved = await cache.match(asset.path)
    if (!saved) return false
    try { await verifyOcrAsset(asset, saved, 'cached copy') } catch { return false }
  }
  return true
}

export async function prepareOcrAssets(language: OcrLanguage, signal: AbortSignal, progress: (message: string, percent: number) => void) {
  if (!('caches' in window) || !crypto.subtle) throw new Error('OCR preparation requires browser Cache Storage and a secure context (HTTPS or localhost).')
  const files = required(language)
  let cache: Cache
  try { cache = await caches.open(cacheName) }
  catch (reason) { throw new OcrAssetError(files[0], 'cache', `opening ${cacheName}; ${reason instanceof Error ? `${reason.name}: ${reason.message.slice(0, 200)}` : 'Unknown browser exception'}.`) }
  for (const [index, asset] of files.entries()) {
    signal.throwIfAborted()
    progress(`Preparing OCR resource ${index + 1} of ${files.length}: ${asset.role}`, index / files.length * 100)
    await ensureOcrAsset(cache, asset, signal)
  }
  signal.throwIfAborted()
  progress('Required OCR assets are cached for the selected language.', 100)
}
