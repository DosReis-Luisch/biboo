import Dexie from 'dexie'
import { database } from '../../data/database'
import type { BookPage, PageRole, PreparedPageImage } from './page'

function orderedPages(bookId: string) {
  return database.pages.where('[bookId+readingOrder]')
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
}

export const pageRepository = {
  list: (bookId: string) => orderedPages(bookId).toArray(),
  getOriginal: (pageId: string) => database.pageOriginals.get(pageId),
  getThumbnail: (pageId: string) => database.pageThumbnails.get(pageId),

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

  delete(bookId: string, pageId: string) {
    return database.transaction('rw', [database.pages, database.pageOriginals, database.pageThumbnails], async () => {
      const page = await database.pages.get(pageId)
      if (!page) return
      if (page.bookId !== bookId) throw new Error('This page does not belong to this book.')
      await database.pageOriginals.delete(pageId)
      await database.pageThumbnails.delete(pageId)
      await database.pages.delete(pageId)
      const remaining = await orderedPages(bookId).toArray()
      await database.pages.bulkPut(remaining.map((item, index) => ({ ...item, readingOrder: index + 1 })))
    })
  },
}
