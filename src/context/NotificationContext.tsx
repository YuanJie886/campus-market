import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import type { AlertColor } from '@mui/material/Alert';

/** 全局消息提示（Snackbar）上下文 */

interface NotificationContextValue {
  /** 弹出提示，severity 默认 success */
  notify: (message: string, severity?: AlertColor) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

interface ToastState {
  open: boolean;
  message: string;
  severity: AlertColor;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({
    open: false,
    message: '',
    severity: 'success',
  });

  const notify = useCallback((message: string, severity: AlertColor = 'success') => {
    setToast({ open: true, message, severity });
  }, []);

  const success = useCallback((message: string) => notify(message, 'success'), [notify]);
  const error = useCallback((message: string) => notify(message, 'error'), [notify]);
  const info = useCallback((message: string) => notify(message, 'info'), [notify]);
  const warning = useCallback((message: string) => notify(message, 'warning'), [notify]);

  const handleClose = useCallback(
    (_event?: unknown, reason?: string) => {
      if (reason === 'clickaway') return;
      setToast((prev) => ({ ...prev, open: false }));
    },
    [],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({ notify, success, error, info, warning }),
    [notify, success, error, info, warning],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={2600}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 84, md: 24 } }}
      >
        <Alert
          onClose={() => handleClose()}
          severity={toast.severity}
          variant="filled"
          sx={{ width: '100%', minWidth: 240 }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
}

/** 使用全局提示，必须在 NotificationProvider 内调用 */
export function useNotify(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotify 必须在 NotificationProvider 内使用');
  }
  return ctx;
}
