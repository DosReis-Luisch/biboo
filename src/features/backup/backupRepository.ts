import { database } from '../../data/database'
import { assertArchive, checkAbort, limits, type ArchiveBundle, type BookSnapshot } from './format'
import { restoredRecords } from './serialization'

const stores = [database.books, database.pages, database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails]

export const backupRepository = {
  snapshot(bookId: string): Promise<BookSnapshot> {
    return database.transaction('r', stores, async () => {
      const book = await database.books.get(bookId)
      assertArchive(book, 'This book no longer exists.')
      const pages = await database.pages.where('bookId').equals(bookId).sortBy('readingOrder')
      assertArchive(pages.length <= limits.pages, `Backup is limited to ${limits.pages} pages per book.`)
      const assetStores = [database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails]
      for (const store of assetStores) assertArchive(await store.where('bookId').equals(bookId).count() <= pages.length, 'Local storage contains orphaned or inconsistent page records.')
      const [originals, thumbnails, corrections, correctedImages, correctedThumbnails] = await Promise.all([
        database.pageOriginals.where('bookId').equals(bookId).toArray(),
        database.pageThumbnails.where('bookId').equals(bookId).toArray(),
        database.pageCorrections.where('bookId').equals(bookId).toArray(),
        database.pageCorrectedImages.where('bookId').equals(bookId).toArray(),
        database.pageCorrectedThumbnails.where('bookId').equals(bookId).toArray(),
      ])
      return { book, pages, originals, thumbnails, corrections, correctedImages, correctedThumbnails }
    })
  },

  async restore(bundle: ArchiveBundle, signal: AbortSignal) {
    checkAbort(signal)
    const records = restoredRecords(bundle)
    checkAbort(signal)
    await database.transaction('rw', stores, async () => {
      checkAbort(signal)
      // add/bulkAdd never replace records, even in the unlikely case of an ID collision.
      await database.books.add(records.book)
      await database.pages.bulkAdd(records.pages)
      await database.pageOriginals.bulkAdd(records.originals)
      await database.pageThumbnails.bulkAdd(records.thumbnails)
      await database.pageCorrections.bulkAdd(records.corrections)
      await database.pageCorrectedImages.bulkAdd(records.correctedImages)
      await database.pageCorrectedThumbnails.bulkAdd(records.correctedThumbnails)
    })
    return records.book
  },
}
