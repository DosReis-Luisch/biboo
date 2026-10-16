import { useEffect, useState } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

export function RouteLoading({ immediate = false }: { immediate?: boolean }) {
  const [visible, setVisible] = useState(immediate)
  useEffect(() => {
    // Cached route transitions usually finish before this indicator is needed.
    const timer = window.setTimeout(() => setVisible(true), 200)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null
  return <Stack role="status" direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
    <CircularProgress size={20} aria-hidden="true" />
    <Typography variant="body2">{immediate ? 'Opening Biboo…' : 'Opening book…'}</Typography>
  </Stack>
}
