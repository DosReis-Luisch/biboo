export type OcrLanguage = 'nld' | 'por'
export const maxOcrWords = 5000
export const ocrLanguages = [{ code: 'nld', label: 'Dutch' }, { code: 'por', label: 'Portuguese' }] as const
export function defaultOcrLanguage(tag: string): OcrLanguage | undefined {
  const language = tag.toLowerCase().split('-')[0]
  return language === 'nl' ? 'nld' : language === 'pt' ? 'por' : undefined
}

export interface PixelBox { x0: number; y0: number; x1: number; y1: number }
// Top-left origin, x rightwards, y downwards, edges in [0,1]. No rotation.
export interface NormalizedBox { x: number; y: number; width: number; height: number }
export interface OcrNode { id: string; order: number; text: string; confidence?: number; box?: NormalizedBox }
export interface OcrWord extends OcrNode { blockId: string; lineId: string }
export interface OcrLine extends OcrNode { blockId: string; paragraphOrder: number; wordIds: string[] }
export interface OcrBlock extends OcrNode { lineIds: string[] }
export interface OcrResult {
  text: string; confidence?: number; language: OcrLanguage; width: number; height: number
  blocks: OcrBlock[]; lines: OcrLine[]; words: OcrWord[]; unavailableWordBoxes: number
}

// Narrow structural input: mapping tests need no worker, WASM, or engine import.
interface EngineNode { text?: string | null; confidence?: number | null; bbox?: PixelBox }
interface EngineLine extends EngineNode { words?: EngineNode[] }
interface EngineBlock extends EngineNode { paragraphs?: { lines?: EngineLine[] }[] }
export interface EnginePage extends EngineNode { blocks?: EngineBlock[] | null }

export const normalizeText = (text: unknown) => typeof text === 'string' ? text.replace(/\r\n?/g, '\n').replace(/\0/g, '') : ''
const confidence = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
function checkDimensions(width: number, height: number) {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)) throw new Error('OCR image dimensions must be positive whole pixels.')
}
export function normalizeBox(box: PixelBox | undefined, width: number, height: number): NormalizedBox | undefined {
  checkDimensions(width, height)
  if (!box || ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) || box.x1 <= box.x0 || box.y1 <= box.y0) return
  const x0 = Math.max(0, Math.min(width, box.x0)), y0 = Math.max(0, Math.min(height, box.y0))
  const x1 = Math.max(0, Math.min(width, box.x1)), y1 = Math.max(0, Math.min(height, box.y1))
  if (x1 <= x0 || y1 <= y0) return
  return { x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height }
}

export function mapOcrResult(page: EnginePage, width: number, height: number, language: OcrLanguage): OcrResult {
  checkDimensions(width, height)
  if (!Array.isArray(page.blocks)) throw new Error('OCR did not return structured blocks. Run recognition again with structured output enabled.')
  const result: OcrResult = { text: normalizeText(page.text), confidence: confidence(page.confidence), language, width, height, blocks: [], lines: [], words: [], unavailableWordBoxes: 0 }
  const node = (raw: EngineNode, id: string, order: number): OcrNode => ({ id, order, text: normalizeText(raw.text), confidence: confidence(raw.confidence), box: normalizeBox(raw.bbox, width, height) })
  // Preserve engine reading order; geometric sorting would scramble columns.
  for (const rawBlock of page.blocks) {
    const block: OcrBlock = { ...node(rawBlock, `block-${result.blocks.length + 1}`, result.blocks.length + 1), lineIds: [] }
    result.blocks.push(block)
    for (const [paragraphIndex, paragraph] of (rawBlock.paragraphs ?? []).entries()) {
      for (const rawLine of paragraph.lines ?? []) {
        const line: OcrLine = { ...node(rawLine, `line-${result.lines.length + 1}`, result.lines.length + 1), blockId: block.id, paragraphOrder: paragraphIndex + 1, wordIds: [] }
        result.lines.push(line)
        block.lineIds.push(line.id)
        for (const rawWord of rawLine.words ?? []) {
          if (result.words.length >= maxOcrWords) throw new Error('This page exceeds the 5000-word OCR proof-of-concept limit. Use a smaller page selection.')
          const word: OcrWord = { ...node(rawWord, `word-${result.words.length + 1}`, result.words.length + 1), blockId: block.id, lineId: line.id }
          if (!word.box) result.unavailableWordBoxes++
          result.words.push(word)
          line.wordIds.push(word.id)
        }
      }
    }
  }
  return result
}
