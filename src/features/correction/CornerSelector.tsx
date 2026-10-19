import { useRef } from 'react'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import { cornerLabels, fromDisplay, toDisplay, type CorrectionDraft, type Corners, type Point } from './correction'

const shortLabels = ['TL', 'TR', 'BR', 'BL']
const imageTransforms = { 0: '', 90: 'matrix(0 1 -1 0 1 0)', 180: 'matrix(-1 0 0 -1 1 1)', 270: 'matrix(0 -1 1 0 0 1)' }
const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function CornerSelector({ draft, imageUrl, width, height, disabled, onChange }: {
  draft: CorrectionDraft; imageUrl: string; width: number; height: number; disabled: boolean; onChange: (draft: CorrectionDraft) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const rotated = draft.rotation === 90 || draft.rotation === 270
  const aspect = rotated ? height / width : width / height
  const displayPoints = draft.corners.map((point) => toDisplay(point, draft.rotation))
  function move(index: number, displayed: Point) {
    const corners = draft.corners.map((point, i) => i === index ? fromDisplay({ x: clamp(displayed.x), y: clamp(displayed.y) }, draft.rotation) : point) as Corners
    onChange({ ...draft, corners })
  }
  return <Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Drag the labeled corners to the paper edges. Focus a handle and use arrow keys for fine adjustments (Shift for smaller steps). Scroll from outside the handles.</Typography>
    <Box sx={{ p: 3, backgroundColor: '#e9ede5', borderRadius: 2 }}>
      <Box ref={stage} sx={{ position: 'relative', width: '100%', maxWidth: `calc(65svh * ${aspect})`, mx: 'auto', aspectRatio: aspect }}>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Original photograph with selected paper outline" role="img" style={{ display: 'block', width: '100%', height: '100%', position: 'absolute', pointerEvents: 'none' }}>
          <image href={imageUrl} width="1" height="1" preserveAspectRatio="none" transform={imageTransforms[draft.rotation]} />
          <polygon points={displayPoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="rgba(40,89,77,0.12)" stroke="#e6ad3c" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
        {displayPoints.map((point, index) => <ButtonBase key={index} disabled={disabled}
          aria-label={`${cornerLabels[index]} corner, ${Math.round(point.x * 100)}% across, ${Math.round(point.y * 100)}% down`}
          title={cornerLabels[index]}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
            const rectangle = stage.current?.getBoundingClientRect()
            if (rectangle?.width && rectangle.height) move(index, { x: (event.clientX - rectangle.left) / rectangle.width, y: (event.clientY - rectangle.top) / rectangle.height })
          }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            const step = event.shiftKey ? 0.001 : 0.005
            move(index, { x: point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) })
          }}
          sx={{ position: 'absolute', left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: 'translate(-50%, -50%)', width: 44, height: 44, borderRadius: '50%', border: '2px solid #fff', color: '#fff', bgcolor: 'primary.main', boxShadow: 2, fontWeight: 700, fontSize: 12, touchAction: 'none', userSelect: 'none', '&.Mui-focusVisible': { outline: '3px solid #e6ad3c', outlineOffset: 2 } }}>
          {shortLabels[index]}
        </ButtonBase>)}
      </Box>
    </Box>
    <Typography variant="caption" color="text.secondary">TL: Top-left · TR: Top-right · BR: Bottom-right · BL: Bottom-left. Labels describe the corrected page, after rotation.</Typography>
  </Box>
}
