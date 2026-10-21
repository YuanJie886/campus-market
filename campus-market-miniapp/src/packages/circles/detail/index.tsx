import Taro, { useDidShow, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { ApiError } from '../../../api/transport';
import { Empty, LoginGate, PageTitle } from '../../../components';
import type { Circle, DemandConditions, DiscoverableCircle } from '../../../model';
import { ARCHIVED_TEXT, CIRCLE_ROLE_LABEL, CIRCLE_TYPE_LABEL, LEAVE_AFTER, LEAVE_CONSEQUENCES, NOT_FOUND_TITLE, NOT_MEMBER_TEXT, OWNER_LEAVE_TEXT, USER_CREATED_NOTE, USER_CREATED_TEXT, isMember } from '../../../circles';
import { circleSubscribedText } from '../../../demand';
import { CIRCLE_PAGES } from '../../../menu';
import { demandUnread, useMarket } from '../../../state';
import { DemandForm } from '../../../widgets/DemandForm';
import { ReportSheet } from '../../../widgets/ReportSheet';

/** 圈子详情：无权查看与不存在显示同一句话；非成员只能看到可发现圈子的名称与简介。 */
export default function CircleDetailPage() {
  const { user } = useMarket(), id = useRouter().params.id ?? '';
  const [circle, setCircle] = useState<Circle | DiscoverableCircle | null | undefined>(undefined);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [subscribing, setSubscribing] = useState(false), [subscribeError, setSubscribeError] = useState(''), [reporting, setReporting] = useState(false);
  const empty = useMemo<DemandConditions>(() => ({}), []);
  const load = async () => {
    if (!user) return;
    try { setCircle(await api.circle(id)); setError(''); }
    catch (e) { if (e instanceof ApiError && e.code === 404) setCircle(null); else setError(e instanceof Error ? e.message : '加载失败'); }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });

  const leave = async () => {
    if (!user || !circle || busy) return;
    const answer = await Taro.showModal({ title: `退出「${circle.name}」？`, content: `退出后：\n${LEAVE_CONSEQUENCES.join('\n')}\n${LEAVE_AFTER}`, confirmText: '确认退出', confirmColor: '#b4432f' });
    if (!answer.confirm) return;
    setBusy(true);
    try { await api.removeCircleMember(id, user.id); void demandUnread.refresh(); void Taro.navigateBack(); }
    catch (e) { setError(e instanceof Error ? e.message : '退出失败，请重试'); }
    finally { setBusy(false); }
  };
  const subscribe = async (conditions: DemandConditions) => {
    setBusy(true); setSubscribeError('');
    try { const result = await api.createSubscription({ ...conditions, circleId: id }); setSubscribing(false); setStatus(circleSubscribedText(result)); }
    catch (e) { setSubscribeError(e instanceof Error ? e.message : '订阅失败，请重试'); }
    finally { setBusy(false); }
  };

  const member = circle && isMember(circle) ? circle : null;
  const manager = member && member.status === 'ACTIVE' && (member.myRole === 'OWNER' || member.myRole === 'MODERATOR');
  const archived = member?.status === 'ARCHIVED';
  return <View className='page'>
    <LoginGate returnTo={`${CIRCLE_PAGES.detail}?id=${encodeURIComponent(id)}`}>
      {circle === undefined && !error ? <Empty title='正在读取圈子…' /> : circle === null ? <View>
        <PageTitle title={NOT_FOUND_TITLE} />
        <Text className='muted'>如果你收到了邀请码，可以<Text className='text-action' onClick={() => void Taro.navigateTo({ url: CIRCLE_PAGES.join })}>用邀请码加入</Text>。</Text>
      </View> : !circle ? <Text className='error-text'>{error}</Text> : <>
        <PageTitle title={circle.name} subtitle={`${CIRCLE_TYPE_LABEL[circle.type]} · ${USER_CREATED_TEXT}${member ? ` · 我是${CIRCLE_ROLE_LABEL[member.myRole]}` : ''}${archived ? ' · 已归档' : ''}`} />
        {circle.description ? <Text className='description'>{circle.description}</Text> : null}
        <Text className='field-help'>{USER_CREATED_NOTE}</Text>
        {error ? <Text className='error-text'>{error}</Text> : null}
        {status ? <Text className='notice sheet-line'>{status}</Text> : null}
        {!member ? <Text className='notice sheet-line'>{NOT_MEMBER_TEXT}</Text> : archived ? <Text className='notice sheet-line'>{ARCHIVED_TEXT}</Text> : <View className='button-row wrap'>
          <Button className='primary small' onClick={() => void Taro.navigateTo({ url: `${CIRCLE_PAGES.products}?id=${encodeURIComponent(id)}` })}>圈子商品</Button>
          <Button className='secondary small' onClick={() => { setSubscribeError(''); setSubscribing(true); }}>订阅圈子新商品</Button>
          {manager && <Button className='secondary small' onClick={() => void Taro.navigateTo({ url: `${CIRCLE_PAGES.manage}?id=${encodeURIComponent(id)}` })}>管理圈子</Button>}
          {member.myRole !== 'OWNER' && <Button className='danger-button small' disabled={busy} onClick={() => void leave()}>退出圈子</Button>}
        </View>}
        {member && member.myRole === 'OWNER' && !archived ? <Text className='field-help'>{OWNER_LEAVE_TEXT}</Text> : null}
        {member && !archived && subscribing && <DemandForm title='订阅圈子新商品' submitLabel='订阅' initial={empty} userCampus={user?.campus ?? '东校区'} busy={busy} errorMessage={subscribeError}
          onCancel={() => setSubscribing(false)} onSubmit={(c) => void subscribe(c)} circleScope={{ name: circle.name }} />}
        {member?.myRole !== 'OWNER' && <View className='report-area'>
          <Text className='report-link' onClick={() => setReporting(!reporting)}>{reporting ? '收起' : '举报这个圈子'}</Text>
          {reporting && <ReportSheet targetType='CIRCLE' targetId={circle.id} targetLabel={circle.name} onClose={() => setReporting(false)} />}
        </View>}
      </>}
    </LoginGate>
  </View>;
}
