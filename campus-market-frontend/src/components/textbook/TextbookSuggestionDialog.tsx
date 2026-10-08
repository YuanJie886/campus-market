import { useEffect, useId, useRef, useState } from 'react';
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
import { toUserMessage } from '../../api/errors';
import type { CourseOffering, TextbookSuggestionInput, TextbookUsage } from '../../api/contracts';
import { SUGGESTION_NOTE, USAGE_OPTIONS, offeringLabel, usageLabel } from '../../utils/catalog';
import { isbnProblem } from '../../utils/isbn';
import ErrorSummary, { type ErrorSummaryItem } from '../trust/ErrorSummary';

interface Props {
  open: boolean;
  offerings: CourseOffering[];
  onClose: () => void;
  onDone: (message: string) => void;
}

const FIELD = { offering: 'suggest-offering', isbn: 'suggest-isbn', title: 'suggest-title', publisher: 'suggest-publisher', edition: 'suggest-edition' };

/**
 * 教材建议（4.4）。只提交书目信息与用途；状态、提交人、学校、时间都由服务端决定。
 * 建议永远是「待审核（未公开）」，不会出现在公开课程页，也没有审核进度。
 */
export default function TextbookSuggestionDialog({ open, offerings, onClose, onDone }: Props) {
  const [offeringId, setOfferingId] = useState('');
  const [mode, setMode] = useState<'isbn' | 'metadata'>('isbn');
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [publisher, setPublisher] = useState('');
  const [editionLabel, setEditionLabel] = useState('');
  const [usage, setUsage] = useState<TextbookUsage>('REQUIRED');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  const isbnErrorId = useId();

  useEffect(() => {
    if (!open) return;
    setOfferingId(offerings[0]?.id ?? '');
    setMode('isbn'); setIsbn(''); setTitle(''); setAuthors(''); setPublisher(''); setEditionLabel('');
    setUsage('REQUIRED'); setNote(''); setErrors({}); setSummary([]); setServerError(null);
  }, [open, offerings]);

  useEffect(() => { if (focusTick > 0) summaryRef.current?.focus(); }, [focusTick]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!offeringId) next[FIELD.offering] = '请选择开课学期';
    if (mode === 'isbn') {
      const problem = isbnProblem(isbn);
      if (problem) next[FIELD.isbn] = problem;
    } else {
      if (!title.trim()) next[FIELD.title] = '请填写书名';
      if (!publisher.trim()) next[FIELD.publisher] = '没有 ISBN 时请填写出版社';
      if (!editionLabel.trim()) next[FIELD.edition] = '没有 ISBN 时请填写版次';
    }
    setErrors(next);
    const items = Object.entries(next).map(([key, message]) => ({ key, message, focus: () => document.getElementById(key)?.focus() }));
    setSummary(items);
    if (items.length) setFocusTick((n) => n + 1);
    return items.length === 0;
  };

  const submit = async () => {
    if (busy || !validate()) return;
    const input: TextbookSuggestionInput = mode === 'isbn'
      ? { courseOfferingId: offeringId, isbn, usageType: usage }
      : { courseOfferingId: offeringId, title, publisher, editionLabel, ...(authors.trim() ? { authors } : {}), usageType: usage };
    if (note.trim()) input.note = note.trim();
    setBusy(true);
    setServerError(null);
    try {
      const result = await getApiClient().createTextbookSuggestion(input);
      onDone(result.outcome === 'EXISTING' ? '你已经提交过相同的建议' : '建议已提交，状态为「待审核（未公开）」');
    } catch (e) {
      setServerError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="suggest-title-heading">
      <DialogTitle id="suggest-title-heading">为这门课建议教材</DialogTitle>
      <DialogContent>
        <p className="mb-3 text-xs text-slate-600">{SUGGESTION_NOTE}</p>
        <div className="flex flex-col gap-3">
          <ErrorSummary ref={summaryRef} title="提交前请先修正以下问题" items={summary} />
          <TextField select id={FIELD.offering} label="开课学期" value={offeringId} onChange={(e) => setOfferingId(e.target.value)}
            error={Boolean(errors[FIELD.offering])} helperText={errors[FIELD.offering]} fullWidth>
            {offerings.map((o) => <MenuItem key={o.id} value={o.id}>{offeringLabel(o)}</MenuItem>)}
          </TextField>
          <fieldset>
            <legend className="text-sm text-slate-700">怎样描述这本书</legend>
            <RadioGroup row name="suggest-mode" value={mode} onChange={(e) => setMode(e.target.value as 'isbn' | 'metadata')}>
              <FormControlLabel value="isbn" control={<Radio size="small" />} label="我有 ISBN" />
              <FormControlLabel value="metadata" control={<Radio size="small" />} label="没有 ISBN（讲义等）" />
            </RadioGroup>
          </fieldset>
          {mode === 'isbn' ? (
            <>
              <TextField id={FIELD.isbn} label="ISBN" value={isbn} onChange={(e) => setIsbn(e.target.value)}
                error={Boolean(errors[FIELD.isbn])}
                inputProps={{ 'aria-describedby': errors[FIELD.isbn] ? isbnErrorId : undefined, maxLength: 30 }} fullWidth />
              {errors[FIELD.isbn] && <p id={isbnErrorId} className="-mt-2 text-xs text-red-700">{errors[FIELD.isbn]}</p>}
            </>
          ) : (
            <>
              <TextField id={FIELD.title} label="书名" value={title} onChange={(e) => setTitle(e.target.value)}
                error={Boolean(errors[FIELD.title])} helperText={errors[FIELD.title]} inputProps={{ maxLength: 120 }} fullWidth />
              <TextField label="作者（选填）" value={authors} onChange={(e) => setAuthors(e.target.value)} inputProps={{ maxLength: 120 }} fullWidth />
              <TextField id={FIELD.publisher} label="出版社" value={publisher} onChange={(e) => setPublisher(e.target.value)}
                error={Boolean(errors[FIELD.publisher])} helperText={errors[FIELD.publisher]} inputProps={{ maxLength: 80 }} fullWidth />
              <TextField id={FIELD.edition} label="版次" value={editionLabel} onChange={(e) => setEditionLabel(e.target.value)}
                error={Boolean(errors[FIELD.edition])} helperText={errors[FIELD.edition] ?? '例如「第 8 版」'} inputProps={{ maxLength: 40 }} fullWidth />
            </>
          )}
          <TextField select label="用途" value={usage} onChange={(e) => setUsage(e.target.value as TextbookUsage)} fullWidth>
            {USAGE_OPTIONS.map((u) => <MenuItem key={u} value={u}>{usageLabel(u)}</MenuItem>)}
          </TextField>
          <TextField label="补充说明（选填）" value={note} onChange={(e) => setNote(e.target.value)}
            inputProps={{ maxLength: 200 }} helperText="请不要填写姓名、学号、联系方式" fullWidth />
          {serverError && <p role="alert" className="text-sm text-red-700">{serverError}</p>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>提交建议</Button>
      </DialogActions>
    </Dialog>
  );
}
