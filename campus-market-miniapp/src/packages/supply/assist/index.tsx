import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { ApiError } from '../../../api/transport';
import { Empty, LoginGate, PageTitle } from '../../../components';
import type { ListingDraft } from '../../../model';
import { ASSISTANT_ROLE_TEXT, draftTitle, tokenFromInput } from '../../../supply';
import { SUPPLY_PAGES } from '../../../menu';
import { useMarket } from '../../../state';
import { DraftEditor } from '../DraftEditor';

/** 协助人页面：兑换邀请码（只放进请求体），整理被邀请的草稿。这里没有发布按钮。 */
export default function AssistPage() {
  const { user } = useMarket();
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [drafts, setDrafts] = useState<ListingDraft[] | null>(null), [selected, setSelected] = useState<string | null>(null), [reloadTick, setReloadTick] = useState(0);
  const load = async () => { if (!user) return; try { setDrafts(await api.assistingDrafts()); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const redeem = async () => {
    const value = tokenFromInput(token);
    if (!value || busy) return;
    setBusy(true); setError('');
    try { const r = await api.redeemAssistInvite(value); setToken(''); setDrafts(r.drafts); setStatus(`已加入协助，可以整理 ${r.drafts.length} 件草稿`); }
    catch (e) { setError(e instanceof Error ? e.message : '兑换失败'); }
    finally { setBusy(false); }
  };
  const reloadOne = async (id: string) => {
    try { const fresh = await api.draft(id); setDrafts((list) => (list ?? []).map((d) => (d.id === id ? fresh : d))); setReloadTick((n) => n + 1); }
    catch (e) {
      // 撤销或过期后协助人不能再读取：从列表中移除
      if (e instanceof ApiError && e.code === 404) { setDrafts((list) => (list ?? []).filter((d) => d.id !== id)); setSelected(null); }
      setError(e instanceof Error ? e.message : '加载失败');
    }
  };
  const current = drafts?.find((d) => d.id === selected) ?? null;
  return <View className='page'>
    <PageTitle title='协助整理发布' subtitle={ASSISTANT_ROLE_TEXT} />
    <LoginGate returnTo={SUPPLY_PAGES.assist}>
      <View className='form-card'>
        <Text className='field-label'>邀请码</Text>
        <Input className='field-input' value={token} maxlength={300} placeholder='邀请码或邀请链接' onInput={(e) => setToken(e.detail.value)} />
        <Button className='primary mt-12' disabled={busy || !token.trim()} loading={busy} onClick={() => void redeem()}>兑换</Button>
      </View>
      {status ? <Text className='notice sheet-line'>{status}</Text> : null}
      {error ? <Text className='error-text'>{error}</Text> : null}
      <Text className='gov-heading'>我正在协助的草稿</Text>
      {drafts === null ? <Empty title='正在读取…' /> : !drafts.length ? <Text className='muted'>还没有可以协助的草稿。请向商品所有者要一个邀请码。</Text>
        : drafts.map((d) => <View key={d.id} className={`req-card ${selected === d.id ? 'unread' : ''}`} onClick={() => setSelected(d.id)}>
          <Text className='req-name'>{draftTitle(d)} · {d.status === 'READY' ? '所有者已标记可发布' : '整理中'}</Text>
        </View>)}
      {current && <DraftEditor key={`${current.id}:${reloadTick}`} draft={current} assistant label='协助整理'
        onSaved={(saved) => setDrafts((list) => (list ?? []).map((d) => (d.id === saved.id ? saved : d)))} onReload={() => void reloadOne(current.id)} />}
    </LoginGate>
  </View>;
}
