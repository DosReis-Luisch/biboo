import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { database } from '../src/data/database'
import { backupRepository } from '../src/features/backup/backupRepository'
import { serializeSnapshot } from '../src/features/backup/serialization'
import { loadOcrPage } from '../src/features/ocr/ocrRepository'
import { expectSameBlob, expectSameSnapshot, fixtureSnapshot } from './fixtures'

beforeEach(async () => { await database.delete(); await database.open() })
afterEach(async () => { await database.delete() })

describe('read-only OCR source selection', () => {
  it('prefers the saved corrected asset and uses original for an uncorrected page', async () => {
    const fixture = fixtureSnapshot()
    const book = await backupRepository.restore(serializeSnapshot(fixture), new AbortController().signal)
    const before = await backupRepository.snapshot(book.id)
    const corrected = await loadOcrPage(book.id, before.pages[0].id)
    expect(corrected.corrected).toBe(true)
    expect(corrected.expectedWidth).toBe(before.corrections[0].targetWidthPx)
    expect(corrected.expectedHeight).toBe(before.corrections[0].targetHeightPx)
    await expectSameBlob(corrected.blob, fixture.correctedImages[0].blob)
    const original = await loadOcrPage(book.id, before.pages[1].id)
    expect(original.corrected).toBe(false)
    expect(original.expectedWidth).toBe(before.pages[1].widthPx)
    await expectSameBlob(original.blob, fixture.originals[1].blob)
    await expectSameSnapshot(await backupRepository.snapshot(book.id), before)
    expect(database.verno).toBe(3)
    expect(database.tables).toHaveLength(7)
  })
  it('rejects a foreign book/page relationship and a stale corrected asset revision', async () => {
    const book = await backupRepository.restore(serializeSnapshot(fixtureSnapshot()), new AbortController().signal)
    const page = (await database.pages.where('bookId').equals(book.id).sortBy('readingOrder'))[0]
    await expect(loadOcrPage('missing-book', page.id)).rejects.toThrow(/no longer exists/)
    await database.pageCorrectedImages.update(page.id, { revision: 'stale-revision' })
    await expect(loadOcrPage(book.id, page.id)).rejects.toThrow(/inconsistent/)
  })
})
