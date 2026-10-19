import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useBlocker, useOutletContext, useParams } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
import { bookRepository } from '../books/bookRepository'
import type { Book } from '../books/book'
import { backupError, downloadFilename, readArchive, writeArchive } from './archive'
import { backupRepository } from './backupRepository'
import { serializeSnapshot } from './serialization'
import { checkAbort } from './format'

export function BackupPage() {
  const { bookId } = useParams()
  return <BackupScreen key={bookId ?? 'restore'} bookId={bookId} />
}

function BackupScreen({ bookId }: { bookId?: string }) {
  const restoring = !bookId
  const [book, setBook] = useState<Book>()
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState({ percent: 0, message: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [download, setDownload] = useState<{ url: string; filename: string; title: string }>()
  const [restored, setRestored] = useState<Book>()
  const input = useRef<HTMLInputElement>(null)
  const alive = useRef(false)
  const locked = useRef(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const downloadUrl = useRef<string | undefined>(undefined)
  const { setEditing } = useOutletContext<ShellContext>()
  const blocker = useBlocker(busy)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    }
  }, [])
  useEffect(() => {
    let active = true
    if (bookId) void bookRepository.get(bookId).then((result) => {
      if (!active) return
      if (result) setBook(result)
      else setError('This book no longer exists. Return to your library.')
    }).catch((reason: unknown) => { if (active) setError(backupError(reason, false)) })
    return () => { active = false }
  }, [bookId])
  useEffect(() => {
    setEditing(busy)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (busy) window.addEventListener('beforeunload', beforeUnload)
    return () => { setEditing(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [busy, setEditing])

  function selected(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0])
    event.currentTarget.value = ''
    setRestored(undefined)
    setError('')
    setNotice('')
  }
  async function start() {
    if (locked.current || (restoring && !file)) return
    locked.current = true
    const task = new AbortController()
    controller.current = task
    setBusy(true)
    setError('')
    setNotice('')
    setRestored(undefined)
    setDownload(undefined)
    if (downloadUrl.current) { URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = undefined }
    const update = (percent: number, message: string) => {
      if (alive.current) setProgress((current) => current.percent === percent && current.message === message ? current : { percent, message })
    }
    update(0, restoring ? 'Opening backup…' : 'Reading a consistent book snapshot…')
    try {
      if (restoring && file) {
        const bundle = await readArchive(file, task.signal, update)
        checkAbort(task.signal)
        update(90, 'Validated. Saving the restored book atomically…')
        setCommitting(true)
        const result = await backupRepository.restore(bundle, task.signal)
        if (alive.current) { setRestored(result); update(100, 'Book restored.') }
      } else if (bookId) {
        const bundle = serializeSnapshot(await backupRepository.snapshot(bookId))
        checkAbort(task.signal)
        const blob = await writeArchive(bundle, task.signal, update)
        checkAbort(task.signal)
        if (alive.current) {
          const url = URL.createObjectURL(blob)
          downloadUrl.current = url
          setDownload({ url, filename: downloadFilename(bundle.manifest.book.title), title: bundle.manifest.book.title })
          update(100, 'Backup ready to download.')
        }
      }
    } catch (reason) {
      if (alive.current) {
        if (task.signal.aborted) setNotice('Canceled. Existing saved books were not changed.')
        else setError(backupError(reason, restoring))
      }
    } finally {
      locked.current = false
      if (alive.current) { setBusy(false); setCommitting(false) }
    }
  }

  return <Stack spacing={3}>
    <Button component={Link} to={bookId ? `/books/${bookId}` : '/'} sx={{ alignSelf: 'flex-start' }}>{bookId ? 'Back to book' : 'Back to library'}</Button>
    <Box><Typography variant="h1">{restoring ? 'Import Biboo backup' : 'Export book'}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>{restoring ? 'Restore a complete project as a separate book on this device.' : book?.title ?? 'Opening book…'}</Typography></Box>
    <Alert severity="warning">Biboo backups contain original book images and may include camera metadata. Archives are not encrypted. Store and share them carefully.</Alert>
    {error && <Alert severity="error">{error}</Alert>}
    {notice && <Alert severity="info">{notice}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography>{restoring ? 'Choose a .biboo file, then restore it. All relationships receive new IDs; existing projects are kept.' : 'Create a portable archive of book metadata, ordered pages, original photos, thumbnails, and saved corrections. Exporting does not change this project.'}</Typography>
        {restoring && <>
          <Button variant="outlined" disabled={busy} onClick={() => input.current?.click()} sx={{ alignSelf: 'flex-start' }}>Choose .biboo file</Button>
          <input hidden disabled={busy} ref={input} type="file" accept=".biboo" onChange={selected} aria-label="Choose Biboo backup" />
          {file && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MiB</Typography>}
        </>}
        <Typography variant="caption" color="text.secondary">Limits: 500 pages, 300 MiB archive file, 256 MiB total expanded data, and 64 MiB per image. Large projects may still exceed this device’s available memory or storage.</Typography>
        <Button variant="contained" disabled={busy || (restoring ? !file : !book)} onClick={() => { void start() }} sx={{ alignSelf: 'flex-start' }}>{restoring ? restored ? 'Restore another copy' : 'Restore as a separate book' : 'Create .biboo backup'}</Button>
        {busy && <Stack spacing={1} role="status" aria-live="polite">
          <Typography>{progress.message}</Typography>
          <LinearProgress variant="determinate" value={progress.percent} aria-label={restoring ? 'Restore progress' : 'Export progress'} />
          <Button disabled={committing} onClick={() => controller.current?.abort()} sx={{ alignSelf: 'flex-start' }}>{committing ? 'Finishing storage transaction…' : 'Cancel operation'}</Button>
        </Stack>}
      </Stack>
    </Paper>
    {download && <Alert severity="success"><Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Typography>Backup ready for “{download.title}”. Download it before leaving this screen.</Typography>
      <Button component="a" href={download.url} download={download.filename} variant="contained" onClick={() => setNotice('Download requested. Check your browser’s Downloads or Files location; Biboo cannot confirm that the file was saved.')}>Download .biboo file</Button>
    </Stack></Alert>}
    {restored && <Alert severity="success"><Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Typography>“{restored.title}” was restored as a separate book. The existing library was kept.</Typography>
      <Button component={Link} to={`/books/${restored.id}`} variant="contained">Open restored book</Button>
      <Button component={Link} to="/">View library</Button>
    </Stack></Alert>}
    <Typography variant="caption" color="text.secondary">Everything is processed locally. Keep downloaded backups outside browser storage. Browser storage can be cleared or evicted.</Typography>
    <Dialog open={blocker.state === 'blocked'} onClose={() => { if (blocker.state === 'blocked') blocker.reset() }} aria-labelledby="backup-busy-title">
      <DialogTitle id="backup-busy-title">{busy ? 'Backup operation in progress' : 'Operation finished'}</DialogTitle>
      <DialogContent><DialogContentText>{busy ? 'Wait until the operation finishes, or stay here to cancel before the final storage transaction.' : 'You can now continue. Download any prepared backup before leaving if you want to keep the file.'}</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>Stay here</Button><Button disabled={busy} onClick={() => { if (blocker.state === 'blocked') blocker.proceed() }}>Continue</Button></DialogActions>
    </Dialog>
  </Stack>
}
