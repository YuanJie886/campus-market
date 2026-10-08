import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { StaffAppeal, StaffAppealPage } from '../../api/contracts';
import { ACTION_LABEL, SCOPE_LABEL, formatUntil } from '../../utils/governance';

/**
 * 平台工作人员：本校的申诉。申诉必须由做出原处理之外的另一位工作人员决定；
 * 接受会撤销尚未到期的限制（爽约来源的同时推翻那次确认）或恢复被隐藏的商品。每个决定都有二次确认。
 */
export default function ModerationAppealsPage() {
  const [data, setData] = useState<StaffAppealPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<{ appeal: StaffAppeal; accept: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const load = useCallback(async () => {
    try {
      setData(await getApiClient().listModerationAppeals({ status: 'PENDING', page: 1, size: 50 }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 403) setForbidden(true);
      else setError(toUserMessage(e));
    }
  }, []);
  useEffect(() => { void load() }, [load]);

  const decide = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const done = await getApiClient().decideModerationAppeal(pending.appeal.id, {
        accept: pending.accept, reasonCode: pending.accept ? 'APPEAL_ACCEPTED' : 'APPEAL_REJECTED', ...(note.trim() ? { note: note.trim() } : {}),
      });
      setPending(null);
      setResult(`申诉已${pending.accept ? '接受' : '驳回'}，已写入审计${done.requestId ? `，操作编号 ${done.requestId}` : ''}。`);
      await load();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (forbidden) return <h1 className="text-xl font-extrabold text-slate-800">需要平台工作人员权限</h1>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">治理工作台 · 待处理的申诉</h1>
        <Link to="/moderation" className="text-sm text-indigo-800 underline">返回案件列表</Link>
      </div>
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{result}</div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!data ? <p role="status" className="text-sm text-slate-600">正在读取…</p> : data.items.length === 0 ? <p className="text-sm text-slate-600">没有待处理的申诉。与你本人或你做出的处理有关的申诉会由其他工作人员决定，不在这里显示。</p> : (
        <ul className="space-y-2" aria-label="申诉列表">
          {data.items.map((a) => (
            <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold text-slate-800">
                {a.subject.kind === 'RESTRICTION'
                  ? `限制「${SCOPE_LABEL[a.subject.scope]}」· ${a.subject.sourceType === 'SYSTEM_RULE' ? `公开规则自动生成（${a.subject.ruleVersion ?? ''}）· ` : ''}${a.subject.active ? `至 ${formatUntil(a.subject.endsAt)}` : '已结束'}`
                  : `处理「${ACTION_LABEL[a.subject.actionCode as keyof typeof ACTION_LABEL] ?? a.subject.actionCode}」`}
              </p>
              <p className="text-slate-700">申诉理由：{a.reason}</p>
              {a.decidable ? (
                <div className="mt-1 flex gap-2">
                  <Button size="small" onClick={() => { setNote(''); setPending({ appeal: a, accept: true }) }}>接受申诉</Button>
                  <Button size="small" color="inherit" onClick={() => { setNote(''); setPending({ appeal: a, accept: false }) }}>驳回申诉</Button>
                </div>
              ) : <p className="text-xs text-slate-600">这条申诉已经有结果。</p>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!pending} onClose={() => setPending(null)} aria-labelledby={titleId}>
        <DialogTitle id={titleId}>{pending?.accept ? '接受这条申诉？' : '驳回这条申诉？'}</DialogTitle>
        <DialogContent className="space-y-2">
          <p className="text-sm text-slate-700">
            {pending?.accept ? '接受后会立即撤销尚未到期的限制或恢复商品，并写入审计。' : '驳回后原处理保持不变，申诉人不能再次申诉。'}
          </p>
          <TextField label="说明（选填）" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>返回</Button>
          <Button variant="contained" color={pending?.accept ? 'primary' : 'error'} disabled={busy} onClick={() => void decide()}>
            {pending?.accept ? '确认接受申诉' : '确认驳回申诉'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
