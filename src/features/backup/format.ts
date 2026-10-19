import type { Book } from '../books/book'
import type { BookPage, PageAsset } from '../pages/page'
import type { CorrectedAsset, PageCorrection } from '../correction/correction'

// Archive versioning is independent of Dexie's schema version.
export const ARCHIVE_FORMAT = 'biboo-book'
export const ARCHIVE_VERSION = 1
export const limits = {
  pages: 500,
  manifestBytes: 2 * 1024 * 1024,
  assetBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  fileBytes: 300 * 1024 * 1024,
  entries: 2001,
} as const

export interface ArchiveAsset { path: string; mimeType: string; byteLength: number }
export interface ArchivePage {
  page: BookPage
  original: ArchiveAsset
  thumbnail: ArchiveAsset
  correction?: { settings: PageCorrection; image: ArchiveAsset; thumbnail: ArchiveAsset }
}
export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT
  archiveVersion: typeof ARCHIVE_VERSION
  exportedAt: string
  book: Book
  pages: ArchivePage[]
}
export interface ArchiveBundle { manifest: ArchiveManifest; assets: Map<string, Blob> }
export interface BookSnapshot {
  book: Book
  pages: BookPage[]
  originals: PageAsset[]
  thumbnails: PageAsset[]
  corrections: PageCorrection[]
  correctedImages: CorrectedAsset[]
  correctedThumbnails: CorrectedAsset[]
}
export type BackupProgress = (percent: number, message: string) => void
export class ArchiveError extends Error {}
export function assertArchive(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ArchiveError(message)
}
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Backup operation canceled.', 'AbortError')
}
export const assetPath = (pageId: string, role: 'original' | 'thumbnail' | 'corrected' | 'corrected-thumbnail') => `pages/${pageId}/${role}`
export const manifestAssets = (manifest: ArchiveManifest) => manifest.pages.flatMap((row) => [row.original, row.thumbnail, ...(row.correction ? [row.correction.image, row.correction.thumbnail] : [])])
