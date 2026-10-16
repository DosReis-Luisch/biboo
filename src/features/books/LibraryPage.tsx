import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import AddRounded from '@mui/icons-material/AddRounded'
import AutoStoriesRounded from '@mui/icons-material/AutoStoriesRounded'
import { Link } from 'react-router'
import { bookRepository, storageError } from './bookRepository'
import { languageName, type Book } from './book'

export function LibraryPage() {
  const [books, setBooks] = useState<Book[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void bookRepository.list().then((result) => { if (active) setBooks(result) })
      .catch((reason: unknown) => { if (active) setError(storageError(reason)) })
    return () => { active = false }
  }, [attempt])

  return <Stack spacing={4}>
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
      <Box><Typography variant="overline" color="secondary">A little library. A world of stories.</Typography><Typography variant="h1">Your books</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Make room for stories in both your languages.</Typography></Box>
      <Button component={Link} to="/books/new" variant="contained" startIcon={<AddRounded />}>Create book</Button>
    </Stack>
    {error ? <Alert severity="error" action={<Button color="inherit" onClick={() => { setError(''); setBooks(undefined); setAttempt((value) => value + 1) }}>Retry</Button>}>{error}</Alert>
      : !books ? <Box role="status"><CircularProgress size={28} aria-label="Loading library" /><Typography>Opening your library…</Typography></Box>
      : books.length === 0 ? <Paper variant="outlined" sx={{ py: { xs: 5, sm: 8 }, px: 3, textAlign: 'center', backgroundColor: '#f1f3e9' }}>
        <AutoStoriesRounded sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
        <Typography variant="h2" gutterBottom>Your next shared story starts here</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 400, mx: 'auto', mb: 3 }}>Add a book, choose your languages, and set its page size. Your library stays on this device.</Typography>
        <Button component={Link} to="/books/new" variant="contained" startIcon={<AddRounded />}>Add your first book</Button>
      </Paper>
      : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
        {books.map((book) => <Card variant="outlined" key={book.id}><CardActionArea component={Link} to={`/books/${book.id}`}><CardContent sx={{ p: 3 }}>
          <AutoStoriesRounded color="primary" sx={{ mb: 2 }} />
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>{book.title}</Typography>
          <Typography variant="body2" color="text.secondary">{languageName(book.sourceLanguage)} → {languageName(book.targetLanguage)}</Typography>
          <Chip label={`${book.widthMm} × ${book.heightMm} mm`} size="small" variant="outlined" sx={{ my: 2 }} />
          <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">Updated {new Date(book.updatedAt).toLocaleDateString()}</Typography>
        </CardContent></CardActionArea></Card>)}
      </Box>}
  </Stack>
}
