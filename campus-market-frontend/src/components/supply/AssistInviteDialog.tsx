import { useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { AssistInvite } from '../../api/contracts';
import { assistLink } from '../../utils/supply';

const EXPIRY_OPTIONS = [
  { hours: 1, label: '1 小时' },
  { hours: 24, label: '24 小时（默认）' },
  { hours: 72, label: '3 天' },
  { hours: 168, label: '7 天（最长）' },
];

export const ASSIST_SCOPE_TEXT =
  '对方可以帮你整理标题、描述、分类、价格建议、打包明细与取货楼栋建议并保存；不能发布，看不到你的联系方式、订单、确认码或其他草稿，也不能再邀请别人。你可以随时撤销。';

interface Props {
  open: boolean;
  onClose: () => void;
  scope: { draftId: string } | { batchId: string };
  onCreated?: (invite: AssistInvite) => void;
}

/**
 * 「协助整理发布」邀请。邀请码只在这个弹窗的内存状态里出现一次：不写 localStorage / sessionStorage，
 * 不放进 URL query；分享链接把它放在 # 之后（fragment 不会发给服务器）。关闭弹窗即丢弃。
 */
export default function AssistInviteDialog({ open, onClose, scope, onCreated }: Props) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const tokenRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) { setToken(null); setError(null); setCopied(''); setHours(24) }
  }, [open]);
  useEffect(() => { if (token) tokenRef.current?.focus() }, [token]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await getApiClient().createAssistInvite({ ...scope, expiresInHours: hours });
      setToken(created.token);
      onCreated?.(created.invite);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(`已复制${what}`);
    } catch {
      setCopied('无法自动复制，请手动选中复制');
    }
  };
  const link = token ? assistLink(window.location.origin, token) : '';

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>邀请协助整理发布</DialogTitle>
      <DialogContent className="space-y-3">
        <p className="text-sm text-slate-700">{ASSIST_SCOPE_TEXT}</p>
        {!token ? (
          <TextField select size="small" label="邀请有效期" value={hours} onChange={(e) => setHours(Number(e.target.value))} fullWidth>
            {EXPIRY_OPTIONS.map((o) => <MenuItem key={o.hours} value={o.hours}>{o.label}</MenuItem>)}
          </TextField>
        ) : (
          <div className="space-y-2">
            <Alert severity="warning" role="note">邀请码只显示这一次，关闭后无法再次查看；只能使用一次。需要时请撤销后重新生成。</Alert>
            <TextField
              label="邀请码（只显示这一次）" value={token} fullWidth size="small"
              inputRef={tokenRef} InputProps={{ readOnly: true }}
            />
            <div className="flex flex-wrap gap-2">
              <Button size="small" variant="outlined" onClick={() => copy(token, '邀请码')}>复制邀请码</Button>
              <Button size="small" variant="outlined" onClick={() => copy(link, '邀请链接')}>复制邀请链接</Button>
            </div>
            <p className="break-all text-xs text-slate-600">链接：{link}</p>
            <p role="status" aria-live="polite" className="text-xs text-emerald-800">{copied}</p>
          </div>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>{token ? '完成' : '取消'}</Button>
        {!token && <Button variant="contained" onClick={create} disabled={busy}>生成一次性邀请</Button>}
      </DialogActions>
    </Dialog>
  );
}
