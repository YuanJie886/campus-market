import { useEffect, useId, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import { MODERATION_NOTE_MAX, MODERATION_REPORT_REASONS, type ModerationReportReason, type ModerationTargetType } from '../../api/contracts';
import { REPORT_REASON_LABEL, TARGET_LABEL } from '../../utils/governance';
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from '../trust/ErrorSummary';

interface Props {
  open: boolean;
  targetType: Exclude<ModerationTargetType, 'NO_SHOW'>;
  targetId: string;
  /** 给读屏的对象说明，例如商品标题（不写进任何地址或日志） */
  targetLabel: string;
  onClose: () => void;
}

/**
 * 举报对话框（商品 / 用户 / 圈子 / 留言 / 私信 / 订单）。原因不预选；「其他」必须写说明。
 * 被举报的人看不到举报人是谁；举报人之后只能看到「已处理 / 未采取措施」这样的状态摘要。
 */
export default function ReportDialog({ open, targetType, targetId, targetLabel, onClose }: Props) {
  const [reason, setReason] = useState<ModerationReportReason | ''>('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const groupName = `report-reason-${targetType}`;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    setSummary([]);
    setError(null);
    setDone(false);
  }, [open]);

  const submit = async () => {
    const problems: ErrorSummaryItem[] = [];
    if (!reason) problems.push({ key: 'reason', message: '请选择举报原因', focus: () => focusRadioGroup(groupName) });
    if (reason === 'OTHER' && !note.trim()) problems.push({ key: 'note', message: '选择「其他」时请写一句说明', focus: () => document.getElementById(noteId)?.focus() });
    if (note.trim().length > MODERATION_NOTE_MAX || /[<>]/.test(note)) problems.push({ key: 'note', message: `说明最多 ${MODERATION_NOTE_MAX} 字，且不能包含尖括号`, focus: () => document.getElementById(noteId)?.focus() });
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    setBusy(true);
    setError(null);
    try {
      await getApiClient().createModerationReport({ targetType, targetId, reasonCode: reason as ModerationReportReason, ...(note.trim() ? { note: note.trim() } : {}) });
      setDone(true);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>举报{TARGET_LABEL[targetType]}</DialogTitle>
      <DialogContent className="space-y-3">
        <p className="text-sm text-slate-700">举报对象：{targetLabel}</p>
        <p className="text-xs text-slate-600">
          举报会交给本校的平台工作人员复核；被举报的人不会知道是谁举报的。单方举报不会自动处罚任何人，平台也不做交易仲裁、赔付或真伪鉴定。
        </p>
        <div role="status" aria-live="polite">
          {done && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">已收到举报。之后可以在「我的举报」里查看处理状态。</p>}
        </div>
        {!done && (
          <>
            <ErrorSummary ref={summaryRef} title="提交前请先修正以下问题" items={summary} />
            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">举报原因</legend>
              <RadioGroup name={groupName} value={reason} onChange={(e) => setReason(e.target.value as ModerationReportReason)}>
                {MODERATION_REPORT_REASONS.map((r) => (
                  <FormControlLabel key={r} value={r} control={<Radio size="small" />} label={REPORT_REASON_LABEL[r]} />
                ))}
              </RadioGroup>
            </fieldset>
            <TextField id={noteId} label="补充说明（选填）" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2}
              inputProps={{ maxLength: MODERATION_NOTE_MAX }} helperText={`最多 ${MODERATION_NOTE_MAX} 字，请不要填写手机号、微信号等联系方式`} />
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{done ? '关闭' : '取消'}</Button>
        {!done && <Button variant="contained" color="error" disabled={busy} onClick={() => void submit()}>提交举报</Button>}
      </DialogActions>
    </Dialog>
  );
}
