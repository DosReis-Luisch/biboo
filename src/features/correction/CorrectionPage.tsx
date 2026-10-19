import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useOutletContext, useParams } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ShellContext } from '../../App'
import { pageError } from '../pages/imageImport'
import { CornerSelector } from './CornerSelector'
import { defaultCorners, rotateDraft, type CorrectionDraft, type CorrectionResult } from './correction'
import { correctionRepository, draftKey, type CorrectionDocument } from './correctionRepository'
import { validateCorners } from './geometry'
import { processCorrection } from './processImage'

type Loaded = { document: CorrectionDocument; image: HTMLImageElement; url: string }

export function CorrectionPage() {
  const { bookId = '', pageId = '' } = useParams()
  return <LoadCorrection key={`${bookId}/${pageId}`} bookId={bookId} pageId={pageId} />
}

function LoadCorrection({ bookId, pageId }: { bookId: string; pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let url: string | undefined
    const image = new Image()
    image.decoding = 'async'
    void (async () => {
      const document = await correctionRepository.load(bookId, pageId)
      if (!active) return
      url = URL.createObjectURL(document.original)
      image.src = url
      try { await image.decode() }
      catch { throw new Error('This browser cannot decode the original photograph. Try a browser that supports its format or import a JPEG/PNG copy.') }
      if (image.naturalWidth < 2 || image.naturalHeight < 2 || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('The original has invalid dimensions or exceeds the 60 megapixel decoding limit.')
      if (active) setLoaded({ document, image, url })
    })().catch((reason: unknown) => {
      image.removeAttribute('src')
      if (url) { URL.revokeObjectURL(url); url = undefined }
      if (active) setError(pageError(reason))
    })
    return () => { active = false; image.removeAttribute('src'); if (url) URL.revokeObjectURL(url) }
  }, [bookId, pageId, attempt])
  if (loaded) return <CorrectionEditor loaded={loaded} />
  return <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
    <Typography variant="h1">Correct page</Typography>
    {error ? <><Alert severity="error">{error}</Alert><Button onClick={() => { setError(''); setAttempt((value) => value + 1) }}>Try again</Button></> : <Box role="status"><CircularProgress size={24} aria-label="Loading original photograph" /><Typography>Opening original photograph…</Typography></Box>}
    <Button component={Link} to={`/books/${bookId}`}>Back to book</Button>
  </Stack>
}

function CorrectionEditor({ loaded: { document, image, url } }: { loaded: Loaded }) {
  const { book, page, settings } = document
  const dimensionsMatch = !settings || (settings.sourceWidthPx === image.naturalWidth && settings.sourceHeightPx === image.naturalHeight)
  const initial: CorrectionDraft = settings && dimensionsMatch ? { corners: settings.corners, rotation: settings.rotation } : { corners: defaultCorners(), rotation: 0 }
  const [draft, setDraft] = useState(initial)
  const [preview, setPreview] = useState<(CorrectionResult & { key: string })>()
  const [previewReady, setPreviewReady] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const [remove, setRemove] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const alive = useRef(false)
  const operation = useRef(false)
  const leaveAllowed = useRef(false)
  const { setEditing } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const busy = processing || saving
  const dirty = draftKey(draft) !== draftKey(initial) || !!preview
  const protectedSession = dirty || busy
  const blocker = useBlocker(() => protectedSession && !leaveAllowed.current)
  let selectionError = ''
  try { validateCorners(draft.corners) } catch (reason) { selectionError = pageError(reason) }

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => {
    setEditing(protectedSession)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (protectedSession) window.addEventListener('beforeunload', beforeUnload)
    return () => { setEditing(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [protectedSession, setEditing])

  function change(next: CorrectionDraft) { setDraft(next); setPreview(undefined); setPreviewReady(false); setError('') }
  function leave() {
    leaveAllowed.current = true
    setEditing(false)
    if (blocker.state === 'blocked') blocker.proceed()
    else void navigate(`/books/${book.id}`)
  }
  function cancel() {
    if (busy) return
    if (dirty) setDiscard(true)
    else leave()
  }
  async function generate() {
    if (operation.current) return
    operation.current = true
    setProcessing(true)
    setProgress(0)
    setError('')
    const task = new AbortController()
    controller.current = task
    try {
      const result = await processCorrection(image, draft, book.widthMm, book.heightMm, task.signal, (value) => { if (alive.current) setProgress(value) })
      if (alive.current) { setPreviewReady(false); setPreview({ ...result, key: draftKey(draft) }) }
    } catch (reason) {
      if (alive.current && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(pageError(reason))
    } finally {
      operation.current = false
      if (alive.current) setProcessing(false)
    }
  }
  async function persist(removeSaved = false) {
    if (operation.current || (!removeSaved && (!previewReady || !preview || preview.key !== draftKey(draft)))) return
    operation.current = true
    setSaving(true)
    setError('')
    try {
      if (removeSaved) await correctionRepository.remove(book.id, page.id, settings?.revision)
      else if (preview) await correctionRepository.save({
        ...draft, pageId: page.id, bookId: book.id,
        sourceWidthPx: image.naturalWidth, sourceHeightPx: image.naturalHeight,
        targetWidthPx: preview.width, targetHeightPx: preview.height,
        widthMm: book.widthMm, heightMm: book.heightMm,
      }, preview, settings?.revision)
      if (alive.current) leave()
    } catch (reason) {
      if (alive.current) { setRemove(false); setError(pageError(reason)) }
    } finally {
      operation.current = false
      if (alive.current) setSaving(false)
    }
  }

  return <Stack spacing={3}>
    <Box><Typography variant="h1">Correct page {page.readingOrder}</Typography><Typography color="text.secondary">{book.title} · target {book.widthMm} × {book.heightMm} mm</Typography></Box>
    <Typography variant="body2">Select the four paper corners in the original photograph, then preview. Saving creates a separate corrected image; your original is preserved.</Typography>
    {!dimensionsMatch && <Alert severity="warning">This browser decoded different original dimensions from the saved correction. The selection starts fresh; the saved correction stays unchanged until you save or remove it.</Alert>}
    {settings && (settings.widthMm !== book.widthMm || settings.heightMm !== book.heightMm) && <Alert severity="warning">The book dimensions changed since this correction was saved. Preview and save to regenerate at the current ratio.</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 3 } }}>
      <Stack spacing={2}>
        <CornerSelector draft={draft} imageUrl={url} width={image.naturalWidth} height={image.naturalHeight} disabled={busy} onChange={change} />
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" disabled={busy} onClick={() => change(rotateDraft(draft, false))}>Rotate 90° left</Button>
          <Button variant="outlined" disabled={busy} onClick={() => change(rotateDraft(draft, true))}>Rotate 90° right</Button>
          <Button disabled={busy} onClick={() => change({ corners: defaultCorners(), rotation: 0 })}>Reset selection</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">Rotation: {draft.rotation}°. The physical book dimensions determine the corrected aspect ratio. Curved paper and incorrect dimensions can still distort the result.</Typography>
        {selectionError && <Alert severity="warning">{selectionError}</Alert>}
        {processing && <Box role="status"><Typography>Correcting image… {progress}%</Typography><LinearProgress variant="determinate" value={progress} aria-label="Perspective correction progress" /><Button onClick={() => controller.current?.abort()}>Stop processing</Button></Box>}
        <Button variant="contained" disabled={busy || !!selectionError} onClick={() => { void generate() }}>Preview correction</Button>
      </Stack>
    </Paper>
    {preview && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2" gutterBottom>Corrected preview</Typography><BlobPreview blob={preview.image} onReady={() => setPreviewReady(true)} onError={() => { setPreviewReady(false); setError('The corrected preview could not be displayed. Try regenerating it or use a smaller original image.') }} /><Typography variant="caption">{preview.width} × {preview.height} pixels. Save to apply this correction.</Typography></Paper>}
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <Button variant="contained" disabled={busy || !previewReady || !preview || preview.key !== draftKey(draft)} onClick={() => { void persist() }}>{saving ? 'Saving…' : 'Save correction'}</Button>
      <Button disabled={busy} onClick={cancel}>Cancel</Button>
      {settings && <Button color="error" disabled={busy} onClick={() => setRemove(true)}>Use original / remove correction</Button>}
    </Stack>
    <Dialog open={remove} onClose={() => { if (!saving) setRemove(false) }} aria-labelledby="remove-correction-title">
      <DialogTitle id="remove-correction-title">Return to the original photograph?</DialogTitle>
      <DialogContent><DialogContentText>This removes the saved correction settings and derived images. Your original photograph and imported thumbnail stay unchanged.</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus disabled={saving} onClick={() => setRemove(false)}>Keep correction</Button><Button color="error" disabled={saving} onClick={() => { void persist(true) }}>Use original</Button></DialogActions>
    </Dialog>
    <Dialog open={discard || blocker.state === 'blocked'} onClose={() => { if (!busy) { setDiscard(false); if (blocker.state === 'blocked') blocker.reset() } }} aria-labelledby="leave-correction-title">
      <DialogTitle id="leave-correction-title">{busy ? 'Correction in progress' : 'Leave the correction editor?'}</DialogTitle>
      <DialogContent><DialogContentText>{busy ? 'Stay here until saving finishes, or return to stop preview processing.' : 'Unsaved corner or rotation changes will be discarded. Previously saved corrections remain unchanged.'}</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus onClick={() => { setDiscard(false); if (blocker.state === 'blocked') blocker.reset() }}>Stay here</Button><Button color="error" disabled={busy} onClick={leave}>Discard and leave</Button></DialogActions>
    </Dialog>
  </Stack>
}

function BlobPreview({ blob, onReady, onError }: { blob: Blob; onReady: () => void; onError: () => void }) {
  const element = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const image = element.current
    const url = URL.createObjectURL(blob)
    if (image) image.src = url
    return () => { image?.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [blob])
  return <Box component="img" ref={element} alt="Corrected page preview" onLoad={onReady} onError={onError} sx={{ display: 'block', maxWidth: '100%', maxHeight: '70svh', mx: 'auto' }} />
}
