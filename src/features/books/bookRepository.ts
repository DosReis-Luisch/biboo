import { database } from '../../data/database'
import { validateBook, type Book, type BookInput } from './book'

function cleanInput(input: BookInput): BookInput {
  if (Object.keys(validateBook(input)).length) throw new Error('Check the book details and try again.')
  return {
    ...input,
    title: input.title.trim(),
    sourceLanguage: Intl.getCanonicalLocales(input.sourceLanguage)[0],
    targetLanguage: Intl.getCanonicalLocales(input.targetLanguage)[0],
  }
}

export const bookRepository = {
  list: () => database.books.orderBy('updatedAt').reverse().toArray(),
  get: (id: string) => database.books.get(id),
  async create(input: BookInput): Promise<Book> {
    const values = cleanInput(input)
    const timestamp = new Date().toISOString()
    const book: Book = { ...values, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }
    await database.books.add(book)
    return book
  },
  async update(id: string, input: BookInput): Promise<Book> {
    const values = cleanInput(input)
    return database.transaction('rw', database.books, async () => {
      const book = await database.books.get(id)
      if (!book) throw new Error('This book no longer exists. Return to your library.')
      const updated = { ...book, ...values, updatedAt: new Date().toISOString() }
      await database.books.put(updated)
      return updated
    })
  },
  delete: (id: string) => database.transaction(
    'rw', [database.books, database.pages, database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails],
    async () => {
      await database.pageOriginals.where('bookId').equals(id).delete()
      await database.pageThumbnails.where('bookId').equals(id).delete()
      await database.pageCorrections.where('bookId').equals(id).delete()
      await database.pageCorrectedImages.where('bookId').equals(id).delete()
      await database.pageCorrectedThumbnails.where('bookId').equals(id).delete()
      await database.pages.where('bookId').equals(id).delete()
      await database.books.delete(id)
    },
  ),
}

export function storageError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return 'Your device storage is full. Free some space and try again.'
    if (error.name === 'MissingAPIError' || error.name === 'SecurityError') {
      return 'Local storage is unavailable. Allow site storage or open Biboo outside private browsing.'
    }
  }
  return 'Biboo could not access your local library. Check that site storage is allowed and try again. Your changes have not been saved.'
}
