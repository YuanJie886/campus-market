import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import { getApiClient } from '../api/client';
import { ApiError, toUserMessage } from '../api/errors';
import { BATCH_MAX_ITEMS, type AssistInvite, type BatchPublishProblem, type ListingBatch, type ListingBatchSummary, type ListingDraft, type ListingKind, type PublishBatchResult } from '../api/contracts';
import { VALIDATION_LABEL, copyCommonFields, missingText, newIdempotencyKey } from '../utils/supply';
import ListingItemEditor, { type ListingItemEditorHandle } from '../components/supply/ListingItemEditor';
import AssistInviteDialog from '../components/supply/AssistInviteDialog';
import AssistInviteList from '../components/supply/AssistInviteList';

/** 协助整理后发布时，发布确认页必须如实写出的文字 */
export const ASSISTED_PUBLISH_TEXT = '内容由他人协助整理，商品所有者已检查并确认发布。';

interface Problem { position: number; draftId: string; text: string }

/**
 * 毕业季快速发布（任何时候都可以用）：一个批次最多 20 件，逐件整理、保存为草稿，
 * 全部通过校验后一次确认发布——要么全部发布，要么一件都不发布。
 */
export default function SupplyWorkbenchPage() {
  const [params, setParams] = useSearchParams();
  const batchId = params.get('batch');
  const [batches, setBatches] = useState<ListingBatchSummary[] | null>(null);
  const [batch, setBatch] = useState<ListingBatch | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [copyCommon, setCopyCommon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishBatchResult | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteTick, setInviteTick] = useState(0);
  // 只有用户明确选择「重新加载」时才重建编辑器；自己保存成功不重建，焦点与提示都留在原处
  const [reloadTick, setReloadTick] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const editorRef = useRef<ListingItemEditorHandle>(null);
  const focusEditorOnSelect = useRef(false);
  // 同一次发布尝试（包括网络失败后的重试）沿用同一个幂等键；批次内容一变就换新键
  const publishKey = useRef<string | null>(null);
  const inviteFilter = useCallback((i: AssistInvite) => i.batchId === batchId, [batchId]);

  const loadBatch = useCallback(async (id: string) => {
    try {
      const b = await getApiClient().getListingBatch(id);
      setBatch(b);
      setError(null);
      return b;
    } catch (e) {
      setError(toUserMessage(e));
      return null;
    }
  }, []);

  useEffect(() => {
    setResult(null);
    setProblems([]);
    if (batchId) { void loadBatch(batchId); return }
    setBatch(null);
    getApiClient().listListingBatches().then(setBatches).catch((e) => setError(toUserMessage(e)));
  }, [batchId, loadBatch]);

  useEffect(() => { if (result) resultRef.current?.focus() }, [result]);
  useEffect(() => {
    if (focusEditorOnSelect.current) { focusEditorOnSelect.current = false; editorRef.current?.focusTitle() }
  }, [selected, batch]);

  const items = batch?.items ?? [];
  const current = useMemo(() => items.find((i) => i.draft.id === selected) ?? items[0] ?? null, [items, selected]);
  const open = batch?.status === 'OPEN';

  const select = (draftId: string, focus = true) => { focusEditorOnSelect.current = focus; setSelected(draftId) };

  const newBatch = async () => {
    try {
      const b = await getApiClient().createListingBatch({ draftIds: [] });
      setParams({ batch: b.id });
    } catch (e) { setError(toUserMessage(e)) }
  };

  const replaceItems = async (draftIds: string[]) => {
    if (!batch) return null;
    try {
      const b = await getApiClient().updateListingBatch(batch.id, { expectedVersion: batch.version, draftIds });
      setBatch(b);
      publishKey.current = null;
      return b;
    } catch (e) {
      if (e instanceof ApiError && e.code === 409) {
        setError('这个批次已在其他页面更新过。请点「重新加载批次」查看最新内容后再操作，本页不会覆盖对方的修改。');
      } else setError(toUserMessage(e));
      return null;
    }
  };

  const addItem = async (draftType: ListingKind) => {
    if (!batch || items.length >= BATCH_MAX_ITEMS) return;
    setError(null);
    try {
      const previous = items[items.length - 1]?.draft.payload;
      const draft = await getApiClient().createListingDraft({ draftType, payload: copyCommon && previous ? copyCommonFields(previous) : {} });
      const b = await replaceItems([...items.map((i) => i.draft.id), draft.id]);
      if (b) { select(draft.id); setStatus(`已添加第 ${b.items.length} 件`) }
    } catch (e) { setError(toUserMessage(e)) }
  };

  const removeItem = async (draftId: string) => {
    const b = await replaceItems(items.map((i) => i.draft.id).filter((id) => id !== draftId));
    if (b) { setSelected(b.items[0]?.draft.id ?? null); setStatus('已从批次移出，草稿仍保留在「我的草稿」里') }
  };

  const onSaved = (saved: ListingDraft) => {
    if (!batch) return;
    publishKey.current = null;
    setBatch({ ...batch, items: batch.items.map((i) => (i.draft.id === saved.id ? { ...i, draft: saved } : i)) });
    void loadBatch(batch.id);
  };

  const showProblems = (list: Problem[]) => {
    setProblems(list);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const check = async () => {
    if (!batch) return;
    const b = await loadBatch(batch.id);
    if (!b) return;
    const list = b.items.filter((i) => i.validation && i.validation.code !== 'VALID').map((i) => ({
      position: i.position, draftId: i.draft.id,
      text: `第 ${i.position} 件：${VALIDATION_LABEL[i.validation!.code]}${i.validation!.code === 'MISSING_FIELD' ? `（${missingText(i.validation!.field)}）` : ''}`,
    }));
    if (list.length) showProblems(list);
    else { setProblems([]); setStatus(b.items.length ? `${b.items.length} 件全部可以发布` : '批次里还没有商品') }
    return { b, list };
  };

  const startPublish = async () => {
    const checked = await check();
    if (checked && checked.b.items.length > 0 && checked.list.length === 0) setConfirmOpen(true);
  };

  const publish = async () => {
    if (!batch) return;
    publishKey.current ??= newIdempotencyKey();
    setPublishing(true);
    try {
      const r = await getApiClient().publishListingBatch(batch.id, publishKey.current);
      setConfirmOpen(false);
      setResult(r);
      publishKey.current = null;
      await loadBatch(batch.id);
    } catch (e) {
      setConfirmOpen(false);
      // 先刷新批次（刷新会清掉上一次的错误提示），再写这一次失败的说明；否则失败提示会被立刻抹掉（8.1 E2E 发现）
      await loadBatch(batch.id);
      setStatus('');
      const details = e instanceof ApiError ? (e.details as { items?: BatchPublishProblem[] } | undefined) : undefined;
      if (e instanceof ApiError && e.code === 400 && details?.items?.length) {
        showProblems(details.items.map((p) => ({
          position: p.position, draftId: p.draftId,
          text: `第 ${p.position} 件：${VALIDATION_LABEL[p.code]}${p.code === 'MISSING_FIELD' ? `（${missingText(p.field)}）` : ''}`,
        })));
        setError('整个批次都没有发布。请按下面的清单逐件修改，其他已填写的内容都还在。');
      } else {
        // 失败时没有任何商品被发布（全有或全无）；网络失败可以直接重试，同一个幂等键不会重复发布
        setError(`发布没有完成，没有任何商品被发布：${toUserMessage(e)}`);
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!batchId) {
    const openBatches = (batches ?? []).filter((b) => b.status === 'OPEN');
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-extrabold text-slate-800">毕业季快速发布</h1>
        <p className="text-sm text-slate-600">
          一次整理多件闲置（最多 {BATCH_MAX_ITEMS} 件），逐件保存为草稿，全部检查通过后一次确认发布：要么全部发布，要么一件都不发布。任何时候都可以用。
        </p>
        {error && <Alert severity="error">{error}</Alert>}
        <Button variant="contained" onClick={newBatch}>新建批次</Button>
        <section aria-labelledby="open-batches" className="space-y-2">
          <h2 id="open-batches" className="text-base font-bold text-slate-800">未发布的批次</h2>
          {batches === null ? <p role="status" className="text-sm text-slate-600">正在读取…</p>
            : openBatches.length === 0 ? <p className="text-sm text-slate-600">还没有未发布的批次。</p>
              : (
                <ul className="space-y-1">
                  {openBatches.map((b) => (
                    <li key={b.id}>
                      <Link to={`/publish/batch?batch=${encodeURIComponent(b.id)}`} className="text-teal-800 underline">
                        {new Date(b.createdAt).toLocaleString('zh-CN')} 创建的批次（{b.itemCount} 件）
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-slate-800">毕业季快速发布</h1>
        <Link to="/publish/batch" className="text-sm text-teal-800 underline">全部批次</Link>
      </div>
      {error && (
        <Alert severity="error" action={batch && <Button color="inherit" size="small" onClick={() => { setError(null); void loadBatch(batch.id) }}>重新加载批次</Button>}>
          {error}
        </Alert>
      )}
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
      {status && <p aria-hidden="true" className="text-sm text-emerald-800">{status}</p>}

      {result && (
        <section aria-labelledby="publish-result" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
          <h2 id="publish-result" ref={resultRef} tabIndex={-1} className="text-base font-bold text-emerald-900 outline-none">
            已发布 {result.publishedCount} 件
          </h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {result.productIds.map((id, i) => <li key={id}><Link to={`/product/${id}`} className="text-teal-800 underline">查看第 {i + 1} 件</Link></li>)}
          </ul>
        </section>
      )}

      {problems.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} aria-labelledby="batch-problems-title" className="rounded-xl border-2 border-red-600 bg-red-50 p-3 outline-none">
          <p id="batch-problems-title" className="text-sm font-bold text-red-800">还有 {problems.length} 件需要修改</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-800">
            {problems.map((p) => (
              <li key={p.draftId}><button type="button" className="text-left underline" onClick={() => select(p.draftId)}>{p.text}</button></li>
            ))}
          </ul>
        </div>
      )}

      {batch && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <nav aria-label="批次中的商品" className="space-y-2">
            <p className="text-sm text-slate-700">共 {items.length} / {BATCH_MAX_ITEMS} 件{open ? '' : ' · 已发布'}</p>
            <ol className="space-y-1">
              {items.map((i) => (
                <li key={i.draft.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => select(i.draft.id)} aria-current={current?.draft.id === i.draft.id ? 'true' : undefined}
                    className={`flex-1 rounded-lg px-2 py-1 text-left text-sm ${current?.draft.id === i.draft.id ? 'bg-teal-100 font-semibold' : 'bg-slate-50'}`}>
                    第 {i.position} 件 · {i.draft.payload.title || '未命名'}
                    {i.draft.draftType === 'BUNDLE' ? '（整套）' : ''}
                    {i.validation && <span className="block text-xs text-slate-600">{VALIDATION_LABEL[i.validation.code]}</span>}
                  </button>
                  {open && <Button size="small" color="inherit" onClick={() => removeItem(i.draft.id)} aria-label={`从批次移出第 ${i.position} 件`}>移出</Button>}
                </li>
              ))}
            </ol>
            {open && (
              <div className="space-y-1">
                <FormControlLabel control={<Checkbox size="small" checked={copyCommon} onChange={(e) => setCopyCommon(e.target.checked)} />}
                  label={<span className="text-xs">新增时复制上一件的通用字段（校区、取货楼栋、联系方式）</span>} />
                <div className="flex flex-wrap gap-2">
                  <Button size="small" variant="outlined" onClick={() => addItem('SINGLE')} disabled={items.length >= BATCH_MAX_ITEMS}>添加单件</Button>
                  <Button size="small" variant="outlined" onClick={() => addItem('BUNDLE')} disabled={items.length >= BATCH_MAX_ITEMS}>添加整套打包</Button>
                </div>
                <Button size="small" onClick={() => setInviteOpen(true)}>邀请协助整理</Button>
              </div>
            )}
            <AssistInviteList refreshKey={inviteTick} filter={inviteFilter} />
          </nav>

          <div className="space-y-4">
            {current && open ? (
              <ListingItemEditor
                key={`${current.draft.id}:${reloadTick}`}
                ref={editorRef}
                draft={current.draft}
                validation={current.validation}
                label={`第 ${current.position} 件`}
                onSaved={onSaved}
                onReload={() => void loadBatch(batch.id).then(() => setReloadTick((n) => n + 1))}
              />
            ) : !open ? (
              <p className="text-sm text-slate-600">这个批次已{batch.status === 'PUBLISHED' ? '发布' : '丢弃'}，内容不能再修改。</p>
            ) : (
              <p className="text-sm text-slate-600">先添加一件商品。分类、价格、成色与验货声明都需要逐件填写，不会替你预先选择。</p>
            )}
            {open && (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
                <Button variant="outlined" onClick={() => void check()}>检查全部</Button>
                <Button variant="contained" onClick={() => void startPublish()} disabled={items.length === 0 || publishing}>
                  发布这 {items.length} 件
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="publish-confirm-title">
        <DialogTitle id="publish-confirm-title">确认一次发布 {items.length} 件？</DialogTitle>
        <DialogContent className="space-y-2">
          <p className="text-sm">全部成功或全部不发布：任何一件失败，这个批次都不会发布任何商品。</p>
          {batch?.assisted && <p className="text-sm font-semibold text-amber-900">{ASSISTED_PUBLISH_TEXT}</p>}
          <p className="text-xs text-slate-600">发布后，买家的订单、确认码与联系方式只有你本人能看到。</p>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmOpen(false)}>再检查一下</Button>
          <Button variant="contained" onClick={() => void publish()} disabled={publishing}>确认发布</Button>
        </DialogActions>
      </Dialog>
      {batch && (
        <AssistInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} scope={{ batchId: batch.id }}
          onCreated={() => setInviteTick((n) => n + 1)} />
      )}
    </div>
  );
}
