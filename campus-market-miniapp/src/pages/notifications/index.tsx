import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate, PageTitle } from '../../components';
import { availableActions, badgeText, CONFIRM, CONTACT_PAGE_SIZE, hasMoreContacts, mergeContactPage, STATUS_LABEL, STATUS_TONE, statusNote, type ContactAction } from '../../contacts';
import type { ContactRequest, ContactRole } from '../../model';
import { timeAgo } from '../../model';
import { notify, notifyError, unread, useMarket, useUnread } from '../../state';

const CARD: Record<ContactRequest['status'], string> = { PENDING: '', APPROVED: 'done', REJECTED: 'dead', WITHDRAWN: 'dead', REVOKED: 'dead' };
const CONFIRM_TEXT: Record<ContactAction, string> = { approve: '同意', reject: '拒绝', revoke: '撤回同意', withdraw: '撤回申请' };

export default function NotificationsPage() {
  const { user } = useMarket();
  const count = useUnread();
  const [role, setRole] = useState<ContactRole>('received');
  const [items, setItems] = useState<ContactRequest[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState('');
  const sequence = useRef(0), loadingMore = useRef(false), identity = useRef(user?.id); identity.current = user?.id;
  const received = role === 'received';

  /** reset 读第一页并把该角色的未读标记为已读；否则追加下一页。 */
  const load = async (reset = true) => {
    if (!user || (!reset && loadingMore.current)) return;
    const gen = ++sequence.current, uid = user.id, current = role;
    loadingMore.current = !reset; setLoading(true); setError('');
    try {
      const next = await api.contacts({ role: current, page: reset ? 1 : page + 1, size: CONTACT_PAGE_SIZE });
      if (gen !== sequence.current || uid !== identity.current) return;
      setItems((previous) => mergeContactPage(previous, next, reset)); setTotal(next.total); setPage(next.page);
      // 打开列表即视为已读：卡片上的「新」标记保留到下次刷新，tabBar 角标立即更新
      const pendingUnread = current === 'received' ? unread.current.received : unread.current.updates;
      if (reset && (pendingUnread > 0 || next.items.some((r) => r.unread))) {
        try { const after = await api.markRead(current); if (uid === identity.current) unread.set(after); } catch { /* 标记已读失败不影响列表 */ }
      }
    } catch (e) { if (gen === sequence.current && uid === identity.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) { loadingMore.current = false; setLoading(false); } }
  };
  useEffect(() => { sequence.current++; loadingMore.current = false; setItems([]); setTotal(0); setPage(0); void load(); }, [user?.id, role]);
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  useReachBottom(() => { if (hasMoreContacts(items.length, total)) void load(false); });

  const act = async (request: ContactRequest, action: ContactAction) => {
    if (busy) return;
    const text = CONFIRM[action];
    const answer = await Taro.showModal({ title: text.title, content: text.content, confirmText: CONFIRM_TEXT[action], confirmColor: action === 'approve' ? '#194e41' : '#b4432f' });
    if (!answer.confirm) return; setBusy(request.id);
    try {
      if (action === 'approve' || action === 'reject') await api.decide(request.id, action === 'approve' ? 'APPROVED' : 'REJECTED');
      else if (action === 'revoke') await api.revoke(request.id);
      else await api.withdraw(request.id);
      notify(text.done);
    } catch (e) { notifyError(e); }
    finally { setBusy(''); await load(); void unread.refresh(); }
  };

  const tab = (value: ContactRole, label: string, unreadCount: number) => <Text className={role === value ? 'selected' : ''} onClick={() => setRole(value)}>
    {label}{badgeText(unreadCount) ? <Text className='seg-count'>{badgeText(unreadCount)}</Text> : null}
  </Text>;

  return <View className='page'>
    <PageTitle title='联系申请' subtitle={received ? '同意后对方才能看到这件商品的联系方式；同意后也可以撤回。' : '卖家同意后，到商品详情查看联系方式；待处理的申请可以撤回。'} />
    <LoginGate returnTo='/pages/notifications/index'>
      <View className='segmented'>
        {tab('received', '收到的', count.received)}
        {tab('sent', '发出的', count.updates)}
      </View>

      {error && !items.length ? <ErrorState message={error} retry={() => void load()} /> : loading && !items.length ? <Empty title='正在加载联系申请…' /> : !items.length ? <Empty title={received ? '暂时没有收到联系申请' : '还没有发出联系申请'} description={received ? '发布闲置后，同学可以向你申请联系。' : '找到喜欢的商品，点「我想要」申请联系。'} /> : items.map((r) => {
        const name = received ? (r.buyerNickname || '本校同学') : (r.sellerNickname || '卖家');
        const actions = availableActions(role, r.status);
        return <View className={`req-card ${CARD[r.status]} ${r.unread ? 'unread' : ''}`} key={r.id}>
          <View className='req-head'>
            <View className={`req-avatar ${r.status === 'PENDING' ? '' : 'mute'}`}>{name.slice(0, 1)}</View>
            <View><Text className='req-name'>{name}{r.unread ? <Text className='req-new'>新</Text> : null}</Text><Text className='req-sub'>{received ? '想联系你' : '我向卖家申请联系方式'}</Text></View>
            <Text className={`status-pill ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</Text>
          </View>
          <View className='req-product' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(r.productId)}` })}>
            <View className='req-thumb'>{(r.productTitle || '商').slice(0, 1)}</View>
            <View className='req-info'><Text className='req-title'>{r.productTitle || '查看商品'}</Text><Text className='req-price'>查看详情 ›</Text></View>
          </View>
          <View className='req-foot'>
            {actions.includes('approve') ? <>
              <Text className='accept' onClick={() => void act(r, 'approve')}>{busy === r.id ? '处理中…' : '同意联系'}</Text>
              <Text className='reject' onClick={() => void act(r, 'reject')}>拒绝</Text>
            </> : <Text className='req-note'>{statusNote(role, r.status)}</Text>}
            {actions.includes('revoke') && <Text className='reject' onClick={() => void act(r, 'revoke')}>{busy === r.id ? '处理中…' : '撤回同意'}</Text>}
            {actions.includes('withdraw') && <Text className='reject' onClick={() => void act(r, 'withdraw')}>{busy === r.id ? '处理中…' : '撤回申请'}</Text>}
            <Text className='req-time'>{timeAgo(r.updatedAt || r.createdAt)}</Text>
          </View>
        </View>;
      })}
      {Boolean(items.length) && (hasMoreContacts(items.length, total)
        ? <Button className='quiet-button' loading={loading} disabled={loading} onClick={() => void load(false)}>加载更多</Button>
        : <Button className='quiet-button' onClick={() => void load()}>已显示全部 {total} 条 · 刷新</Button>)}
      {error && Boolean(items.length) && <Text className='muted'>{error}</Text>}
    </LoginGate>
  </View>;
}
