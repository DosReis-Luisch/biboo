import Dexie, { type EntityTable } from 'dexie'
import type { Book } from '../features/books/book'
import type { BookPage, PageAsset } from '../features/pages/page'

const database = new Dexie('biboo') as Dexie & {
  books: EntityTable<Book, 'id'>
  pages: EntityTable<BookPage, 'id'>
  pageOriginals: EntityTable<PageAsset, 'pageId'>
  pageThumbnails: EntityTable<PageAsset, 'pageId'>
}

// Keep version 1 intact; add future schema changes as new versions with migrations.
database.version(1).stores({ books: 'id, updatedAt' })

// Additive migration: existing version 1 book records are left untouched.
database.version(2).stores({
  pages: 'id, bookId, [bookId+readingOrder]',
  pageOriginals: 'pageId, bookId',
  pageThumbnails: 'pageId, bookId',
})

export { database }
