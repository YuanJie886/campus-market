import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import { APPEAL_REASON_MAX, type MyGovernance } from '../../api/contracts';
import { CORRECTION_LABEL, NOTICE_SECTION_LABEL, RESTRICTION_SOURCE_LABEL, SCOPE_LABEL, SCOPE_STILL_ALLOWED, formatUntil } from '../../utils/governance';
import ErrorSummary, { type ErrorSummaryItem } from '../../components/trust/ErrorSummary';

type Target = { kind: 'restriction' | 'action'; id: string; label: string } | null;

/**
 * 我的限制：只有本人看得到。每条限制写明范围、到期时间（具体时间 + 还剩多久）、来源类别、仍然可以做的事，
 * 以及申诉状态。每条限制 / 每次商品隐藏可以申诉一次。不显示举报人或工作人员身份。
 */
/** 申诉状态：没有可以回避的工作人员时明确说明「保持待处理」，不会被自动驳回 */
function appealStatusText(a: NonNullable<MyGovernance['restrictions'][number]['appeal']>): string {
  if (a.status === 'PENDING') return a.awaitingEligibleStaff ? '处理中：本校暂时没有可以回避利益冲突的工作人员，申诉保持待处理，不会被自动驳回' : '处理中';
  return a.status === 'ACCEPTED' ? '已接受' : '已驳回';
}

const NOTICE_EXPLAIN: Record<'HIDE_PRODUCT' | 'HIDE_COMMENT' | 'QUARANTINE_MESSAGE' | 'CONFIRM_NO_SHOW', string> = {
  HIDE_PRODUCT: '其他同学看不到这件商品。',
  HIDE_COMMENT: '这条留言对所有人都只显示「已被平台隐藏」；原文保留，没有删除。',
  QUARANTINE_MESSAGE: '只隔离了这一条私信：双方都只看到占位提示，会话与其他消息照常，可以继续沟通。',
  CONFIRM_NO_SHOW: '这次确认计入 30 天内的爽约次数（按确认时间计）。申诉成功后不再计入，受影响的自动限制只会缩短或撤销。',
};

export default function MyRestrictionsPage() {
  const [data, setData] = useState<MyGovernance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(null);
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reasonId = useId();

  const load = useCallback(async () => {
    try {
      setData(await getApiClient().getMyGovernance());
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, []);
  useEffect(() => { void load() }, [load]);

  const submit = async () => {
    if (!target) return;
    const problems: ErrorSummaryItem[] = [];
    if (!reason.trim()) problems.push({ key: 'reason', message: '请写明申诉理由', focus: () => document.getElementById(reasonId)?.focus() });
    if (reason.trim().length > APPEAL_REASON_MAX || /[<>]/.test(reason)) {
      problems.push({ key: 'reason', message: `申诉理由最多 ${APPEAL_REASON_MAX} 字，且不能包含尖括号`, focus: () => document.getElementById(reasonId)?.focus() });
    }
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    setBusy(true);
    setError(null);
    try {
      await getApiClient().submitAppeal(target.kind === 'restriction' ? { restrictionId: target.id, reason: reason.trim() } : { actionId: target.id, reason: reason.trim() });
      setTarget(null);
      setStatus('申诉已提交，将由另一位平台工作人员处理。');
      await load();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const openAppeal = (t: Target) => {
    setReason('');
    setSummary([]);
    setError(null);
    setTarget(t);
  };

  if (!data) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p role="status" className="text-sm text-slate-600">正在读取…</p>;
  const active = data.restrictions.filter((r) => r.active);
  const past = data.restrictions.filter((r) => !r.active);
  const productNotices = data.notices.filter((n) => n.actionCode === 'HIDE_PRODUCT');
  const otherNotices = data.notices.filter((n) => n.actionCode !== 'HIDE_PRODUCT');
  return (
    <section aria-labelledby="my-restrictions-title" className="space-y-4">
      <h2 id="my-restrictions-title" className="text-lg font-bold text-slate-800">我的限制</h2>
      <p className="text-sm text-slate-700">这里的内容只有你自己看得到，不会出现在公开资料里。限制都有期限，到期自动解除。</p>
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-slate-800">生效中的限制</h3>
        {active.length === 0 ? <p className="text-sm text-slate-600">目前没有生效中的限制。</p> : (
          <ul className="space-y-2" aria-label="生效中的限制">
            {active.map((r) => (
              <li key={r.id} className="rounded-xl border border-amber-300 bg-white p-3 text-sm">
                <p className="font-semibold text-slate-800">暂时不能：{SCOPE_LABEL[r.scope]}（生效中）</p>
                <p className="text-slate-700">解除时间：{formatUntil(r.endsAt)}</p>
                <p className="text-slate-700">来源：{RESTRICTION_SOURCE_LABEL[r.source]}{r.ruleVersion ? `（规则版本 ${r.ruleVersion}）` : ''}</p>
                {r.basis && r.basis.length > 0 && (
                  <p className="text-xs text-slate-600">依据：30 天内按确认时间计的 {r.basis.length} 次已确认爽约
                    （{r.basis.map((b) => `${new Date(b.confirmedAt).toLocaleDateString('zh-CN')}${b.stillConfirmed ? '' : '，已被推翻'}`).join('；')}）</p>
                )}
                {r.corrections && r.corrections.length > 0 && (
                  <ul className="text-xs text-slate-700" aria-label="纠正记录">
                    {r.corrections.map((c) => (
                      <li key={c.createdAt}>{CORRECTION_LABEL[c.outcome]}：剩余 {c.remainingCount} 次，解除时间由 {formatUntil(c.previousEndsAt)} 改为 {formatUntil(c.newEndsAt)}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-600">{SCOPE_STILL_ALLOWED[r.scope]}</p>
                {r.appeal ? <p className="text-xs text-slate-700">申诉：{appealStatusText(r.appeal)}</p> : null}
                {r.canAppeal && (
                  <Button size="small" onClick={() => openAppeal({ kind: 'restriction', id: r.id, label: `「${SCOPE_LABEL[r.scope]}」限制` })}>
                    对「{SCOPE_LABEL[r.scope]}」限制提出申诉
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {productNotices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-800">商品处理</h3>
          <ul className="space-y-2" aria-label="商品处理记录">
            {productNotices.map((n) => (
              <li key={n.actionId} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-semibold text-slate-800">「{n.targetLabel}」{n.active ? '已被隐藏（其他同学看不到）' : '已恢复'}</p>
                {n.appeal ? <p className="text-xs text-slate-700">申诉：{appealStatusText(n.appeal)}</p> : null}
                {n.canAppeal && (
                  <Button size="small" onClick={() => openAppeal({ kind: 'action', id: n.actionId, label: `商品「${n.targetLabel}」被隐藏` })}>
                    对商品「{n.targetLabel}」被隐藏提出申诉
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {otherNotices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-800">留言、私信与爽约确认</h3>
          <ul className="space-y-2" aria-label="其他处理记录">
            {otherNotices.map((n) => (
              <li key={n.actionId} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-semibold text-slate-800">{NOTICE_SECTION_LABEL[n.actionCode]}：{n.targetLabel}{n.active ? '（生效中）' : '（已不再生效）'}</p>
                <p className="text-xs text-slate-600">{NOTICE_EXPLAIN[n.actionCode]}</p>
                {n.appeal ? <p className="text-xs text-slate-700">申诉：{appealStatusText(n.appeal)}</p> : null}
                {n.canAppeal && (
                  <Button size="small" onClick={() => openAppeal({ kind: 'action', id: n.actionId, label: `${NOTICE_SECTION_LABEL[n.actionCode]}（${n.targetLabel}）` })}>
                    对「{NOTICE_SECTION_LABEL[n.actionCode]}」提出申诉
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {past.length > 0 && (
        <details className="text-sm text-slate-700">
          <summary>已结束的限制（{past.length}）</summary>
          <ul className="mt-1 list-disc pl-5">
            {past.map((r) => (
              <li key={r.id}>{SCOPE_LABEL[r.scope]} · {r.revokedAt
                ? `${r.revokeReason === 'RULE_RECOMPUTED' ? '已按规则重算撤销' : '已撤销'}（${new Date(r.revokedAt).toLocaleString('zh-CN')}）`
                : `已于 ${new Date(r.endsAt).toLocaleString('zh-CN')} 到期`}</li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={!!target} onClose={() => setTarget(null)} aria-labelledby={titleId} fullWidth maxWidth="sm">
        <DialogTitle id={titleId}>提出申诉</DialogTitle>
        <DialogContent className="space-y-3">
          <p className="text-sm text-slate-700">申诉对象：{target?.label}。每条限制或处理只能申诉一次，会由与此事无关的另一位平台工作人员处理；
            申诉成功会撤销尚未到期的限制或恢复内容，因此受影响的其他自动限制只会被缩短或撤销，不会加重。</p>
          <ErrorSummary ref={summaryRef} title="提交前请先修正以下问题" items={summary} />
          <TextField id={reasonId} label="申诉理由" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={3}
            inputProps={{ maxLength: APPEAL_REASON_MAX }} helperText={`最多 ${APPEAL_REASON_MAX} 字`} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>取消</Button>
          <Button variant="contained" disabled={busy} onClick={() => void submit()}>提交申诉</Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
