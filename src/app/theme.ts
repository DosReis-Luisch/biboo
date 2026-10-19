import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: { main: '#28594d' },
    secondary: { main: '#91602b' },
    background: { default: '#faf7f0', paper: '#ffffff' },
    text: { primary: '#243e36', secondary: '#59665e' },
    error: { main: '#ae3636' },
  },
  typography: {
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    h1: { fontSize: 'clamp(2rem, 5vw, 2.8rem)', fontWeight: 750, letterSpacing: '-0.04em' },
    h2: { fontSize: '1.4rem', fontWeight: 700 },
    h3: { fontSize: '1.15rem', fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 650 },
  },
  shape: { borderRadius: 16 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44 } } },
    MuiTextField: { defaultProps: { fullWidth: true } },
    MuiPaper: { styleOverrides: { outlined: { borderColor: '#e0e4da' } } },
  },
})
