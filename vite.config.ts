import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ocrModelMiddleware } from './scripts/ocr-model-middleware.ts'

// https://vite.dev/config/
export default defineConfig(({ isPreview }) => {
  // Preview-only, server-side variables: never expose private keys via VITE_*.
  const certPath = process.env.BIBOO_HTTPS_CERT
  const keyPath = process.env.BIBOO_HTTPS_KEY
  if (isPreview && Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error('Set both BIBOO_HTTPS_CERT and BIBOO_HTTPS_KEY for HTTPS preview, or clear both for HTTP localhost preview.')
  }
  const https = isPreview && certPath && keyPath
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined
  return {
  preview: { https },
  plugins: [{
    name: 'biboo-ocr-asset-manifest',
    configureServer(server) {
      server.middlewares.use(ocrModelMiddleware(server.config.publicDir))
    },
    configurePreviewServer(server) {
      server.middlewares.use(ocrModelMiddleware(resolve(server.config.root, server.config.build.outDir)))
    },
    resolveId(id) { if (id === 'virtual:biboo-ocr-assets') return '\0biboo-ocr-assets' },
    load(id) {
      if (id !== '\0biboo-ocr-assets') return
      // npm predev/prebuild prepares this. Fail loudly rather than use CDN defaults.
      const manifest = JSON.parse(readFileSync(new URL('./public/ocr-assets/manifest.json', import.meta.url), 'utf8'))
      return `export default ${JSON.stringify(manifest)}`
    },
  }, react(), VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    pwaAssets: {
      image: 'public/biboo.svg',
      preset: 'minimal-2023',
      overrideManifestIcons: true,
    },
    manifest: {
      id: '/',
      name: 'Biboo',
      short_name: 'Biboo',
      description: 'Bilingual Books — a local library for your family’s stories.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#faf7f0',
      theme_color: '#28594d',
    },
    workbox: {
      // Only build-owned application assets. Never cache book data or images.
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // All current split chunks stay offline-ready. Future optional model/pack
      // downloads belong here (public/optional-resources), outside precaching.
      globIgnores: ['optional-resources/**', 'ocr-assets/**'],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [/^\/$/, /^\/books(?:\/[^/?]+)?\/?$/, /^\/books\/[^/?]+\/pages\/[^/?]+\/(?:correct|ocr)\/?$/, /^\/backup\/import\/?$/, /^\/books\/[^/?]+\/backup\/?$/],
      runtimeCaching: [{
        // Only immutable, packaged OCR assets; no user images or arbitrary URLs.
        // Preparation requests have a query, bypass this rule, and verify SHA-256.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/ocr-assets\/[a-f0-9]{16}\//.test(url.pathname) && !url.search,
        handler: 'CacheFirst',
        options: { cacheName: 'biboo-ocr-v1', cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 20, purgeOnQuotaError: true } },
      }],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: false,
    },
    devOptions: { enabled: false },
  })],
  }
})
