import { defaultTheme, type RaThemeOptions } from 'react-admin';

export const adminTheme: RaThemeOptions = {
    ...defaultTheme,
    sidebar: { width: 248, closedWidth: 64 },
    palette: {
        mode: 'light', primary: { main: '#087f6d' }, secondary: { main: '#172c29' },
        background: { default: '#f5f7f9', paper: '#ffffff' },
        text: { primary: '#1c302d', secondary: '#73817e' }, divider: '#e9eeec',
        success: { main: '#148564' }, warning: { main: '#b57918' }, info: { main: '#367cc0' }, error: { main: '#cf5959' },
    },
    shape: { borderRadius: 12 },
    typography: {
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 13, h4: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-.04em' },
        h5: { fontSize: '1.2rem', fontWeight: 700 }, h6: { fontSize: '1rem', fontWeight: 650 }, button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
        ...defaultTheme.components,
        MuiCard: { styleOverrides: { root: { border: '1px solid #e5ebe8', boxShadow: '0 2px 6px rgba(22,48,39,.025)' } } },
        MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8, padding: '7px 14px' } } },
        MuiTextField: { defaultProps: { variant: 'outlined', size: 'small', slotProps: { inputLabel: { shrink: true } } } },
        MuiFormControl: { defaultProps: { variant: 'outlined', size: 'small' } },
        MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 8, backgroundColor: '#fff' }, notchedOutline: { borderColor: '#dde6e1' } } },
        MuiTableCell: { styleOverrides: { head: { background: '#f8faf9', color: '#6d7e77', fontWeight: 600, whiteSpace: 'nowrap', paddingTop: 14, paddingBottom: 14 }, body: { paddingTop: 17, paddingBottom: 17, borderColor: '#eef2ef' } } },
        MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500, height: 25, fontSize: 11 }, outlined: { borderColor: 'currentColor' } } },
        MuiDialog: { styleOverrides: { paper: { padding: 8, borderRadius: 16 } } },
        MuiAlert: { styleOverrides: { root: { borderRadius: 10 }, standardInfo: { backgroundColor: '#edf7f5', color: '#3d7065' } } },
        RaDatagrid: { styleOverrides: { root: { '& .RaDatagrid-rowCell:first-of-type': { fontWeight: 600 }, '& .RaDatagrid-row:hover': { backgroundColor: '#f5faf8' } } } },
        RaToolbar: { styleOverrides: { root: { backgroundColor: '#fafcfb', borderTop: '1px solid #e9eeec', padding: '18px 24px' } } },
    },
};
