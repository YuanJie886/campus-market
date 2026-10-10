import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate, PageTitle } from '../../components';
import type { ContactRequest } from '../../model';
import { timeAgo } from '../../model';
import { notify, notifyError, useMarket } from '../../state';

const labels = { PENDING: '等待处理', APPROVED: '已同意', REJECTED: '未同意' };
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
  const displayed = items.filter((r) => received ? r.sellerId === user?.id : r.buyerId === user?.id);
  const decide = async (request: ContactRequest, status: 'APPROVED' | 'REJECTED') => {
    if (busy) return;
    const answer = await Taro.showModal({ title: status === 'APPROVED' ? '同意这次联系申请？' : '暂不同意这次申请？', content: status === 'APPROVED' ? '同意后，该同学可以查看这件商品的联系方式。' : '对方不会看到你的联系方式。', confirmColor: '#194e41' });
    if (!answer.confirm) return; setBusy(request.id);
    try { await api.decide(request.id, status); await load(); notify(status === 'APPROVED' ? '已同意联系' : '已处理申请'); }
    catch (e) { notifyError(e); } finally { setBusy(''); }
  };
  return <View className='page'><PageTitle title='每一次联系，都由你决定' subtitle='申请和同意只针对这件商品，不影响商品在售状态。' /><LoginGate returnTo='/pages/notifications/index'>
    <View className='segmented'><Text className={received ? 'selected' : ''} onClick={() => setReceived(true)}>收到的申请</Text><Text className={!received ? 'selected' : ''} onClick={() => setReceived(false)}>发出的申请</Text></View>
    <View className='result-line'><Text>{displayed.length} 条申请</Text><Text className='text-action' onClick={() => void load()}>刷新</Text></View>
    {error ? <ErrorState message={error} retry={() => void load()} /> : loading && !items.length ? <Empty title='正在加载联系申请…' /> : !displayed.length ? <Empty title={received ? '暂时没有收到联系申请' : '还没有发出联系申请'} description={received ? '发布闲置后，同学可以向你申请联系。' : '找到喜欢的商品，点击「我想要」申请联系。'} /> : displayed.map((r) => <View className='request-card' key={r.id}>
      <View className='request-top'><Text className='status-pill'>{labels[r.status]}</Text><Text className='muted'>{timeAgo(r.createdAt)}</Text></View>
      <Text className='request-title' onClick={() => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(r.productId)}` })}>{r.productTitle || '查看商品'} ↗</Text>
      <Text className='muted'>{received ? `${r.buyerNickname || '本校同学'} 想联系你` : r.status === 'APPROVED' ? '卖家已同意，请到商品详情查看联系方式。' : r.status === 'REJECTED' ? '卖家暂未同意这次申请。' : '等待卖家同意后查看联系方式。'}</Text>
      {received && r.status === 'PENDING' && <View className='button-row'><Button className='secondary' disabled={Boolean(busy)} onClick={() => void decide(r, 'REJECTED')}>暂不同意</Button><Button className='primary' loading={busy === r.id} disabled={Boolean(busy)} onClick={() => void decide(r, 'APPROVED')}>同意联系</Button></View>}
    </View>)}
  </LoginGate></View>;
}
