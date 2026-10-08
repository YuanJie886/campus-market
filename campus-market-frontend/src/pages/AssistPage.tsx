import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../api/client';
import { ApiError, toUserMessage } from '../api/errors';
import type { ListingDraft } from '../api/contracts';
import { tokenFromFragment } from '../utils/supply';
import ListingItemEditor from '../components/supply/ListingItemEditor';

export const ASSISTANT_ROLE_TEXT =
  '你正在协助整理发布：可以修改标题、描述、分类、价格建议、打包明细与取货楼栋建议并保存。最终由商品所有者检查并发布；你看不到所有者的联系方式、订单、确认码或其他草稿。';

/**
 * 协助人页面。邀请码可以手动输入，也可以来自链接的 # 片段：读取后立刻从地址栏抹掉，
 * 只放进兑换请求的请求体，不进入 URL query、不写入任何浏览器存储。这里没有发布按钮。
 */
export default function AssistPage() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [drafts, setDrafts] = useState<ListingDraft[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const inputId = useId();
  const listRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const fromLink = tokenFromFragment(window.location.hash);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (fromLink) setToken(fromLink);
  }, []);

  const load = useCallback(async () => {
    try {
      setDrafts(await getApiClient().listAssistingDrafts());
    } catch (e) {
      setError(toUserMessage(e));
    }
  }, []);
  useEffect(() => { void load() }, [load]);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await getApiClient().redeemAssistInvite(token.trim());
      setToken('');
      setDrafts(result.drafts);
      setStatus(`已加入协助，可以整理 ${result.drafts.length} 件草稿`);
      window.setTimeout(() => listRef.current?.focus(), 0);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reloadOne = async (id: string) => {
    try {
      const fresh = await getApiClient().getListingDraft(id);
      setDrafts((list) => (list ?? []).map((d) => (d.id === id ? fresh : d)));
      setReloadTick((n) => n + 1);
    } catch (e) {
      // 撤销或过期后协助人不能再读取：从列表中移除
      if (e instanceof ApiError && e.code === 404) { setDrafts((list) => (list ?? []).filter((d) => d.id !== id)); setSelected(null) }
      setError(toUserMessage(e));
    }
  };

  const current = drafts?.find((d) => d.id === selected) ?? null;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-extrabold text-slate-800">协助整理发布</h1>
      <p className="text-sm text-slate-700">{ASSISTANT_ROLE_TEXT}</p>

      <form className="flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); void redeem() }} aria-labelledby={`${inputId}-title`}>
        <h2 id={`${inputId}-title`} className="sr-only">兑换邀请码</h2>
        <TextField size="small" label="邀请码" value={token} onChange={(e) => setToken(e.target.value)}
          inputProps={{ maxLength: 200, autoComplete: 'off', spellCheck: false }} />
        <Button type="submit" variant="contained" disabled={busy || !token.trim()}>兑换</Button>
      </form>
      <div role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</div>
      {error && <Alert severity="error">{error}</Alert>}

      <section aria-labelledby="assisting-title" className="space-y-2">
        <h2 id="assisting-title" ref={listRef} tabIndex={-1} className="text-base font-bold text-slate-800 outline-none">我正在协助的草稿</h2>
        {drafts === null ? <p role="status" className="text-sm text-slate-600">正在读取…</p>
          : drafts.length === 0 ? <p className="text-sm text-slate-600">还没有可以协助的草稿。请向商品所有者要一个邀请码。</p>
            : (
              <ul className="space-y-1">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setSelected(d.id)} aria-current={selected === d.id ? 'true' : undefined}
                      className={`rounded-lg px-2 py-1 text-left text-sm ${selected === d.id ? 'bg-teal-100 font-semibold' : 'bg-slate-50'}`}>
                      {d.payload.title || '未命名'}{d.draftType === 'BUNDLE' ? '（整套打包）' : ''} · {d.status === 'READY' ? '所有者已标记可发布' : '整理中'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </section>

      {current && (
        <ListingItemEditor
          key={`${current.id}:${reloadTick}`}
          draft={current}
          assistant
          label="协助整理"
          onSaved={(saved) => setDrafts((list) => (list ?? []).map((d) => (d.id === saved.id ? saved : d)))}
          onReload={() => void reloadOne(current.id)}
        />
      )}
    </div>
  );
}
