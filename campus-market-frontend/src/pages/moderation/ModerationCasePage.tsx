import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { ConflictReason } from '../../api/contracts';
import { MODERATION_DECISION_REASONS, type ModerationActionCode, type ModerationCaseDetail, type ModerationDecisionReason } from '../../api/contracts';
import {
  ACTION_IMPACT, ACTION_LABEL, CASE_STATUS_LABEL, DECISION_REASON_LABEL, HIGH_RISK_ACTIONS, NO_SHOW_REASON_LABEL, NO_SHOW_STATUS_LABEL,
  REPORT_REASON_LABEL, TARGET_LABEL, formatUntil,
  CONFLICT_REASON_LABEL, formatSlotRange,
} from '../../utils/governance';
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from '../../components/trust/ErrorSummary';

const DURATIONS = [24, 72, 168, 336, 720];

/**
 * 案件详情与结案。一个案件只有一个最终结果；高风险动作（隐藏、归档、限制、确认爽约）要二次确认，
 * 确认框写明影响与到期时间。结案成功后显示本次操作的 requestId（已写入审计）。
 */
export default function ModerationCasePage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<ModerationCaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [conflict, setConflict] = useState<ConflictReason | null>(null);
  const [action, setAction] = useState<ModerationActionCode | ''>('');
  const [reason, setReason] = useState<ModerationDecisionReason | ''>('');
  const [hours, setHours] = useState(24);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reasonId = useId();
  const noteId = useId();

  const load = useCallback(async () => {
    try {
      setDetail(await getApiClient().getModerationCase(id));
    } catch (e) {
      // 7.1C：与本人有利益冲突的案件（403 CONFLICT_OF_INTEREST）单独说明，不显示任何细节
      const details = e instanceof ApiError ? e.details as { code?: string; reason?: ConflictReason } | undefined : undefined;
      if (e instanceof ApiError && e.code === 403 && details?.code === 'CONFLICT_OF_INTEREST') setConflict(details.reason ?? 'SELF_TARGET');
      else if (e instanceof ApiError && (e.code === 404 || e.code === 403)) setNotFound(true);
      else setError(toUserMessage(e));
    }
  }, [id]);
  useEffect(() => { void load() }, [load]);

  const run = async (fn: () => Promise<ModerationCaseDetail>, done: (d: ModerationCaseDetail) => string) => {
    setBusy(true);
    setError(null);
    try {
      const d = await fn();
      setDetail(d);
      setResult(done(d));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const restrict = action.startsWith('RESTRICT_');
  const validate = (): boolean => {
    const problems: ErrorSummaryItem[] = [];
    if (!action) problems.push({ key: 'action', message: '请选择处理动作', focus: () => focusRadioGroup('decision-action') });
    if (!reason) problems.push({ key: 'reason', message: '请选择处理原因', focus: () => document.getElementById(reasonId)?.focus() });
    if (reason === 'OTHER' && !note.trim()) problems.push({ key: 'note', message: '选择「其他」时请写一句说明', focus: () => document.getElementById(noteId)?.focus() });
    setSummary(problems);
    if (problems.length) window.setTimeout(() => summaryRef.current?.focus(), 0);
    return problems.length === 0;
  };

  const decide = () => run(async () => {
    const d = await getApiClient().decideModerationCase(id, {
      action: action as ModerationActionCode, reasonCode: reason as ModerationDecisionReason,
      ...(note.trim() ? { note: note.trim() } : {}), ...(restrict ? { durationHours: hours } : {}),
    });
    setConfirming(false);
    return d;
  }, (d) => `已处理：${ACTION_LABEL[action as ModerationActionCode]}。操作已写入审计${d.requestId ? `，操作编号 ${d.requestId}` : ''}。`);

  const onSubmit = () => {
    if (!validate()) return;
    if (HIGH_RISK_ACTIONS.includes(action as ModerationActionCode)) setConfirming(true);
    else void decide();
  };

  if (conflict) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">这个案件需要回避</h1>
        <p className="text-sm text-slate-700" role="note">
          {CONFLICT_REASON_LABEL[conflict]}，你不能查看细节、领取或结案；案件保持待处理，由本校其他工作人员处理。
        </p>
        <Link to="/moderation" className="text-sm text-indigo-800 underline">返回案件列表</Link>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl space-y-2">
        <h1 className="text-xl font-extrabold text-slate-800">案件不存在或你没有权限查看</h1>
        <Link to="/moderation" className="text-sm text-indigo-800 underline">返回案件列表</Link>
      </div>
    );
  }
  if (!detail) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p role="status" className="text-sm text-slate-600">正在读取…</p>;
  const decidable = detail.allowedActions.length > 0;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">{TARGET_LABEL[detail.targetType]}案件</h1>
        <p className="text-sm text-slate-700">状态：{CASE_STATUS_LABEL[detail.status]}{detail.resolutionCode ? ` · 结果：${ACTION_LABEL[detail.resolutionCode]}` : ''}</p>
        <Link to="/moderation" className="text-sm text-indigo-800 underline">返回案件列表</Link>
      </div>
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{result}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <section aria-labelledby="target-title" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <h2 id="target-title" className="text-base font-bold text-slate-800">对象：{detail.target.exists ? detail.target.label : '已不存在'}</h2>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {Object.entries(detail.target.fields).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-slate-600">{k}</dt><dd className="text-slate-800">{String(v)}</dd></div>
          ))}
        </dl>
        <p className="mt-1 text-xs text-slate-600">这里只有处理所需的最少信息，没有联系方式、确认码或会话全文。</p>
      </section>

      {detail.noShow && (
        <section aria-labelledby="noshow-title" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h2 id="noshow-title" className="text-base font-bold text-slate-800">爽约复核</h2>
          <p>原因：{NO_SHOW_REASON_LABEL[detail.noShow.report.reasonCode]} · 状态：{NO_SHOW_STATUS_LABEL[detail.noShow.report.status]}</p>
          {detail.noShow.report.note && <p>报告人说明：{detail.noShow.report.note}</p>}
          {detail.noShow.report.responseNote && <p>对方回应：{detail.noShow.report.responseNote}</p>}
          <p>
            档期：{detail.noShow.meeting.endsAt
              ? formatSlotRange(detail.noShow.meeting.startsAt, detail.noShow.meeting.endsAt)
              : new Date(detail.noShow.meeting.startsAt).toLocaleString('zh-CN')}（第 {detail.noShow.meeting.revision} 版）
          </p>
          {detail.noShow.meeting.explicit === false && (
            <p className="text-amber-900" role="note">
              这份报告针对的原始预约没有明确的结束时间，不能确认为爽约（只能驳回）；平台不推测结束时间。
            </p>
          )}
          <p className="mt-1 font-semibold">到达声明（本人手动声明，不是定位证据）：</p>
          {detail.noShow.presence.length === 0 ? <p>双方都没有声明。</p> : (
            <ul className="list-disc pl-5">
              {detail.noShow.presence.map((p, i) => <li key={i}>{p.party === 'REPORTER' ? '报告人' : '被报告人'}：{p.status === 'ARRIVED' ? '已到达' : p.status === 'DEPARTED' ? '已出发' : '未声明'}{p.at ? `（${new Date(p.at).toLocaleString('zh-CN')}）` : ''}</li>)}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="reports-title" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <h2 id="reports-title" className="text-base font-bold text-slate-800">举报（{detail.reports.length}）</h2>
        <p className="text-xs text-slate-600">不显示举报人身份。</p>
        <ul className="mt-1 space-y-1">
          {detail.reports.map((r) => (
            <li key={r.id}>{REPORT_REASON_LABEL[r.reasonCode]}{r.note ? `：${r.note}` : ''}{r.snapshot ? ` · 被举报内容：「${r.snapshot}」` : ''}</li>
          ))}
        </ul>
      </section>

      {detail.actions.length > 0 && (
        <section aria-labelledby="actions-title" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <h2 id="actions-title" className="text-base font-bold text-slate-800">处理记录（不可修改）</h2>
          <ul className="mt-1 space-y-1">
            {detail.actions.map((a) => (
              <li key={a.id}>
                {ACTION_LABEL[a.actionCode as ModerationActionCode] ?? a.actionCode} · {DECISION_REASON_LABEL[a.reasonCode as ModerationDecisionReason] ?? a.reasonCode}
                {a.expiresAt ? ` · 到期 ${formatUntil(a.expiresAt)}` : ''}{a.effective ? '' : ' · 未改变目标'}{a.byMe ? ' · 我' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.status === 'OPEN' && (
        <Button variant="outlined" disabled={busy} onClick={() => void run(() => getApiClient().claimModerationCase(id), () => '已领取这个案件，其他工作人员不能再结案。')}>
          领取这个案件
        </Button>
      )}

      {decidable && (
        <section aria-labelledby="decide-title" className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4">
          <h2 id="decide-title" className="text-base font-bold text-slate-800">处理</h2>
          <ErrorSummary ref={summaryRef} title="处理前请先修正以下问题" items={summary} />
          <fieldset>
            <legend className="text-sm font-semibold text-slate-800">处理动作</legend>
            <RadioGroup name="decision-action" value={action} onChange={(e) => setAction(e.target.value as ModerationActionCode)}>
              {detail.allowedActions.map((a) => (
                <FormControlLabel key={a} value={a} control={<Radio size="small" />} label={`${ACTION_LABEL[a]}${HIGH_RISK_ACTIONS.includes(a) ? '（需要二次确认）' : ''}`} />
              ))}
            </RadioGroup>
          </fieldset>
          {action && <p className="text-xs text-slate-700">影响：{ACTION_IMPACT[action]}</p>}
          <TextField id={reasonId} select size="small" label="处理原因" value={reason} onChange={(e) => setReason(e.target.value as ModerationDecisionReason)} sx={{ minWidth: 220 }}>
            {MODERATION_DECISION_REASONS.map((r) => <MenuItem key={r} value={r}>{DECISION_REASON_LABEL[r]}</MenuItem>)}
          </TextField>
          {restrict && (
            <TextField select size="small" label="限制期限" value={hours} onChange={(e) => setHours(Number(e.target.value))} sx={{ minWidth: 220, ml: 1 }}
              helperText="最长 30 天，没有永久限制；超过 7 天需要高级工作人员">
              {DURATIONS.map((h) => <MenuItem key={h} value={h}>{h < 168 ? `${h} 小时` : `${h / 24} 天`}</MenuItem>)}
            </TextField>
          )}
          <TextField id={noteId} label="说明（选填）" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} />
          <Button variant="contained" disabled={busy} onClick={onSubmit}>提交处理</Button>
        </section>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby={titleId}>
        <DialogTitle id={titleId}>确认执行「{action ? ACTION_LABEL[action as ModerationActionCode] : ''}」？</DialogTitle>
        <DialogContent className="space-y-2">
          <p className="text-sm text-slate-700">{action ? ACTION_IMPACT[action as ModerationActionCode] : ''}</p>
          {restrict && <p className="text-sm text-slate-700">到期时间：{formatUntil(Date.now() + hours * 3_600_000)}，到期自动解除。</p>}
          <p className="text-xs text-slate-600">这个结果写入后不能修改；如有错误，只能通过申诉由另一位工作人员处理。</p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>返回</Button>
          <Button variant="contained" color="error" disabled={busy} onClick={() => void decide()}>
            确认{action ? ACTION_LABEL[action as ModerationActionCode] : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
