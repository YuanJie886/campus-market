import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api } from '../../../api';
import { Empty, LoginGate, PageTitle } from '../../../components';
import type { Circle, DiscoverableCircle } from '../../../model';
import { CIRCLE_ROLE_LABEL, CIRCLE_TYPE_LABEL, USER_CREATED_NOTE, USER_CREATED_TEXT } from '../../../circles';
import { CIRCLE_PAGES } from '../../../menu';
import { useMarket } from '../../../state';

const open = (id: string) => void Taro.navigateTo({ url: `${CIRCLE_PAGES.detail}?id=${encodeURIComponent(id)}` });

/** 我的圈子：圈子只能通过邀请加入；「可发现」的圈子只显示名称和简介，没有「申请加入」按钮。搜索词只在页面状态里。 */
export default function CirclesPage() {
  const { user } = useMarket();
  const [mine, setMine] = useState<Circle[] | null>(null), [found, setFound] = useState<DiscoverableCircle[] | null>(null);
  const [query, setQuery] = useState(''), [error, setError] = useState(''), [showArchived, setShowArchived] = useState(false);
  const sequence = useRef(0);
  const search = async (q: string) => { try { setFound(await api.discoverCircles(q.trim() || undefined)); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } };
  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current; setError('');
    try { const list = await api.myCircles(); if (gen === sequence.current) setMine(list); }
    catch (e) { if (gen === sequence.current) { setMine([]); setError(e instanceof Error ? e.message : '加载失败'); } }
    await search(query);
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const active = (mine ?? []).filter((c) => c.status === 'ACTIVE'), archived = (mine ?? []).filter((c) => c.status !== 'ACTIVE');
  return <View className='page'>
    <PageTitle title='我的圈子' subtitle={`${USER_CREATED_NOTE}加入圈子需要成员给你的邀请码。`} />
    <LoginGate returnTo={CIRCLE_PAGES.list}>
      <View className='button-row'>
        <Button className='primary small' onClick={() => void Taro.navigateTo({ url: CIRCLE_PAGES.create })}>创建圈子</Button>
        <Button className='secondary small' onClick={() => void Taro.navigateTo({ url: CIRCLE_PAGES.join })}>用邀请码加入</Button>
      </View>
      {error ? <Text className='error-text'>{error}</Text> : null}
      <Text className='gov-heading'>已加入</Text>
      {mine === null ? <Empty title='正在读取…' /> : !active.length ? <Text className='muted'>你还没有加入任何圈子。</Text> : active.map((c) => <View className='req-card' key={c.id} onClick={() => open(c.id)}>
        <Text className='req-name'>{c.name}</Text>
        <Text className='req-sub'>{CIRCLE_TYPE_LABEL[c.type]} · {USER_CREATED_TEXT} · 我是{CIRCLE_ROLE_LABEL[c.myRole]} · {c.visibility === 'PRIVATE' ? '私密' : '可发现'}</Text>
      </View>)}
      {archived.length > 0 && <View>
        <Text className='text-action' onClick={() => setShowArchived(!showArchived)}>已归档的圈子（{archived.length}）</Text>
        {showArchived && archived.map((c) => <Text key={c.id} className='muted sheet-line' onClick={() => open(c.id)}>{c.name}（已归档，只读）</Text>)}
      </View>}
      <Text className='gov-heading'>本校可发现的圈子</Text>
      <Text className='field-help'>这里只列出创建者设为「可发现」的圈子。想加入，请向圈子成员要邀请码。</Text>
      <View className='inline-row'>
        <Input className='field-input' value={query} placeholder='圈子名称' maxlength={30} confirmType='search' onInput={(e) => setQuery(e.detail.value)} onConfirm={() => void search(query)} />
        <Button className='secondary small' onClick={() => void search(query)}>搜索</Button>
      </View>
      {found === null ? <Empty title='正在读取…' /> : !found.length ? <Text className='muted'>没有找到可发现的圈子。</Text> : found.map((c) => <View className='req-card' key={c.id} onClick={() => { if (c.joined) open(c.id); }}>
        <Text className='req-name'>{c.name}</Text>
        <Text className='req-sub'>{CIRCLE_TYPE_LABEL[c.type]} · {USER_CREATED_TEXT}{c.joined ? ' · 已加入' : ' · 需要邀请码加入'}</Text>
        {c.description ? <Text className='muted'>{c.description}</Text> : null}
      </View>)}
    </LoginGate>
  </View>;
}
