import { Button, Text, Textarea, View } from '@tarojs/components';
import { useState } from 'react';
import { api } from '../api';
import { REPORT_REASONS, type ReportReason, type ReportTargetType } from '../model';
import { REPORT_DONE, REPORT_INTRO, REPORT_NOTE_HELP, REPORT_NOTE_MAX, REPORT_REASON_LABEL, TARGET_LABEL, reportError, reportInput } from '../governance';

/**
 * 举报面板（商品 / 留言 / 私信），与 Web ReportDialog 一致：原因不预选；「其他」必须写说明；
 * 被举报的人看不到举报人是谁；提交后可以在「我的举报」里查看处理状态。服务端的错误原样显示。
 */
export function ReportSheet({ targetType, targetId, targetLabel, onClose }: { targetType: ReportTargetType; targetId: string; targetLabel: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | ''>(''), [note, setNote] = useState(''), [error, setError] = useState(''), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const problem = reportError(reason, note);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { await api.report(reportInput(targetType, targetId, reason as ReportReason, note)); setDone(true); }
    catch (e) { setError(e instanceof Error ? e.message : '提交失败，请重试'); }
    finally { setBusy(false); }
  };
  return <View className='panel report-panel'>
    <Text className='section-title'>举报{TARGET_LABEL[targetType]}</Text>
    <Text className='muted sheet-line'>举报对象：{targetLabel}</Text>
    <Text className='muted sheet-line'>{REPORT_INTRO}</Text>
    {done ? <Text className='notice sheet-line'>{REPORT_DONE}</Text> : <>
      <Text className='field-label'>举报原因</Text>
      <View className='choice-grid'>
        {REPORT_REASONS.map((r) => <Text key={r} className={`choice ${reason === r ? 'active' : ''}`} onClick={() => setReason(r)}>{REPORT_REASON_LABEL[r]}</Text>)}
      </View>
      <Text className='field-label'>补充说明（选填）</Text>
      <Textarea className='field-input field-textarea' value={note} maxlength={REPORT_NOTE_MAX} placeholder='请描述你发现的问题' onInput={(e) => setNote(e.detail.value)} />
      <Text className='field-help'>{REPORT_NOTE_HELP}</Text>
    </>}
    {error ? <Text className='error-text'>{error}</Text> : null}
    <View className='button-row'>
      <Button className='secondary small' onClick={onClose}>{done ? '关闭' : '取消'}</Button>
      {!done && <Button className='primary small' disabled={busy} loading={busy} onClick={() => void submit()}>提交举报</Button>}
    </View>
  </View>;
}
