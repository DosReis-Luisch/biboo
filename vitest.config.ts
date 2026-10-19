import { defineConfig } from 'vitest/config'

// Deliberately separate from Vite's app/PWA plugins. No browser or service worker.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
