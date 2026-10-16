import { useEffect, useRef, useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { Link, useBlocker, useNavigate, useOutletContext, useParams } from 'react-router'
import type { ShellContext } from '../../App'
import { bookRepository, storageError } from './bookRepository'
import { dimensionPresets, languageName, languages, validateBook, type Book, type BookInput } from './book'
import { PagesSection } from '../pages/PagesSection'

export function BookPage() {
  const { bookId } = useParams()
  // A keyed child prevents form state leaking between book URLs.
  return bookId ? <ExistingBook key={bookId} id={bookId} /> : <BookEditor />
}

function ExistingBook({ id }: { id: string }) {
  const [book, setBook] = useState<Book>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pagesBusy, setPagesBusy] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    let active = true
    void bookRepository.get(id).then((result) => { if (active) setBook(result) })
      .catch((reason: unknown) => { if (active) setError(storageError(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, attempt])

  async function deleteBook() {
    setDeleting(true)
    setError('')
    try {
      await bookRepository.delete(id)
      void navigate('/', { replace: true })
    } catch (reason) {
      setError(storageError(reason))
      setConfirmDelete(false)
      setDeleting(false)
    }
  }

  if (loading) return <CircularProgress aria-label="Opening book" />
  if (!book) return <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
    <Typography variant="h1">{error ? 'Unable to open book' : 'Book not found'}</Typography>
    {error ? <><Alert severity="error">{error}</Alert><Button onClick={() => { setError(''); setLoading(true); setAttempt((value) => value + 1) }}>Try again</Button></> : <Typography>This book may have been deleted from this device.</Typography>}
    <Button component={Link} to="/">Back to library</Button>
  </Stack>
  if (editing) return <BookEditor book={book} onSaved={(saved) => { setBook(saved); setEditing(false) }} onCancel={() => setEditing(false)} />

  return <Stack spacing={3}>
    <Button component={Link} to="/" startIcon={<ArrowBackRounded />} sx={{ alignSelf: 'flex-start' }}>Library</Button>
    <Box><Typography variant="overline" color="secondary">Book project</Typography><Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{book.title}</Typography></Box>
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
      <Stack spacing={3}>
        <Box><Typography variant="h2" gutterBottom>Two languages, one story</Typography><Typography>{languageName(book.sourceLanguage)} → {languageName(book.targetLanguage)}</Typography></Box>
        <Divider />
        <Box><Typography variant="h3" gutterBottom>Page dimensions</Typography><Typography>{book.widthMm} × {book.heightMm} mm · {book.widthMm === book.heightMm ? 'Square' : book.widthMm > book.heightMm ? 'Landscape' : 'Portrait'}</Typography></Box>
        <Typography variant="body2" color="text.secondary">Created {new Date(book.createdAt).toLocaleString()}<br />Last saved {new Date(book.updatedAt).toLocaleString()}</Typography>
        <Button variant="contained" disabled={pagesBusy} onClick={() => setEditing(true)} sx={{ alignSelf: 'flex-start' }}>Edit book</Button>
      </Stack>
    </Paper>
    <PagesSection bookId={id} onBusyChange={setPagesBusy} />
    <Button color="error" disabled={pagesBusy} startIcon={<DeleteOutlineRounded />} onClick={() => setConfirmDelete(true)} sx={{ alignSelf: 'flex-start' }}>Delete book</Button>
    <Dialog open={confirmDelete} onClose={() => { if (!deleting) setConfirmDelete(false) }} aria-labelledby="delete-title" aria-describedby="delete-description">
      <DialogTitle id="delete-title">Delete this book?</DialogTitle>
      <DialogContent><DialogContentText id="delete-description">“{book.title}”, all its pages, and their original images and thumbnails will be permanently removed from this device. This cannot be undone.</DialogContentText></DialogContent>
      <DialogActions><Button autoFocus disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep book</Button><Button color="error" disabled={deleting} onClick={() => { void deleteBook() }}>{deleting ? 'Deleting…' : 'Delete book'}</Button></DialogActions>
    </Dialog>
  </Stack>
}

type FormValues = Omit<BookInput, 'widthMm' | 'heightMm'> & { widthMm: string; heightMm: string }

function BookEditor({ book, onSaved, onCancel }: { book?: Book; onSaved?: (book: Book) => void; onCancel?: () => void }) {
  const initial: FormValues = {
    title: book?.title ?? '', sourceLanguage: book?.sourceLanguage ?? 'nl-NL', targetLanguage: book?.targetLanguage ?? 'pt-PT',
    widthMm: String(book?.widthMm ?? 210), heightMm: String(book?.heightMm ?? 210),
  }
  const [values, setValues] = useState(initial)
  const [presetId, setPresetId] = useState(() => dimensionPresets.find((preset) => preset.width === Number(initial.widthMm) && preset.height === Number(initial.heightMm))?.id ?? 'custom')
  const [errors, setErrors] = useState<ReturnType<typeof validateBook>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [discard, setDiscard] = useState(false)
  const leaveAllowed = useRef(false)
  const navigate = useNavigate()
  const { setEditing } = useOutletContext<ShellContext>()
  const dirty = (Object.keys(initial) as (keyof FormValues)[]).some((key) => values[key] !== initial[key])
  const protectedSession = dirty || saving
  const blocker = useBlocker(() => protectedSession && !leaveAllowed.current)

  useEffect(() => {
    setEditing(protectedSession)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (protectedSession) window.addEventListener('beforeunload', beforeUnload)
    return () => { setEditing(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [protectedSession, setEditing])

  function change(key: keyof FormValues, value: string) {
    if (key === 'widthMm' || key === 'heightMm') setPresetId('custom')
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setError('')
  }

  function cancel() {
    if (dirty) { setDiscard(true); return }
    if (onCancel) onCancel()
    else void navigate('/')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const input: BookInput = { ...values, widthMm: Number(values.widthMm), heightMm: Number(values.heightMm) }
    const issues = validateBook(input)
    setErrors(issues)
    if (Object.keys(issues).length) {
      setError('Please check the highlighted fields.')
      const firstField = Object.keys(issues)[0]
      document.getElementById(`book-${firstField}`)?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = book ? await bookRepository.update(book.id, input) : await bookRepository.create(input)
      leaveAllowed.current = true
      setEditing(false)
      if (onSaved) onSaved(saved)
      else void navigate(`/books/${saved.id}`, { replace: true })
    } catch (reason) {
      setError(storageError(reason))
      setSaving(false)
    }
  }

  return <Stack spacing={3}>
    <Button onClick={cancel} disabled={saving} startIcon={<ArrowBackRounded />} sx={{ alignSelf: 'flex-start' }}>{book ? 'Book details' : 'Library'}</Button>
    <Box><Typography variant="h1">{book ? 'Edit book' : 'A new story'}</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Start with the book, its languages, and the size of one page.</Typography></Box>
    <Paper component="form" noValidate onSubmit={(event) => { void submit(event) }} variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
      <Stack spacing={3}>
        {error && <Alert severity="error">{error}</Alert>}
        <Box component="fieldset" disabled={saving} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Stack spacing={3}>
            <TextField id="book-title" label="Book title" required autoFocus value={values.title} onChange={(event) => change('title', event.target.value)} error={!!errors.title} helperText={errors.title ?? 'Use the title on the cover, or a name your family knows.'} slotProps={{ htmlInput: { maxLength: 200 } }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 3 }}>
              {(['sourceLanguage', 'targetLanguage'] as const).map((key) => <TextField key={key} id={`book-${key}`} select label={key === 'sourceLanguage' ? 'Original language' : 'Translation language'} value={values[key]} onChange={(event) => change(key, event.target.value)} error={!!errors[key]} helperText={errors[key]}>
                {!languages.some((language) => language.tag === values[key]) && <MenuItem value={values[key]}>{values[key]}</MenuItem>}
                {languages.map((language) => <MenuItem key={language.tag} value={language.tag}>{language.label}</MenuItem>)}
              </TextField>)}
            </Box>
            {values.sourceLanguage === values.targetLanguage && <Alert severity="info">Both languages are the same. You can change either language whenever you like.</Alert>}
            <Divider />
            <Box><Typography variant="h2">Page size</Typography><Typography variant="body2" color="text.secondary">Measure a single page, rather than an open spread.</Typography></Box>
            <TextField select id="page-preset" label="Size preset" value={presetId} onChange={(event) => {
              setPresetId(event.target.value)
              const preset = dimensionPresets.find((item) => item.id === event.target.value)
              if (preset) {
                setValues((current) => ({ ...current, widthMm: String(preset.width), heightMm: String(preset.height) }))
                setErrors((current) => ({ ...current, widthMm: undefined, heightMm: undefined }))
              }
            }} helperText="Edit either measurement for a custom size.">
              {dimensionPresets.map((preset) => <MenuItem key={preset.id} value={preset.id}>{preset.label}</MenuItem>)}
              <MenuItem value="custom">Custom dimensions</MenuItem>
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {(['widthMm', 'heightMm'] as const).map((key) => <TextField key={key} id={`book-${key}`} label={key === 'widthMm' ? 'Width (mm)' : 'Height (mm)'} type="number" required value={values[key]} onChange={(event) => change(key, event.target.value)} error={!!errors[key]} helperText={errors[key]} slotProps={{ htmlInput: { min: 1, max: 2000, step: 'any', inputMode: 'decimal' } }} />)}
            </Stack>
            <Button variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => {
              setPresetId('custom')
              setValues((current) => ({ ...current, widthMm: current.heightMm, heightMm: current.widthMm }))
              setErrors((current) => ({ ...current, widthMm: undefined, heightMm: undefined }))
            }}>Swap width and height</Button>
          </Stack>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : book ? 'Save changes' : 'Create book'}</Button>
          <Button type="button" disabled={saving} onClick={cancel}>Cancel</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">Saved only on this device. Changes are saved when you press {book ? 'Save changes' : 'Create book'}.</Typography>
      </Stack>
    </Paper>
    <Dialog open={discard || blocker.state === 'blocked'} onClose={() => { if (!saving) { setDiscard(false); if (blocker.state === 'blocked') blocker.reset() } }} aria-labelledby="discard-title" aria-describedby="discard-description">
      <DialogTitle id="discard-title">{saving ? 'Saving your book' : 'Discard unsaved changes?'}</DialogTitle>
      <DialogContent><DialogContentText id="discard-description">{saving ? 'Please wait until your book has finished saving.' : 'Your latest changes have not been saved to this device.'}</DialogContentText></DialogContent>
      <DialogActions>
        <Button autoFocus onClick={() => { setDiscard(false); if (blocker.state === 'blocked') blocker.reset() }}>Keep editing</Button>
        <Button color="error" disabled={saving} onClick={() => {
          leaveAllowed.current = true
          setEditing(false)
          if (blocker.state === 'blocked') blocker.proceed()
          else if (onCancel) onCancel()
          else void navigate('/')
        }}>Discard changes</Button>
      </DialogActions>
    </Dialog>
  </Stack>
}
