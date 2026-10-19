import type { Corners, Point } from './correction'

const rectangle: Corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
export type Homography = [number, number, number, number, number, number, number, number, number]

export function validateCorners(points: Corners): void {
  if (points.length !== 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
    throw new Error('Keep all four corners inside the photograph.')
  }
  let doubleArea = 0
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01 || cross < 0.0001) {
      throw new Error('Corners must form a convex, clockwise quadrilateral without crossings or collapsed edges. Keep neighboring corners farther apart.')
    }
    doubleArea += a.x * b.y - b.x * a.y
  }
  if (doubleArea < 0.01) throw new Error('The selected area is too small. Select at least 0.5% of the photograph.')
}

// Eight unknowns, h33 = 1. Partial-pivot Gaussian elimination of an 8x8 system.
export function solveHomography(source: Corners, destination: Corners): Homography {
  const rows: number[][] = []
  source.forEach(({ x, y }, i) => {
    const { x: u, y: v } = destination[i]
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  })
  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    if (Math.abs(rows[pivot][column]) < 1e-10) throw new Error('The corner selection is numerically unstable. Adjust the corners.')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let j = column; j <= 8; j++) rows[column][j] /= divisor
    for (let row = 0; row < 8; row++) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let j = column; j <= 8; j++) rows[row][j] -= factor * rows[column][j]
    }
  }
  return [...rows.map((row) => row[8]), 1] as Homography
}

export function invertHomography(h: Homography): Homography {
  const [a, b, c, d, e, f, g, i, j] = h
  const inverse = [e * j - f * i, c * i - b * j, b * f - c * e,
    f * g - d * j, a * j - c * g, c * d - a * f,
    d * i - e * g, b * g - a * i, a * e - b * d]
  const determinant = a * inverse[0] + b * inverse[3] + c * inverse[6]
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) throw new Error('The selected perspective cannot be inverted.')
  return inverse.map((value) => value / determinant) as Homography
}

export function project(h: Homography, x: number, y: number): Point {
  const divisor = h[6] * x + h[7] * y + h[8]
  if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-9) throw new Error('The selected perspective is too extreme.')
  return { x: (h[0] * x + h[1] * y + h[2]) / divisor, y: (h[3] * x + h[4] * y + h[5]) / divisor }
}

export function rectificationHomographies(corners: Corners) {
  validateCorners(corners)
  // Destination TL is finite, so this inverse system can safely use h33 = 1.
  // A direct source-origin-normalized forward solve need not have that property.
  const inverse = solveHomography(rectangle, corners)
  return { inverse, forward: invertHomography(inverse) }
}

export function outputDimensions(widthMm: number, heightMm: number): { width: number; height: number } {
  if (![widthMm, heightMm].every((value) => Number.isFinite(value) && value >= 1 && value <= 2000)) throw new Error('Set valid physical book dimensions before correcting a page.')
  const scale = 2400 / Math.max(widthMm, heightMm)
  const width = Math.round(widthMm * scale), height = Math.round(heightMm * scale)
  if (width < 2 || height < 2) throw new Error('The physical page ratio is too narrow for a 2400-pixel correction. Check the book dimensions.')
  return { width, height }
}

export interface PixelSource { data: Uint8ClampedArray; width: number; height: number }

// Pure pixel engine: no DOM, Dexie, or React. Call rows in chunks or in a worker.
export function createRectifier(source: PixelSource, corners: Corners, width: number, height: number) {
  if (width < 2 || height < 2 || width > 2400 || height > 2400 || !Number.isInteger(width) || !Number.isInteger(height)
    || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 2 || source.height < 2 || source.width > 3000 || source.height > 3000
    || source.data.length !== source.width * source.height * 4) throw new Error('Invalid processing image dimensions.')
  const { inverse } = rectificationHomographies(corners)
  const [a, b, c, d, e, f, g, h, i] = inverse
  const pixels = source.data
  const data = new Uint8ClampedArray(width * height * 4)
  return {
    data,
    renderRows(start: number, end: number) {
      for (let y = start; y < Math.min(end, height); y++) {
        for (let x = 0; x < width; x++) {
          const u = x / (width - 1), v = y / (height - 1)
          const denominator = g * u + h * v + i
          if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) throw new Error('The selected perspective is too extreme.')
          const px = (a * u + b * v + c) / denominator, py = (d * u + e * v + f) / denominator
          if (!Number.isFinite(px) || !Number.isFinite(py) || px < -1e-6 || px > 1 + 1e-6 || py < -1e-6 || py > 1 + 1e-6) throw new Error('The perspective maps outside the original image. Adjust the corners.')
          const sx = Math.max(0, Math.min(1, px)) * (source.width - 1)
          const sy = Math.max(0, Math.min(1, py)) * (source.height - 1)
          const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0
          const x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1)
          const i00 = (y0 * source.width + x0) * 4, i10 = (y0 * source.width + x1) * 4
          const i01 = (y1 * source.width + x0) * 4, i11 = (y1 * source.width + x1) * 4
          const target = (y * width + x) * 4
          // Interpolate premultiplied colors, then composite transparency on white.
          const a00 = pixels[i00 + 3] / 255 * (1 - dx) * (1 - dy), a10 = pixels[i10 + 3] / 255 * dx * (1 - dy)
          const a01 = pixels[i01 + 3] / 255 * (1 - dx) * dy, a11 = pixels[i11 + 3] / 255 * dx * dy
          const white = 255 * (1 - a00 - a10 - a01 - a11)
          for (let channel = 0; channel < 3; channel++) data[target + channel] = pixels[i00 + channel] * a00 + pixels[i10 + channel] * a10 + pixels[i01 + channel] * a01 + pixels[i11 + channel] * a11 + white
          data[target + 3] = 255
        }
      }
    },
  }
}
