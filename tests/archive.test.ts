import { describe, expect, it, vi } from 'vitest'
import { BlobReader, BlobWriter, ZipWriter, configure } from '@zip.js/zip.js/index-native.js'
import { readArchive, writeArchive } from '../src/features/backup/archive'
import { limits, type ArchiveBundle } from '../src/features/backup/format'
import { serializeSnapshot, restoredRecords } from '../src/features/backup/serialization'
import { emptySnapshot, expectSameBlob, fixtureSnapshot } from './fixtures'

const signal = () => new AbortController().signal
const asFile = (blob: Blob) => new File([blob], 'test.biboo', { type: 'application/zip' })
const filesFor = (bundle: ArchiveBundle): [string, Blob][] => [
  ['manifest.json', new Blob([JSON.stringify(bundle.manifest)])], ...bundle.assets,
]

async function zipFiles(files: [string, Blob][]) {
  configure({ useWebWorkers: false, useCompressionStream: true })
  const writer = new ZipWriter(new BlobWriter('application/zip'), { level: 0, useWebWorkers: false })
  for (const [path, blob] of files) await writer.add(path, new BlobReader(blob), { level: 0 })
  return writer.close()
}

function firstCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i <= bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) return i
  throw new Error('Test fixture has no ZIP central directory')
}

describe('real small ZIP archives (native zip.js, no mocks)', () => {
  it.each(['empty', 'originals', 'corrected'] as const)('round-trips %s through the production writer and reader', async (kind) => {
    const bundle = serializeSnapshot(kind === 'empty' ? emptySnapshot() : fixtureSnapshot(kind === 'corrected'))
    const progress = vi.fn()
    const blob = await writeArchive(bundle, signal(), progress)
    expect(blob.type).toBe('application/zip')
    const extracted = await readArchive(asFile(blob), signal(), progress)
    expect(extracted.manifest).toEqual(bundle.manifest)
    expect([...extracted.assets.keys()]).toEqual([...bundle.assets.keys()])
    for (const [path, original] of bundle.assets) await expectSameBlob(extracted.assets.get(path)!, original)
    expect(restoredRecords(extracted).pages).toHaveLength(bundle.manifest.pages.length)
    expect(progress).toHaveBeenCalled()
    for (const [percent, message] of progress.mock.calls) {
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
      expect(message).toBeTypeOf('string')
    }
  })

  it('rejects malformed JSON and invalid UTF-8 in real ZIP entries', async () => {
    for (const payload of ['{not json', new Uint8Array([0xff, 0xfe, 0xff])]) {
      const blob = await zipFiles([['manifest.json', new Blob([payload])]])
      await expect(readArchive(asFile(blob), signal(), vi.fn())).rejects.toThrow(/UTF-8 JSON/)
    }
  })

  it.each(['missing manifest', 'missing image', 'extra image', 'unsafe traversal', 'absolute path', 'backslash path'] as const)('rejects archive membership/path violations: %s', async (failure) => {
    const files = filesFor(serializeSnapshot(fixtureSnapshot()))
    if (failure === 'missing manifest') files.shift()
    if (failure === 'missing image') files.pop()
    if (failure === 'extra image') files.push(['pages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/original', new Blob(['extra'])])
    if (failure === 'unsafe traversal') files.push(['../outside', new Blob(['x'])])
    if (failure === 'absolute path') files.push(['/manifest.json', new Blob(['x'])])
    if (failure === 'backslash path') files.push(['pages\\outside\\original', new Blob(['x'])])
    const blob = await zipFiles(files)
    await expect(readArchive(asFile(blob), signal(), vi.fn())).rejects.toThrow()
  })

  it('detects corruption of stored bytes using the ZIP CRC', async () => {
    const bytes = new Uint8Array(await (await zipFiles(filesFor(serializeSnapshot(fixtureSnapshot())))).arrayBuffer())
    const view = new DataView(bytes.buffer)
    const central = firstCentralDirectory(bytes)
    const local = view.getUint32(central + 42, true)
    const payload = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    // CRC must fail before JSON parsing, regardless of the changed byte.
    bytes[payload] ^= 1
    await expect(readArchive(asFile(new Blob([bytes])), signal(), vi.fn())).rejects.toThrow(/CRC/i)
  })

  it('rejects non-ZIP input and a truncated archive', async () => {
    const complete = await zipFiles(filesFor(serializeSnapshot(fixtureSnapshot())))
    for (const blob of [new Blob(['not a zip']), complete.slice(0, Math.floor(complete.size / 2))]) {
      await expect(readArchive(asFile(blob), signal(), vi.fn())).rejects.toThrow()
    }
  })

  it('rejects an oversized declared manifest without allocating its declared contents', async () => {
    const bytes = new Uint8Array(await (await zipFiles(filesFor(serializeSnapshot(fixtureSnapshot())))).arrayBuffer())
    const central = firstCentralDirectory(bytes)
    new DataView(bytes.buffer).setUint32(central + 24, limits.manifestBytes + 1, true)
    await expect(readArchive(asFile(new Blob([bytes])), signal(), vi.fn())).rejects.toThrow()
  })

  it('rejects empty, misnamed and oversized input before ZIP parsing', async () => {
    await expect(readArchive(asFile(new Blob()), signal(), vi.fn())).rejects.toThrow(/nonempty/)
    await expect(readArchive(new File(['x'], 'book.zip'), signal(), vi.fn())).rejects.toThrow(/\.biboo/)
    const file = asFile(new Blob(['x']))
    // Header-level guard only; never allocate a 300 MiB test fixture.
    vi.spyOn(file, 'size', 'get').mockReturnValue(limits.fileBytes + 1)
    await expect(readArchive(file, signal(), vi.fn())).rejects.toThrow(/300 MiB/)
  })

  it('rejects mismatched export assets and honors cancellation', async () => {
    const bundle = serializeSnapshot(fixtureSnapshot())
    bundle.assets.delete(bundle.manifest.pages[0].original.path)
    await expect(writeArchive(bundle, signal(), vi.fn())).rejects.toThrow(/missing/)
    const controller = new AbortController()
    controller.abort()
    await expect(writeArchive(serializeSnapshot(emptySnapshot()), controller.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
