import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link } from 'react-router'

// Eagerly available: this screen must work even if a route module cannot load.
export function RouteErrorPage() {
  return <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
    <Typography variant="h1">Unable to open this page</Typography>
    <Alert severity="error">A required file may be unavailable, or the page encountered an error. Return to your library or reload to try again. If needed, reconnect to the internet first.</Alert>
    <Typography color="text.secondary">Reloading does not clear your saved library.</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
      <Button component={Link} to="/" variant="contained">Back to library</Button>
      <Button variant="outlined" onClick={() => window.location.reload()}>Reload page</Button>
    </Stack>
  </Stack>
}
