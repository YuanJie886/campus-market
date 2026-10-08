import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { tokenFromFragment } from '../../utils/supply';
import { USER_CREATED_NOTE } from '../../utils/circle';
import { clearPendingInvite, holdPendingInvite, peekPendingInvite } from '../../utils/pendingInvite';

/**
 * 用邀请码加入圈子。邀请码可以手动输入，也可以来自链接的 # 片段：读取后立刻从地址栏抹掉，
 * 只放进兑换请求的请求体，不进入 URL query、不写入任何浏览器存储。
 * 无效、过期、已用、已撤销的邀请码显示同一句提示，不透露圈子是否存在。
 *
 * <p>6.1B：未登录时这个页面不再被登录拦截吞掉邀请码——先把邀请码放进本页内存，再去登录；
 * 登录（或注册）成功回到这里时自动填入，但仍然要用户点击「加入」才会兑换。刷新页面会丢失，这是刻意的安全取舍。
 */
export default function CircleJoinPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromLink = tokenFromFragment(window.location.hash);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (fromLink) holdPendingInvite(fromLink);
    const held = fromLink ?? peekPendingInvite();
    if (held) setToken(held);
  }, []);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const circle = await getApiClient().redeemCircleInvite(token.trim());
      setToken('');
      clearPendingInvite();
      navigate(`/circles/${encodeURIComponent(circle.id)}`);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p role="status" className="text-sm text-slate-600">正在读取登录状态…</p>;

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-xl font-extrabold text-slate-800">用邀请码加入圈子</h1>
        <p className="text-sm text-slate-700">{USER_CREATED_NOTE}加入前需要先登录。</p>
        {token ? (
          <p className="rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-900" role="note">
            已收到邀请码。登录或注册后会回到这里，由你确认是否加入。邀请码只保存在当前页面里，不会写进浏览器存储；刷新页面后需要重新打开邀请链接。
          </p>
        ) : (
          <p className="text-sm text-slate-700">登录后可以在这里输入邀请码。</p>
        )}
        <div className="flex gap-2">
          <Button variant="contained" onClick={() => navigate('/login', { state: { from: '/circles/join' } })}>去登录</Button>
          <Button variant="outlined" onClick={() => navigate('/register', { state: { from: '/circles/join' } })}>注册新账号</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-xl font-extrabold text-slate-800">用邀请码加入圈子</h1>
      <p className="text-sm text-slate-700">{USER_CREATED_NOTE}每个邀请码只能使用一次。</p>
      {token && <p className="text-xs text-slate-600">邀请码已自动填好，确认后点击「加入」。</p>}
      <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); void redeem() }} aria-label="兑换圈子邀请码">
        <TextField size="small" label="邀请码" value={token} onChange={(e) => setToken(e.target.value)}
          inputProps={{ maxLength: 200, autoComplete: 'off', spellCheck: false }} />
        <Button type="submit" variant="contained" disabled={busy || !token.trim()}>加入</Button>
      </form>
      {error && <Alert severity="error">{error}</Alert>}
    </div>
  );
}
