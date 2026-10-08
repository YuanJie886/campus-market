import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
import { NO_SHOW_REASONS, type NoShowReason, type NoShowReport, type OrderNoShowView } from '../../api/contracts';
import { NO_SHOW_ELIGIBILITY_TEXT, NO_SHOW_REASON_LABEL, NO_SHOW_STATUS_LABEL, formatSlotRange, formatUntil } from '../../utils/governance';
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from '../trust/ErrorSummary';

type Pending = { kind: 'report' } | { kind: 'acknowledge' | 'dispute'; report: NoShowReport } | null;

/**
 * 模块 7.2：订单上的爽约报告。
 * 只有双方确认过的档期结束 15 分钟后才能报告；单方报告只是「等待对方回应」，不会产生任何处罚；
 * 只有对方承认或平台工作人员复核确认才计数。「已到达」是本人手动声明，不是定位证据。
 */
export default function NoShowPanel({ orderId }: { orderId: string }) {
  const [view, setView] = useState<OrderNoShowView | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState<NoShowReason | ''>('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const noteId = useId();
  const groupName = `no-show-reason-${orderId}`;

  const load = useCallback(async () => {
    try {
      setView(await getApiClient().getOrderNoShow(orderId));
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, [orderId]);
  useEffect(() => { void load() }, [load]);

  const open = (p: Pending) => {
    setReason('');
    setNote('');
    setSummary([]);
    setError(null);
    setPending(p);
  };

  const submit = async () => {
    if (!pending) return;
    const problems: ErrorSummaryItem[] = [];
    if (pending.kind === 'report' && !reason) problems.push({ key: 'reason', message: '请选择原因', focus: () => focusRadioGroup(groupName) });
    if ((pending.kind === 'dispute' || reason === 'OTHER') && !note.trim()) {
      problems.push({ key: 'note', message: pending.kind === 'dispute' ? '请写一句说明，方便工作人员复核' : '选择「其他」时请写一句说明', focus: () => document.getElementById(noteId)?.focus() });
    }
    if (note.trim().length > 200 || /[<>]/.test(note)) problems.push({ key: 'note', message: '说明最多 200 字，且不能包含尖括号', focus: () => document.getElementById(noteId)?.focus() });
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    setBusy(true);
    setError(null);
    try {
      const api = getApiClient();
      if (pending.kind === 'report') {
        await api.reportNoShow(orderId, { reasonCode: reason as NoShowReason, ...(note.trim() ? { note: note.trim() } : {}) });
        setStatus('已提交爽约报告。对方回应之前不会产生任何处罚。');
      } else if (pending.kind === 'acknowledge') {
        await api.acknowledgeNoShow(pending.report.id, note.trim() || undefined);
        setStatus('你已承认这次爽约。');
      } else {
        await api.disputeNoShow(pending.report.id, note.trim());
        setStatus('已提出异议，平台工作人员会复核。');
      }
      setPending(null);
      await load();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const escalate = async (report: NoShowReport) => {
    setBusy(true);
    setError(null);
    try {
      await getApiClient().createModerationReport({ targetType: 'NO_SHOW', targetId: report.id, reasonCode: 'NO_SHOW_REVIEW' });
      setStatus('已请平台工作人员复核。');
      await load();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null;
  const e = view.eligibility;
  return (
    <section aria-labelledby={`${titleId}-section`} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id={`${titleId}-section`} className="text-base font-bold text-slate-800">爽约报告</h2>
      <p className="text-xs text-slate-700">
        单方报告不会产生任何处罚；只有对方承认或平台工作人员复核确认后才计入。「已到达」是本人手动声明，不是定位证据。
        30 天内第 1 次确认只提醒，第 2 次限制预约 24 小时，第 3 次起 72 小时；限制到期自动解除，可以申诉。
      </p>
      <p className="text-sm text-slate-700">
        {NO_SHOW_ELIGIBILITY_TEXT[e.code]}
        {e.code === 'TOO_EARLY' && e.reportableAt ? ` 可以报告的时间：${formatUntil(e.reportableAt)}。` : ''}
      </p>
      {e.slot && (
        <p className="text-xs text-slate-600" data-slot-snapshot>
          判断依据：双方确认、接受时冻结的档期 {formatSlotRange(e.slot.startsAt, e.slot.endsAt)}
          {e.slot.revision > 0 ? `（第 ${e.slot.revision} 次改约）` : '（原始预约）'}。
        </p>
      )}
      {e.canReport && <Button variant="outlined" color="warning" onClick={() => open({ kind: 'report' })}>报告对方爽约</Button>}
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>
      {view.reports.length > 0 && (
        <ul className="space-y-2" aria-label="这笔订单的爽约报告">
          {view.reports.map((r) => (
            <li key={r.id} className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">
                {r.byMe ? '我报告对方' : r.aboutMe ? '对方报告我' : '爽约报告'}：{NO_SHOW_REASON_LABEL[r.reasonCode]}
              </p>
              <p className="text-slate-700">状态：{NO_SHOW_STATUS_LABEL[r.status]}</p>
              {r.note && <p className="text-slate-600">说明：{r.note}</p>}
              {r.responseNote && <p className="text-slate-600">回应：{r.responseNote}</p>}
              <div className="mt-1 flex flex-wrap gap-2">
                {r.canRespond && <Button size="small" onClick={() => open({ kind: 'acknowledge', report: r })}>承认</Button>}
                {r.canRespond && <Button size="small" onClick={() => open({ kind: 'dispute', report: r })}>提出异议</Button>}
                {r.canEscalate && <Button size="small" disabled={busy} onClick={() => void escalate(r)}>请平台工作人员复核</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && !pending && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Dialog open={!!pending} onClose={() => setPending(null)} aria-labelledby={titleId} fullWidth maxWidth="sm">
        <DialogTitle id={titleId}>
          {pending?.kind === 'report' ? '报告对方爽约' : pending?.kind === 'acknowledge' ? '承认这次爽约？' : '对这份报告提出异议'}
        </DialogTitle>
        <DialogContent className="space-y-3">
          {pending?.kind === 'acknowledge' && (
            <p className="text-sm text-slate-700">
              承认后计为一次已确认爽约：30 天内第 2 次会限制预约新订单 24 小时，第 3 次起 72 小时。不影响浏览和已经成立的订单。
            </p>
          )}
          {pending?.kind === 'dispute' && <p className="text-sm text-slate-700">提出异议后不会计入，平台工作人员会结合双方的说明复核。</p>}
          {pending?.kind === 'report' && <p className="text-sm text-slate-700">报告只针对这笔订单的当前档期。对方回应之前，不会对任何人产生处罚。</p>}
          <ErrorSummary ref={summaryRef} title="提交前请先修正以下问题" items={summary} />
          {pending?.kind === 'report' && (
            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">原因</legend>
              <RadioGroup name={groupName} value={reason} onChange={(ev) => setReason(ev.target.value as NoShowReason)}>
                {NO_SHOW_REASONS.map((r) => <FormControlLabel key={r} value={r} control={<Radio size="small" />} label={NO_SHOW_REASON_LABEL[r]} />)}
              </RadioGroup>
            </fieldset>
          )}
          <TextField id={noteId} label={pending?.kind === 'dispute' ? '说明（必填）' : '说明（选填）'} value={note} onChange={(ev) => setNote(ev.target.value)}
            fullWidth multiline minRows={2} inputProps={{ maxLength: 200 }} helperText="最多 200 字" />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>取消</Button>
          <Button variant="contained" disabled={busy} onClick={() => void submit()}>
            {pending?.kind === 'report' ? '提交报告' : pending?.kind === 'acknowledge' ? '确认承认' : '提交异议'}
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
