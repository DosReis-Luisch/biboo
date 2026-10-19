import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { database } from '../src/data/database'
import { backupRepository } from '../src/features/backup/backupRepository'
import type { BookSnapshot } from '../src/features/backup/format'
import { serializeSnapshot } from '../src/features/backup/serialization'
import { bookRepository } from '../src/features/books/bookRepository'
import { pageRepository } from '../src/features/pages/pageRepository'
import { bookId, expectSameSnapshot, firstPageId, fixtureSnapshot, secondPageId } from './fixtures'

const signal = () => new AbortController().signal
const counts = () => Promise.all(database.tables.map((table) => table.count()))

async function seed(snapshot = fixtureSnapshot()) {
  await database.transaction('rw', database.tables, async () => {
    await database.books.add(snapshot.book)
    await database.pages.bulkAdd(snapshot.pages)
    await database.pageOriginals.bulkAdd(snapshot.originals)
    await database.pageThumbnails.bulkAdd(snapshot.thumbnails)
    await database.pageCorrections.bulkAdd(snapshot.corrections)
    await database.pageCorrectedImages.bulkAdd(snapshot.correctedImages)
    await database.pageCorrectedThumbnails.bulkAdd(snapshot.correctedThumbnails)
  })
  return snapshot
}

// One fake database per test lifecycle. No concurrent tests share this singleton.
beforeEach(async () => {
  await database.delete()
  await database.open()
})
afterEach(async () => {
  await database.delete()
})

describe('existing IndexedDB schema and persistence', () => {
  it('creates, updates and reopens a book through the existing repository', async () => {
    const input = { title: '  My book  ', sourceLanguage: 'nl-nl', targetLanguage: 'pt-pt', widthMm: 210, heightMm: 297 }
    const created = await bookRepository.create(input)
    expect(created.title).toBe('My book')
    expect(created.sourceLanguage).toBe('nl-NL')
    expect(created.targetLanguage).toBe('pt-PT')
    const updated = await bookRepository.update(created.id, { ...input, title: 'Updated title', widthMm: 280 })
    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.title).toBe('Updated title')
    expect(updated.widthMm).toBe(280)
    database.close()
    await database.open()
    expect(await bookRepository.get(created.id)).toEqual(updated)
    expect(await bookRepository.list()).toEqual([updated])
  })

  it('has schema version 3, seven stores, and the ordering/ownership indexes', async () => {
    expect(database.verno).toBe(3)
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      'books', 'pageCorrectedImages', 'pageCorrectedThumbnails', 'pageCorrections', 'pageOriginals', 'pageThumbnails', 'pages',
    ].sort())
    expect(database.books.schema.primKey.keyPath).toBe('id')
    expect(database.books.schema.indexes.map((index) => index.name)).toContain('updatedAt')
    expect(database.pages.schema.indexes.map((index) => index.name)).toEqual(['bookId', '[bookId+readingOrder]'])
    for (const table of [database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails]) {
      expect(table.schema.primKey.keyPath).toBe('pageId')
      expect(table.schema.indexes.map((index) => index.name)).toEqual(['bookId'])
    }
    const snapshot = await seed()
    database.close()
    await database.open()
    expect(await bookRepository.get(bookId)).toEqual(snapshot.book)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), snapshot)
  })

  it.each([1, 2])('upgrades a real version %i database without losing legacy records', async (version) => {
    await database.delete()
    const snapshot = fixtureSnapshot(false)
    const legacy = new Dexie('biboo')
    legacy.version(1).stores({ books: 'id, updatedAt' })
    if (version === 2) legacy.version(2).stores({
      pages: 'id, bookId, [bookId+readingOrder]', pageOriginals: 'pageId, bookId', pageThumbnails: 'pageId, bookId',
    })
    try {
      await legacy.open()
      await legacy.table('books').add(snapshot.book)
      if (version === 2) {
        await legacy.table('pages').bulkAdd(snapshot.pages)
        await legacy.table('pageOriginals').bulkAdd(snapshot.originals)
        await legacy.table('pageThumbnails').bulkAdd(snapshot.thumbnails)
      }
    } finally { legacy.close() }
    await database.open()
    expect(database.verno).toBe(3)
    expect(await bookRepository.get(bookId)).toEqual(snapshot.book)
    if (version === 2) await expectSameSnapshot(await backupRepository.snapshot(bookId), snapshot)
    else expect(await database.pages.count()).toBe(0)
    expect(await database.pageCorrections.count()).toBe(0)
    expect(await database.pageCorrectedImages.count()).toBe(0)
    expect(await database.pageCorrectedThumbnails.count()).toBe(0)
  })
})

describe('atomic independent restoration', () => {
  it('restores twice without replacing the source, including after database reopen', async () => {
    const original = await seed()
    const bundle = serializeSnapshot(await backupRepository.snapshot(bookId))
    const first = await backupRepository.restore(bundle, signal())
    const second = await backupRepository.restore(bundle, signal())
    expect(new Set([bookId, first.id, second.id]).size).toBe(3)
    const restored = await backupRepository.snapshot(first.id)
    expect(restored.pages.map((page) => page.readingOrder)).toEqual([1, 2])
    expect(restored.pages.every((page) => page.bookId === first.id)).toBe(true)
    expect(restored.pages.map((page) => page.id)).not.toContain(firstPageId)
    expect(restored.pages.map((page) => page.id)).not.toContain(secondPageId)
    // Compare all metadata and bytes against the source after explicit ID remapping.
    const expected: BookSnapshot = {
      ...original,
      book: { ...original.book, id: first.id },
      pages: original.pages.map((page, i) => ({ ...page, id: restored.pages[i].id, bookId: first.id })),
      corrections: original.corrections.map((row) => ({ ...row, bookId: first.id, pageId: restored.pages[0].id, revision: restored.corrections[0].revision })),
      originals: original.originals.map((row, i) => ({ ...row, bookId: first.id, pageId: restored.pages[i].id })),
      thumbnails: original.thumbnails.map((row, i) => ({ ...row, bookId: first.id, pageId: restored.pages[i].id })),
      correctedImages: original.correctedImages.map((row) => ({ ...row, bookId: first.id, pageId: restored.pages[0].id, revision: restored.corrections[0].revision })),
      correctedThumbnails: original.correctedThumbnails.map((row) => ({ ...row, bookId: first.id, pageId: restored.pages[0].id, revision: restored.corrections[0].revision })),
    }
    await expectSameSnapshot(restored, expected)
    database.close()
    await database.open()
    expect(await database.books.count()).toBe(3)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
    await expectSameSnapshot(await backupRepository.snapshot(first.id), expected)
    // Deleting a restored copy cannot affect the original or the other copy.
    await bookRepository.delete(second.id)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
    await expectSameSnapshot(await backupRepository.snapshot(first.id), expected)
  })

  it('rolls back all seven stores when the final asset write throws', async () => {
    const original = await seed()
    const before = await counts()
    const fail = () => { throw new Error('Forced final restoration write failure') }
    // A real Dexie hook fails the final store after prior writes were queued.
    database.pageCorrectedThumbnails.hook('creating', fail)
    try {
      await expect(backupRepository.restore(serializeSnapshot(original), signal())).rejects.toThrow(/Forced final restoration write failure/)
    } finally {
      database.pageCorrectedThumbnails.hook('creating').unsubscribe(fail)
    }
    expect(await counts()).toEqual(before)
    database.close()
    await database.open()
    expect(await counts()).toEqual(before)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
  })

  it('does not write malformed or canceled restores', async () => {
    const original = await seed()
    const before = await counts()
    const invalid = serializeSnapshot(original)
    invalid.assets.delete(invalid.manifest.pages[0].original.path)
    await expect(backupRepository.restore(invalid, signal())).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(backupRepository.restore(serializeSnapshot(original), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await counts()).toEqual(before)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
  })
})

describe('page ordering and cascading deletion', () => {
  it('reorders the complete set atomically and preserves identity, roles, corrections and assets', async () => {
    const original = await seed()
    await pageRepository.reorder(bookId, [secondPageId, firstPageId])
    const expected = {
      ...original, pages: [{ ...original.pages[1], readingOrder: 1 }, { ...original.pages[0], readingOrder: 2 }],
    }
    await expectSameSnapshot(await backupRepository.snapshot(bookId), expected)
    database.close()
    await database.open()
    expect((await pageRepository.list(bookId)).map((page) => page.id)).toEqual([secondPageId, firstPageId])
    await pageRepository.move(bookId, firstPageId, -1)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
    await pageRepository.move(bookId, firstPageId, 1)
    await expectSameSnapshot(await backupRepository.snapshot(bookId), expected)
    await pageRepository.move(bookId, firstPageId, 1) // End of list: no-op.
    await expectSameSnapshot(await backupRepository.snapshot(bookId), expected)
  })

  it('rejects duplicate, missing and foreign IDs without changing the saved order', async () => {
    const original = await seed()
    const other = await backupRepository.restore(serializeSnapshot(original), signal())
    const foreignId = (await pageRepository.list(other.id))[0].id
    for (const ids of [[firstPageId, firstPageId], [firstPageId], [firstPageId, foreignId], [firstPageId, 'missing'], []]) {
      await expect(pageRepository.reorder(bookId, ids)).rejects.toThrow()
      await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
    }
  })

  it('rolls back a reorder when an update fails after another page update', async () => {
    const original = await seed()
    const fail = (_changes: unknown, key: unknown) => {
      if (key === firstPageId) throw new Error('Forced reorder failure')
    }
    database.pages.hook('updating', fail)
    try {
      await expect(pageRepository.reorder(bookId, [secondPageId, firstPageId])).rejects.toThrow(/Forced reorder failure/)
    } finally { database.pages.hook('updating').unsubscribe(fail) }
    await expectSameSnapshot(await backupRepository.snapshot(bookId), original)
  })

  it('deletes a corrected page and all its assets, renumbering only the remaining pages', async () => {
    const original = await seed()
    const other = await backupRepository.restore(serializeSnapshot(original), signal())
    const otherBefore = await backupRepository.snapshot(other.id)
    await expect(pageRepository.delete(other.id, firstPageId)).rejects.toThrow(/belong/)
    await pageRepository.delete(bookId, firstPageId)
    for (const table of [database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails]) {
      expect(await table.get(firstPageId)).toBeUndefined()
    }
    expect(await database.pages.get(firstPageId)).toBeUndefined()
    await expectSameSnapshot(await backupRepository.snapshot(bookId), {
      ...original, pages: [{ ...original.pages[1], readingOrder: 1 }],
      originals: [original.originals[1]], thumbnails: [original.thumbnails[1]],
      corrections: [], correctedImages: [], correctedThumbnails: [],
    })
    await expectSameSnapshot(await backupRepository.snapshot(other.id), otherBefore)
  })

  it('deletes an entire book across all seven stores without affecting another book', async () => {
    const original = await seed()
    const other = await backupRepository.restore(serializeSnapshot(original), signal())
    const otherBefore = await backupRepository.snapshot(other.id)
    await bookRepository.delete(bookId)
    expect(await database.books.get(bookId)).toBeUndefined()
    for (const table of [database.pages, database.pageOriginals, database.pageThumbnails, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails]) {
      expect(await table.where('bookId').equals(bookId).count()).toBe(0)
    }
    await expectSameSnapshot(await backupRepository.snapshot(other.id), otherBefore)
  })
})
