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
import { CANCELLATION_NOTE_MAX, CANCELLATION_REASONS, type CancellationReason, type CanonicalOrderStatus } from '../../api/contracts';
import { CANCEL_REASON_LABEL } from '../../utils/governance';
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from '../trust/ErrorSummary';

interface Props {
  open: boolean;
  /** 订单当前状态：只用来决定原因是否必填与提示文案；阶段本身由服务端判定 */
  status: CanonicalOrderStatus;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (input: { reasonCode?: CancellationReason; note?: string }) => void;
}

/**
 * 取消订单。卖家确认之前的取消没有任何处罚，原因选填；卖家确认之后双方仍可取消，但必须选择结构化原因。
 * 平台不托管资金，取消只是释放商品；已确认档期后的取消只出现在本人履历里，不进入公共履历，也不计分。
 */
export default function CancelOrderDialog({ open, status, busy = false, error, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const noteId = useId();
  const required = status !== 'PENDING_SELLER_CONFIRM';
  const groupName = 'cancel-reason';

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNote('');
    setSummary([]);
  }, [open]);

  const submit = () => {
    const problems: ErrorSummaryItem[] = [];
    if (required && !reason) problems.push({ key: 'reason', message: '请选择取消原因', focus: () => focusRadioGroup(groupName) });
    if (reason === 'OTHER' && !note.trim()) problems.push({ key: 'note', message: '选择「其他」时请写一句说明', focus: () => document.getElementById(noteId)?.focus() });
    if (note.trim().length > CANCELLATION_NOTE_MAX || /[<>]/.test(note)) {
      problems.push({ key: 'note', message: `说明最多 ${CANCELLATION_NOTE_MAX} 字，且不能包含尖括号`, focus: () => document.getElementById(noteId)?.focus() });
    }
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    onConfirm({ ...(reason ? { reasonCode: reason } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{status === 'DISPUTED' ? '取消这笔交易？' : '取消这个预约？'}</DialogTitle>
      <DialogContent className="space-y-3">
        <p className="text-sm text-slate-700">
          {required
            ? '卖家已经确认过这笔订单。双方都可以取消，但需要选择一个原因；取消会记录在你自己的履历里，不会出现在公开资料中，也不会自动处罚任何人。'
            : '卖家还没有确认，现在取消没有任何处罚。原因可以不填。'}
        </p>
        <p className="text-xs text-slate-600">平台不托管资金；取消后商品会重新上架。</p>
        <ErrorSummary ref={summaryRef} title="取消前请先修正以下问题" items={summary} />
        <fieldset>
          <legend className="text-sm font-semibold text-slate-800">取消原因{required ? '（必选）' : '（选填）'}</legend>
          <RadioGroup name={groupName} value={reason} onChange={(e) => setReason(e.target.value as CancellationReason)}>
            {CANCELLATION_REASONS.map((r) => <FormControlLabel key={r} value={r} control={<Radio size="small" />} label={CANCEL_REASON_LABEL[r]} />)}
          </RadioGroup>
        </fieldset>
        <TextField id={noteId} label="说明（选填，「其他」时必填）" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2}
          inputProps={{ maxLength: CANCELLATION_NOTE_MAX }} helperText={`最多 ${CANCELLATION_NOTE_MAX} 字`} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>不取消</Button>
        <Button variant="contained" color="error" disabled={busy} onClick={submit}>确认取消订单</Button>
      </DialogActions>
    </Dialog>
  );
}
