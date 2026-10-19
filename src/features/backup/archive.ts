import type { FileEntry } from '@zip.js/zip.js'
import { SecureContextError } from '../../app/secureContext'
import { ArchiveError, assertArchive, checkAbort, limits, manifestAssets, type ArchiveBundle, type BackupProgress } from './format'
import { parseManifest } from './validation'

async function zipImplementation(signal: AbortSignal) {
  // Native entry supplies a JS codec fallback without a separate WASM download.
  const zip = await import('@zip.js/zip.js/index-native.js')
  checkAbort(signal)
  zip.configure({ useWebWorkers: false, useCompressionStream: true, chunkSize: 64 * 1024 })
  return zip
}

export async function writeArchive(bundle: ArchiveBundle, signal: AbortSignal, progress: BackupProgress): Promise<Blob> {
  const manifest = parseManifest(bundle.manifest)
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  assertArchive(manifestBlob.size <= limits.manifestBytes, 'The backup manifest exceeds 2 MiB.')
  const references = manifestAssets(manifest)
  const total = manifestBlob.size + references.reduce((sum, asset) => sum + asset.byteLength, 0)
  assertArchive(total <= limits.totalBytes, 'This book exceeds the 256 MiB backup limit. No archive was created.')
  const zip = await zipImplementation(signal)
  const writer = new zip.ZipWriter<Blob>(new zip.BlobWriter('application/zip'), { level: 0, bufferedWrite: false, useWebWorkers: false })
  let closed = false
  let completed = 0
  try {
    const files = [{ path: 'manifest.json', blob: manifestBlob }, ...references.map((reference) => {
      const blob = bundle.assets.get(reference.path)
      assertArchive(blob instanceof Blob && blob.size === reference.byteLength && blob.type === reference.mimeType, 'An image changed or is missing from the export snapshot.')
      return { path: reference.path, blob }
    })]
    for (let index = 0; index < files.length; index++) {
      checkAbort(signal)
      const file = files[index]
      await writer.add(file.path, new zip.BlobReader(file.blob), {
        level: 0, signal, useWebWorkers: false,
        onprogress: (bytes) => progress(5 + Math.floor(90 * (completed + bytes) / total), `Packing file ${index + 1} of ${files.length}…`),
      })
      completed += file.blob.size
    }
    checkAbort(signal)
    progress(97, 'Finishing backup…')
    const blob = await writer.close()
    closed = true
    checkAbort(signal)
    assertArchive(blob.size <= limits.fileBytes, 'The generated archive exceeds the file-size limit.')
    return blob
  } finally {
    if (!closed) await writer.close().catch(() => undefined)
  }
}

function validateEntry(entry: FileEntry) {
  const safeName = entry.filename === 'manifest.json' || /^pages\/[0-9a-f-]{36}\/(original|thumbnail|corrected|corrected-thumbnail)$/.test(entry.filename)
  assertArchive(safeName, 'The backup contains an unsafe or unexpected archive path.')
  const rawName = new TextEncoder().encode(entry.filename)
  assertArchive(entry.rawFilename.length === rawName.length && entry.rawFilename.every((byte, index) => byte === rawName[index]), 'Ambiguous archive entry names are not supported.')
  const mode = (entry.unixMode ?? (entry.externalFileAttributes >>> 16)) & 0xf000
  assertArchive(!entry.symlink && !entry.executable && !entry.msdosAttributes?.directory && (mode === 0 || mode === 0x8000), 'Links, executables, and special archive entries are not supported.')
  assertArchive(!entry.encrypted, 'Encrypted ZIP entries are not supported by the Biboo archive format.')
  assertArchive(entry.compressionMethod === 0 || entry.compressionMethod === 8, 'Only stored or DEFLATE-compressed ZIP entries are supported.')
  const maximum = entry.filename === 'manifest.json' ? limits.manifestBytes : limits.assetBytes
  assertArchive(Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize > 0 && entry.uncompressedSize <= maximum, 'An archive entry has an invalid or excessive decompressed size.')
  assertArchive(Number.isSafeInteger(entry.compressedSize) && entry.compressedSize >= 0 && entry.compressedSize <= limits.fileBytes, 'An archive entry has an invalid compressed size.')
  assertArchive(typeof entry.crc32 === 'number' && Number.isInteger(entry.crc32), 'An archive entry has no valid CRC checksum.')
}

// Bound actual streamed output as well as declared sizes; never trust ZIP headers alone.
async function extract(entry: FileEntry, type: string, signal: AbortSignal, budget: { used: number }, progress: (bytes: number) => void): Promise<Blob> {
  const parts: BlobPart[] = []
  let bytes = 0
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      checkAbort(signal)
      bytes += chunk.byteLength
      budget.used += chunk.byteLength
      assertArchive(bytes <= entry.uncompressedSize && budget.used <= limits.totalBytes, 'Decompressed data exceeds its declared size or the 256 MiB archive limit.')
      parts.push(chunk.slice())
      progress(bytes)
    },
  })
  await entry.getData(sink, { signal, checkSignature: true, checkOverlappingEntry: true, strictness: 'strict', useWebWorkers: false, useCompressionStream: true })
  assertArchive(bytes === entry.uncompressedSize, 'An image or manifest was truncated during decompression.')
  return new Blob(parts, { type })
}

export async function readArchive(file: File, signal: AbortSignal, progress: BackupProgress): Promise<ArchiveBundle> {
  assertArchive(file.name.toLowerCase().endsWith('.biboo'), 'Choose a .biboo book backup.')
  assertArchive(file.size > 0 && file.size <= limits.fileBytes, 'Backup files must be nonempty and no larger than 300 MiB.')
  const zip = await zipImplementation(signal)
  const reader = new zip.ZipReader(new zip.BlobReader(file), { strictness: 'strict', filenameValidation: 'strict', checkSignature: true, checkOverlappingEntry: true, useWebWorkers: false })
  try {
    progress(2, 'Checking archive entries…')
    const entries = new Map<string, FileEntry>()
    let total = 0
    for await (const entry of reader.getEntriesGenerator()) {
      checkAbort(signal)
      assertArchive(entry.directory === false, 'Directory entries are not part of the Biboo archive format.')
      validateEntry(entry)
      assertArchive(!entries.has(entry.filename), 'Duplicate archive entry paths are not allowed.')
      entries.set(entry.filename, entry)
      assertArchive(entries.size <= limits.entries, 'This archive contains too many entries.')
      total += entry.uncompressedSize
      assertArchive(total <= limits.totalBytes, 'The declared decompressed archive exceeds 256 MiB.')
    }
    const manifestEntry = entries.get('manifest.json')
    assertArchive(manifestEntry, 'The backup is missing manifest.json.')
    const budget = { used: 0 }
    const manifestBlob = await extract(manifestEntry, 'application/json', signal, budget, () => undefined)
    let json: unknown
    try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await manifestBlob.arrayBuffer())) }
    catch { throw new ArchiveError('The backup manifest is not valid UTF-8 JSON.') }
    const manifest = parseManifest(json)
    const references = manifestAssets(manifest)
    assertArchive(entries.size === references.length + 1, 'The archive contains unreferenced or missing files.')
    for (const reference of references) {
      const entry = entries.get(reference.path)
      assertArchive(entry && entry.uncompressedSize === reference.byteLength, 'A required asset is missing or its size disagrees with the manifest.')
    }
    const assets = new Map<string, Blob>()
    let completed = manifestBlob.size
    for (let index = 0; index < references.length; index++) {
      const reference = references[index]
      const entry = entries.get(reference.path)
      assertArchive(entry, 'A required asset is missing.')
      checkAbort(signal)
      const blob = await extract(entry, reference.mimeType, signal, budget, (bytes) => progress(5 + Math.floor(80 * (completed + bytes) / total), `Reading image ${index + 1} of ${references.length}…`))
      assets.set(reference.path, blob)
      completed += blob.size
    }
    checkAbort(signal)
    return { manifest, assets }
  } finally { await reader.close() }
}

function quotaFailure(reason: unknown, depth = 0): boolean {
  if (!reason || typeof reason !== 'object' || depth > 3) return false
  const error = reason as { name?: unknown; inner?: unknown; cause?: unknown; failures?: unknown }
  return error.name === 'QuotaExceededError' || quotaFailure(error.inner, depth + 1) || quotaFailure(error.cause, depth + 1)
    || (Array.isArray(error.failures) && error.failures.some((failure: unknown) => quotaFailure(failure, depth + 1)))
}

export function backupError(reason: unknown, restoring: boolean): string {
  if (reason instanceof SecureContextError) return `${reason.message}${restoring ? ' No book was imported.' : ''}`
  if (reason instanceof ArchiveError) return `${reason.message}${restoring ? ' No book was imported.' : ''}`
  if (quotaFailure(reason)) {
    return restoring ? 'Device storage is full. Free space and retry. No partial restored book was saved.' : 'Not enough browser storage to prepare this backup. Free space and retry. Your saved book was not changed.'
  }
  const detail = reason instanceof Error ? reason.message.slice(0, 240) : ''
  return restoring
    ? `Restore failed. The archive may be damaged or unsupported, or site storage may be unavailable. No partial book was added.${detail ? ` Details: ${detail}` : ''}`
    : `Backup could not finish. Your saved book was not changed.${detail ? ` Details: ${detail}` : ''}`
}

export function downloadFilename(title: string): string {
  const slug = title.normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'book'
  return `biboo-${slug}.biboo`
}
