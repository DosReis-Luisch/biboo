import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useBlocker, useNavigate, useOutletContext, useParams } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ShellContext } from '../../App'
import type { Book } from '../books/book'
import { bookRepository } from '../books/bookRepository'
import { PageImage } from '../pages/PageImage'
import { pageError, preparePageImage } from '../pages/imageImport'
import { pageRepository } from '../pages/pageRepository'
import { pageRoleLabels, type BookPage, type PageRole } from '../pages/page'
import { cameraCapture, cameraError, requestCamera, stopStream } from './camera'
import { CaptureSession, type CaptureStage } from './captureSession'

export function ScannerPage() {
  const { bookId } = useParams()
  return bookId ? <Scanner key={bookId} bookId={bookId} /> : <Alert severity="error">No book was selected.</Alert>
}

function Scanner({ bookId }: { bookId: string }) {
  const navigate = useNavigate()
  const { setEditing } = useOutletContext<ShellContext>()
  const [book, setBook] = useState<Book>()
  const [loadError, setLoadError] = useState('')
  const [camera, setCamera] = useState<'idle' | 'starting' | 'active' | 'paused'>('idle')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [stage, setStage] = useState<CaptureStage>('capturing')
  const [role, setRole] = useState<PageRole>('interior')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quality, setQuality] = useState('')
  const [recent, setRecent] = useState<BookPage[]>([])
  const [savedCount, setSavedCount] = useState(0)
  const [viewing, setViewing] = useState<BookPage>()
  const [deleting, setDeleting] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const locked = useRef(false)
  const starting = useRef(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const release = useRef<(() => void) | undefined>(undefined)
  const capture = useRef<ReturnType<typeof cameraCapture> | undefined>(undefined)
  const savedIds = useRef(new Set<string>())
  const allowLeave = useRef(false)
  const [session] = useState(() => new CaptureSession(preparePageImage, (image, pageRole, id) => pageRepository.add(bookId, image, pageRole, id)))
  const blocker = useBlocker(() => !allowLeave.current && (locked.current || session.hasPending))

  const stopCamera = useCallback(() => {
    controller.current?.abort()
    release.current?.()
    release.current = undefined
    capture.current = undefined
    if (video.current) { video.current.pause(); video.current.srcObject = null }
  }, [])

  useEffect(() => {
    mounted.current = true
    void bookRepository.get(bookId).then((value) => {
      if (!mounted.current) return
      if (value) setBook(value)
      else setLoadError('This book no longer exists. Return to the library.')
    }).catch((reason) => { if (mounted.current) setLoadError(pageError(reason)) })
    const suspend = () => {
      stopCamera()
      if (mounted.current) {
        setReady(false); setCamera('paused')
        setNotice('Camera paused. Saved pages are safe. Resume the camera when you return.')
      }
    }
    const visibility = () => { if (document.hidden) suspend() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', suspend)
    return () => {
      mounted.current = false
      stopCamera()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', suspend)
    }
  }, [bookId, stopCamera])

  useEffect(() => {
    const protect = busy || pending
    setEditing(protect)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (protect) window.addEventListener('beforeunload', beforeUnload)
    return () => { setEditing(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [busy, pending, setEditing])

  async function startCamera() {
    if (starting.current || locked.current || document.hidden) return
    stopCamera()
    starting.current = true
    const attempt = new AbortController()
    controller.current = attempt
    setCamera('starting'); setReady(false); setError(''); setNotice('')
    try {
      const stream = await requestCamera(attempt.signal)
      // Permission may have been granted after this screen was left or hidden.
      if (!mounted.current || attempt.signal.aborted || document.hidden || !video.current) { stopStream(stream); return }
      const track = stream.getVideoTracks()[0]
      if (!track) { stopStream(stream); throw new Error('The camera returned no video track.') }
      const interrupted = () => {
        stopCamera()
        if (mounted.current) { setReady(false); setCamera('paused'); setError('The camera stopped. Saved pages are safe. Resume the camera to continue.') }
      }
      const mute = () => { if (mounted.current) setReady(false) }
      const unmute = () => { if (mounted.current && !document.hidden) setReady(!!video.current?.videoWidth) }
      track.addEventListener('ended', interrupted)
      track.addEventListener('mute', mute)
      track.addEventListener('unmute', unmute)
      release.current = () => {
        track.removeEventListener('ended', interrupted)
        track.removeEventListener('mute', mute)
        track.removeEventListener('unmute', unmute)
        stopStream(stream)
      }
      video.current.srcObject = stream
      capture.current = cameraCapture(video.current, stream)
      await video.current.play()
      if (!mounted.current || attempt.signal.aborted) return
      setCamera('active'); setReady(video.current.readyState >= 2 && !track.muted)
    } catch (reason) {
      if (mounted.current && !attempt.signal.aborted) {
        stopCamera(); setCamera('paused'); setReady(false); setError(cameraError(reason))
      }
    } finally {
      starting.current = false
    }
  }

  async function saveCapture(takePhoto?: () => Promise<File>) {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(''); setNotice('')
    const progress = (value: CaptureStage) => { if (mounted.current) setStage(value) }
    try {
      const page = takePhoto ? await session.capture(takePhoto, role, progress) : await session.retry(progress)
      if (!mounted.current) return
      savedIds.current.add(page.id)
      setSavedCount(savedIds.current.size)
      setRecent((pages) => [page, ...pages.filter((item) => item.id !== page.id)].slice(0, 6))
      setNotice(`Saved page ${page.readingOrder}: ${page.widthPx} × ${page.heightPx} pixels.`)
    } catch (reason) {
      if (mounted.current) setError(`${pageError(reason)} Previously saved pages are safe.`)
    } finally {
      locked.current = false
      if (mounted.current) { setBusy(false); setPending(session.hasPending) }
    }
  }

  function shutter() {
    const take = capture.current
    if (!take || !ready || pending || locked.current) return
    void saveCapture(async () => {
      const result = await take()
      if (mounted.current) setQuality(result.method === 'photo' ? 'Last capture: native still photograph. Original camera bytes preserved.' : 'Last capture: video-frame JPEG at native stream resolution. This may be smaller than a photograph from the phone’s Camera app.')
      return result.file
    })
  }

  function singlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file && !pending && !locked.current) {
      setQuality('Last capture: original file from the system camera or photo picker.')
      void saveCapture(() => Promise.resolve(file))
    }
  }

  function discard() {
    session.discard(); setPending(false); setDiscarding(false); setError('')
    setNotice('Unsaved photograph discarded. Previously saved pages remain in the book.')
  }

  function leave() {
    if (locked.current) return
    if (session.hasPending) session.discard()
    allowLeave.current = true; stopCamera(); setEditing(false)
    if (blocker.state === 'blocked') blocker.proceed()
    else void navigate(`/books/${bookId}`)
  }

  async function deleteCapture() {
    if (!viewing || locked.current) return
    locked.current = true; setBusy(true); setError('')
    try {
      await pageRepository.delete(bookId, viewing.id)
      if (!mounted.current) return
      savedIds.current.delete(viewing.id); setSavedCount(savedIds.current.size)
      setRecent((pages) => pages.filter((page) => page.id !== viewing.id))
      setViewing(undefined); setDeleting(false); setNotice('Saved capture deleted. Other pages remain saved.')
    } catch (reason) { if (mounted.current) { setError(pageError(reason)); setDeleting(false) } }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }

  if (loadError) return <Stack spacing={2}><Alert severity="error">{loadError}</Alert><Button onClick={() => { void navigate('/') }}>Return to library</Button></Stack>
  if (!book) return <Typography role="status">Opening book…</Typography>
  return <Stack spacing={2}>
    <Typography variant="h1">Scan book</Typography>
    <Typography>{book.title} · {savedCount} page(s) saved this session</Typography>
    <Typography variant="body2" color="text.secondary">Photograph pages in reading order. Each photo saves immediately on this device. Finish or exit keeps saved pages. Nothing is uploaded.</Typography>
    <Box sx={{ bgcolor: '#172025', borderRadius: 2, overflow: 'hidden' }}>
      <Box component="video" ref={video} muted autoPlay playsInline aria-label="Live book page camera preview"
        onCanPlay={() => { if (capture.current && !document.hidden) setReady(true) }}
        onError={() => { stopCamera(); setReady(false); setCamera('paused'); setError('Camera playback failed. Resume the camera or take a single photo.') }}
        sx={{ display: 'block', width: '100%', maxHeight: { xs: '42svh', sm: '58svh' }, minHeight: 180, objectFit: 'contain' }} />
    </Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <Button variant="contained" size="large" disabled={busy || pending || !ready || camera !== 'active'} onClick={shutter} sx={{ minHeight: 64, flex: 1 }}>Capture page</Button>
      <Button variant="outlined" disabled={busy || camera === 'starting'} onClick={() => { void startCamera() }}>{camera === 'starting' ? 'Starting camera…' : camera === 'idle' ? 'Start camera' : 'Resume camera'}</Button>
      <Button disabled={busy || camera !== 'active'} onClick={() => { stopCamera(); setReady(false); setCamera('paused'); setNotice('Camera paused. Resume when ready.') }}>Pause camera</Button>
    </Stack>
    {camera === 'active' && !ready && <Alert severity="info">Waiting for a usable camera frame. If the feed stays interrupted, pause and resume the camera.</Alert>}
    <Typography variant="caption" color="text.secondary">Keep the whole page visible and steady. There is no automatic cropping or edge detection. Capture quality depends on this browser and camera; review the saved pixels before scanning a whole book.</Typography>
    {quality && <Typography variant="body2" color="text.secondary">{quality}</Typography>}
    <TextField select label="Page type for next capture" value={role} disabled={busy || pending} onChange={(event) => setRole(event.target.value as PageRole)} sx={{ maxWidth: 300 }}>
      {(Object.keys(pageRoleLabels) as PageRole[]).map((value) => <MenuItem key={value} value={value}>{pageRoleLabels[value]}</MenuItem>)}
    </TextField>
    <Box aria-live="polite">
      {busy && <Stack spacing={1}><Typography role="status">{deleting ? 'Deleting capture…' : stage === 'capturing' ? 'Capturing photograph…' : stage === 'processing' ? 'Preparing photograph and thumbnail…' : 'Saving page…'}</Typography><LinearProgress aria-label="Capture operation progress" /></Stack>}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="info">{notice}</Alert>}
    </Box>
    {pending && <Stack spacing={1}>
      <Alert severity="warning">One photograph is not saved. Retry saving or discard it before capturing another. Closing the browser can lose this unsaved photograph.</Alert>
      <Stack direction="row" spacing={1}><Button disabled={busy} variant="contained" onClick={() => { void saveCapture() }}>Retry save</Button><Button disabled={busy} color="error" onClick={() => setDiscarding(true)}>Discard unsaved photo</Button></Stack>
    </Stack>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <Button variant="outlined" disabled={busy || pending} onClick={() => { stopCamera(); setReady(false); setCamera('paused'); picker.current?.click() }}>Take single photo</Button>
      <Button disabled={busy} onClick={() => { void navigate(`/books/${bookId}`) }}>Import photos in gallery</Button>
    </Stack>
    <input hidden ref={picker} type="file" accept="image/*" capture="environment" onChange={singlePhoto} aria-label="Take a single book page photograph" />
    <Typography variant="caption" color="text.secondary">Single photo uses the system camera where supported, otherwise a file picker. For multiple existing photos, return to the gallery and choose Import photos.</Typography>
    {recent.length > 0 && <Stack spacing={1}>
      <Typography variant="h2">Recent captures</Typography>
      <Typography variant="body2">Tap a thumbnail to review or delete a saved capture. The six most recent captures are shown here; all pages are in the gallery.</Typography>
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
        {recent.map((page, index) => <Button key={page.id} variant="outlined" disabled={busy} onClick={() => setViewing(page)} aria-label={`Review ${index === 0 ? 'latest capture' : 'saved capture'}: ${page.widthPx} by ${page.heightPx} pixels`} sx={{ flexShrink: 0, width: 120, p: 0.5, '& img': { height: 100 } }}>
          <Stack spacing={0.5} sx={{ width: '100%' }}><PageImage pageId={page.id} alt="Saved capture thumbnail" /><Typography variant="caption">{index === 0 ? 'Latest' : 'Review'} · {page.widthPx} × {page.heightPx}</Typography></Stack>
        </Button>)}
      </Stack>
    </Stack>}
    <Typography variant="caption" color="text.secondary">Browser storage can be cleared or evicted. Export a Biboo backup after scanning important pages.</Typography>
    <Stack direction="row" spacing={1}>
      <Button variant="contained" disabled={busy} onClick={() => { void navigate(`/books/${bookId}`) }}>Finish</Button>
      <Button disabled={busy} onClick={() => { void navigate(`/books/${bookId}`) }}>Exit scanner</Button>
    </Stack>
    <Dialog open={!!viewing} onClose={() => { if (!busy) { setViewing(undefined); setDeleting(false) } }} fullWidth maxWidth="lg" aria-labelledby="capture-review-title">
      <DialogTitle id="capture-review-title">{deleting ? 'Delete saved capture?' : 'Review saved capture'}</DialogTitle>
      <DialogContent>{viewing && <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {deleting ? <Typography>This permanently deletes this saved page and its images. Other saved pages stay in the book.</Typography> : <><PageImage key={viewing.id} pageId={viewing.id} original alt="Full saved photograph" /><Typography>{viewing.widthPx} × {viewing.heightPx} px · {pageRoleLabels[viewing.role ?? 'interior']}</Typography></>}
      </Stack>}</DialogContent>
      <DialogActions>{deleting ? <><Button disabled={busy} onClick={() => setDeleting(false)}>Keep capture</Button><Button color="error" disabled={busy} onClick={() => { void deleteCapture() }}>Delete capture</Button></> : <><Button color="error" disabled={busy} onClick={() => setDeleting(true)}>Delete capture</Button><Button onClick={() => setViewing(undefined)}>Close</Button></>}</DialogActions>
    </Dialog>
    <Dialog open={discarding} onClose={() => setDiscarding(false)} aria-labelledby="discard-capture-title">
      <DialogTitle id="discard-capture-title">Discard unsaved photograph?</DialogTitle><DialogContent>Only the unsaved photograph will be discarded. Saved pages remain in the book.</DialogContent>
      <DialogActions><Button autoFocus onClick={() => setDiscarding(false)}>Keep photograph</Button><Button color="error" onClick={discard}>Discard</Button></DialogActions>
    </Dialog>
    <Dialog open={blocker.state === 'blocked'} onClose={() => { if (blocker.state === 'blocked') blocker.reset() }} aria-labelledby="leave-scanner-title">
      <DialogTitle id="leave-scanner-title">{busy ? 'Wait for the page operation' : pending ? 'Leave an unsaved photograph?' : 'Leave scanner?'}</DialogTitle>
      <DialogContent>{busy ? 'Wait for this operation to finish before leaving.' : pending ? 'Leaving discards the unsaved photograph. Previously saved pages stay in the book.' : 'Saved pages will stay in the book.'}</DialogContent>
      <DialogActions><Button autoFocus onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>Stay here</Button><Button disabled={busy} onClick={leave}>{pending ? 'Discard unsaved and leave' : 'Continue'}</Button></DialogActions>
    </Dialog>
  </Stack>
}
