import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Chip } from '@mui/material';
import { getApiClient } from '../../api/client';
import type { ContactRequest } from '../../api/contracts';
import { toUserMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { useNotify } from '../../context/NotificationContext';
import { formatDateTime } from '../../utils/format';

const STATUS = { PENDING: '等待卖家同意', APPROVED: '已同意展示', REJECTED: '已拒绝' } as const;
export default function ContactRequestsPage() {
  const { currentUser } = useAuth();
  const { success, error } = useNotify();
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [role, setRole] = useState<'seller' | 'buyer'>('seller');
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setRequests(await getApiClient().listContactRequests()); setLoadError(''); }
    catch (e) { setLoadError(toUserMessage(e)); }
    finally { setLoading(false); }
  }, [currentUser?.id]);
  useEffect(() => { void refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, [refresh]);
  const decide = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    if (busy) return;
    setBusy(id);
    try {
      const updated = await getApiClient().decideContactRequest(id, status);
      setRequests((list) => list.map((r) => r.id === id ? { ...r, ...updated, productTitle: r.productTitle, buyerNickname: r.buyerNickname } : r));
      success(status === 'APPROVED' ? '已同意，仅该买家可以查看联系方式' : '已拒绝该联系申请');
    } catch (e) { error(toUserMessage(e)); }
    finally { setBusy(null); }
  };
  const list = requests.filter((r) => (role === 'seller' ? r.sellerId : r.buyerId) === currentUser?.id);
  return <section className="space-y-4 rounded-2xl bg-white p-5 shadow-card" aria-label="联系申请">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">联系申请</h2><Button onClick={refresh} disabled={loading}>刷新</Button></div>
    <p className="text-sm text-slate-500">同意申请后，仅向该买家展示这件商品的联系方式。平台只提供商品展示和联系方式，后续沟通与交易由双方自行联系。</p>
    <div className="flex gap-2" role="group" aria-label="申请类型">
      <Button variant={role === 'seller' ? 'contained' : 'outlined'} onClick={() => setRole('seller')}>收到的申请（{requests.filter((r) => r.sellerId === currentUser?.id && r.status === 'PENDING').length} 待处理）</Button>
      <Button variant={role === 'buyer' ? 'contained' : 'outlined'} onClick={() => setRole('buyer')}>我发出的申请</Button>
    </div>
    {loadError && <Alert severity="error">{loadError}</Alert>}
    {loading ? <p role="status">正在读取联系申请…</p> : list.length === 0 ? <p className="py-6 text-center text-slate-500">暂无联系申请</p> : <ul className="space-y-3">{list.map((r) => <li key={r.id} className="rounded-xl border border-slate-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-semibold text-brand-700" to={`/product/${r.productId}`}>{r.productTitle || '查看商品'}</Link><Chip size="small" label={STATUS[r.status]} color={r.status === 'APPROVED' ? 'success' : 'default'} /></div>
      <p className="mt-2 text-sm text-slate-500">{role === 'seller' ? `${r.buyerNickname || '买家'} 想查看你的联系方式 · ` : ''}{formatDateTime(r.createdAt)}</p>
      {role === 'seller' && r.status === 'PENDING' && <div className="mt-3 flex gap-2"><Button variant="contained" disabled={!!busy} onClick={() => decide(r.id, 'APPROVED')}>同意展示联系方式</Button><Button color="inherit" disabled={!!busy} onClick={() => decide(r.id, 'REJECTED')}>拒绝</Button></div>}
      {role === 'buyer' && r.status === 'APPROVED' && <Button component={Link} to={`/product/${r.productId}`} sx={{ mt: 1 }}>查看卖家联系方式</Button>}
    </li>)}</ul>}
  </section>;
}
