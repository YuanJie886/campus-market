import { useEffect, useRef } from 'react';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { CATEGORIES, CONDITIONS } from '../../types';
import { BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS, type BundleItemInput } from '../../api/contracts';

/** 编辑中的一行：分类与成色可以暂时为空（不替卖家预选），数量以文本编辑。 */
export interface BundleRow { key: string; itemCode?: string; name: string; category: string; condition: string; quantity: string; note: string }

let rowSeq = 0;
export const emptyBundleRow = (): BundleRow => ({ key: `row-${(rowSeq += 1)}`, name: '', category: '', condition: '', quantity: '1', note: '' });

export function rowsFromItems(items: BundleItemInput[] | undefined): BundleRow[] {
  return (items ?? []).map((i) => ({
    key: `row-${(rowSeq += 1)}`, itemCode: i.itemCode, name: i.name ?? '', category: i.category ?? '', condition: i.condition ?? '',
    quantity: i.quantity === undefined || i.quantity === null ? '' : String(i.quantity), note: i.note ?? '',
  }));
}

/** 转成提交体：空字段原样留空，交给服务端逐条校验，前端不替卖家补默认值。 */
export function itemsFromRows(rows: BundleRow[]): BundleItemInput[] {
  return rows.map((r) => {
    const quantity = /^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : (r.quantity as unknown as number);
    const item: Record<string, unknown> = { name: r.name, category: r.category, condition: r.condition, quantity };
    if (r.itemCode) item.itemCode = r.itemCode;
    if (r.note.trim()) item.note = r.note;
    return item as unknown as BundleItemInput;
  });
}

interface Props {
  rows: BundleRow[];
  onChange: (rows: BundleRow[]) => void;
  /** 服务端或本地校验给出的整体错误 */
  error?: string | null;
  /** 同一页面有多个编辑器时用于区分 id */
  idPrefix?: string;
}

/**
 * 整套打包的明细编辑：2～30 行，每行名称 / 分类 / 成色 / 数量 / 备注。
 * 新增一行后焦点移到新行的名称；删除一行后焦点移到下一行（没有下一行时移到「添加一行」）。
 */
export default function BundleEditor({ rows, onChange, error, idPrefix = 'bundle' }: Props) {
  const nameRefs = useRef(new Map<string, HTMLInputElement | null>());
  const addRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | 'add' | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'add') addRef.current?.focus();
    else nameRefs.current.get(target)?.focus();
  });

  const update = (key: string, patch: Partial<BundleRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    if (rows.length >= BUNDLE_MAX_ITEMS) return;
    const row = emptyBundleRow();
    pendingFocus.current = row.key;
    onChange([...rows, row]);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    pendingFocus.current = next[index]?.key ?? 'add';
    onChange(next);
  };
  const quantity = rows.reduce((n, r) => n + (/^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : 0), 0);
  const categories = new Set(rows.map((r) => r.category).filter(Boolean)).size;
  const errorId = `${idPrefix}-error`;
  const countId = `${idPrefix}-count`;

  return (
    <section aria-labelledby={`${idPrefix}-title`} aria-describedby={error ? `${countId} ${errorId}` : countId} className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <div>
        <h3 id={`${idPrefix}-title`} className="text-sm font-bold text-slate-800">打包明细</h3>
        <p className="mt-1 text-xs text-slate-600">整套展示，请逐项填写内容，方便买家了解商品。</p>
        <p id={countId} role="status" className="mt-1 text-xs text-slate-700">
          共 {rows.length} 行（需要 {BUNDLE_MIN_ITEMS}～{BUNDLE_MAX_ITEMS} 行）· 包含 {categories} 类 / {quantity} 件
        </p>
      </div>
      {error && <p id={errorId} className="text-sm text-red-700">{error}</p>}
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const n = index + 1;
          return (
            <li key={row.key} className="rounded-xl bg-slate-50 p-3">
              <fieldset className="grid gap-2 sm:grid-cols-6">
                <legend className="mb-1 text-xs font-semibold text-slate-700">第 {n} 行</legend>
                <TextField
                  id={`${idPrefix}-name-${index}`}
                  size="small" label={`第 ${n} 行名称`} value={row.name} className="sm:col-span-2"
                  inputRef={(el: HTMLInputElement | null) => { nameRefs.current.set(row.key, el) }}
                  inputProps={{ maxLength: 60 }}
                  onChange={(e) => update(row.key, { name: e.target.value })}
                />
                <TextField
                  select size="small" label={`第 ${n} 行分类`} value={row.category}
                  onChange={(e) => update(row.key, { category: e.target.value })}
                  SelectProps={{ displayEmpty: false }}
                >
                  {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <TextField
                  select size="small" label={`第 ${n} 行成色`} value={row.condition}
                  onChange={(e) => update(row.key, { condition: e.target.value })}
                >
                  {CONDITIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <TextField
                  size="small" label={`第 ${n} 行数量`} value={row.quantity}
                  inputProps={{ inputMode: 'numeric', maxLength: 2 }}
                  onChange={(e) => update(row.key, { quantity: e.target.value })}
                />
                <TextField
                  size="small" label={`第 ${n} 行备注`} value={row.note} className="sm:col-span-5"
                  inputProps={{ maxLength: 200 }}
                  onChange={(e) => update(row.key, { note: e.target.value })}
                />
                <div className="flex items-center">
                  <Button size="small" color="inherit" onClick={() => remove(index)} aria-label={`删除第 ${n} 行`}>删除</Button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <Button id={`${idPrefix}-add`} ref={addRef} variant="outlined" size="small" onClick={add} disabled={rows.length >= BUNDLE_MAX_ITEMS}>
        添加一行
      </Button>
    </section>
  );
}
