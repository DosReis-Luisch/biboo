import Dexie from 'dexie'
import { database } from '../../data/database'
import type { BookPage, GalleryPage, PageRole, PreparedPageImage } from './page'

function orderedPages(bookId: string) {
  return database.pages.where('[bookId+readingOrder]')
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
}

export const pageRepository = {
  list: (bookId: string) => orderedPages(bookId).toArray(),
  listGallery: (bookId: string): Promise<GalleryPage[]> => database.transaction('r', [database.pages, database.pageCorrections], async () => {
    const pages = await orderedPages(bookId).toArray()
    const corrections = await database.pageCorrections.where('bookId').equals(bookId).toArray()
    const revisions = new Map(corrections.map((correction) => [correction.pageId, correction.revision]))
    return pages.map((page) => ({ ...page, correctionRevision: revisions.get(page.id) }))
  }),
  getOriginal: (pageId: string) => database.pageOriginals.get(pageId),
  async getThumbnail(pageId: string, correctionRevision?: string) {
    if (correctionRevision) {
      const corrected = await database.pageCorrectedThumbnails.get(pageId)
      if (corrected?.revision === correctionRevision) return corrected
    }
    return database.pageThumbnails.get(pageId)
  },

  async add(bookId: string, image: PreparedPageImage, role: PageRole): Promise<BookPage> {
    // Decode/thumbnail work must finish BEFORE opening an IndexedDB transaction.
    return database.transaction(
      'rw', [database.books, database.pages, database.pageOriginals, database.pageThumbnails],
      async () => {
        if (!await database.books.get(bookId)) throw new Error('The book was deleted. Return to your library.')
        const last = await orderedPages(bookId).last()
        const page: BookPage = {
          id: crypto.randomUUID(), bookId, readingOrder: (last?.readingOrder ?? 0) + 1,
          createdAt: new Date().toISOString(), originalFilename: image.originalFilename,
          widthPx: image.widthPx, heightPx: image.heightPx, mimeType: image.mimeType, role,
        }
        await database.pages.add(page)
        await database.pageOriginals.add({ pageId: page.id, bookId, blob: image.original })
        await database.pageThumbnails.add({ pageId: page.id, bookId, blob: image.thumbnail })
        return page
      },
    )
  },

  move(bookId: string, pageId: string, direction: -1 | 1) {
    return database.transaction('rw', database.pages, async () => {
      const pages = await orderedPages(bookId).toArray()
      const index = pages.findIndex((page) => page.id === pageId)
      if (index < 0) throw new Error('This page no longer exists. Reopen your book.')
      const neighbor = pages[index + direction]
      if (!neighbor) return
      const page = pages[index]
      await database.pages.bulkPut([
        { ...page, readingOrder: neighbor.readingOrder },
        { ...neighbor, readingOrder: page.readingOrder },
      ])
    })
  },

  reorder(bookId: string, pageIds: readonly string[]) {
    const requestedIds = [...pageIds]
    return database.transaction('rw', [database.books, database.pages], async () => {
      if (!await database.books.get(bookId)) throw new Error('The book was deleted. Return to your library.')
      if (new Set(requestedIds).size !== requestedIds.length) {
        throw new Error('The requested order contains duplicate page IDs. Try reordering again.')
      }
      const current = await orderedPages(bookId).toArray()
      const byId = new Map(current.map((page) => [page.id, page]))
      if (requestedIds.some((id) => !byId.has(id))) {
        throw new Error('The requested order contains a missing page or a page from another book. Reopen the book and try again.')
      }
      if (requestedIds.length !== current.length) {
        throw new Error('The page list changed or some page IDs are missing. Try reordering the current gallery again.')
      }
      // Validate the COMPLETE set before writing, and preserve every other field.
      await database.pages.bulkPut(requestedIds.map((id, index) => {
        const page = byId.get(id)
        if (!page) throw new Error('This page no longer exists. Try reordering again.')
        return { ...page, readingOrder: index + 1 }
      }))
    })
  },

  delete(bookId: string, pageId: string) {
    return database.transaction('rw', [database.pages, database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails], async () => {
      const page = await database.pages.get(pageId)
      if (!page) return
      if (page.bookId !== bookId) throw new Error('This page does not belong to this book.')
      await database.pageOriginals.delete(pageId)
      await database.pageThumbnails.delete(pageId)
      await database.pageCorrections.delete(pageId)
      await database.pageCorrectedImages.delete(pageId)
      await database.pageCorrectedThumbnails.delete(pageId)
      await database.pages.delete(pageId)
      const remaining = await orderedPages(bookId).toArray()
      await database.pages.bulkPut(remaining.map((item, index) => ({ ...item, readingOrder: index + 1 })))
    })
  },
}
