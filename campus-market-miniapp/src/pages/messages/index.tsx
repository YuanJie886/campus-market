import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, ErrorState, LoginGate, PageTitle } from '../../components';
import type { Conversation } from '../../model';
import { timeAgo } from '../../model';
import { conversationRole, counterpartOf, LIST_POLL_MS } from '../../messages';
import { badgeText } from '../../contacts';
import { messageUnread, useMarket, useMessageUnread, usePolling } from '../../state';
import { Avatar } from '../../widgets/Avatar';

/** 私信会话列表：只在页面显示时每 15 秒刷新一次（与 Web 相同）；未读数显示在顶部与「通知」角标。 */
export default function MessagesPage() {
  const { user } = useMarket();
  const unreadCount = useMessageUnread();
  const [items, setItems] = useState<Conversation[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({}), [names, setNames] = useState<Record<string, string>>({}), [avatars, setAvatars] = useState<Record<string, string>>({});
  const sequence = useRef(0), titleCache = useRef<Record<string, string>>({}), nameCache = useRef<Record<string, string>>({}), avatarCache = useRef<Record<string, string>>({});

  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current, uid = user.id;
    setLoading(true);
    try {
      const list = await api.conversations();
      if (gen !== sequence.current) return;
      setItems(list); setError(''); void messageUnread.refresh();
      const products = [...new Set(list.map((c) => c.productId))].filter((id) => !(id in titleCache.current));
      const people = [...new Set(list.map((c) => counterpartOf(c, uid)))].filter((id) => !(id in nameCache.current));
      await Promise.all([
        ...products.map((id) => api.detail(id).then((p) => { titleCache.current[id] = p.title; }).catch(() => { titleCache.current[id] = ''; })),
        ...people.map((id) => api.publicUser(id).then((u) => { nameCache.current[id] = u.nickname; avatarCache.current[id] = u.avatar ?? ''; }).catch(() => { nameCache.current[id] = ''; avatarCache.current[id] = ''; })),
      ]);
      if (gen === sequence.current) { setTitles({ ...titleCache.current }); setNames({ ...nameCache.current }); setAvatars({ ...avatarCache.current }); }
    } catch (e) { if (gen === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
    finally { if (gen === sequence.current) setLoading(false); }
  };
  useEffect(() => { sequence.current++; titleCache.current = {}; nameCache.current = {}; avatarCache.current = {}; setItems([]); }, [user?.id]);
  usePolling(load, LIST_POLL_MS, Boolean(user));
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });

  return <View className='page'>
    <PageTitle title='私信' subtitle={unreadCount ? `${badgeText(unreadCount)} 条未读` : '围绕某件商品和同学沟通；交换联系方式请使用「申请联系方式」。'} />
    <LoginGate returnTo='/pages/messages/index'>
      {error && !items.length ? <ErrorState message={error} retry={() => void load()} />
        : loading && !items.length ? <Empty title='正在加载私信…' />
          : !items.length ? <Empty title='还没有私信' description='在商品详情点「私信卖家」，可以用快捷消息询问。' />
            : items.map((c) => {
              const role = conversationRole(c, user?.id ?? ''), other = counterpartOf(c, user?.id ?? '');
              return <View className='req-card' key={c.id} onClick={() => void Taro.navigateTo({ url: `/pages/conversation/index?id=${encodeURIComponent(c.id)}` })}>
                <View className='req-head'>
                  <Avatar value={avatars[other]} userId={other} nickname={names[other]} size='small' />
                  <View><Text className='req-name'>{names[other] || (role === 'SELLER' ? '买家' : '卖家')}</Text><Text className='req-sub'>{role === 'SELLER' ? '我是卖家' : '我是买家'} · {titles[c.productId] || '商品当前不可见'}</Text></View>
                  <Text className='req-time conversation-time'>{timeAgo(c.updatedAt || c.createdAt)}</Text>
                </View>
              </View>;
            })}
      {error && Boolean(items.length) && <Text className='muted'>{error}</Text>}
    </LoginGate>
  </View>;
}
