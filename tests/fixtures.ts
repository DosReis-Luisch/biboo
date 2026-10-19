import { expect } from 'vitest'
import type { BookSnapshot } from '../src/features/backup/format'

export const timestamp = '2026-10-01T12:00:00.000Z'
export const bookId = '11111111-1111-4111-8111-111111111111'
export const firstPageId = '22222222-2222-4222-8222-222222222222'
export const secondPageId = '33333333-3333-4333-8333-333333333333'
export const revision = '44444444-4444-4444-8444-444444444444'

export function fixtureSnapshot(corrected = true): BookSnapshot {
  // Tiny, distinct binary tokens, not decodable photographs. These layers must
  // preserve bytes without decoding. Pixel interpolation uses separate RGBA data.
  const blob = (token: number, type = 'image/jpeg') => new Blob([new Uint8Array([0, 255, token, 128, 1, 2, 3])], { type })
  const pages: BookSnapshot['pages'] = [
    { id: firstPageId, bookId, readingOrder: 1, originalFilename: 'cover.jpg', createdAt: timestamp, widthPx: 3000, heightPx: 4000, mimeType: 'image/jpeg', role: 'cover' },
    { id: secondPageId, bookId, readingOrder: 2, originalFilename: 'page two.png', createdAt: timestamp, widthPx: 320, heightPx: 200, mimeType: 'image/png', role: 'interior' },
  ]
  return {
    book: { id: bookId, title: 'Een boek / Um livro', sourceLanguage: 'nl-NL', targetLanguage: 'pt-PT', widthMm: 210, heightMm: 297, createdAt: timestamp, updatedAt: '2026-10-02T12:00:00.000Z' },
    pages,
    originals: pages.map((page, index) => ({ pageId: page.id, bookId, blob: blob(index + 1, page.mimeType) })),
    thumbnails: pages.map((page, index) => ({ pageId: page.id, bookId, blob: blob(index + 3) })),
    corrections: corrected ? [{ pageId: firstPageId, bookId, revision, corners: [{ x: 0.15, y: 0.85 }, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 }, { x: 0.8, y: 0.95 }], rotation: 90, sourceWidthPx: 3000, sourceHeightPx: 4000, targetWidthPx: 1697, targetHeightPx: 2400, widthMm: 210, heightMm: 297, updatedAt: timestamp }] : [],
    correctedImages: corrected ? [{ pageId: firstPageId, bookId, revision, blob: blob(5, 'image/png') }] : [],
    correctedThumbnails: corrected ? [{ pageId: firstPageId, bookId, revision, blob: blob(6) }] : [],
  }
}

export function emptySnapshot(): BookSnapshot {
  const snapshot = fixtureSnapshot(false)
  return { ...snapshot, pages: [], originals: [], thumbnails: [] }
}

export async function expectSameBlob(actual: Blob, expected: Blob) {
  expect(actual).toBeInstanceOf(Blob)
  expect(actual.type).toBe(expected.type)
  expect(actual.size).toBe(expected.size)
  expect(new Uint8Array(await actual.arrayBuffer())).toEqual(new Uint8Array(await expected.arrayBuffer()))
}

export async function expectSameSnapshot(actual: BookSnapshot, expected: BookSnapshot) {
  expect(actual.book).toEqual(expected.book)
  expect(actual.pages).toEqual(expected.pages)
  // Store iteration is by primary key, not necessarily fixture/reading order.
  expect([...actual.corrections].sort((a, b) => a.pageId.localeCompare(b.pageId)))
    .toEqual([...expected.corrections].sort((a, b) => a.pageId.localeCompare(b.pageId)))
  for (const key of ['originals', 'thumbnails', 'correctedImages', 'correctedThumbnails'] as const) {
    expect(actual[key]).toHaveLength(expected[key].length)
    for (const row of expected[key]) {
      const found = actual[key].find((candidate) => candidate.pageId === row.pageId)!
      expect(found).toBeDefined()
      expect({ ...found, blob: undefined }).toEqual({ ...row, blob: undefined })
      await expectSameBlob(found.blob, row.blob)
    }
  }
}

