import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { theme } from './app/theme'
import { LibraryPage } from './features/books/LibraryPage'
import { NotFoundPage } from './app/NotFoundPage'
import { RouteErrorPage } from './app/RouteErrorPage'

const router = createBrowserRouter([{
  element: <App />,
  hydrateFallbackElement: <App initializing />,
  children: [
    { path: '/', element: <LibraryPage /> },
    {
      path: '/books/new',
      lazy: async () => {
        const { BookPage } = await import('./features/books/BookPage')
        return { element: <BookPage key="new" /> }
      },
      errorElement: <RouteErrorPage />,
    },
    {
      path: '/books/:bookId',
      lazy: async () => {
        const { BookPage } = await import('./features/books/BookPage')
        return { Component: BookPage }
      },
      errorElement: <RouteErrorPage />,
    },
    {
      path: '/books/:bookId/pages/:pageId/correct',
      lazy: async () => {
        const { CorrectionPage } = await import('./features/correction/CorrectionPage')
        return { Component: CorrectionPage }
      },
      errorElement: <RouteErrorPage />,
    },
    {
      path: '/books/:bookId/pages/:pageId/ocr',
      lazy: async () => {
        const { OcrPage } = await import('./features/ocr/OcrPage')
        return { Component: OcrPage }
      },
      errorElement: <RouteErrorPage />,
    },
    {
      path: '/backup/import',
      lazy: async () => {
        const { BackupPage } = await import('./features/backup/BackupPage')
        return { Component: BackupPage }
      },
      errorElement: <RouteErrorPage />,
    },
    {
      path: '/books/:bookId/backup',
      lazy: async () => {
        const { BackupPage } = await import('./features/backup/BackupPage')
        return { Component: BackupPage }
      },
      errorElement: <RouteErrorPage />,
    },
    { path: '*', element: <NotFoundPage /> },
  ],
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
)
