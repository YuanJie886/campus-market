import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Text, Textarea, View } from '@tarojs/components';
import { useRef, useState } from 'react';
import { api } from '../../api';
import { Empty, LoginGate, PageTitle } from '../../components';
import type { AppealSummary, MyGovernance } from '../../model';
import {
  APPEAL_DONE, APPEAL_INTRO, APPEAL_REASON_MAX, NOTICE_EXPLAIN, NOTICE_SECTION_LABEL, RESTRICTION_SOURCE_LABEL, SCOPE_LABEL, SCOPE_STILL_ALLOWED, MY_RESTRICTIONS_INTRO,
  appealError, appealInput, appealStatusText, formatUntil, groupGovernance, otherNoticeTitle, pastRestrictionText, productNoticeTitle, type AppealTarget,
} from '../../governance';
import { useMarket } from '../../state';

/**
 * 我的限制：只有本人看得到。每条限制写明范围、到期时间（具体时间 + 还剩多久）、来源、仍然可以做的事与申诉状态；
 * 每条限制 / 每次处理只能申诉一次。历史上的爽约确认与自动限制只作记录展示。文案与 Web「我的限制」一致。
 */
export default function MyRestrictionsPage() {
  const { user } = useMarket();
  const [data, setData] = useState<MyGovernance | null>(null), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [target, setTarget] = useState<AppealTarget | null>(null), [reason, setReason] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = async () => {
    if (!user) return;
    const gen = ++sequence.current;
    try { const next = await api.myGovernance(); if (gen === sequence.current) { setData(next); setError(''); } }
    catch (e) { if (gen === sequence.current) setError(e instanceof Error ? e.message : '加载失败'); }
  };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });

  const openAppeal = (t: AppealTarget) => { setTarget(t); setReason(''); setFormError(''); setStatus(''); };
  const submit = async () => {
    if (!target || busy) return;
    const problem = appealError(reason);
    if (problem) { setFormError(problem); return; }
    setBusy(true); setFormError('');
    try { await api.appeal(appealInput(target, reason)); setTarget(null); setStatus(APPEAL_DONE); await load(); }
    catch (e) { setFormError(e instanceof Error ? e.message : '提交失败，请重试'); }
    finally { setBusy(false); }
  };
  const appealLine = (appeal: AppealSummary | null) => appeal ? <Text className='gov-line'>申诉：{appealStatusText(appeal)}</Text> : null;
  const appealForm = (id: string) => target?.id === id ? <View className='panel report-panel'>
    <Text className='section-title'>提出申诉</Text>
    <Text className='muted sheet-line'>申诉对象：{target.label}。{APPEAL_INTRO}</Text>
    <Textarea className='field-input field-textarea' value={reason} maxlength={APPEAL_REASON_MAX} placeholder='申诉理由' onInput={(e) => setReason(e.detail.value)} />
    <Text className='field-help'>最多 {APPEAL_REASON_MAX} 字</Text>
    {formError ? <Text className='error-text'>{formError}</Text> : null}
    <View className='button-row'>
      <Button className='secondary small' onClick={() => setTarget(null)}>取消</Button>
      <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>提交申诉</Button>
    </View>
  </View> : null;

  const groups = data ? groupGovernance(data) : null;
  return <View className='page'>
    <PageTitle title='我的限制' subtitle={MY_RESTRICTIONS_INTRO} />
    <LoginGate returnTo='/pages/my-restrictions/index'>
      {status ? <Text className='notice gov-status'>{status}</Text> : null}
      {error ? <Text className='error-text'>{error}</Text> : null}
      {!groups ? <Empty title={error ? '暂时无法读取' : '正在读取…'} /> : <>
        <Text className='gov-heading'>生效中的限制</Text>
        {!groups.active.length ? <Text className='muted gov-empty'>目前没有生效中的限制。</Text> : groups.active.map((r) => <View className='req-card gov-active' key={r.id}>
          <Text className='req-name'>暂时不能：{SCOPE_LABEL[r.scope] ?? r.scope}（生效中）</Text>
          <Text className='gov-line'>解除时间：{formatUntil(r.endsAt)}</Text>
          <Text className='gov-line'>来源：{RESTRICTION_SOURCE_LABEL[r.source] ?? r.source}</Text>
          <Text className='gov-meta'>{SCOPE_STILL_ALLOWED[r.scope] ?? ''}</Text>
          {appealLine(r.appeal)}
          {r.canAppeal && target?.id !== r.id && <Text className='text-action gov-appeal' onClick={() => openAppeal({ kind: 'restriction', id: r.id, label: `「${SCOPE_LABEL[r.scope]}」限制` })}>对「{SCOPE_LABEL[r.scope]}」限制提出申诉</Text>}
          {appealForm(r.id)}
        </View>)}

        {groups.productNotices.length > 0 && <>
          <Text className='gov-heading'>商品处理</Text>
          {groups.productNotices.map((n) => <View className='req-card' key={n.actionId}>
            <Text className='req-name'>{productNoticeTitle(n)}</Text>
            {appealLine(n.appeal)}
            {n.canAppeal && target?.id !== n.actionId && <Text className='text-action gov-appeal' onClick={() => openAppeal({ kind: 'action', id: n.actionId, label: `商品「${n.targetLabel}」被隐藏` })}>对商品「{n.targetLabel}」被隐藏提出申诉</Text>}
            {appealForm(n.actionId)}
          </View>)}
        </>}

        {groups.otherNotices.length > 0 && <>
          <Text className='gov-heading'>留言、私信与历史记录</Text>
          {groups.otherNotices.map((n) => <View className='req-card' key={n.actionId}>
            <Text className='req-name'>{otherNoticeTitle(n)}</Text>
            <Text className='gov-meta'>{NOTICE_EXPLAIN[n.actionCode] ?? ''}</Text>
            {appealLine(n.appeal)}
            {n.canAppeal && target?.id !== n.actionId && <Text className='text-action gov-appeal' onClick={() => openAppeal({ kind: 'action', id: n.actionId, label: `${NOTICE_SECTION_LABEL[n.actionCode]}（${n.targetLabel}）` })}>对「{NOTICE_SECTION_LABEL[n.actionCode]}」提出申诉</Text>}
            {appealForm(n.actionId)}
          </View>)}
        </>}

        {groups.past.length > 0 && <>
          <Text className='gov-heading'>已结束的限制（{groups.past.length}）</Text>
          {groups.past.map((r) => <Text className='gov-line gov-past' key={r.id}>· {pastRestrictionText(r)}</Text>)}
        </>}
      </>}
    </LoginGate>
  </View>;
}
