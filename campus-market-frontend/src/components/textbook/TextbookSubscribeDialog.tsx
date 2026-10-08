import { useEffect, useId, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { TextbookEdition } from '../../api/contracts';
import { SCOPE_FALLBACK_ORDER, SCOPE_LABEL, type BuildingScope } from '../../utils/geo';
import TextbookEditionSummary from './TextbookEditionSummary';

interface Props {
  open: boolean;
  edition: Pick<TextbookEdition, 'id' | 'title' | 'editionLabel' | 'isbn' | 'authors' | 'publisher' | 'publishedYear' | 'subtitle'> | null;
  /** 用户是否设置了宿舍楼：没有时只能选校区 / 全校，不替用户猜楼栋 */
  hasDorm: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * 无货时订阅这个教材版本（4.6）。按版本 id 精确匹配：分类、学校由服务端决定，
 * 用户只选地理范围和可选预算。匹配理由与档位都由服务端给出。
 */
export default function TextbookSubscribeDialog({ open, edition, hasDorm, onClose, onDone }: Props) {
  const [scope, setScope] = useState<BuildingScope>('SCHOOL');
  const [maxPrice, setMaxPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  useEffect(() => {
    if (!open) return;
    setScope('SCHOOL');
    setMaxPrice('');
    setError(null);
  }, [open]);

  const scopes = SCOPE_FALLBACK_ORDER.filter((s) => hasDorm || s === 'CAMPUS' || s === 'SCHOOL');
  const submit = async () => {
    if (!edition) return;
    const price = maxPrice.trim() === '' ? null : Number(maxPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return setError('预算应为不小于 0 的数字');
    setBusy(true);
    setError(null);
    try {
      const result = await getApiClient().createDemandSubscription({
        textbookEditionId: edition.id, geoScope: scope, ...(price !== null ? { maxPrice: price } : {}),
      });
      onDone(result.outcome === 'EXISTING' ? '你已经订阅过这个版本' : '已订阅：有同版本的新货时会出现在「需求匹配」里');
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="textbook-subscribe-title">
      <DialogTitle id="textbook-subscribe-title">订阅这个教材版本</DialogTitle>
      <DialogContent>
        {edition && <TextbookEditionSummary edition={edition} />}
        <p className="my-2 text-xs text-slate-600">只匹配关联了这个版本的商品，不按书名猜测；同名书的其他版次不会通知你。</p>
        <div className="flex flex-col gap-3">
          <TextField select label="范围" value={scope} onChange={(e) => setScope(e.target.value as BuildingScope)} fullWidth>
            {scopes.map((s) => <MenuItem key={s} value={s}>{SCOPE_LABEL[s]}</MenuItem>)}
          </TextField>
          <TextField
            label="最高预算（元，选填）"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            inputProps={{ inputMode: 'decimal' }}
            fullWidth
          />
          {error && <p id={errorId} role="alert" className="text-sm text-red-700">{error}</p>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy} aria-describedby={error ? errorId : undefined}>确认订阅</Button>
      </DialogActions>
    </Dialog>
  );
}
