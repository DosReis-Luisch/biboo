import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { database } from '../src/data/database'
import { pageRepository } from '../src/features/pages/pageRepository'
import type { PreparedPageImage } from '../src/features/pages/page'
import { CaptureSession } from '../src/features/scanner/captureSession'
import { bookId, expectSameBlob, firstPageId, fixtureSnapshot, secondPageId } from './fixtures'

function prepared(): PreparedPageImage {
  const snapshot = fixtureSnapshot(false)
  const page = snapshot.pages[0]
  return { original: snapshot.originals[0].blob, thumbnail: snapshot.thumbnails[0].blob, originalFilename: page.originalFilename, widthPx: page.widthPx, heightPx: page.heightPx, mimeType: page.mimeType }
}
beforeEach(async () => {
  await database.delete()
  await database.open()
  await database.books.add(fixtureSnapshot(false).book)
})
afterEach(async () => { await database.delete() })

describe('progressive scanner persistence in existing stores', () => {
  it('keeps captures across a reopen and acknowledges a committed retry without overwriting metadata or order', async () => {
    const image = prepared()
    const first = await pageRepository.add(bookId, image, 'cover', firstPageId)
    await pageRepository.add(bookId, image, 'interior', secondPageId)
    await pageRepository.reorder(bookId, [secondPageId, firstPageId])
    database.close()
    await database.open()
    const retry = await pageRepository.add(bookId, image, 'interior', firstPageId)
    expect(retry).toEqual({ ...first, readingOrder: 2 })
    expect((await pageRepository.list(bookId)).map((page) => page.id)).toEqual([secondPageId, firstPageId])
    expect(await database.pageOriginals.count()).toBe(2)
    expect(await database.pageThumbnails.count()).toBe(2)
    await expectSameBlob((await pageRepository.getOriginal(firstPageId))!.blob, image.original)
    await expectSameBlob((await pageRepository.getThumbnail(firstPageId))!.blob, image.thumbnail)
  })

  it('retries a lost save acknowledgement through the real repository without duplicating a page', async () => {
    let loseAcknowledgement = true
    const session = new CaptureSession(async () => prepared(), async (image, role, id) => {
      const page = await pageRepository.add(bookId, image, role, id)
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Lost acknowledgement') }
      return page
    })
    await expect(session.capture(async () => new File(['original'], 'camera.jpg'), 'interior', () => {})).rejects.toThrow('Lost acknowledgement')
    expect(await database.pages.count()).toBe(1)
    const page = await session.retry(() => {})
    expect((await pageRepository.list(bookId)).map((item) => item.id)).toEqual([page.id])
    expect(await database.pageOriginals.count()).toBe(1)
    expect(await database.pageThumbnails.count()).toBe(1)
  })

  it('rolls back a failed thumbnail write, preserves earlier captures, and safely retries', async () => {
    const image = prepared()
    const first = await pageRepository.add(bookId, image, 'cover', firstPageId)
    const fail = () => { throw new DOMException('Forced storage failure', 'QuotaExceededError') }
    database.pageThumbnails.hook('creating', fail)
    try {
      await expect(pageRepository.add(bookId, image, 'interior', secondPageId)).rejects.toThrow('Forced storage failure')
    } finally { database.pageThumbnails.hook('creating').unsubscribe(fail) }
    expect(await pageRepository.list(bookId)).toEqual([first])
    expect(await database.pageOriginals.get(secondPageId)).toBeUndefined()
    expect(await database.pageThumbnails.get(secondPageId)).toBeUndefined()
    const next = await pageRepository.add(bookId, image, 'interior', secondPageId)
    expect(next.readingOrder).toBe(2)
    expect(await database.pages.count()).toBe(2)
    expect(await database.pageOriginals.count()).toBe(2)
    expect(await database.pageThumbnails.count()).toBe(2)
  })

  it('rejects a foreign capture ID and inconsistent or missing assets without overwriting them', async () => {
    const image = prepared()
    const first = await pageRepository.add(bookId, image, 'cover', firstPageId)
    const otherBook = '55555555-5555-4555-8555-555555555555'
    await database.books.add({ ...fixtureSnapshot(false).book, id: otherBook })
    await expect(pageRepository.add(otherBook, image, 'interior', firstPageId)).rejects.toThrow('inconsistent')
    await expect(pageRepository.add(bookId, { ...image, widthPx: image.widthPx + 1 }, 'interior', firstPageId)).rejects.toThrow('inconsistent')
    expect(await database.pages.get(firstPageId)).toEqual(first)
    await database.pageThumbnails.delete(firstPageId)
    await expect(pageRepository.add(bookId, image, 'interior', firstPageId)).rejects.toThrow('inconsistent')
    expect(await database.pageThumbnails.get(firstPageId)).toBeUndefined()
    expect(await database.pages.count()).toBe(1)
  })
})
