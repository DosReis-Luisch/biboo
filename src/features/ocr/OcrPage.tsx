import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { ShellContext } from '../../App'
import { hasOcrAssets, prepareOcrAssets } from './assets'
import { defaultOcrLanguage, ocrLanguages, type OcrLanguage, type OcrResult } from './ocr'
import { loadOcrPage } from './ocrRepository'
import { prepareOcrImage } from './prepareImage'
import { recognizePage } from './recognize'
import { OcrAssetError } from './assetPreparation'

type Document = Awaited<ReturnType<typeof loadOcrPage>>
type Input = Awaited<ReturnType<typeof prepareOcrImage>>
type Loaded = { document: Document; input: Input; url: string }
const errorMessage = (reason: unknown) => reason instanceof OcrAssetError ? reason.message : reason instanceof Error && reason.name === 'QuotaExceededError'
  ? 'Not enough browser storage to cache OCR assets. Free device/site space and retry. Your books were not changed.'
  : reason instanceof Error ? reason.message.slice(0, 500) : 'Local OCR could not finish. Prepare its assets online and retry.'

export function OcrPage() {
  const { bookId = '', pageId = '' } = useParams()
  return <LoadOcr key={`${bookId}/${pageId}`} bookId={bookId} pageId={pageId} />
}

function LoadOcr({ bookId, pageId }: { bookId: string; pageId: string }) {
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    void (async () => {
      const document = await loadOcrPage(bookId, pageId)
      controller.signal.throwIfAborted()
      const input = await prepareOcrImage(document.blob, document.expectedWidth, document.expectedHeight, controller.signal)
      controller.signal.throwIfAborted()
      url = URL.createObjectURL(input.blob)
      setLoaded({ document, input, url })
    })().catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [bookId, pageId, attempt])
  if (loaded) return <OcrEditor loaded={loaded} />
  return <Stack spacing={2}>
    <Typography variant="h1">Recognize page text</Typography>
    {error ? <Alert severity="error" action={<Button onClick={() => { setError(''); setAttempt((value) => value + 1) }}>Retry</Button>}>{error}</Alert> : <Typography role="status">Preparing the page image…</Typography>}
    <Button component={Link} to={`/books/${bookId}`}>Back to book</Button>
  </Stack>
}

function OcrEditor({ loaded: { document: { book, page, corrected }, input, url } }: { loaded: Loaded }) {
  const [language, setLanguage] = useState<OcrLanguage | ''>(() => defaultOcrLanguage(book.sourceLanguage) ?? '')
  const [cached, setCached] = useState(false)
  const [busy, setBusy] = useState<'prepare' | 'recognize'>()
  const [status, setStatus] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<OcrResult>()
  const [overlay, setOverlay] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const controller = useRef<AbortController | undefined>(undefined)
  const lock = useRef(false)
  const cacheProbe = useRef(0)
  const mounted = useRef(false)
  const { setEditing } = useOutletContext<ShellContext>()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  useEffect(() => {
    let active = true
    const probe = ++cacheProbe.current
    if (language) void hasOcrAssets(language).then((value) => { if (active && probe === cacheProbe.current) setCached(value) }).catch(() => { if (active && probe === cacheProbe.current) setCached(false) })
    return () => { active = false }
  }, [language])
  useEffect(() => {
    setEditing(!!busy)
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    if (busy) window.addEventListener('beforeunload', beforeUnload)
    return () => { setEditing(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [busy, setEditing])

  async function run(mode: 'prepare' | 'recognize') {
    if (!language || lock.current) return
    lock.current = true
    // A slow initial cache probe must not overwrite this attempt's outcome.
    cacheProbe.current++
    const task = new AbortController()
    controller.current = task
    setBusy(mode); setError(''); setPercent(0); setCached(false)
    if (mode === 'recognize') { setResult(undefined); setSelectedId('') }
    const progress = (message: string, value: number) => {
      if (!task.signal.aborted) { setStatus(message); setPercent(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))) }
    }
    try {
      await prepareOcrAssets(language, task.signal, progress)
      task.signal.throwIfAborted()
      setCached(true)
      if (mode === 'recognize') {
        const recognized = await recognizePage(input, language, task.signal, (message, fraction) => progress(message, fraction * 100))
        task.signal.throwIfAborted()
        setResult(recognized)
        setStatus(`Recognition finished: ${recognized.words.length} words. Results are temporary.`)
        setPercent(100)
      }
    } catch (reason) {
      if (!task.signal.aborted) {
        setError(errorMessage(reason))
        setCached(false)
        setPercent(0)
        setStatus(mode === 'prepare' ? 'OCR preparation failed. Review the diagnostic above and retry online.' : 'OCR could not finish. Review the diagnostic above.')
      }
    } finally {
      lock.current = false
      cacheProbe.current++
      // Aborted operations never publish results (including after unmount).
      if (mounted.current) {
        setBusy(undefined)
        if (task.signal.aborted) { setStatus('OCR canceled. No results were saved.'); setPercent(0) }
      }
    }
  }
  function cancel() {
    controller.current?.abort()
    setStatus('Stopping OCR…')
  }
  function changeLanguage(value: string) {
    if (value !== 'nld' && value !== 'por') return
    cacheProbe.current++
    setLanguage(value); setCached(false); setResult(undefined); setSelectedId(''); setError(''); setStatus('')
  }
  const selected = result?.words.find((word) => word.id === selectedId)

  return <Stack spacing={3}>
    <Box><Typography variant="h1">Recognize page {page.readingOrder}</Typography><Typography color="text.secondary">{book.title} · {corrected ? 'Saved corrected image' : 'Original photograph'}</Typography></Box>
    <Typography variant="body2">Text recognition runs on this device. Results disappear when you leave or refresh. Images, corrections and backups are unchanged.</Typography>
    {!defaultOcrLanguage(book.sourceLanguage) && <Alert severity="warning">The book’s source language ({book.sourceLanguage}) is not supported by this proof of concept. Select Dutch or Portuguese explicitly to continue.</Alert>}
    {error && <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
      <TextField select label="Recognition language" value={language} disabled={!!busy} onChange={(event) => changeLanguage(event.target.value)} sx={{ maxWidth: 320 }}>
        <MenuItem value="" disabled>Select a language</MenuItem>
        {ocrLanguages.map((item) => <MenuItem key={item.code} value={item.code}>{item.label}</MenuItem>)}
      </TextField>
      <Typography variant="body2">Prepare while online before first offline use of each language. Only the selected model is loaded. Shared runtime assets are reused.</Typography>
      <Typography variant="body2" role="status">{cached ? 'Required assets are in Cache Storage. Offline OCR also requires this version’s production service worker to control the page.' : 'OCR assets have not been confirmed cached for this language. Prepare them before offline use.'}</Typography>
      {!navigator.serviceWorker?.controller && <Alert severity="info">This page is not controlled by a service worker. Use a production build, finish installation, and reload before verifying offline OCR. Development mode needs the local server.</Alert>}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button variant="outlined" disabled={!!busy || !language} onClick={() => { void run('prepare') }}>Prepare OCR assets</Button>
        <Button variant="contained" disabled={!!busy || !language || !cached} onClick={() => { void run('recognize') }}>Recognize text</Button>
        {busy && <Button onClick={cancel}>Cancel OCR</Button>}
      </Stack>
      <Box role="status" aria-live="polite"><Typography variant="body2">{status}{busy ? ` · ${Math.round(percent)}%` : ''}</Typography></Box>
      {busy && <LinearProgress variant="determinate" value={percent} aria-label={busy === 'prepare' ? 'OCR asset preparation' : 'Current OCR stage progress'} />}
    </Stack></Paper>
    <Paper variant="outlined" sx={{ p: { xs: 1, sm: 2 } }}>
      <FormControlLabel control={<Switch checked={overlay} onChange={(event) => setOverlay(event.target.checked)} />} label="Show word boxes" />
      <Box sx={{ position: 'relative', width: '100%', maxWidth: 800, mx: 'auto' }}>
        <Box component="img" src={url} alt={`OCR working image for page ${page.readingOrder}`} width={input.width} height={input.height} draggable={false} sx={{ display: 'block', width: '100%', height: 'auto' }} />
        {overlay && result?.words.map((word) => word.box && <Box component="button" type="button" key={word.id}
          aria-label={`Word ${word.order}: ${word.text}. ${word.confidence === undefined ? 'Confidence unavailable' : `Confidence ${Math.round(word.confidence)} percent`}`}
          aria-pressed={word.id === selectedId} title={`${word.text} · ${word.confidence?.toFixed(1) ?? 'unknown'}%`}
          onMouseEnter={() => setSelectedId(word.id)} onFocus={() => setSelectedId(word.id)} onClick={() => setSelectedId(word.id)}
          sx={{ position: 'absolute', left: `${word.box.x * 100}%`, top: `${word.box.y * 100}%`, width: `${word.box.width * 100}%`, height: `${word.box.height * 100}%`, minWidth: 0, p: 0, border: '1px solid', borderColor: word.id === selectedId ? 'secondary.main' : 'primary.main', backgroundColor: word.id === selectedId ? 'rgba(215,161,75,.3)' : 'rgba(40,89,77,.08)', cursor: 'pointer', '&:focus-visible': { outline: '3px solid #28594d', outlineOffset: 2 } }} />)}
      </Box>
      <Typography variant="caption" component="p" sx={{ mt: 1 }}>{input.width} × {input.height} recognition pixels, from {input.sourceWidth} × {input.sourceHeight} decoded pixels. The image above is the exact PNG supplied to OCR; the saved image is preserved.</Typography>
    </Paper>
    {result && <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={2}>
      <Typography variant="h2">Recognized text</Typography>
      <Typography variant="body2">{result.blocks.length} blocks · {result.lines.length} lines · {result.words.length} words · confidence {result.confidence === undefined ? 'unavailable' : `${result.confidence.toFixed(1)}%`}</Typography>
      {!result.text.trim() && <Alert severity="info">No text was recognized. Check the language, photograph quality and saved correction.</Alert>}
      {result.unavailableWordBoxes > 0 && <Alert severity="warning">{result.unavailableWordBoxes} words have invalid or empty boxes. Their text is retained, but their boxes are hidden.</Alert>}
      <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', m: 0 }}>{result.text}</Typography>
      {result.words.length > 0 && <TextField select label="Word details (reading order)" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <MenuItem value="">Select a word or its box</MenuItem>
        {result.words.map((word) => <MenuItem key={word.id} value={word.id}>{word.order}. {word.text}</MenuItem>)}
      </TextField>}
      {selected && <Box aria-live="polite"><Typography>Word {selected.order}: {selected.text}</Typography><Typography variant="body2">Confidence: {selected.confidence === undefined ? 'unavailable' : `${selected.confidence.toFixed(1)}%`} · {selected.blockId}, {selected.lineId}</Typography><Typography variant="caption">{selected.box ? `Normalized box: x ${selected.box.x.toFixed(4)}, y ${selected.box.y.toFixed(4)}, width ${selected.box.width.toFixed(4)}, height ${selected.box.height.toFixed(4)}` : 'No valid word box.'}</Typography></Box>}
    </Stack></Paper>}
    <Button component={Link} to={`/books/${book.id}`} sx={{ alignSelf: 'flex-start' }}>Back to book</Button>
  </Stack>
}
