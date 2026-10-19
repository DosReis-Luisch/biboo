import { createRectifier } from './geometry'
import type { Corners } from './correction'

export interface RectifyRequest { pixels: ArrayBuffer; sourceWidth: number; sourceHeight: number; corners: Corners; width: number; height: number }
export type RectifyResponse = { progress: number } | { pixels: ArrayBuffer } | { error: string }
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RectifyRequest>) => void) | null
  postMessage: (message: RectifyResponse, transfer?: Transferable[]) => void
}
scope.onmessage = ({ data: input }) => {
  try {
    const job = createRectifier({ data: new Uint8ClampedArray(input.pixels), width: input.sourceWidth, height: input.sourceHeight }, input.corners, input.width, input.height)
    for (let row = 0; row < input.height; row += 32) {
      job.renderRows(row, row + 32)
      scope.postMessage({ progress: Math.min(1, (row + 32) / input.height) })
    }
    scope.postMessage({ pixels: job.data.buffer }, [job.data.buffer])
  } catch (reason) { scope.postMessage({ error: reason instanceof Error ? reason.message : 'Perspective processing failed.' }) }
}
