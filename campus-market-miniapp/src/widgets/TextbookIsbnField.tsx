import Taro from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { ApiError } from '../api/transport';
import { describeLinked, editionLines, ISBN_CONFIRM_NOTE, ISBN_DEMO_NOTE, ISBN_HELP, ISBN_NOT_FOUND, isbnProblem, TEXTBOOK_CHANGED_NOTE } from '../catalog';
import type { TextbookEdition } from '../model';

export interface LinkedTextbook { editionId: string; label: string }

/** 弹窗请卖家对照封面与版权页确认版本；只有点「确认关联这个版本」才关联。 */
async function confirmEdition(e: TextbookEdition): Promise<boolean> {
  const content = [`${e.title} ${e.editionLabel}`, ...(e.subtitle ? [e.subtitle] : []), ...editionLines(e), ISBN_CONFIRM_NOTE, ...(e.isDemo ? [ISBN_DEMO_NOTE] : [])].join('\n');
  const answer = await Taro.showModal({ title: '确认是这个版本吗？', content, confirmText: '确认关联', cancelText: '不是这个', confirmColor: '#194e41' });
  return answer.confirm;
}

/**
 * 教材书籍发布时的 ISBN 关联（与 Web TextbookIsbnField 一致）：前端只做即时格式提示，服务端是最终权威；
 * 命中目录后由卖家确认；未命中时可以不关联继续发布。从不根据书名猜测版本。
 * presetEditionId：从教材版本页「我有这一版，去发布」进入时打开这个版本的确认框（仍需卖家确认）。
 */
export function TextbookIsbnField({ value, onChange, changed, presetEditionId, onPresetHandled }: { value: LinkedTextbook | null; onChange: (next: LinkedTextbook | null) => void; changed?: boolean; presetEditionId?: string | null; onPresetHandled?: () => void }) {
  const [isbn, setIsbn] = useState(''), [touched, setTouched] = useState(false), [busy, setBusy] = useState(false), [notFound, setNotFound] = useState(''), [error, setError] = useState('');
  const formatError = touched && isbn.trim() ? isbnProblem(isbn) : null;
  const offer = async (e: TextbookEdition) => { if (await confirmEdition(e)) { onChange({ editionId: e.id, label: describeLinked(e) }); setIsbn(''); } };
  useEffect(() => {
    if (!presetEditionId) return;
    let active = true;
    api.textbook(presetEditionId).then((e) => { if (active) void offer(e).finally(() => onPresetHandled?.()); }).catch((e) => { if (active) { setError(e instanceof Error ? e.message : '读取教材失败'); onPresetHandled?.(); } });
    return () => { active = false; };
  }, [presetEditionId]);
  const lookup = async () => {
    setTouched(true); setNotFound(''); setError('');
    if (isbnProblem(isbn) || busy) return;
    setBusy(true);
    try { await offer(await api.textbookByIsbn(isbn)); }
    catch (e) { if (e instanceof ApiError && e.code === 404) setNotFound(ISBN_NOT_FOUND); else setError(e instanceof Error ? e.message : '查找失败，请重试'); }
    finally { setBusy(false); }
  };
  return <View className='panel'>
    <Text className='section-title'>关联课程教材版本（选填）</Text>
    <Text className='field-help'>{ISBN_HELP}</Text>
    {value ? <View className='notice'><Text>已关联：{value.label}</Text><Text className='text-action' onClick={() => onChange(null)}>不关联教材目录</Text></View>
      : <View className='inline-row'>
        <Input className='field-input' value={isbn} placeholder='ISBN' maxlength={30} onInput={(e) => { setIsbn(e.detail.value); setNotFound(''); }} onBlur={() => setTouched(true)} />
        <Button className='secondary small' disabled={busy} loading={busy} onClick={() => void lookup()}>在目录中查找</Button>
      </View>}
    {formatError ? <Text className='error-text'>{formatError}</Text> : null}
    {busy ? <Text className='muted'>正在查找…</Text> : notFound ? <Text className='muted'>{notFound}</Text> : null}
    {error ? <Text className='error-text'>{error}</Text> : null}
    {changed ? <Text className='field-help'>{TEXTBOOK_CHANGED_NOTE}</Text> : null}
  </View>;
}
