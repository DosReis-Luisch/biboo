import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { Link, Outlet, useNavigation } from 'react-router'
import AutoStoriesRounded from '@mui/icons-material/AutoStoriesRounded'
import { pwa } from './app/pwa'
import { RouteLoading } from './app/RouteLoading'
import { insecureContextMessage } from './app/secureContext'

export type ShellContext = { setEditing: (value: boolean) => void }

export default function App({ initializing = false }: { initializing?: boolean }) {
  const navigation = useNavigation()
  const [editing, setEditingState] = useState(false)
  const status = useSyncExternalStore(pwa.subscribe, pwa.getSnapshot)
  const insecure = globalThis.isSecureContext === false
  const showStatus = insecure || status.error || status.offlineReady || status.updateAvailable
  const setEditing = useCallback((value: boolean) => {
    pwa.setEditing(value)
    setEditingState(value)
  }, [])
  useEffect(() => { if (!insecure) pwa.start() }, [insecure])

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: '1px solid #e0e4da' }}>
        <Toolbar sx={{ gap: 2, maxWidth: 1100, width: '100%', mx: 'auto', py: 1 }}>
          <Stack component={Link} to="/" direction="row" spacing={1.5} sx={{ alignItems: 'center', textDecoration: 'none', color: 'inherit', flexGrow: 1 }}>
            <AutoStoriesRounded color="primary" sx={{ fontSize: 34 }} />
            <Box><Typography variant="h2" component="span">Biboo</Typography><Typography variant="caption" component="div">Bilingual Books</Typography></Box>
          </Stack>
          <Button component={Link} to="/">Library</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" component="main" id="main" tabIndex={-1} sx={{ py: { xs: 2, sm: 6 }, minHeight: '75svh' }}>
        {showStatus && <Stack spacing={2} sx={{ mb: { xs: 2, sm: 3 } }} aria-live="polite">
          {insecure && <Alert severity="warning">{insecureContextMessage} PWA installation and offline OCR also require a secure context.</Alert>}
          {status.error && <Alert severity="warning">Offline setup or update could not finish. Connect to the internet and reopen Biboo to try again.</Alert>}
          {status.offlineReady && !status.updateAvailable && <Alert severity="success">Your book library is ready to use offline. OCR needs separate language preparation.</Alert>}
          {status.updateAvailable && <Alert severity="info"><Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <span>{editing ? 'An update is ready. Save or discard your changes before updating.' : 'A new version of Biboo is ready.'}</span>
            <Button variant="outlined" size="small" disabled={editing} onClick={() => { void pwa.update() }}>Update and reload</Button>
          </Stack></Alert>}
        </Stack>}
        {(initializing || navigation.state !== 'idle') && <RouteLoading immediate={initializing} />}
        {!initializing && <Outlet context={{ setEditing } satisfies ShellContext} />}
      </Container>
      <Container maxWidth="md" component="footer" sx={{ py: 3, borderTop: '1px solid #e0e4da' }}>
        <Typography variant="body2" color="text.secondary">Your family’s books, on this device. No account needed.</Typography>
        <Typography variant="caption" color="text.secondary">Clearing site data removes your library. Keep your original books safe.</Typography>
      </Container>
    </>
  )
}
