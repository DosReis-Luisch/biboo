export type PageRole = 'cover' | 'interior' | 'back-cover'

export interface BookPage {
  id: string
  bookId: string
  readingOrder: number
  originalFilename?: string
  createdAt: string
  widthPx: number
  heightPx: number
  mimeType: string
  role?: PageRole
}

export interface PageAsset {
  pageId: string
  bookId: string
  blob: Blob
}

export interface PreparedPageImage {
  original: Blob
  thumbnail: Blob
  originalFilename?: string
  widthPx: number
  heightPx: number
  mimeType: string
}

export const pageRoleLabels: Record<PageRole, string> = {
  cover: 'Cover', interior: 'Interior', 'back-cover': 'Back cover',
}
