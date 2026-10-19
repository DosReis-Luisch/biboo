import { database } from '../../data/database'

// Read-only, coherent source selection; no OCR schema or writes.
export function loadOcrPage(bookId: string, pageId: string) {
  return database.transaction('r', [database.books, database.pages, database.pageOriginals, database.pageCorrections, database.pageCorrectedImages], async () => {
    const book = await database.books.get(bookId), page = await database.pages.get(pageId)
    if (!book || !page || page.bookId !== bookId) throw new Error('This book or page no longer exists.')
    const settings = await database.pageCorrections.get(pageId)
    if (settings) {
      const image = await database.pageCorrectedImages.get(pageId)
      if (settings.bookId !== bookId || !image || image.bookId !== bookId || image.revision !== settings.revision) throw new Error('The saved corrected image is missing or inconsistent. Reopen the correction editor before recognizing text.')
      return { book, page, blob: image.blob, corrected: true, expectedWidth: settings.targetWidthPx, expectedHeight: settings.targetHeightPx }
    }
    const image = await database.pageOriginals.get(pageId)
    if (!image || image.bookId !== bookId) throw new Error('The original photograph is missing. Import this page again.')
    return { book, page, blob: image.blob, corrected: false, expectedWidth: page.widthPx, expectedHeight: page.heightPx }
  })
}
