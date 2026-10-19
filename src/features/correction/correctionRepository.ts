import { database } from '../../data/database'
import { createId } from '../../app/secureContext'
import type { PageCorrection, CorrectionDraft, CorrectionResult } from './correction'
import { outputDimensions, validateCorners } from './geometry'

async function checkRevision(pageId: string, expectedRevision?: string) {
  const previous = await database.pageCorrections.get(pageId)
  if (previous?.revision !== expectedRevision) throw new Error('This correction changed in another tab. Reopen the editor before saving.')
}

export const correctionRepository = {
  load(bookId: string, pageId: string) {
    return database.transaction('r', [database.books, database.pages, database.pageOriginals, database.pageCorrections], async () => {
      const book = await database.books.get(bookId)
      const page = await database.pages.get(pageId)
      const original = await database.pageOriginals.get(pageId)
      if (!book || !page || page.bookId !== bookId) throw new Error('This book or page no longer exists.')
      if (!original || original.bookId !== bookId) throw new Error('The original photograph is missing. Import the page again.')
      return { book, page, original: original.blob, settings: await database.pageCorrections.get(pageId) }
    })
  },
  save(settings: Omit<PageCorrection, 'revision' | 'updatedAt'>, result: CorrectionResult, expectedRevision?: string) {
    validateCorners(settings.corners)
    const dimensions = outputDimensions(settings.widthMm, settings.heightMm)
    if (dimensions.width !== result.width || dimensions.height !== result.height || result.width !== settings.targetWidthPx || result.height !== settings.targetHeightPx
      || !result.image.size || !result.thumbnail.size || ![0, 90, 180, 270].includes(settings.rotation)
      || ![settings.sourceWidthPx, settings.sourceHeightPx].every((value) => Number.isInteger(value) && value >= 2)
      || settings.sourceWidthPx * settings.sourceHeightPx > 60_000_000) throw new Error('The generated preview does not match the correction settings. Preview again.')
    return database.transaction('rw', [database.books, database.pages, database.pageOriginals, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails], async () => {
      const page = await database.pages.get(settings.pageId)
      const book = await database.books.get(settings.bookId)
      if (!page || page.bookId !== settings.bookId || !book || !await database.pageOriginals.where(':id').equals(settings.pageId).count()) throw new Error('The original page or book no longer exists.')
      if (book.widthMm !== settings.widthMm || book.heightMm !== settings.heightMm) throw new Error('The physical book dimensions changed. Reopen the editor and preview again.')
      await checkRevision(settings.pageId, expectedRevision)
      const revision = createId()
      const record: PageCorrection = { ...settings, revision, updatedAt: new Date().toISOString() }
      await database.pageCorrections.put(record)
      await database.pageCorrectedImages.put({ pageId: settings.pageId, bookId: settings.bookId, revision, blob: result.image })
      await database.pageCorrectedThumbnails.put({ pageId: settings.pageId, bookId: settings.bookId, revision, blob: result.thumbnail })
    })
  },
  remove(bookId: string, pageId: string, expectedRevision?: string) {
    return database.transaction('rw', [database.pages, database.pageCorrections, database.pageCorrectedImages, database.pageCorrectedThumbnails], async () => {
      const page = await database.pages.get(pageId)
      if (!page || page.bookId !== bookId) throw new Error('This page no longer exists.')
      await checkRevision(pageId, expectedRevision)
      await database.pageCorrections.delete(pageId)
      await database.pageCorrectedImages.delete(pageId)
      await database.pageCorrectedThumbnails.delete(pageId)
    })
  },
}

export type CorrectionDocument = Awaited<ReturnType<typeof correctionRepository.load>>
export const draftKey = (draft: CorrectionDraft) => JSON.stringify(draft)
