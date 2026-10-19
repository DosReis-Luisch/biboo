export interface Point { x: number; y: number }
// Destination order: top-left, top-right, bottom-right, bottom-left.
// Coordinates ALWAYS refer to the unrotated, browser-decoded original.
export type Corners = [Point, Point, Point, Point]
export type Rotation = 0 | 90 | 180 | 270
export interface CorrectionDraft { corners: Corners; rotation: Rotation }
export interface PageCorrection extends CorrectionDraft {
  pageId: string
  bookId: string
  sourceWidthPx: number
  sourceHeightPx: number
  targetWidthPx: number
  targetHeightPx: number
  widthMm: number
  heightMm: number
  updatedAt: string
  revision: string
}
export interface CorrectedAsset { pageId: string; bookId: string; revision: string; blob: Blob }
export interface CorrectionResult { image: Blob; thumbnail: Blob; width: number; height: number }
export const defaultCorners = (): Corners => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
export const cornerLabels = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const

export function toDisplay(point: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 90: return { x: 1 - point.y, y: point.x }
    case 180: return { x: 1 - point.x, y: 1 - point.y }
    case 270: return { x: point.y, y: 1 - point.x }
    default: return point
  }
}
export function fromDisplay(point: Point, rotation: Rotation): Point {
  return toDisplay(point, ((360 - rotation) % 360) as Rotation)
}
export function rotateDraft(draft: CorrectionDraft, clockwise: boolean): CorrectionDraft {
  const [tl, tr, br, bl] = draft.corners
  return {
    corners: clockwise ? [bl, tl, tr, br] : [tr, br, bl, tl],
    rotation: ((draft.rotation + (clockwise ? 90 : 270)) % 360) as Rotation,
  }
}
