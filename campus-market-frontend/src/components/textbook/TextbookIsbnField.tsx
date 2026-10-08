import { useEffect, useId, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { ApiError, toUserMessage } from '../../api/errors';
import type { ProductTextbook, TextbookEdition } from '../../api/contracts';
import { formatIsbn, isbnProblem } from '../../utils/isbn';
import TextbookEditionSummary from './TextbookEditionSummary';

export interface LinkedTextbook { editionId: string; label: string }

interface Props {
  /** 当前关联的版本；null 表示不关联教材目录 */
  value: LinkedTextbook | null;
  onChange: (next: LinkedTextbook | null) => void;
  /** 编辑模式：换版本时提示买家看到的信息会变化 */
  editing?: boolean;
  /** 商品原本关联的版本（编辑时） */
  initial?: ProductTextbook | null;
  /** 从教材版本页进入：打开这个版本的确认框。无 ISBN 的版本只能这样关联；仍需卖家主动确认 */
  presetEditionId?: string | null;
}

export const describeLinked = (e: { title: string; editionLabel: string; isbn: string | null }) =>
  e.isbn ? `${e.title} ${e.editionLabel} · ISBN ${formatIsbn(e.isbn)}` : `${e.title} ${e.editionLabel} · 无 ISBN`;

/**
 * 教材书籍发布时的 ISBN 关联。前端只做即时格式提示，服务端是最终权威。
 * 命中目录后必须由卖家在确认框里主动确认；未命中时可以不关联目录继续发布。
 * 从不根据书名猜测版本。
 */
export default function TextbookIsbnField({ value, onChange, editing, initial, presetEditionId }: Props) {
  const [isbn, setIsbn] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<TextbookEdition | null>(null);
  const helpId = useId();
  const errorId = useId();
  const statusId = useId();

  const formatError = touched && isbn.trim() ? isbnProblem(isbn) : null;

  // 只在进入页面时打开一次；关掉确认框后不会再弹
  useEffect(() => {
    if (!presetEditionId) return;
    let active = true;
    getApiClient().getTextbook(presetEditionId)
      .then((edition) => { if (active) setCandidate(edition) })
      .catch((e) => { if (active) setError(toUserMessage(e)) });
    return () => { active = false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetEditionId]);

  const lookup = async () => {
    setTouched(true);
    setNotFound(null);
    setError(null);
    if (isbnProblem(isbn)) return;
    setBusy(true);
    try {
      setCandidate(await getApiClient().getTextbookByIsbn(isbn));
    } catch (e) {
      if (e instanceof ApiError && e.code === 404) setNotFound('本校教材目录中没有这个 ISBN。可以不关联教材目录继续发布，买家只会看到你填写的标题和描述。');
      else setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const changed = editing && initial && value?.editionId !== initial.editionId;
  return (
    <section aria-labelledby="textbook-link-title" className="space-y-2 rounded-2xl border border-slate-200 p-4">
      <h2 id="textbook-link-title" className="text-sm font-bold text-slate-800">关联课程教材版本（选填）</h2>
      <p id={helpId} className="text-xs text-slate-600">
        输入书背面的 ISBN（可以带空格或连字符），在本校教材目录里查到对应版本后由你确认。系统不会根据书名替你选择版本。
      </p>
      {value ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-teal-50 p-3 text-sm" data-linked-edition={value.editionId}>
          <span>已关联：{value.label}</span>
          <Button size="small" color="inherit" onClick={() => onChange(null)}>不关联教材目录</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <TextField
            size="small"
            label="ISBN"
            value={isbn}
            onChange={(e) => { setIsbn(e.target.value); setNotFound(null); }}
            onBlur={() => setTouched(true)}
            error={Boolean(formatError)}
            inputProps={{ inputMode: 'text', maxLength: 30, 'aria-describedby': formatError ? `${errorId} ${helpId}` : helpId }}
          />
          <Button variant="outlined" onClick={lookup} disabled={busy}>在目录中查找</Button>
        </div>
      )}
      {formatError && <p id={errorId} className="text-xs text-red-700">{formatError}</p>}
      <div id={statusId} role="status" aria-live="polite" className="text-xs text-slate-700">
        {busy ? '正在查找…' : notFound}
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      {changed && (
        <Alert severity="info" role="note" sx={{ py: 0 }}>
          更换或解除后，买家在商品页看到的教材版本信息会随之变化；已经生成的订单不受影响。
        </Alert>
      )}

      <Dialog open={Boolean(candidate)} onClose={() => setCandidate(null)} aria-labelledby="textbook-confirm-title">
        <DialogTitle id="textbook-confirm-title">确认是这个版本吗？</DialogTitle>
        <DialogContent>
          {candidate && <TextbookEditionSummary edition={candidate} />}
          <p className="mt-2 text-xs text-slate-600">请对照书的封面与版权页。版次不同就是不同的书，买家会按这个版本查找。</p>
          {candidate?.isDemo && <p className="mt-1 text-xs text-amber-800">这是演示目录中的虚构教材。</p>}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setCandidate(null)}>不是这个版本</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (candidate) onChange({ editionId: candidate.id, label: describeLinked(candidate) });
              setCandidate(null);
              setIsbn('');
            }}
          >
            确认关联这个版本
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
