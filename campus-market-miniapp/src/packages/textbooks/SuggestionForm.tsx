import { Button, Input, Picker, Text, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../../api';
import type { CourseOffering, TextbookUsage } from '../../model';
import { SUGGESTION_NOTE, SUGGESTION_NOTE_HELP, USAGE_OPTIONS, offeringLabel, suggestionDoneText, suggestionInput, suggestionProblems, usageLabel, type SuggestionForm as Form } from '../../catalog';

/**
 * 教材建议（与 Web TextbookSuggestionDialog 一致）：只提交书目信息与用途；建议永远是「待审核（未公开）」。
 * 内容安全等服务端 400 原样显示在提交按钮上方。
 */
export function SuggestionForm({ offerings, onClose, onDone }: { offerings: CourseOffering[]; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState<Form>({ offeringId: offerings[0]?.id ?? '', mode: 'isbn', isbn: '', title: '', authors: '', publisher: '', editionLabel: '', usage: 'REQUIRED', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({}), [serverError, setServerError] = useState(''), [busy, setBusy] = useState(false);
  const patch = (part: Partial<Form>) => setForm((f) => ({ ...f, ...part }));
  const submit = async () => {
    if (busy) return;
    const next = suggestionProblems(form);
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true); setServerError('');
    try { const result = await api.createTextbookSuggestion(suggestionInput(form)); onDone(suggestionDoneText(result.outcome)); }
    catch (e) { setServerError(e instanceof Error ? e.message : '提交失败，请重试'); }
    finally { setBusy(false); }
  };
  const err = (key: string) => errors[key] ? <Text className='error-text'>{errors[key]}</Text> : null;
  return <View className='panel'>
    <Text className='section-title'>为这门课建议教材</Text>
    <Text className='field-help'>{SUGGESTION_NOTE}</Text>
    {Object.keys(errors).length > 0 && <Text className='error-text'>提交前请先修正以下问题</Text>}
    <Text className='field-label'>开课学期</Text>
    <Picker range={offerings.map(offeringLabel)} value={Math.max(0, offerings.findIndex((o) => o.id === form.offeringId))} onChange={(e) => patch({ offeringId: offerings[Number(e.detail.value)]?.id ?? '' })}>
      <View className='picker'><Text className='picker-value'>{offerings.find((o) => o.id === form.offeringId) ? offeringLabel(offerings.find((o) => o.id === form.offeringId)!) : '请选择'}</Text><View className='i-chevron' /></View>
    </Picker>
    {err('offering')}
    <Text className='field-label'>怎样描述这本书</Text>
    <View className='choice-grid'>
      <Text className={`choice ${form.mode === 'isbn' ? 'active' : ''}`} onClick={() => patch({ mode: 'isbn' })}>我有 ISBN</Text>
      <Text className={`choice ${form.mode === 'metadata' ? 'active' : ''}`} onClick={() => patch({ mode: 'metadata' })}>没有 ISBN（讲义等）</Text>
    </View>
    {form.mode === 'isbn' ? <><Text className='field-label'>ISBN</Text><Input className='field-input' value={form.isbn} maxlength={30} onInput={(e) => patch({ isbn: e.detail.value })} />{err('isbn')}</> : <>
      <Text className='field-label'>书名</Text><Input className='field-input' value={form.title} maxlength={120} onInput={(e) => patch({ title: e.detail.value })} />{err('title')}
      <Text className='field-label'>作者（选填）</Text><Input className='field-input' value={form.authors} maxlength={120} onInput={(e) => patch({ authors: e.detail.value })} />
      <Text className='field-label'>出版社</Text><Input className='field-input' value={form.publisher} maxlength={80} onInput={(e) => patch({ publisher: e.detail.value })} />{err('publisher')}
      <Text className='field-label'>版次</Text><Input className='field-input' value={form.editionLabel} maxlength={40} placeholder='例如「第 8 版」' onInput={(e) => patch({ editionLabel: e.detail.value })} />{err('edition')}
    </>}
    <Text className='field-label'>用途</Text>
    <View className='choice-grid'>{USAGE_OPTIONS.map((u: TextbookUsage) => <Text key={u} className={`choice ${form.usage === u ? 'active' : ''}`} onClick={() => patch({ usage: u })}>{usageLabel(u)}</Text>)}</View>
    <Text className='field-label'>补充说明（选填）</Text>
    <Input className='field-input' value={form.note} maxlength={200} onInput={(e) => patch({ note: e.detail.value })} />
    <Text className='field-help'>{SUGGESTION_NOTE_HELP}</Text>
    {serverError ? <Text className='error-text'>{serverError}</Text> : null}
    <View className='button-row'>
      <Button className='secondary small' disabled={busy} onClick={onClose}>取消</Button>
      <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>提交建议</Button>
    </View>
  </View>;
}
