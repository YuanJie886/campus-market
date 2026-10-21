import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../../api';
import { Empty, LoginGate, PageTitle } from '../../../components';
import type { TextbookSuggestion } from '../../../model';
import { SUGGESTION_NOTE, formatIsbn, suggestionStatusLabel, termLabel, usageLabel } from '../../../catalog';
import { formatDateTime } from '../../../governance';
import { TEXTBOOK_PAGES } from '../../../menu';
import { useMarket } from '../../../state';

/** 我的教材建议：只有本人可见；状态只有「待审核（未公开）」与「已撤回」，没有审核进度。 */
export default function TextbookSuggestionsPage() {
  const { user } = useMarket();
  const [items, setItems] = useState<TextbookSuggestion[] | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const load = async () => { if (!user) return; try { setItems(await api.myTextbookSuggestions()); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); } };
  useDidShow(() => { void load(); });
  usePullDownRefresh(() => { void load().finally(() => Taro.stopPullDownRefresh()); });
  const withdraw = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try { await api.withdrawTextbookSuggestion(id); setStatus('已撤回这条建议'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : '撤回失败'); } finally { setBusy(false); }
  };
  return <View className='page'>
    <PageTitle title='我的教材建议' subtitle={SUGGESTION_NOTE} />
    <LoginGate returnTo={TEXTBOOK_PAGES.suggestions}>
      {status ? <Text className='notice sheet-line'>{status}</Text> : null}
      {error ? <Text className='error-text'>{error}</Text> : null}
      {items === null && !error ? <Empty title='正在读取…' /> : items && !items.length ? <View>
        <Text className='muted'>还没有提交过建议。可以在 <Text className='text-action' onClick={() => void Taro.navigateTo({ url: TEXTBOOK_PAGES.courses })}>课程教材</Text> 的课程页里提交。</Text>
      </View> : (items ?? []).map((s) => <View key={s.id} className='req-card'>
        <Text className='req-name'>{s.courseName} · {s.academicYear} {termLabel(s.term)}</Text>
        <Text className='req-sub'>{s.textbookEditionId ? `${s.editionTitle ?? ''} ${s.editionEditionLabel ?? ''}` : s.isbn ? `ISBN ${formatIsbn(s.isbn)}` : `${s.title ?? ''} ${s.editionLabel ?? ''} · ${s.publisher ?? ''}`} · {usageLabel(s.usageType)} · {formatDateTime(s.createdAt)}</Text>
        <View className='section-head'><Text className='muted'>{suggestionStatusLabel(s.status)}</Text>{s.status === 'PENDING' && <Text className='text-action' onClick={() => void withdraw(s.id)}>撤回</Text>}</View>
      </View>)}
    </LoginGate>
  </View>;
}
