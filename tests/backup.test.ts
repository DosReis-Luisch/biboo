import { describe, expect, it } from 'vitest'
import { ArchiveError, assetPath, limits, manifestAssets, type ArchiveManifest, type BookSnapshot } from '../src/features/backup/format'
import { restoredRecords, serializeSnapshot } from '../src/features/backup/serialization'
import { parseManifest } from '../src/features/backup/validation'
import { bookId, emptySnapshot, expectSameBlob, firstPageId, fixtureSnapshot, revision } from './fixtures'

describe('snapshot serialization and restore mapping', () => {
  it.each([false, true])('preserves complete metadata and binary assets (corrected=%s)', async (corrected) => {
    const snapshot = fixtureSnapshot(corrected)
    const before = structuredClone(snapshot)
    const bundle = serializeSnapshot(snapshot)
    expect(bundle.manifest.format).toBe('biboo-book')
    expect(bundle.manifest.archiveVersion).toBe(1)
    expect(bundle.manifest.book).toEqual(snapshot.book)
    expect(bundle.manifest.pages.map((row) => row.page)).toEqual(snapshot.pages)
    expect(bundle.assets.size).toBe(corrected ? 6 : 4)
    for (const [key, role] of [
      ['originals', 'original'], ['thumbnails', 'thumbnail'],
      ['correctedImages', 'corrected'], ['correctedThumbnails', 'corrected-thumbnail'],
    ] as const) {
      for (const row of snapshot[key]) {
        const path = assetPath(row.pageId, role)
        const asset = manifestAssets(bundle.manifest).find((entry) => entry.path === path)!
        expect(asset).toEqual({ path, mimeType: row.blob.type, byteLength: row.blob.size })
        expect(bundle.assets.get(path)).toBe(row.blob)
        await expectSameBlob(bundle.assets.get(path)!, row.blob)
      }
    }
    expect(bundle.manifest.pages[0].correction?.settings).toEqual(snapshot.corrections[0])
    expect(snapshot).toEqual(before)
    expect(parseManifest(JSON.parse(JSON.stringify(bundle.manifest)))).toEqual(bundle.manifest)

    const restored = restoredRecords(bundle)
    const again = restoredRecords(bundle)
    const originalIds = [bookId, ...snapshot.pages.map((page) => page.id), ...snapshot.corrections.map((row) => row.revision)]
    const newIds = [restored.book.id, ...restored.pages.map((page) => page.id), ...restored.corrections.map((row) => row.revision)]
    expect(new Set(newIds).size).toBe(newIds.length)
    for (const id of newIds) expect(originalIds).not.toContain(id)
    for (const id of [again.book.id, ...again.pages.map((page) => page.id), ...again.corrections.map((row) => row.revision)]) expect(newIds).not.toContain(id)
    expect(restored.book).toEqual({ ...snapshot.book, id: restored.book.id })
    snapshot.pages.forEach((page, index) => {
      expect(restored.pages[index]).toEqual({ ...page, id: restored.pages[index].id, bookId: restored.book.id })
    })
    for (const key of ['originals', 'thumbnails', 'correctedImages', 'correctedThumbnails'] as const) {
      expect(restored[key]).toHaveLength(snapshot[key].length)
      for (let i = 0; i < snapshot[key].length; i++) {
        const old = snapshot[key][i], row = restored[key][i]
        const pageIndex = snapshot.pages.findIndex((page) => page.id === old.pageId)
        expect({ ...row, blob: undefined }).toEqual({
          ...old, blob: undefined, pageId: restored.pages[pageIndex].id, bookId: restored.book.id,
          ...('revision' in old ? { revision: restored.corrections.find((settings) => settings.pageId === row.pageId)!.revision } : {}),
        })
        expect(row.blob).toBe(old.blob)
        await expectSameBlob(row.blob, old.blob)
      }
    }
    if (corrected) {
      expect(restored.corrections[0]).toEqual({ ...snapshot.corrections[0], pageId: restored.pages[0].id, bookId: restored.book.id, revision: restored.corrections[0].revision })
      expect(restored.corrections[0].revision).not.toBe(revision)
    } else expect(restored.corrections).toEqual([])
  })

  it('supports a book with no pages', () => {
    const bundle = serializeSnapshot(emptySnapshot())
    expect(bundle.manifest.pages).toEqual([])
    expect(bundle.assets.size).toBe(0)
    const restored = restoredRecords(bundle)
    expect(restored.book).toEqual({ ...bundle.manifest.book, id: restored.book.id })
    for (const key of ['pages', 'originals', 'thumbnails', 'corrections', 'correctedImages', 'correctedThumbnails'] as const) expect(restored[key]).toEqual([])
  })

  const invalidSnapshots: [string, (snapshot: BookSnapshot) => void][] = [
    ['missing original', (s) => { s.originals.pop() }],
    ['missing thumbnail', (s) => { s.thumbnails.pop() }],
    ['duplicate original row', (s) => { s.originals.push(s.originals[0]) }],
    ['foreign asset owner', (s) => { s.originals[0].bookId = firstPageId }],
    ['orphan asset', (s) => { s.originals[0].pageId = revision }],
    ['incomplete correction', (s) => { s.correctedImages = [] }],
    ['orphan correction images', (s) => { s.corrections = [] }],
    ['mismatched derived revision', (s) => { s.correctedImages[0].revision = firstPageId }],
    ['mismatched thumbnail revision', (s) => { s.correctedThumbnails[0].revision = firstPageId }],
    ['empty original', (s) => { s.originals[0].blob = new Blob([], { type: 'image/jpeg' }) }],
  ]
  it.each(invalidSnapshots)('rejects inconsistent local snapshots: %s', (_name, mutate) => {
    const snapshot = fixtureSnapshot()
    mutate(snapshot)
    expect(() => serializeSnapshot(snapshot)).toThrow(ArchiveError)
  })

  it.each(['missing', 'extra', 'wrong path', 'wrong size', 'wrong MIME'] as const)('revalidates extracted assets before restore: %s', (failure) => {
    const bundle = serializeSnapshot(fixtureSnapshot())
    const reference = bundle.manifest.pages[0].original
    const blob = bundle.assets.get(reference.path)!
    if (failure === 'missing') bundle.assets.delete(reference.path)
    if (failure === 'extra') bundle.assets.set('unexpected', blob)
    if (failure === 'wrong path') {
      bundle.assets.delete(reference.path)
      bundle.assets.set('pages/elsewhere/original', blob)
    }
    if (failure === 'wrong size') bundle.assets.set(reference.path, new Blob(['short'], { type: blob.type }))
    if (failure === 'wrong MIME') bundle.assets.set(reference.path, new Blob([blob], { type: 'image/png' }))
    expect(() => restoredRecords(bundle)).toThrow(ArchiveError)
  })
})

describe('untrusted manifest validation', () => {
  const invalid: [string, (manifest: ArchiveManifest) => void][] = [
    ['unsupported version', (m) => { Object.assign(m, { archiveVersion: 2 }) }],
    ['wrong format', (m) => { Object.assign(m, { format: 'other' }) }],
    ['unknown fields', (m) => { Object.assign(m.book, { executable: true }) }],
    ['blank title', (m) => { m.book.title = '  ' }],
    ['invalid language', (m) => { m.book.sourceLanguage = 'not_a_tag' }],
    ['invalid timestamp', (m) => { m.book.createdAt = 'yesterday' }],
    ['noncanonical UUID', (m) => { m.book.id = 'not-a-uuid' }],
    ['duplicate page IDs', (m) => { m.pages[1].page.id = m.pages[0].page.id }],
    ['page ID equals book ID', (m) => { m.pages[0].page.id = m.book.id }],
    ['duplicate correction revision', (m) => { m.pages[0].correction!.settings.revision = m.book.id }],
    ['foreign page owner', (m) => { m.pages[0].page.bookId = firstPageId }],
    ['nonconsecutive order', (m) => { m.pages[1].page.readingOrder = 3 }],
    ['invalid role', (m) => { Object.assign(m.pages[0].page, { role: 'unknown' }) }],
    ['invalid page dimensions', (m) => { m.pages[0].page.widthPx = 0 }],
    ['excessive pixel count', (m) => { m.pages[0].page.widthPx = 60_000_000 }],
    ['foreign correction owner', (m) => { m.pages[0].correction!.settings.bookId = firstPageId }],
    ['foreign correction page', (m) => { m.pages[0].correction!.settings.pageId = m.pages[1].page.id }],
    ['invalid rotation', (m) => { Object.assign(m.pages[0].correction!.settings, { rotation: 45 }) }],
    ['outside corner', (m) => { m.pages[0].correction!.settings.corners[0].x = -0.1 }],
    ['NaN corner', (m) => { m.pages[0].correction!.settings.corners[0].y = NaN }],
    ['crossed corners', (m) => { const c = m.pages[0].correction!.settings.corners; [c[1], c[2]] = [c[2], c[1]] }],
    ['degenerate corners', (m) => { const c = m.pages[0].correction!.settings.corners; c[1] = { ...c[0] } }],
    ['incomplete correction', (m) => { Reflect.deleteProperty(m.pages[0].correction!, 'thumbnail') }],
    ['incorrect output ratio', (m) => { m.pages[0].correction!.settings.targetWidthPx++ }],
    ['traversal path', (m) => { m.pages[0].original.path = '../original' }],
    ['foreign asset reference', (m) => { m.pages[0].thumbnail.path = m.pages[1].thumbnail.path }],
    ['MIME disagreement', (m) => { m.pages[0].original.mimeType = 'image/png' }],
    ['SVG asset', (m) => { m.pages[0].thumbnail.mimeType = 'image/svg+xml' }],
    ['empty asset', (m) => { m.pages[0].original.byteLength = 0 }],
    ['fractional asset size', (m) => { m.pages[0].original.byteLength = 1.5 }],
    ['oversize asset', (m) => { m.pages[0].original.byteLength = limits.assetBytes + 1 }],
  ]
  it.each(invalid)('rejects %s', (_name, mutate) => {
    const manifest = serializeSnapshot(fixtureSnapshot()).manifest
    mutate(manifest)
    expect(() => parseManifest(manifest)).toThrow(ArchiveError)
  })

  it.each([null, [], 'not a manifest', {}, { format: 'biboo-book', archiveVersion: 1 }].map((value) => ({ value })))('rejects malformed root data $value', ({ value }) => {
    expect(() => parseManifest(value)).toThrow(ArchiveError)
  })

  it('accepts exactly the page limit and rejects one more without image allocation', () => {
    const manifest = serializeSnapshot(fixtureSnapshot(false)).manifest
    const template = manifest.pages[0]
    manifest.pages = Array.from({ length: limits.pages }, (_, index) => {
      const row = structuredClone(template)
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`
      row.page.id = id
      row.page.readingOrder = index + 1
      row.original.path = assetPath(id, 'original')
      row.thumbnail.path = assetPath(id, 'thumbnail')
      return row
    })
    expect(parseManifest(manifest).pages).toHaveLength(limits.pages)
    manifest.pages.push(structuredClone(template))
    expect(() => parseManifest(manifest)).toThrow(/at most 500/)
  })

  it('enforces individual and aggregate declared byte limits at their boundaries', () => {
    const manifest = serializeSnapshot(fixtureSnapshot()).manifest
    const assets = manifestAssets(manifest)
    assets[0].byteLength = limits.assetBytes
    expect(() => parseManifest(manifest)).not.toThrow()
    assets[1].byteLength = limits.assetBytes
    assets[2].byteLength = limits.assetBytes
    assets[3].byteLength = limits.assetBytes - assets[4].byteLength - assets[5].byteLength
    expect(() => parseManifest(manifest)).not.toThrow()
    assets[3].byteLength++
    expect(() => parseManifest(manifest)).toThrow(/256 MiB/)
  })
})
