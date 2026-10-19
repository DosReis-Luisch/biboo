import { describe, expect, it } from 'vitest'
import { defaultOcrLanguage, mapOcrResult, maxOcrWords, normalizeBox, normalizeText, type EnginePage } from '../src/features/ocr/ocr'

const word = (text: string, x0 = 10) => ({ text, confidence: 92.5, bbox: { x0, y0: 20, x1: x0 + 30, y1: 40 } })
const fixture = (): EnginePage => ({
  text: 'Hallo wereld\r\nOlá!\n', confidence: 87,
  blocks: [
    { text: 'Hallo wereld', confidence: 91, bbox: { x0: 0, y0: 0, x1: 200, y1: 50 }, paragraphs: [
      { lines: [{ text: 'Hallo wereld', confidence: 90, bbox: { x0: 10, y0: 20, x1: 120, y1: 40 }, words: [word('Hallo', 80), word('wereld', 10)] }] },
    ] },
    { text: 'Olá!', paragraphs: [{ lines: [{ text: 'Olá!', words: [word('Olá!')] }] }] },
  ],
})

describe('OCR language selection and text normalization', () => {
  it.each([['nl-NL', 'nld'], ['pt-PT', 'por'], ['NL-be', 'nld'], ['pt-BR', 'por'], ['en-GB', undefined], ['', undefined]])('maps %s explicitly to %s', (tag, expected) => {
    expect(defaultOcrLanguage(tag!)).toBe(expected)
  })
  it('normalizes line endings and NULs while preserving accents, spacing and full text', () => {
    expect(normalizeText('  Olá\r\nwereld\r\0\n')).toBe('  Olá\nwereld\n\n')
    expect(normalizeText(null)).toBe('')
  })
})

describe('coordinates on the exact recognition image', () => {
  it('normalizes full-image edges and known pixel boxes', () => {
    expect(normalizeBox({ x0: 0, y0: 0, x1: 400, y1: 200 }, 400, 200)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(normalizeBox({ x0: 100, y0: 20, x1: 200, y1: 60 }, 400, 200)).toEqual({ x: 0.25, y: 0.1, width: 0.25, height: 0.2 })
  })
  it('has the same normalized box after uniform image scaling', () => {
    expect(normalizeBox({ x0: 10, y0: 20, x1: 40, y1: 60 }, 200, 100))
      .toEqual(normalizeBox({ x0: 100, y0: 200, x1: 400, y1: 600 }, 2000, 1000))
  })
  it('clips slight engine edge overshoot to the image', () => {
    expect(normalizeBox({ x0: -1, y0: -2, x1: 201, y1: 101 }, 200, 100)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
  it.each([
    { x0: 20, y0: 10, x1: 10, y1: 20 }, { x0: 0, y0: 0, x1: 0, y1: 20 },
    { x0: 0, y0: NaN, x1: 10, y1: 20 }, { x0: 0, y0: 0, x1: Infinity, y1: 20 },
    { x0: -20, y0: 0, x1: -1, y1: 20 },
  ])('omits invalid or wholly outside boxes: %j', (box) => {
    expect(normalizeBox(box, 200, 100)).toBeUndefined()
  })
  it.each([[0, 100], [100, -1], [NaN, 100], [100.5, 200]])('rejects invalid recognition dimensions %s x %s', (width, height) => {
    expect(() => mapOcrResult(fixture(), width, height, 'nld')).toThrow(/dimensions/)
  })
})

describe('structured OCR mapping', () => {
  it('retains text, confidence, hierarchy and engine reading order without mutating input', () => {
    const raw = fixture(), before = structuredClone(raw)
    const result = mapOcrResult(raw, 200, 100, 'nld')
    expect(result.text).toBe('Hallo wereld\nOlá!\n')
    expect(result).toMatchObject({ language: 'nld', width: 200, height: 100, confidence: 87, unavailableWordBoxes: 0 })
    expect(result.words.map((item) => item.text)).toEqual(['Hallo', 'wereld', 'Olá!'])
    // Deliberately right-to-left x positions prove no accidental geometric sort.
    expect(result.words.map((item) => item.order)).toEqual([1, 2, 3])
    expect(result.blocks.map((item) => item.lineIds)).toEqual([['line-1'], ['line-2']])
    expect(result.lines[0]).toMatchObject({ id: 'line-1', blockId: 'block-1', paragraphOrder: 1, wordIds: ['word-1', 'word-2'], text: 'Hallo wereld', confidence: 90 })
    expect(result.words[0]).toEqual({ id: 'word-1', order: 1, blockId: 'block-1', lineId: 'line-1', text: 'Hallo', confidence: 92.5, box: { x: 0.4, y: 0.2, width: 0.15, height: 0.2 } })
    expect(result.words[2].blockId).toBe('block-2')
    expect(raw).toEqual(before)
  })
  it('retains words even if boxes or confidences are unavailable', () => {
    const result = mapOcrResult({ text: 'word', confidence: NaN, blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'word', confidence: -1, bbox: { x0: 0, y0: 0, x1: 0, y1: 0 } }] }] }] }] }, 200, 100, 'por')
    expect(result.confidence).toBeUndefined()
    expect(result.words[0]).toMatchObject({ text: 'word', confidence: undefined, box: undefined })
    expect(result.unavailableWordBoxes).toBe(1)
  })
  it('distinguishes a blank page from missing structured output', () => {
    expect(mapOcrResult({ text: '', blocks: [] }, 200, 100, 'por').words).toEqual([])
    expect(() => mapOcrResult({ text: 'words', blocks: null }, 200, 100, 'por')).toThrow(/structured/)
  })
  it('bounds the number of mapped words', () => {
    const page: EnginePage = { blocks: [{ paragraphs: [{ lines: [{ words: Array.from({ length: maxOcrWords }, () => word('x')) }] }] }] }
    expect(mapOcrResult(page, 200, 100, 'nld').words).toHaveLength(maxOcrWords)
    page.blocks![0].paragraphs![0].lines![0].words!.push(word('extra'))
    expect(() => mapOcrResult(page, 200, 100, 'nld')).toThrow(/5000-word/)
  })
})
