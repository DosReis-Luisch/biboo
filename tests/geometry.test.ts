import { describe, expect, it } from 'vitest'
import { defaultCorners, fromDisplay, rotateDraft, toDisplay, type Corners, type Point, type Rotation } from '../src/features/correction/correction'
import { createRectifier, invertHomography, outputDimensions, project, rectificationHomographies, solveHomography, validateCorners, type Homography } from '../src/features/correction/geometry'

const skew: Corners = [{ x: 0.15, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.8, y: 0.95 }, { x: 0.05, y: 0.8 }]
const closePoint = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 10)
  expect(actual.y).toBeCloseTo(expected.y, 10)
}
const pixelSource = () => ({ width: 2, height: 2, data: new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255,
  255, 255, 255, 255, 0, 0, 255, 255,
]) })

describe('projective geometry', () => {
  it('solves the identity and inverts it without moving points', () => {
    const h = solveHomography(defaultCorners(), defaultCorners())
    const expected = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    h.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12))
    for (const p of [...defaultCorners(), { x: 0.37, y: 0.61 }]) {
      closePoint(project(h, p.x, p.y), p)
      closePoint(project(invertHomography(h), p.x, p.y), p)
    }
  })

  it('maps a known trapezoid using independently calculated interior coordinates', () => {
    const trapezoid: Corners = [{ x: 0.2, y: 0 }, { x: 0.8, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const { forward, inverse } = rectificationHomographies(trapezoid)
    // x=(0.6u-0.2v+0.2)/(1-0.4v), y=0.6v/(1-0.4v).
    closePoint(project(inverse, 0.5, 0.5), { x: 0.5, y: 0.375 })
    closePoint(project(inverse, 0.25, 0.5), { x: 0.3125, y: 0.375 })
    closePoint(project(forward, 0.3125, 0.375), { x: 0.25, y: 0.5 })
  })

  it('maps all skewed corners and round-trips a deterministic interior grid', () => {
    const { forward, inverse } = rectificationHomographies(skew)
    defaultCorners().forEach((p, i) => {
      closePoint(project(inverse, p.x, p.y), skew[i])
      closePoint(project(forward, skew[i].x, skew[i].y), p)
    })
    for (const x of [0, 0.17, 0.5, 0.83, 1]) for (const y of [0, 0.23, 0.5, 0.79, 1]) {
      const source = project(inverse, x, y)
      closePoint(project(forward, source.x, source.y), { x, y })
      const destination = project(forward, x, y)
      closePoint(project(inverse, destination.x, destination.y), { x, y })
    }
  })

  const invalid: [string, Corners][] = [
    ['outside', [{ x: -0.01, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
    ['nonfinite', [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
    ['infinite', [{ x: 0, y: Infinity }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
    ['duplicate', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
    ['bow tie', [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]],
    ['concave', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 1 }]],
    ['reversed', [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }]],
    ['collinear', [{ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 }, { x: 1, y: 1 }]],
    ['short edge', [{ x: 0, y: 0 }, { x: 0.009, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
    ['tiny area', [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 0.05 }, { x: 0, y: 0.05 }]],
  ]
  it.each(invalid)('rejects %s selections before rectification', (_name, corners) => {
    expect(() => validateCorners(corners)).toThrow()
    expect(() => rectificationHomographies(corners)).toThrow()
  })

  it('rejects singular systems, singular inverses, and vanishing projective denominators', () => {
    expect(() => validateCorners(defaultCorners().slice(0, 3) as Corners)).toThrow()
    const collapsed: Corners = Array.from({ length: 4 }, () => ({ x: 0, y: 0 })) as Corners
    expect(() => solveHomography(collapsed, defaultCorners())).toThrow(/unstable/)
    expect(() => invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(/inverted/)
    for (const denominator of [0, 1e-10, Infinity, NaN]) {
      const h: Homography = [1, 0, 0, 0, 1, 0, 0, 0, denominator]
      expect(() => project(h, 0.5, 0.5)).toThrow(/extreme/)
    }
  })
})

describe('rotation and physical dimensions', () => {
  it.each([0, 90, 180, 270] as Rotation[])('maps display coordinates and back at %i degrees', (rotation) => {
    const point = { x: 0.2, y: 0.7 }
    const expected = { 0: point, 90: { x: 0.3, y: 0.2 }, 180: { x: 0.8, y: 0.3 }, 270: { x: 0.7, y: 0.8 } }
    closePoint(toDisplay(point, rotation), expected[rotation])
    for (const p of [...skew, point, ...defaultCorners()]) {
      const display = toDisplay(p, rotation)
      closePoint(fromDisplay(display, rotation), p)
      closePoint(toDisplay(fromDisplay(p, rotation), rotation), p)
    }
  })

  it.each([true, false])('rotates corner identities and returns after four turns (clockwise=%s)', (clockwise) => {
    const initial = { corners: structuredClone(skew), rotation: 0 as Rotation }
    const copy = structuredClone(initial)
    let draft = rotateDraft(initial, clockwise)
    expect(draft.corners).toEqual(clockwise ? [skew[3], skew[0], skew[1], skew[2]] : [skew[1], skew[2], skew[3], skew[0]])
    expect(draft.rotation).toBe(clockwise ? 90 : 270)
    expect(rotateDraft(draft, !clockwise)).toEqual(initial)
    for (let i = 1; i < 4; i++) draft = rotateDraft(draft, clockwise)
    expect(draft).toEqual(initial)
    expect(initial).toEqual(copy)
  })

  it('returns independent default corners', () => {
    const first = defaultCorners()
    first[0].x = 0.5
    expect(defaultCorners()[0]).toEqual({ x: 0, y: 0 })
  })

  it.each([[210, 297, 1697, 2400], [297, 210, 2400, 1697], [180, 180, 2400, 2400], [280, 210, 2400, 1800], [123.4, 187.9, 1576, 2400]])('sizes %s x %s mm using the physical ratio', (w, h, width, height) => {
    const result = outputDimensions(w, h)
    expect(result).toEqual({ width, height })
    const scale = 2400 / Math.max(w, h)
    expect(Math.abs(result.width - w * scale)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(result.height - h * scale)).toBeLessThanOrEqual(0.5)
  })

  it.each([[0, 100], [100, -1], [2001, 100], [NaN, 100], [100, Infinity], [1, 2000], [2000, 1]])('rejects invalid or unrenderably narrow dimensions %s x %s', (w, h) => {
    expect(() => outputDimensions(w, h)).toThrow()
  })
})

describe('small deterministic RGBA interpolation', () => {
  it('preserves all four opaque pixels under identity sampling', () => {
    const source = pixelSource()
    const output = createRectifier(source, defaultCorners(), 2, 2)
    output.renderRows(0, 2)
    expect(output.data).toEqual(source.data)
  })

  it('samples exact corners, edge midpoints and the bilinear center', () => {
    const output = createRectifier(pixelSource(), defaultCorners(), 3, 3)
    output.renderRows(0, 3)
    const pixel = (x: number, y: number) => [...output.data.slice((y * 3 + x) * 4, (y * 3 + x + 1) * 4)]
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(2, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(0, 2)).toEqual([255, 255, 255, 255])
    expect(pixel(2, 2)).toEqual([0, 0, 255, 255])
    expect(pixel(1, 0)).toEqual([128, 128, 0, 255])
    expect(pixel(2, 1)).toEqual([0, 128, 128, 255])
    expect(pixel(1, 1)).toEqual([128, 128, 128, 255])
  })

  it('rotates clockwise once without mirroring or changing source bytes', () => {
    const source = pixelSource()
    const before = source.data.slice()
    const { corners } = rotateDraft({ corners: defaultCorners(), rotation: 0 }, true)
    const output = createRectifier(source, corners, 2, 2)
    output.renderRows(0, 2)
    expect([...output.data]).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255])
    expect(source.data).toEqual(before)
  })

  it('premultiplies alpha and composites on white without dark fringes', () => {
    const source = { width: 2, height: 2, data: new Uint8ClampedArray([
      255, 0, 0, 128, 0, 0, 255, 0,
      0, 255, 0, 0, 0, 0, 0, 0,
    ]) }
    const output = createRectifier(source, defaultCorners(), 3, 3)
    output.renderRows(0, 3)
    expect([...output.data.slice(0, 4)]).toEqual([255, 127, 127, 255])
    expect([...output.data.slice(4, 8)]).toEqual([255, 191, 191, 255])
    expect([...output.data.slice(8, 12)]).toEqual([255, 255, 255, 255])
    expect([...output.data.slice(16, 20)]).toEqual([255, 223, 223, 255])
  })

  it('renders row chunks identically and clamps the final row range', () => {
    const full = createRectifier(pixelSource(), skew, 5, 4)
    const chunks = createRectifier(pixelSource(), skew, 5, 4)
    full.renderRows(0, 4)
    chunks.renderRows(0, 1)
    chunks.renderRows(1, 3)
    chunks.renderRows(3, 20)
    expect(chunks.data).toEqual(full.data)
  })

  it('rejects invalid image buffers and processing dimensions', () => {
    expect(() => createRectifier({ ...pixelSource(), data: new Uint8ClampedArray(15) }, defaultCorners(), 2, 2)).toThrow(/dimensions/)
    for (const width of [1, 2.5, 2401]) expect(() => createRectifier(pixelSource(), defaultCorners(), width, 2)).toThrow(/dimensions/)
    for (const width of [1, 2.5, 3001]) expect(() => createRectifier({ ...pixelSource(), width }, defaultCorners(), 2, 2)).toThrow(/dimensions/)
  })
})
