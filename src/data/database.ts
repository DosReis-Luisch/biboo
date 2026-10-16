import Dexie, { type EntityTable } from 'dexie'
import type { Book } from '../features/books/book'

const database = new Dexie('biboo') as Dexie & { books: EntityTable<Book, 'id'> }

// Keep version 1 intact; add future schema changes as new versions with migrations.
database.version(1).stores({ books: 'id, updatedAt' })

export { database }
