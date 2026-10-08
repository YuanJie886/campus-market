import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { TextbookSuggestion } from '../../api/contracts';
import { SUGGESTION_NOTE, suggestionStatusLabel, termLabel, usageLabel } from '../../utils/catalog';
import { formatDateTime } from '../../utils/format';
import { formatIsbn } from '../../utils/isbn';

/** 我的教材建议：只有本人可见；状态只有「待审核（未公开）」与「已撤回」，没有审核进度。 */
export default function TextbookSuggestionsPage() {
  const [items, setItems] = useState<TextbookSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => getApiClient().listMyTextbookSuggestions().then(setItems).catch((e) => setError(toUserMessage(e)));
  useEffect(() => { void load(); }, []);

  const withdraw = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await getApiClient().withdrawTextbookSuggestion(id);
      setStatus('已撤回这条建议');
      await load();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="my-suggestions-title" className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <h2 id="my-suggestions-title" className="text-base font-bold text-slate-800">我的教材建议</h2>
      <p className="text-xs text-slate-600">{SUGGESTION_NOTE}</p>
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>
      {error && <Alert severity="error">{error}</Alert>}
      {!items && !error && <p className="text-sm text-slate-600">正在读取…</p>}
      {items && items.length === 0 && (
        <p className="text-sm text-slate-600">
          还没有提交过建议。可以在 <Link to="/courses" className="underline">课程教材</Link> 的课程页里提交。
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm" data-status={s.status}>
              <div>
                <p className="font-semibold text-slate-800">{s.courseName} · {s.academicYear} {termLabel(s.term)}</p>
                <p className="text-xs text-slate-700">
                  {s.textbookEditionId
                    ? `${s.editionTitle ?? ''} ${s.editionEditionLabel ?? ''}`
                    : s.isbn ? `ISBN ${formatIsbn(s.isbn)}` : `${s.title ?? ''} ${s.editionLabel ?? ''} · ${s.publisher ?? ''}`}
                  {` · ${usageLabel(s.usageType)} · ${formatDateTime(s.createdAt)}`}
                </p>
                <p className="text-xs text-slate-600">{suggestionStatusLabel(s.status)}</p>
              </div>
              {s.status === 'PENDING' && (
                <Button size="small" color="inherit" disabled={busy} onClick={() => withdraw(s.id)}>撤回</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
