import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
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
      globIgnores: ['optional-resources/**'],
      navigateFallback: 'index.html',
      navigateFallbackAllowlist: [/^\/$/, /^\/books(?:\/[^/?]+)?\/?$/, /^\/books\/[^/?]+\/pages\/[^/?]+\/correct\/?$/],
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
      skipWaiting: false,
      clientsClaim: false,
    },
    devOptions: { enabled: false },
  })],
})
