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
