import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useBlocker, useNavigate, useOutletContext } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ShellContext } from '../../App'
import { PageImage } from './PageImage'
import { PageGallery } from './PageGallery'
import { ImageImportError, isQuotaError, pageError, preparePageImage } from './imageImport'
import { pageRepository } from './pageRepository'
import { pageRoleLabels, type BookPage, type GalleryPage, type PageRole } from './page'

type ImportProgress = { total: number; completed: number; saved: number; filename: string }
type ImportResult = { saved: number; skipped: number; failures: { filename: string; message: string }[] }
type StorageInfo = { usage?: number; quota?: number }
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`

export function PagesSection({ bookId, onBusyChange }: { bookId: string; onBusyChange: (busy: boolean) => void }) {
  const [retry, setRetry] = useState(0)
  const navigate = useNavigate()
  const result = useLiveQuery(async () => {
    try { return { pages: await pageRepository.listGallery(bookId), error: '' } }
    catch (reason) { return { pages: [] as GalleryPage[], error: pageError(reason) } }
  }, [bookId, retry])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<ImportProgress>()
  const [report, setReport] = useState<ImportResult>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [storage, setStorage] = useState<StorageInfo>()
  const [role, setRole] = useState<PageRole>('interior')
  const [viewing, setViewing] = useState<BookPage>()
  const [deleting, setDeleting] = useState<BookPage>()
  const filesInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const stop = useRef(false)
  const mounted = useRef(false)
  const { setEditing } = useOutletContext<ShellContext>()
  const working = busy || dragging
  const blocker = useBlocker(working)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stop.current = true }
  }, [])

  useEffect(() => {
    onBusyChange(working)
    setEditing(working)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (working) window.addEventListener('beforeunload', beforeUnload)
    return () => {
      onBusyChange(false)
      setEditing(false)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [working, onBusyChange, setEditing])

  useEffect(() => {
    if (busy) return
    let active = true
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then((estimate) => { if (active) setStorage(estimate) }).catch(() => { /* Estimates are optional. */ })
    }
    return () => { active = false }
  }, [busy])

  function begin() {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    return true
  }

  function finish() {
    lock.current = false
    if (mounted.current) { setBusy(false); setProgress(undefined) }
  }

  async function importFiles(files: File[]) {
    if (!files.length || !begin()) return
    stop.current = false
    setReport(undefined)
    const summary: ImportResult = { saved: 0, skipped: 0, failures: [] }
    // Sequential decode/save bounds working memory and keeps selection order.
    try {
      const estimatedFree = storage?.quota !== undefined && storage.usage !== undefined ? storage.quota - storage.usage : undefined
      if (estimatedFree !== undefined && files.reduce((total, file) => total + file.size, 0) > estimatedFree) {
        setNotice('These files may exceed the estimated available storage. Some imports may fail. Saved pages will be kept.')
      }
      for (let index = 0; index < files.length; index++) {
        if (stop.current) { summary.skipped = files.length - index; break }
        const file = files[index]
        if (mounted.current) setProgress({ total: files.length, completed: index, saved: summary.saved, filename: file.name || 'Camera image' })
        try {
          const prepared = await preparePageImage(file)
          if (stop.current) { summary.skipped = files.length - index; break }
          await pageRepository.add(bookId, prepared, role)
          summary.saved++
        } catch (reason) {
          summary.failures.push({ filename: file.name || 'Camera image', message: pageError(reason) })
          if (isQuotaError(reason) || !(reason instanceof ImageImportError)) {
            // Stop on storage/database failures; skip only bad images independently.
            summary.skipped = files.length - index - 1
            break
          }
        }
        if (mounted.current) setProgress({ total: files.length, completed: index + 1, saved: summary.saved, filename: file.name || 'Camera image' })
      }
    } finally {
      if (mounted.current) setReport(summary)
      finish()
    }
  }

  function selected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = '' // Permit retrying the same file selection.
    void importFiles(files)
  }

  async function move(page: BookPage, direction: -1 | 1) {
    if (!begin()) return
    try {
      await pageRepository.move(bookId, page.id, direction)
      if (mounted.current) setNotice(`Page moved ${direction === -1 ? 'earlier' : 'later'}.`)
    } catch (reason) { if (mounted.current) setError(pageError(reason)) }
    finally { finish() }
  }

  async function deletePage() {
    if (!deleting || !begin()) return
    try {
      await pageRepository.delete(bookId, deleting.id)
      if (mounted.current) { setDeleting(undefined); setNotice('Page and its images deleted from this device.') }
    } catch (reason) {
      if (mounted.current) { setDeleting(undefined); setError(pageError(reason)) }
    }
    finally { finish() }
  }

  async function reorder(pageIds: string[]) {
    if (!begin()) return
    setNotice('Saving page order…')
    try {
      await pageRepository.reorder(bookId, pageIds)
      if (mounted.current) setNotice('Page order saved.')
    } catch (reason) {
      if (mounted.current) {
        setNotice('')
        setError(pageError(reason))
        setRetry((value) => value + 1)
      }
    } finally { finish() }
  }

  const pages = result?.pages ?? []
  const viewedPage = pages.find((page) => page.id === viewing?.id)
  const viewingNumber = pages.findIndex((page) => page.id === viewing?.id) + 1
  const deletingNumber = pages.findIndex((page) => page.id === deleting?.id) + 1
  const lowStorage = storage?.quota !== undefined && storage.usage !== undefined && storage.quota - storage.usage < 50 * 1024 * 1024
  const correct = (page: BookPage) => { void navigate(`/books/${bookId}/pages/${page.id}/correct`) }
  const recognize = (page: BookPage) => { void navigate(`/books/${bookId}/pages/${page.id}/ocr`) }
  return <Stack component="section" spacing={2} aria-labelledby="pages-title">
    <Typography variant="h2" id="pages-title">Pages{result && !result.error ? ` (${pages.length})` : ''}</Typography>
    <Typography variant="body2" color="text.secondary">Add photographs in reading order. Originals stay on this device; nothing is uploaded.</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <Button variant="contained" disabled={working || !result || !!result.error} onClick={() => filesInput.current?.click()}>Import pages</Button>
      <Button variant="outlined" disabled={working || !result || !!result.error} onClick={() => cameraInput.current?.click()}>Take a photo</Button>
    </Stack>
    <input hidden ref={filesInput} type="file" accept="image/*" multiple onChange={selected} aria-label="Choose page images" />
    <input hidden ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={selected} aria-label="Take a page photograph" />
    <TextField select label="Page type for next import" value={role} disabled={working} onChange={(event) => setRole(event.target.value as PageRole)} sx={{ maxWidth: 300 }}>
      {(Object.keys(pageRoleLabels) as PageRole[]).map((value) => <MenuItem key={value} value={value}>{pageRoleLabels[value]}</MenuItem>)}
    </TextField>
    <Typography variant="caption" color="text.secondary">JPEG, PNG, and other formats your browser can decode. Up to 50 MiB and 60 megapixels per image. Camera support varies; use Import pages if capture is unavailable.</Typography>
    <Typography variant="caption" color="text.secondary">
      {storage?.usage !== undefined && storage.quota !== undefined ? `Estimated site storage: ${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}. ` : 'Storage estimates are unavailable in this browser. '}
      Browser storage can be cleared or evicted. Keep your original photos elsewhere too.
    </Typography>
    {lowStorage && <Alert severity="warning">Estimated available site storage is below 50 MiB. Free some space before adding large photos.</Alert>}
    <Box aria-live="polite">
      {notice && <Alert severity="info">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {progress && <Stack spacing={1}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Importing {progress.completed + 1 > progress.total ? progress.total : progress.completed + 1} of {progress.total}: {progress.filename} · {progress.saved} saved</Typography>
        <LinearProgress variant="determinate" value={100 * progress.completed / progress.total} aria-label="Import progress" />
        <Button onClick={() => { stop.current = true }} sx={{ alignSelf: 'flex-start' }}>Stop import</Button>
      </Stack>}
      {report && <Stack spacing={1}>
        <Alert severity={report.failures.length || report.skipped ? 'warning' : 'success'}>{report.saved} page(s) saved. {report.failures.length} failed. {report.skipped} not imported. Successful pages remain saved; retry failed or skipped files separately.</Alert>
        {report.failures.map((failure, index) => <Alert severity="error" key={index} sx={{ overflowWrap: 'anywhere' }}>{failure.filename}: {failure.message}</Alert>)}
      </Stack>}
    </Box>
    {!result ? <Typography role="status">Opening pages…</Typography>
      : result.error ? <Alert severity="error" action={<Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>}>{result.error}</Alert>
      : pages.length === 0 ? <Typography color="text.secondary">No pages yet. Import photos or take your first page photograph.</Typography>
      : <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">Drag the Reorder handle to move a page. On touch screens, hold the handle briefly first. With a keyboard, press Space or Enter on the handle, use arrow keys, then press Space or Enter to drop. Escape cancels. Move earlier / Move later also remain available.</Typography>
        <PageGallery pages={pages} disabled={busy || !!viewing || !!deleting} onView={setViewing} onDelete={setDeleting} onCorrect={correct} onRecognize={recognize}
          onMove={(page, direction) => { void move(page, direction) }} onReorder={reorder} onDraggingChange={setDragging} />
      </Stack>}
    <Dialog open={!!viewing} onClose={() => setViewing(undefined)} fullWidth maxWidth="lg" aria-labelledby="page-view-title">
      <DialogTitle id="page-view-title">{viewedPage ? `Page ${viewingNumber}` : 'Page unavailable'}</DialogTitle>
      <DialogContent>
        {viewedPage ? <Stack spacing={2}>
          <Typography variant="body2">Original photograph{viewedPage.correctionRevision ? ' · the gallery shows its corrected thumbnail.' : ''}</Typography>
          <PageImage key={viewedPage.id} pageId={viewedPage.id} original alt={`Full view of page ${viewingNumber}`} />
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{viewedPage.originalFilename || 'Camera image'} · {viewedPage.widthPx} × {viewedPage.heightPx} px · {viewedPage.mimeType}</Typography>
        </Stack> : <Typography>This page is no longer available in this book.</Typography>}
      </DialogContent>
      <DialogActions>{viewedPage && <Button onClick={() => correct(viewedPage)}>Correct page</Button>}<Button onClick={() => setViewing(undefined)}>Close</Button></DialogActions>
    </Dialog>
    <Dialog open={!!deleting} onClose={() => { if (!busy) setDeleting(undefined) }} aria-labelledby="page-delete-title" aria-describedby="page-delete-description">
      <DialogTitle id="page-delete-title">{deletingNumber ? `Delete page ${deletingNumber}?` : 'Delete page?'}</DialogTitle>
      <DialogContent><DialogContentText id="page-delete-description">This permanently removes the page, original image, thumbnails, and any correction settings and derived images from this device. The remaining pages will be renumbered. This cannot be undone.</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus disabled={busy} onClick={() => setDeleting(undefined)}>Keep page</Button><Button color="error" disabled={busy} onClick={() => { void deletePage() }}>{busy ? 'Deleting…' : 'Delete page'}</Button></DialogActions>
    </Dialog>
    <Dialog open={blocker.state === 'blocked'} onClose={() => { if (blocker.state === 'blocked') blocker.reset() }} aria-labelledby="pages-busy-title">
      <DialogTitle id="pages-busy-title">{working ? 'Page operation in progress' : 'Pages finished saving'}</DialogTitle>
      <DialogContent><DialogContentText>{working ? 'Finish or cancel reordering, or wait for the current save to finish before leaving. Choose Stay here to stop an import between images.' : 'You can now continue to the requested page.'}</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>Stay here</Button><Button disabled={working} onClick={() => { if (blocker.state === 'blocked') blocker.proceed() }}>Continue</Button></DialogActions>
    </Dialog>
  </Stack>
}
