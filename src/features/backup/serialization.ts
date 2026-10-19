import type { BookPage, PageAsset } from '../pages/page'
import { createId } from '../../app/secureContext'
import type { CorrectedAsset, PageCorrection } from '../correction/correction'
import { ARCHIVE_FORMAT, ARCHIVE_VERSION, assertArchive, assetPath, limits, manifestAssets, type ArchiveAsset, type ArchiveBundle, type ArchivePage, type BookSnapshot } from './format'
import { parseManifest } from './validation'

function indexed<T extends { pageId: string; bookId: string }>(rows: T[], bookId: string, pageIds: Set<string>, label: string) {
  const map = new Map<string, T>()
  for (const row of rows) {
    assertArchive(row.bookId === bookId && pageIds.has(row.pageId) && !map.has(row.pageId), `Inconsistent ${label} relationships in local storage.`)
    map.set(row.pageId, row)
  }
  return map
}

export function serializeSnapshot(snapshot: BookSnapshot): ArchiveBundle {
  const assets = new Map<string, Blob>()
  const pageIds = new Set(snapshot.pages.map((page) => page.id))
  const originals = indexed(snapshot.originals, snapshot.book.id, pageIds, 'original image')
  const thumbnails = indexed(snapshot.thumbnails, snapshot.book.id, pageIds, 'thumbnail')
  const corrections = indexed(snapshot.corrections, snapshot.book.id, pageIds, 'correction')
  const correctedImages = indexed(snapshot.correctedImages, snapshot.book.id, pageIds, 'corrected image')
  const correctedThumbnails = indexed(snapshot.correctedThumbnails, snapshot.book.id, pageIds, 'corrected thumbnail')
  assertArchive(originals.size === pageIds.size && thumbnails.size === pageIds.size, 'A page is missing its original image or imported thumbnail. Backup was not created.')
  assertArchive(correctedImages.size === corrections.size && correctedThumbnails.size === corrections.size, 'Correction settings and derived assets are incomplete. Backup was not created.')
  function describe(row: PageAsset | CorrectedAsset | undefined, path: string): ArchiveAsset {
    assertArchive(row?.blob instanceof Blob && row.blob.size > 0, `Missing image data for ${path}.`)
    assets.set(path, row.blob)
    return { path, mimeType: row.blob.type, byteLength: row.blob.size }
  }
  const pages: ArchivePage[] = snapshot.pages.map((page) => {
    const settings = corrections.get(page.id)
    const original = describe(originals.get(page.id), assetPath(page.id, 'original'))
    const thumbnail = describe(thumbnails.get(page.id), assetPath(page.id, 'thumbnail'))
    if (!settings) {
      assertArchive(!correctedImages.has(page.id) && !correctedThumbnails.has(page.id), 'A page has derived images without correction settings.')
      return { page, original, thumbnail }
    }
    const image = correctedImages.get(page.id), thumb = correctedThumbnails.get(page.id)
    assertArchive(image?.revision === settings.revision && thumb?.revision === settings.revision, 'A correction revision disagrees with its derived images.')
    return { page, original, thumbnail, correction: { settings, image: describe(image, assetPath(page.id, 'corrected')), thumbnail: describe(thumb, assetPath(page.id, 'corrected-thumbnail')) } }
  })
  const manifest = parseManifest({ format: ARCHIVE_FORMAT, archiveVersion: ARCHIVE_VERSION, exportedAt: new Date().toISOString(), book: snapshot.book, pages })
  return { manifest, assets }
}

// Validate extracted Blob references again at the database boundary, then remap.
export function restoredRecords(bundle: ArchiveBundle) {
  const manifest = parseManifest(bundle.manifest)
  const references = manifestAssets(manifest)
  assertArchive(bundle.assets.size === references.length, 'The extracted archive contains missing or extra assets.')
  let bytes = 0
  for (const asset of references) {
    const blob = bundle.assets.get(asset.path)
    assertArchive(blob instanceof Blob && blob.size === asset.byteLength && blob.type === asset.mimeType, 'An extracted image does not match its manifest reference.')
    bytes += blob.size
  }
  assertArchive(bytes <= limits.totalBytes, 'The restored book exceeds the image-data limit.')
  const book = { ...manifest.book, id: createId() }
  const pages: BookPage[] = [], originals: PageAsset[] = [], thumbnails: PageAsset[] = []
  const corrections: PageCorrection[] = [], correctedImages: CorrectedAsset[] = [], correctedThumbnails: CorrectedAsset[] = []
  // References are retained as Blobs; bytes are never decoded or regenerated.
  const blobAt = (reference: ArchiveAsset) => {
    const blob = bundle.assets.get(reference.path)
    assertArchive(blob, 'A referenced image is missing.')
    return blob
  }
  for (const row of manifest.pages) {
    const pageId = createId()
    pages.push({ ...row.page, id: pageId, bookId: book.id })
    originals.push({ pageId, bookId: book.id, blob: blobAt(row.original) })
    thumbnails.push({ pageId, bookId: book.id, blob: blobAt(row.thumbnail) })
    if (row.correction) {
      const revision = createId()
      corrections.push({ ...row.correction.settings, pageId, bookId: book.id, revision })
      correctedImages.push({ pageId, bookId: book.id, revision, blob: blobAt(row.correction.image) })
      correctedThumbnails.push({ pageId, bookId: book.id, revision, blob: blobAt(row.correction.thumbnail) })
    }
  }
  return { book, pages, originals, thumbnails, corrections, correctedImages, correctedThumbnails }
}
