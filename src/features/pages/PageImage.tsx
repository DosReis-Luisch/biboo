import { memo, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { pageRepository } from './pageRepository'

// Mounted with a stable page ID. Reordering does not refetch image assets.
export const PageImage = memo(function PageImage({ pageId, original = false, alt }: {
  pageId: string; original?: boolean; alt: string
}) {
  const [source, setSource] = useState<{ url?: string; error?: string }>({})
  useEffect(() => {
    let active = true
    let url: string | undefined
    const load = original ? pageRepository.getOriginal : pageRepository.getThumbnail
    void load(pageId).then((asset) => {
      if (!active) return
      if (!asset) { setSource({ error: 'Image unavailable. Reopen the book or import the page again.' }); return }
      url = URL.createObjectURL(asset.blob)
      setSource({ url })
    }).catch(() => { if (active) setSource({ error: 'Unable to read this image from device storage.' }) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [pageId, original])

  if (source.error) return <Typography role="status" variant="body2" sx={{ p: 2 }}>{source.error}</Typography>
  if (!source.url) return <Box role="status" sx={{ p: 2 }}>Loading image…</Box>
  return <Box component="img" src={source.url} alt={alt} draggable={false} loading={original ? 'eager' : 'lazy'} decoding="async"
    onError={() => setSource({ error: 'This browser could not display this image. Try importing a JPEG or PNG version.' })}
    sx={{ display: 'block', width: '100%', height: original ? 'auto' : 160, maxHeight: original ? '70svh' : undefined, objectFit: 'contain', backgroundColor: '#f1f3e9' }} />
})
