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
import InviteCodeBox from '../InviteCodeBox';

const EXPIRY_OPTIONS = [
  { hours: 1, label: '1 小时' },
  { hours: 24, label: '24 小时（默认）' },
  { hours: 72, label: '3 天' },
  { hours: 168, label: '7 天（最长）' },
];

/** 与小程序 ASSIST_TOKEN_ONCE 相同 */
export const ASSIST_TOKEN_ONCE = '邀请码只显示这一次，关闭后无法再次查看；只能使用一次。需要时请撤销后重新生成。';

export const ASSIST_SCOPE_TEXT =
  '对方可以帮你整理标题、描述、分类、价格建议、打包明细与取货楼栋建议并保存；不能发布，看不到你的联系方式、联系申请或其他草稿，也不能再邀请别人。你可以随时撤销。';

interface Props {
  open: boolean;
  onClose: () => void;
  scope: { draftId: string } | { batchId: string };
  onCreated?: (invite: AssistInvite) => void;
}

/**
 * 「协助整理发布」邀请。与小程序一致以邀请码为主：邀请码只在这个弹窗的内存状态里出现一次，
 * 不写 localStorage / sessionStorage，不放进地址栏，也不再生成链接；对方在协助页输入或粘贴。关闭弹窗即丢弃。
 */
export default function AssistInviteDialog({ open, onClose, scope, onCreated }: Props) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) { setToken(null); setError(null); setHours(24) }
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
          <InviteCodeBox ref={tokenRef} title="邀请码（只显示这一次）" token={token}
            note={`${ASSIST_TOKEN_ONCE}对方登录后打开「毕业季快速发布 → 用邀请码协助整理」输入或粘贴。`} />
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
