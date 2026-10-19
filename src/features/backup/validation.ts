import type { Book } from '../books/book'
import type { BookPage, PageRole } from '../pages/page'
import type { Corners, PageCorrection, Rotation } from '../correction/correction'
import { validateCorners, outputDimensions } from '../correction/geometry'
import { ARCHIVE_FORMAT, ARCHIVE_VERSION, ArchiveError, assertArchive, assetPath, limits, manifestAssets, type ArchiveAsset, type ArchiveManifest } from './format'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  assertArchive(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`)
  assertArchive(Object.keys(value).every((key) => keys.includes(key)), `${label} contains unsupported fields.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, maximum: number): string {
  assertArchive(typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0'), `Invalid ${label}.`)
  return value
}
function id(value: unknown, label: string): string {
  const result = text(value, label, 36)
  assertArchive(uuid.test(result), `${label} must be a canonical lowercase UUID.`)
  return result
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  assertArchive(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), `Invalid ${label}.`)
  return value
}
function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 24)
  const date = new Date(result)
  assertArchive(Number.isFinite(date.getTime()) && date.toISOString() === result, `${label} must be an ISO UTC timestamp.`)
  return result
}
function language(value: unknown, label: string): string {
  const result = text(value, label, 100)
  try { assertArchive(Intl.getCanonicalLocales(result).length === 1, `Invalid ${label}.`) }
  catch { throw new ArchiveError(`Invalid ${label}.`) }
  return result
}
function mime(value: unknown): string {
  const result = text(value, 'asset MIME type', 100)
  assertArchive(/^image\/[a-z0-9][a-z0-9.+-]*$/.test(result) && !result.startsWith('image/svg'), 'Only raster image MIME types are supported in backups.')
  return result
}
function asset(value: unknown, expectedPath: string): ArchiveAsset {
  const row = record(value, ['path', 'mimeType', 'byteLength'], 'Asset reference')
  assertArchive(row.path === expectedPath, 'An asset path does not match its page or role.')
  return { path: expectedPath, mimeType: mime(row.mimeType), byteLength: number(row.byteLength, 'asset size', 1, limits.assetBytes, true) }
}
function book(value: unknown): Book {
  const row = record(value, ['id', 'title', 'sourceLanguage', 'targetLanguage', 'widthMm', 'heightMm', 'createdAt', 'updatedAt'], 'Book')
  const title = text(row.title, 'book title', 200)
  assertArchive(title.trim().length > 0, 'The book title cannot be blank.')
  return {
    id: id(row.id, 'Book ID'), title, sourceLanguage: language(row.sourceLanguage, 'source language'), targetLanguage: language(row.targetLanguage, 'target language'),
    widthMm: number(row.widthMm, 'book width', 1, 2000), heightMm: number(row.heightMm, 'book height', 1, 2000),
    createdAt: timestamp(row.createdAt, 'book creation date'), updatedAt: timestamp(row.updatedAt, 'book update date'),
  }
}
function page(value: unknown, bookId: string, order: number): BookPage {
  const row = record(value, ['id', 'bookId', 'readingOrder', 'originalFilename', 'createdAt', 'widthPx', 'heightPx', 'mimeType', 'role'], 'Page')
  assertArchive(row.bookId === bookId && row.readingOrder === order, 'Page ownership or reading order is invalid. Pages must be ordered consecutively from 1.')
  assertArchive(row.role === undefined || (typeof row.role === 'string' && ['cover', 'interior', 'back-cover'].includes(row.role)), 'Invalid page role.')
  const widthPx = number(row.widthPx, 'original pixel width', 1, 60_000_000, true), heightPx = number(row.heightPx, 'original pixel height', 1, 60_000_000, true)
  assertArchive(widthPx * heightPx <= 60_000_000, 'An original exceeds the 60 megapixel page limit.')
  return {
    id: id(row.id, 'Page ID'), bookId, readingOrder: order, createdAt: timestamp(row.createdAt, 'page creation date'),
    widthPx, heightPx, mimeType: mime(row.mimeType),
    ...(row.originalFilename !== undefined ? { originalFilename: text(row.originalFilename, 'original filename', 1024) } : {}),
    ...(row.role !== undefined ? { role: row.role as PageRole } : {}),
  }
}
function correction(value: unknown, bookId: string, pageId: string): PageCorrection {
  const row = record(value, ['pageId', 'bookId', 'corners', 'rotation', 'sourceWidthPx', 'sourceHeightPx', 'targetWidthPx', 'targetHeightPx', 'widthMm', 'heightMm', 'updatedAt', 'revision'], 'Correction settings')
  assertArchive(row.pageId === pageId && row.bookId === bookId, 'Correction ownership is invalid.')
  assertArchive(typeof row.rotation === 'number' && [0, 90, 180, 270].includes(row.rotation), 'Invalid correction rotation.')
  assertArchive(Array.isArray(row.corners) && row.corners.length === 4, 'A correction requires four corners.')
  const corners = row.corners.map((value) => {
    const point = record(value, ['x', 'y'], 'Source corner')
    return { x: number(point.x, 'corner x', 0, 1), y: number(point.y, 'corner y', 0, 1) }
  }) as Corners
  try { validateCorners(corners) } catch { throw new ArchiveError('Correction corners are invalid, crossed, or degenerate.') }
  const sourceWidthPx = number(row.sourceWidthPx, 'correction source width', 2, 60_000_000, true), sourceHeightPx = number(row.sourceHeightPx, 'correction source height', 2, 60_000_000, true)
  assertArchive(sourceWidthPx * sourceHeightPx <= 60_000_000, 'Correction source dimensions exceed the limit.')
  const widthMm = number(row.widthMm, 'correction physical width', 1, 2000), heightMm = number(row.heightMm, 'correction physical height', 1, 2000)
  let dimensions: { width: number; height: number }
  try { dimensions = outputDimensions(widthMm, heightMm) } catch { throw new ArchiveError('Invalid physical correction dimensions.') }
  assertArchive(row.targetWidthPx === dimensions.width && row.targetHeightPx === dimensions.height, 'Correction output dimensions do not match its saved physical ratio.')
  return {
    pageId, bookId, corners, rotation: row.rotation as Rotation, sourceWidthPx, sourceHeightPx,
    targetWidthPx: dimensions.width, targetHeightPx: dimensions.height, widthMm, heightMm,
    updatedAt: timestamp(row.updatedAt, 'correction update date'), revision: id(row.revision, 'Correction revision'),
  }
}

// Parse unknown JSON into new whitelisted records; never spread untrusted input.
export function parseManifest(value: unknown): ArchiveManifest {
  const root = record(value, ['format', 'archiveVersion', 'exportedAt', 'book', 'pages'], 'Manifest')
  assertArchive(root.format === ARCHIVE_FORMAT, 'This file is not a Biboo book backup.')
  assertArchive(root.archiveVersion === ARCHIVE_VERSION, 'Unsupported Biboo archive version. Open it with a compatible version of Biboo.')
  const metadata = book(root.book)
  assertArchive(Array.isArray(root.pages) && root.pages.length <= limits.pages, `A backup may contain at most ${limits.pages} pages.`)
  const ids = new Set([metadata.id])
  const pages = root.pages.map((value, index) => {
    const row = record(value, ['page', 'original', 'thumbnail', 'correction'], 'Archive page')
    const metadataPage = page(row.page, metadata.id, index + 1)
    assertArchive(!ids.has(metadataPage.id), 'Duplicate book or page IDs in the archive.')
    ids.add(metadataPage.id)
    const original = asset(row.original, assetPath(metadataPage.id, 'original'))
    assertArchive(original.mimeType === metadataPage.mimeType, 'Original MIME type disagrees with page metadata.')
    const thumbnail = asset(row.thumbnail, assetPath(metadataPage.id, 'thumbnail'))
    if (row.correction === undefined) return { page: metadataPage, original, thumbnail }
    const derived = record(row.correction, ['settings', 'image', 'thumbnail'], 'Page correction')
    const settings = correction(derived.settings, metadata.id, metadataPage.id)
    assertArchive(!ids.has(settings.revision), 'Duplicate IDs or correction revisions in the archive.')
    ids.add(settings.revision)
    return { page: metadataPage, original, thumbnail, correction: { settings, image: asset(derived.image, assetPath(metadataPage.id, 'corrected')), thumbnail: asset(derived.thumbnail, assetPath(metadataPage.id, 'corrected-thumbnail')) } }
  })
  const manifest: ArchiveManifest = { format: ARCHIVE_FORMAT, archiveVersion: ARCHIVE_VERSION, exportedAt: timestamp(root.exportedAt, 'export date'), book: metadata, pages }
  const assets = manifestAssets(manifest)
  assertArchive(new Set(assets.map((entry) => entry.path)).size === assets.length, 'Duplicate asset references in the manifest.')
  assertArchive(assets.reduce((sum, entry) => sum + entry.byteLength, 0) <= limits.totalBytes, 'This backup exceeds the 256 MiB image-data limit.')
  return manifest
}
