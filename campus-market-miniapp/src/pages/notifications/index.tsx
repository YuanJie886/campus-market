import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate, PageTitle } from '../../components';
import type { ContactRequest } from '../../model';
import { timeAgo } from '../../model';
import { notify, notifyError, useMarket } from '../../state';

const LABELS = { PENDING: '待处理', APPROVED: '已同意', REJECTED: '未同意' };
const TONES = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'mute' };
const CARD = { PENDING: '', APPROVED: 'done', REJECTED: 'dead' };

export default function NotificationsPage() {
  const { user } = useMarket();
  const [items, setItems] = useState<ContactRequest[]>([]), [received, setReceived] = useState(true), [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState('');
  const sequence = useRef(0), identity = useRef(user?.id); identity.current = user?.id;

  const load = async () => {
    if (!user) return; const gen = ++sequence.current, uid = user.id;
    setLoading(true); setError('');
    try { const values = await api.contacts(); if (gen === sequence.current && uid === identity.current) setItems(values); }
    catch (e) { if (gen === sequence.current && uid === identity.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useEffect(() => { sequence.current++; setItems([]); void load(); }, [user?.id]);
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });

  const incoming = items.filter((r) => r.sellerId === user?.id);
  const outgoing = items.filter((r) => r.buyerId === user?.id);
  const displayed = received ? incoming : outgoing;
  const pendingCount = incoming.filter((r) => r.status === 'PENDING').length;

  const decide = async (request: ContactRequest, status: 'APPROVED' | 'REJECTED') => {
    if (busy) return;
    const answer = await Taro.showModal({ title: status === 'APPROVED' ? '同意这次联系申请？' : '暂不同意这次申请？', content: status === 'APPROVED' ? '同意后，该同学可以查看这件商品的联系方式。' : '对方不会看到你的联系方式。', confirmColor: '#194e41' });
    if (!answer.confirm) return; setBusy(request.id);
    try { await api.decide(request.id, status); await load(); notify(status === 'APPROVED' ? '已同意联系' : '已处理申请'); }
    catch (e) { notifyError(e); } finally { setBusy(''); }
  };

  const note = (r: ContactRequest) => {
    if (received) return r.status === 'PENDING' ? '等待你处理' : r.status === 'APPROVED' ? '已同意，对方可查看联系方式' : '已婉拒，对方不会看到联系方式';
    return r.status === 'PENDING' ? '等待卖家同意后查看联系方式' : r.status === 'APPROVED' ? '卖家已同意，请到商品详情查看联系方式' : '卖家暂未同意这次申请';
  };

  return <View className='page'>
    <PageTitle title='联系申请' subtitle={pendingCount ? `${pendingCount} 条待处理 · 同意后对方才能看到你的联系方式` : '同意后对方才能看到你的联系方式，不影响商品在售状态。'} />
    <LoginGate returnTo='/pages/notifications/index'>
      <View className='segmented'>
        <Text className={received ? 'selected' : ''} onClick={() => setReceived(true)}>收到的<Text className='seg-count'>{incoming.length}</Text></Text>
        <Text className={!received ? 'selected' : ''} onClick={() => setReceived(false)}>发出的<Text className='seg-count'>{outgoing.length}</Text></Text>
      </View>

      {error ? <ErrorState message={error} retry={() => void load()} /> : loading && !items.length ? <Empty title='正在加载联系申请…' /> : !displayed.length ? <Empty title={received ? '暂时没有收到联系申请' : '还没有发出联系申请'} description={received ? '发布闲置后，同学可以向你申请联系。' : '找到喜欢的商品，点「我想要」申请联系。'} /> : displayed.map((r) => <View className={`req-card ${CARD[r.status]}`} key={r.id}>
        <View className='req-head'>
          <View className={`req-avatar ${r.status === 'PENDING' ? '' : 'mute'}`}>{received ? (r.buyerNickname || '同').slice(0, 1) : '我'}</View>
          <View><Text className='req-name'>{received ? (r.buyerNickname || '本校同学') : '我发出的申请'}</Text><Text className='req-sub'>{received ? '想联系你' : '等待对方回应'}</Text></View>
          <Text className={`status-pill ${TONES[r.status]}`}>{LABELS[r.status]}</Text>
        </View>
        <View className='req-product' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(r.productId)}` })}>
          <View className='req-thumb'>{(r.productTitle || '商').slice(0, 1)}</View>
          <View className='req-info'><Text className='req-title'>{r.productTitle || '查看商品'}</Text><Text className='req-price'>查看详情 ›</Text></View>
        </View>
        <View className='req-foot'>
          {received && r.status === 'PENDING' ? <>
            <Text className='accept' onClick={() => void decide(r, 'APPROVED')}>{busy === r.id ? '处理中…' : '同意联系'}</Text>
            <Text className='reject' onClick={() => void decide(r, 'REJECTED')}>暂不同意</Text>
          </> : <Text className='req-note'>{note(r)}</Text>}
          <Text className='req-time'>{timeAgo(r.createdAt)}</Text>
        </View>
      </View>)}
      {Boolean(displayed.length) && <Button className='quiet-button' onClick={() => void load()}>刷新列表</Button>}
    </LoginGate>
  </View>;
}
