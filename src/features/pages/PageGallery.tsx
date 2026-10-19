import { useEffect, useRef } from 'react'
import {
  closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded'
import { PageImage } from './PageImage'
import { pageRoleLabels, type BookPage, type GalleryPage } from './page'

type GalleryProps = {
  pages: GalleryPage[]
  disabled: boolean
  onView: (page: BookPage) => void
  onDelete: (page: BookPage) => void
  onCorrect: (page: BookPage) => void
  onRecognize: (page: BookPage) => void
  onMove: (page: BookPage, direction: -1 | 1) => void
  onReorder: (pageIds: string[]) => Promise<void>
  onDraggingChange: (dragging: boolean) => void
}

export function PageGallery({ pages, disabled, onView, onDelete, onCorrect, onRecognize, onMove, onReorder, onDraggingChange }: GalleryProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const suppressActions = useRef(false)
  const clickTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    window.clearTimeout(clickTimer.current)
    onDraggingChange(false)
  }, [onDraggingChange])

  function endInteraction() {
    onDraggingChange(false)
    // Ignore a trailing synthesized touch/click when releasing over a control.
    window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => { suppressActions.current = false }, 350)
  }

  function drop({ active, over }: DragEndEvent) {
    endInteraction()
    if (disabled || !over || active.id === over.id) return
    const from = pages.findIndex((page) => page.id === active.id)
    const to = pages.findIndex((page) => page.id === over.id)
    if (from < 0 || to < 0) return
    // The live query supplies committed order; don't optimistically reorder state.
    void onReorder(arrayMove(pages.map((page) => page.id), from, to))
  }

  const position = (id: UniqueIdentifier) => pages.findIndex((page) => page.id === id) + 1
  return <DndContext sensors={sensors} collisionDetection={closestCenter}
    onDragStart={() => {
      window.clearTimeout(clickTimer.current)
      suppressActions.current = true
      onDraggingChange(true)
    }}
    onDragEnd={drop} onDragCancel={endInteraction}
    accessibility={{
      screenReaderInstructions: {
        draggable: 'To reorder a page, focus its Reorder handle and press Space or Enter. Use the arrow keys to move across the grid. Press Space or Enter to drop, or Escape to cancel.',
      },
      announcements: {
        onDragStart: ({ active }) => `Picked up page ${position(active.id)} of ${pages.length}.`,
        onDragOver: ({ active, over }) => over ? `Page ${position(active.id)} over position ${position(over.id)} of ${pages.length}.` : 'No drop target.',
        onDragEnd: ({ active, over }) => over && active.id !== over.id ? `Dropped at position ${position(over.id)}. Saving page order.` : 'Page order unchanged.',
        onDragCancel: () => 'Reordering canceled. Saved page order is unchanged.',
      },
    }}>
    <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        {pages.map((page, index) => <SortablePageCard key={page.id} page={page} index={index} count={pages.length} disabled={disabled}
          onView={() => { if (!suppressActions.current) onView(page) }}
          onDelete={() => { if (!suppressActions.current) onDelete(page) }}
          onCorrect={() => { if (!suppressActions.current) onCorrect(page) }}
          onRecognize={() => { if (!suppressActions.current) onRecognize(page) }}
          onMove={(direction) => { if (!suppressActions.current) onMove(page, direction) }} />)}
      </Box>
    </SortableContext>
  </DndContext>
}

function SortablePageCard({ page, index, count, disabled, onView, onDelete, onCorrect, onRecognize, onMove }: {
  page: GalleryPage; index: number; count: number; disabled: boolean
  onView: () => void; onDelete: () => void; onCorrect: () => void; onRecognize: () => void; onMove: (direction: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isSorting, isOver } = useSortable({ id: page.id, disabled })
  const controlsDisabled = disabled || isSorting
  return <Card ref={setNodeRef} variant="outlined"
    style={{ transform: CSS.Transform.toString(transform), transition }}
    sx={{
      display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative',
      zIndex: isDragging ? 2 : 'auto', opacity: isDragging ? 0.9 : 1,
      outline: isDragging || isOver ? '2px solid' : undefined,
      outlineColor: isDragging ? 'primary.main' : 'secondary.main',
      boxShadow: isDragging ? 6 : undefined,
      backgroundColor: isOver && !isDragging ? '#f1f3e9' : 'background.paper',
    }}>
    <CardActionArea disabled={controlsDisabled} onClick={onView} aria-label={`Open page ${index + 1}`} sx={{ height: 'auto', flexShrink: 0 }}>
      <PageImage pageId={page.id} correctionRevision={page.correctionRevision} alt={`Thumbnail of page ${index + 1}${page.correctionRevision ? ', corrected' : ''}`} />
    </CardActionArea>
    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, flexGrow: 1 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="h3">Page {index + 1}</Typography>
        <Button ref={setActivatorNodeRef} {...attributes} {...(controlsDisabled && !isDragging ? {} : listeners)} type="button" size="small"
          disabled={count < 2} aria-disabled={disabled || count < 2 || (isSorting && !isDragging)} aria-label={`Reorder page ${index + 1}`} startIcon={<DragIndicatorRounded />}
          sx={{ touchAction: 'none', userSelect: 'none', cursor: disabled ? 'default' : isDragging ? 'grabbing' : 'grab', flexShrink: 0 }}>
          Reorder
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">{page.role ? pageRoleLabels[page.role] : 'Page'} · {page.widthPx} × {page.heightPx} px</Typography>
      {page.correctionRevision && <Typography variant="caption" color="primary">Correction applied · original preserved</Typography>}
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
        <Button size="small" disabled={controlsDisabled} onClick={onCorrect} aria-label={`Correct page ${index + 1}`}>Correct page</Button>
        <Button size="small" disabled={controlsDisabled} onClick={onRecognize} aria-label={`Recognize text on page ${index + 1}`}>Recognize text</Button>
        <Button size="small" disabled={controlsDisabled || index === 0} onClick={() => onMove(-1)} aria-label={`Move page ${index + 1} earlier`}>Move earlier</Button>
        <Button size="small" disabled={controlsDisabled || index === count - 1} onClick={() => onMove(1)} aria-label={`Move page ${index + 1} later`}>Move later</Button>
        <Button size="small" color="error" disabled={controlsDisabled} onClick={onDelete} aria-label={`Delete page ${index + 1}`}>Delete page</Button>
      </Stack>
    </CardContent>
  </Card>
}
