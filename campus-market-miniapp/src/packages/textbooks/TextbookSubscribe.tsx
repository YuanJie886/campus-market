import { Button, Input, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../api';
import type { BuildingScope, TextbookEdition } from '../../model';
import { editionLines } from '../../catalog';
import { SCOPE_LABEL, TEXTBOOK_SUBSCRIBE_NOTE, textbookScopes, textbookSubscribeInput, textbookSubscribedText } from '../../demand';
import { demandUnread } from '../../state';

/** 无货时订阅这个教材版本（与 Web TextbookSubscribeDialog 一致）：按版本 id 精确匹配，用户只选地理范围和可选预算。 */
export function TextbookSubscribe({ edition, hasDorm, onClose, onDone }: { edition: Pick<TextbookEdition, 'id' | 'title' | 'editionLabel' | 'isbn' | 'authors' | 'publisher' | 'publishedYear'>; hasDorm: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [scope, setScope] = useState<BuildingScope>('SCHOOL'), [maxPrice, setMaxPrice] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async () => {
    const input = textbookSubscribeInput(edition.id, scope, maxPrice);
    if ('error' in input) { setError(input.error); return; }
    setBusy(true); setError('');
    try { const result = await api.createSubscription(input.conditions); void demandUnread.refresh(); onDone(textbookSubscribedText(result)); }
    catch (e) { setError(e instanceof Error ? e.message : '订阅失败，请重试'); }
    finally { setBusy(false); }
  };
  return <View className='panel'>
    <Text className='section-title'>订阅这个教材版本</Text>
    <Text className='req-name'>{edition.title} {edition.editionLabel}</Text>
    {editionLines(edition).map((line) => <Text key={line} className='muted sheet-line'>{line}</Text>)}
    <Text className='field-help'>{TEXTBOOK_SUBSCRIBE_NOTE}</Text>
    <Text className='field-label'>范围</Text>
    <View className='choice-grid'>{textbookScopes(hasDorm).map((s) => <Text key={s} className={`choice ${scope === s ? 'active' : ''}`} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</Text>)}</View>
    <Text className='field-label'>最高预算（元，选填）</Text>
    <Input className='field-input' type='digit' value={maxPrice} onInput={(e) => setMaxPrice(e.detail.value)} />
    {error ? <Text className='error-text'>{error}</Text> : null}
    <View className='button-row'>
      <Button className='secondary small' disabled={busy} onClick={onClose}>取消</Button>
      <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>确认订阅</Button>
    </View>
  </View>;
}
