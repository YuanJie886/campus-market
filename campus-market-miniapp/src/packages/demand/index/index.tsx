import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Switch, Text, View } from '@tarojs/components';
import { useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { Empty, ErrorState, LoginGate, PageTitle } from '../../../components';
import { money, timeAgo, type DemandConditions, type DemandMatch, type DemandSubscription } from '../../../model';
import { DELETED_DONE, DEMANDS_INTRO, INVALID_LABEL, NO_MATCHES, NO_SUBSCRIPTIONS, describeConditions, reasonLabel, subscribeResultText, tierLabel } from '../../../demand';
import { DEMAND_PAGES } from '../../../menu';
import { demandUnread, notify, notifyError, useMarket, useSchools } from '../../../state';
import { DemandForm } from '../../../widgets/DemandForm';

type Tab = 'matches' | 'subscriptions';
const openProduct = (id: string) => void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}` });

/**
 * 需求匹配收件箱与订阅管理：只展示本人订阅产生的匹配；打开商品后走与商品详情相同的联系申请流程。
 * 未读数显示在「通知」角标上；打开、标记已读、忽略后立即更新。
 */
export default function DemandsPage() {
  const { user } = useMarket(), { catalog } = useSchools(), router = useRouter();
  const [tab, setTab] = useState<Tab>(router.params.tab === 'subscriptions' ? 'subscriptions' : 'matches');
  const [matches, setMatches] = useState<DemandMatch[] | null>(null), [subs, setSubs] = useState<DemandSubscription[] | null>(null), [error, setError] = useState('');
  const [editing, setEditing] = useState<DemandSubscription | 'new' | null>(null), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = async (current: Tab = tab) => {
    if (!user) return;
    const gen = ++sequence.current;
    try {
      if (current === 'matches') { const page = await api.demandMatches(1, 50); if (gen === sequence.current) setMatches(page.items); }
      else { const list = await api.subscriptions(); if (gen === sequence.current) setSubs(list); }
      if (gen === sequence.current) setError('');
    } catch (e) { if (gen === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
    void demandUnread.refresh();
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const switchTab = (next: Tab) => { setTab(next); setEditing(null); setError(''); void load(next); };
  /** 标记已读 / 忽略返回新的未读数，直接写进「通知」角标。 */
  const act = async (fn: () => Promise<number>) => { try { demandUnread.set(await fn()); await load(); } catch (e) { notifyError(e); } };
  const view = (m: DemandMatch) => { if (!m.read) void act(() => api.markDemandRead(m.id)); openProduct(m.product.id); };
  const toggle = async (s: DemandSubscription) => { try { await api.updateSubscription(s.id, { active: !s.active }); await load(); } catch (e) { notifyError(e); } };
  const remove = async (s: DemandSubscription) => { try { await api.deleteSubscription(s.id); notify(DELETED_DONE); await load(); } catch (e) { notifyError(e); } };
  const save = async (conditions: DemandConditions) => {
    if (!editing) return;
    setBusy(true); setFormError('');
    try {
      if (editing === 'new') notify(subscribeResultText(await api.createSubscription(conditions)));
      else await api.updateSubscription(editing.id, conditions);
      setEditing(null); await load();
    } catch (e) { setFormError(e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const initial = useMemo<DemandConditions>(() => editing && editing !== 'new' ? editing : {}, [editing]);

  return <View className='page'>
    <PageTitle title='需求匹配' subtitle={DEMANDS_INTRO} />
    <LoginGate returnTo={DEMAND_PAGES.inbox}>
      <View className='segmented'>
        <Text className={tab === 'matches' ? 'selected' : ''} onClick={() => switchTab('matches')}>匹配收件箱</Text>
        <Text className={tab === 'subscriptions' ? 'selected' : ''} onClick={() => switchTab('subscriptions')}>我的订阅</Text>
      </View>
      {error ? <ErrorState message={error} retry={() => void load()} /> : tab === 'matches' ? (
        matches === null ? <Empty title='加载中…' /> : !matches.length ? <Empty title={NO_MATCHES} action={<Button className='secondary' onClick={() => void Taro.switchTab({ url: '/pages/market/index' })}>去逛逛</Button>} />
          : matches.map((m) => <View key={m.id} className={`req-card ${m.read ? '' : 'unread'}`}>
            <View className='section-head'>
              <Text className='req-name' onClick={() => view(m)}>{m.product.title}{m.read ? null : <Text className='req-new'>未读</Text>}</Text>
              <Text className='status-pill ok'>{tierLabel(m.tier)}</Text>
            </View>
            <Text className='price'><Text className='currency'>¥</Text>{money(m.product.price)}</Text>
            <Text className='req-sub'>命中订阅：{describeConditions(m.subscription, (id) => catalog.campusLabel(id))} · {timeAgo(m.createdAt)}</Text>
            <Text className='req-sub'>匹配理由：{m.reasonCodes.map(reasonLabel).join('、')}</Text>
            {!m.valid && m.invalidReason ? <Text className='gov-note warn'>{INVALID_LABEL[m.invalidReason]}</Text> : null}
            <View className='button-row wrap'>
              <Button className='secondary small' onClick={() => view(m)}>查看商品</Button>
              {m.valid && <Button className='primary small' onClick={() => view(m)}>申请联系卖家</Button>}
              {!m.read && <Button className='secondary small' onClick={() => void act(() => api.markDemandRead(m.id))}>标记已读</Button>}
              <Button className='quiet-button small' onClick={() => void act(() => api.dismissDemandMatch(m.id))}>忽略</Button>
            </View>
          </View>)
      ) : <>
        {editing ? <DemandForm title={editing === 'new' ? '订阅一个需求' : '修改订阅条件'} submitLabel={editing === 'new' ? '确认订阅' : '保存'} initial={initial} userCampus={user?.campus ?? ''} busy={busy}
          errorMessage={formError} onCancel={() => setEditing(null)} onSubmit={(c) => void save(c)} circleScope={editing !== 'new' && editing.circle ? { name: editing.circle.name } : null} />
          : <Button className='primary small' onClick={() => { setFormError(''); setEditing('new'); }}>新建订阅</Button>}
        {subs === null ? <Empty title='加载中…' /> : !subs.length ? <Empty title={NO_SUBSCRIPTIONS} /> : subs.map((s) => <View key={s.id} className='req-card'>
          <Text className='req-name'>{describeConditions(s, (id) => catalog.campusLabel(id))}</Text>
          <Text className='req-sub'>已匹配 {s.matchCount} 件{s.active ? '' : ' · 已停用'}</Text>
          <View className='switch-row'>
            <Text className='muted'>{s.active ? '启用中' : '已停用'}</Text>
            <Switch color='#194E41' checked={s.active} onChange={() => void toggle(s)} />
          </View>
          <View className='button-row'>
            <Button className='secondary small' onClick={() => { setFormError(''); setEditing(s); }}>修改</Button>
            <Button className='quiet-button small' onClick={() => void remove(s)}>删除</Button>
          </View>
        </View>)}
      </>}
    </LoginGate>
  </View>;
}
