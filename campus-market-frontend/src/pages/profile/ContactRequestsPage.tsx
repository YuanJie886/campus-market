import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { CONTACT_REQUEST_STATUSES, type ContactRequest, type ContactRequestPage, type ContactRequestRole, type ContactRequestStatus } from '../../api/contracts';
import { toUserMessage } from '../../api/errors';
import { useNotify } from '../../context/NotificationContext';
import { useContactUnreadCounts } from '../../context/ContactUnreadContext';
import { formatDateTime } from '../../utils/format';

/** 五种状态的展示文案（判断只用机器码） */
export const CONTACT_STATUS_LABEL: Record<ContactRequestStatus, string> = {
  PENDING: '等待卖家同意',
  APPROVED: '已同意展示',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
  REVOKED: '卖家已撤回同意',
};
/** 每页条数（服务端上限 50） */
export const CONTACT_PAGE_SIZE = 10;

const ROLE_LABEL: Record<ContactRequestRole, string> = { received: '收到的申请', sent: '我发出的申请' };

/**
 * 联系申请：收到的（我是卖家）与发出的（我是买家）两个标签，服务端分页与状态筛选。
 * 打开某个标签时，把这个标签下的未读标记为已读（列表里本次读到的未读条目仍显示「未读」标记，直到下次刷新）。
 * 卖家可以同意 / 拒绝待处理的申请，或撤回已经给出的同意（二次确认，买家立即看不到联系方式）；
 * 买家可以撤回还没有处理的申请，撤回后可以重新申请。申请对象里从不包含联系方式。
 */
export default function ContactRequestsPage() {
  const { success, error } = useNotify();
  const { counts, set: setUnread } = useContactUnreadCounts();
  const [role, setRole] = useState<ContactRequestRole>('received');
  const [status, setStatus] = useState<ContactRequestStatus | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ContactRequestPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ContactRequest | null>(null);
  const sequence = useRef(0);
  /** 本次打开后已经标记过已读的标签 */
  const markedRole = useRef<ContactRequestRole | null>(null);
  const dialogTitleId = useId();
  const dialogBodyId = useId();
  const panelId = useId();

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const result = await getApiClient().listContactRequests({ role, ...(status ? { status } : {}), page, size: CONTACT_PAGE_SIZE });
      if (current !== sequence.current) return;
      setData(result);
      setLoadError('');
      // 打开标签即标记已读；之后刷新时只有读到新的未读才再次标记
      if (markedRole.current !== role || result.items.some((r) => r.unread)) {
        markedRole.current = role;
        try {
          setUnread(await getApiClient().markContactRequestsRead(role));
        } catch {
          // 标记已读失败不影响查看列表；角标会在下一次轮询时更正
        }
      }
    } catch (e) {
      if (current === sequence.current) setLoadError(toUserMessage(e));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [role, status, page, setUnread]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const switchRole = (next: ContactRequestRole) => {
    if (next === role) return;
    setRole(next);
    setStatus('');
    setPage(1);
    setData(null);
    setActionError('');
  };

  const act = async (r: ContactRequest, run: () => Promise<ContactRequest>, done: string) => {
    if (busy) return;
    setBusy(r.id);
    setActionError('');
    try {
      await run();
      success(done);
      await load();
    } catch (e) {
      const message = toUserMessage(e);
      setActionError(message);
      error(message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const confirmRevoke = async () => {
    const target = revoking;
    if (!target) return;
    setRevoking(null);
    await act(target, () => getApiClient().revokeContactRequest(target.id), '已撤回同意，该买家已看不到这件商品的联系方式');
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1;
  const unreadOf = (r: ContactRequestRole) => (r === 'received' ? counts.received : counts.updates);

  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 shadow-card" aria-labelledby="contact-requests-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="contact-requests-title" className="text-lg font-bold">联系申请</h2>
        <Button onClick={() => void load()} disabled={loading}>刷新</Button>
      </div>
      <p className="text-sm text-slate-600">
        同意申请后，仅向该买家展示这件商品的联系方式；你可以随时撤回同意，撤回后对方立即看不到。平台只提供商品展示和联系方式，后续沟通与交易由双方自行联系。
      </p>
      <Tabs value={role} onChange={(_, next: ContactRequestRole) => switchRole(next)} aria-label="申请类型" variant="scrollable" scrollButtons={false}>
        {(['received', 'sent'] as const).map((r) => (
          <Tab key={r} value={r} id={`${panelId}-tab-${r}`} aria-controls={panelId}
            label={unreadOf(r) > 0 ? `${ROLE_LABEL[r]}（${unreadOf(r)} 条未读）` : ROLE_LABEL[r]} />
        ))}
      </Tabs>
      <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${role}`} className="space-y-3">
        <TextField select size="small" label="按状态筛选" value={status} sx={{ minWidth: 180 }}
          onChange={(e) => { setStatus(e.target.value as ContactRequestStatus | ''); setPage(1) }}>
          <MenuItem value="">全部状态</MenuItem>
          {CONTACT_REQUEST_STATUSES.map((s) => <MenuItem key={s} value={s}>{CONTACT_STATUS_LABEL[s]}</MenuItem>)}
        </TextField>
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {actionError && <p role="alert" className="text-sm text-red-700">{actionError}</p>}
        {loading && !data ? <p role="status">正在读取联系申请…</p> : !data || data.items.length === 0 ? (
          <p className="py-6 text-center text-slate-500">{status ? '没有这个状态的联系申请' : '暂无联系申请'}</p>
        ) : (
          <ul className="space-y-3" aria-label={ROLE_LABEL[role]}>
            {data.items.map((r) => {
              const titleId = `${panelId}-item-${r.id}`;
              return (
                <li key={r.id} className="rounded-xl border border-slate-100 p-4" data-request-id={r.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {r.unread && <Chip size="small" color="error" label="未读" />}
                      <Link id={titleId} className="font-semibold text-brand-700" to={`/product/${r.productId}`}>{r.productTitle || '查看商品'}</Link>
                    </span>
                    <Chip size="small" label={CONTACT_STATUS_LABEL[r.status]} color={r.status === 'APPROVED' ? 'success' : 'default'} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {role === 'received' ? `${r.buyerNickname || '买家'} 想查看你的联系方式` : `卖家：${r.sellerNickname || '卖家'}`}
                    {' · 申请于 '}{formatDateTime(r.createdAt)}
                    {r.decidedAt ? ` · 处理于 ${formatDateTime(r.decidedAt)}` : ''}
                  </p>
                  {role === 'received' && r.status === 'PENDING' && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="contained" disabled={!!busy} aria-describedby={titleId}
                        onClick={() => void act(r, () => getApiClient().decideContactRequest(r.id, 'APPROVED'), '已同意，仅该买家可以查看联系方式')}>
                        同意展示联系方式
                      </Button>
                      <Button color="inherit" disabled={!!busy} aria-describedby={titleId}
                        onClick={() => void act(r, () => getApiClient().decideContactRequest(r.id, 'REJECTED'), '已拒绝该联系申请')}>
                        拒绝
                      </Button>
                    </div>
                  )}
                  {role === 'received' && r.status === 'APPROVED' && (
                    <Button sx={{ mt: 1 }} color="warning" disabled={!!busy} aria-describedby={titleId} onClick={() => setRevoking(r)}>
                      撤回同意
                    </Button>
                  )}
                  {role === 'sent' && r.status === 'PENDING' && (
                    <Button sx={{ mt: 1 }} color="inherit" disabled={!!busy} aria-describedby={titleId}
                      onClick={() => void act(r, () => getApiClient().withdrawContactRequest(r.id), '已撤回联系申请')}>
                      撤回申请
                    </Button>
                  )}
                  {role === 'sent' && r.status === 'WITHDRAWN' && (
                    <Button sx={{ mt: 1 }} disabled={!!busy} aria-describedby={titleId}
                      onClick={() => void act(r, () => getApiClient().requestContact(r.productId), '已重新发送联系申请，等待卖家同意')}>
                      重新申请
                    </Button>
                  )}
                  {role === 'sent' && r.status === 'APPROVED' && (
                    <Button component={Link} to={`/product/${r.productId}`} sx={{ mt: 1 }} aria-describedby={titleId}>查看卖家联系方式</Button>
                  )}
                  {role === 'sent' && (r.status === 'REJECTED' || r.status === 'REVOKED') && (
                    <p className="mt-2 text-xs text-slate-600">
                      {r.status === 'REVOKED' ? '卖家已撤回同意，你已看不到这件商品的联系方式，' : '卖家没有同意展示联系方式，'}这件商品不能再次申请；可以通过站内留言继续沟通。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {data && pages > 1 && (
          <nav aria-label="联系申请分页" className="flex items-center gap-2">
            <Button size="small" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一页</Button>
            <span className="text-sm text-slate-700" aria-live="polite">第 {data.page} / {pages} 页（共 {data.total} 条）</span>
            <Button size="small" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          </nav>
        )}
      </div>

      <Dialog open={!!revoking} onClose={() => setRevoking(null)} aria-labelledby={dialogTitleId} aria-describedby={dialogBodyId}>
        <DialogTitle id={dialogTitleId}>撤回对这次申请的同意？</DialogTitle>
        <DialogContent>
          <p id={dialogBodyId} className="text-sm text-slate-700">
            撤回后，{revoking?.buyerNickname || '这位买家'}将立即看不到「{revoking?.productTitle || '这件商品'}」的联系方式，并且不能再次申请这件商品的联系方式。撤回后不能恢复。
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevoking(null)}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void confirmRevoke()}>确认撤回同意</Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
