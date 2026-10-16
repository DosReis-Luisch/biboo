import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'

export function NotFoundPage() {
  return <Stack spacing={2} sx={{ alignItems: 'flex-start' }}><Typography variant="h1">Page not found</Typography><Typography>This page is not part of your library.</Typography><Button component={Link} to="/" variant="contained">Back to library</Button></Stack>
}
