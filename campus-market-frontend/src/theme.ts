import { createTheme } from '@mui/material/styles';

/**
 * 全局 MUI 主题。
 * 与 Tailwind 共存策略：Tailwind preflight 已关闭，由 MUI CssBaseline 负责全局重置。
 */
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1f5a4e',
      light: '#6f9984',
      dark: '#123b34',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#d97459',
      light: '#e9a28d',
      dark: '#a84b36',
      contrastText: '#ffffff',
    },
    success: { main: '#16a34a' },
    warning: { main: '#f59e0b' },
    error: { main: '#ef4444' },
    info: { main: '#3b82f6' },
    background: {
      default: '#f4f2ed',
      paper: '#faf9f5',
    },
    text: {
      primary: '#171918',
      secondary: '#667068',
    },
    divider: 'rgba(23,25,24,0.12)',
  },
  shape: {
    borderRadius: 14,
  },
  typography: {
    fontFamily:
      "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
    h1: { fontSize: '1.75rem', fontWeight: 700 },
    h2: { fontSize: '1.5rem', fontWeight: 700 },
    h3: { fontSize: '1.25rem', fontWeight: 700 },
    h4: { fontSize: '1.125rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.9375rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontWeight: 700,
          '&.MuiButton-contained': {
            boxShadow: '0 8px 18px rgba(31, 90, 78, 0.18)',
          },
          '&.MuiButton-contained:hover': {
            boxShadow: '0 10px 24px rgba(31, 90, 78, 0.24)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: 14 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 14 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16 },
      },
    },
  },
});

export default theme;
