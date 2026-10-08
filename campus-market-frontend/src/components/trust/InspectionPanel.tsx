import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import type { BuyerResult, InspectionResultInput, OrderFlow } from '../../api/contracts';
import { formatDateTime } from '../../utils/format';
import {
  BUYER_RESULT_OPTIONS, INSPECTION_DISCLAIMER, conditionLabel, inspectionStatusLabel, resultLabel,
} from '../../utils/trustedFlow';
import ErrorSummary, { focusRadioGroup, type ErrorSummaryItem } from './ErrorSummary';

export const BUYER_NOTE_MAX = 200;
export const resultFieldName = (code: string) => `result-${code}`;

interface Draft { result: BuyerResult | null; note: string }

interface Props {
  flow: OrderFlow;
  busy: boolean;
  onSaveDraft: (items: InspectionResultInput[]) => void;
  onSubmit: (items: InspectionResultInput[]) => void;
}

/**
 * 订单验货。买家在面交阶段逐项对照卖家声明填写；卖家只能查看。
 * 提交后记录不可修改——提交前会再确认一次。
 */
export default function InspectionPanel({ flow, busy, onSaveDraft, onSubmit }: Props) {
  const inspection = flow.inspection;
  const editable = flow.role === 'BUYER' && inspection.status === 'PENDING' && flow.status === 'PENDING_MEETING';
  const final = inspection.status === 'SUBMITTED' || inspection.status === 'NEEDS_RESOLUTION';

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);

  // 以服务端保存的草稿为准恢复（刷新、换标签页后都一致）
  useEffect(() => {
    setDrafts(Object.fromEntries(inspection.items.map((i) => [i.code, { result: i.buyerResult, note: i.buyerNote ?? '' }])));
    setErrors({});
    setSummary([]);
  }, [inspection]);

  useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus();
  }, [focusTick]);

  const payload = (): InspectionResultInput[] =>
    inspection.items.map((i) => {
      const d = drafts[i.code] ?? { result: null, note: '' };
      const note = d.note.trim();
      return { itemCode: i.code, result: d.result, ...(note ? { note } : {}) };
    });

  const validate = (finalSubmit: boolean): boolean => {
    const next: Record<string, string> = {};
    for (const item of inspection.items) {
      const d = drafts[item.code];
      if (finalSubmit && !d?.result) next[item.code] = `请为「${item.label}」给出现场结果`;
      else if (d?.note && d.note.trim().length > BUYER_NOTE_MAX) next[item.code] = `备注最多 ${BUYER_NOTE_MAX} 个字`;
      else if (d?.note && /[<>]/.test(d.note)) next[item.code] = '备注不能包含尖括号';
    }
    setErrors(next);
    const items = inspection.items
      .filter((i) => next[i.code])
      .map((i) => ({ key: i.code, message: next[i.code], focus: () => focusRadioGroup(resultFieldName(i.code)) }));
    setSummary(items);
    if (items.length) setFocusTick((n) => n + 1);
    return items.length === 0;
  };

  if (inspection.status === 'LEGACY_NONE' || inspection.status === 'NOT_PROVIDED') {
    return (
      <section aria-labelledby="inspection-title" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
        <h2 id="inspection-title" className="text-base font-bold text-slate-800">验货记录</h2>
        <p className="mt-1 text-sm text-slate-700" data-inspection-status={inspection.status}>
          {inspection.status === 'LEGACY_NONE'
            ? '无结构化验货记录：该订单创建于验货清单上线之前。'
            : '该商品发布时未提供结构化验货声明，本订单没有验货清单。'}
        </p>
        <p className="mt-1 text-xs text-slate-600">面交时请当面仔细检查；确认面交流程与原来一致。</p>
      </section>
    );
  }

  const mismatchCount = inspection.items.filter((i) => i.buyerResult === 'MISMATCH').length;
  return (
    <section aria-labelledby="inspection-title" className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <div>
        <h2 id="inspection-title" className="text-base font-bold text-slate-800">验货记录</h2>
        <p className="text-xs text-slate-600">
          {inspection.templateTitle ?? '验货清单'}
          {inspection.templateVersion ? ` · 第 ${inspection.templateVersion} 版` : ''} ·{' '}
          <span data-inspection-status={inspection.status}>{inspectionStatusLabel(inspection.status)}</span>
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700">{INSPECTION_DISCLAIMER}</p>
      </div>

      {final && inspection.submittedAtIso && (
        <p className="text-sm text-slate-700">
          买家于 <time dateTime={inspection.submittedAtIso}>{formatDateTime(Date.parse(inspection.submittedAtIso))}</time> 提交，
          记录已锁定，任何一方都不能修改。
          {mismatchCount > 0 && <strong className="ml-1 text-red-800">共 {mismatchCount} 项与声明不一致。</strong>}
        </p>
      )}
      {!editable && inspection.status === 'PENDING' && (
        <p className="text-sm text-slate-700">
          {flow.role === 'SELLER'
            ? '等待买家在面交时逐项验货。买家的草稿不会显示给你，提交后你会看到最终结果。'
            : '卖家接受预约、进入待面交阶段后，才能填写验货结果。'}
        </p>
      )}

      {editable && <ErrorSummary ref={summaryRef} title="提交前请补全验货结果" items={summary} />}

      <ul className="space-y-2">
        {inspection.items.map((item) => {
          const d = drafts[item.code] ?? { result: null, note: '' };
          const legendId = `result-legend-${item.code}`;
          const errorId = `result-error-${item.code}`;
          const mismatch = item.buyerResult === 'MISMATCH';
          return (
            <li
              key={item.code}
              data-item-code={item.code}
              className={`rounded-xl p-3 ${final && mismatch ? 'border-2 border-red-600 bg-red-50' : 'bg-slate-50'}`}
            >
              <p className="text-sm font-semibold text-slate-800">
                {item.label}
                {!item.required && <span className="ml-1 text-xs font-normal text-slate-600">（选填）</span>}
              </p>
              {/* 快照里的核对说明（整套打包的每条明细在这里写出分类、卖家标注的成色与核对要点） */}
              {item.description && <p className="text-xs text-slate-600">{item.description}</p>}
              {/* 普通清单的必填项在发布时一定有声明；必填却没有声明的只可能是打包明细，成色已写在说明里 */}
              {item.sellerCondition !== null || !item.required ? (
                <p className="text-xs text-slate-700">
                  卖家声明：{conditionLabel(item.sellerCondition)}
                  {item.sellerNote ? `（${item.sellerNote}）` : ''}
                </p>
              ) : item.sellerNote ? (
                <p className="text-xs text-slate-700">卖家备注：{item.sellerNote}</p>
              ) : null}
              {editable ? (
                <FormControl component="fieldset" error={Boolean(errors[item.code])} fullWidth>
                  <legend id={legendId} className="sr-only">{item.label} 的现场结果</legend>
                  <RadioGroup
                    row
                    name={resultFieldName(item.code)}
                    value={d.result ?? ''}
                    aria-labelledby={legendId}
                    aria-describedby={errors[item.code] ? errorId : undefined}
                    onChange={(e) => {
                      const result = e.target.value as BuyerResult;
                      setDrafts((prev) => ({ ...prev, [item.code]: { ...d, result } }));
                    }}
                  >
                    {BUYER_RESULT_OPTIONS.map((option) => (
                      <FormControlLabel key={option} value={option} control={<Radio size="small" />} label={resultLabel(option)} />
                    ))}
                  </RadioGroup>
                  <TextField
                    size="small"
                    label="现场备注（选填）"
                    value={d.note}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.code]: { ...d, note: e.target.value } }))}
                    inputProps={{ maxLength: BUYER_NOTE_MAX }}
                    fullWidth
                  />
                  {errors[item.code] && <FormHelperText id={errorId}>{errors[item.code]}</FormHelperText>}
                </FormControl>
              ) : (
                final && (
                  <p className="text-sm text-slate-800" data-result={item.buyerResult ?? ''}>
                    买家现场结果：<strong>{resultLabel(item.buyerResult)}</strong>
                    {mismatch && <span className="ml-1 font-bold text-red-800">（不一致）</span>}
                    {item.buyerNote ? ` · ${item.buyerNote}` : ''}
                  </p>
                )
              )}
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outlined" disabled={busy} onClick={() => validate(false) && onSaveDraft(payload())}>
            保存草稿
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => validate(true) && setConfirmOpen(true)}>
            提交验货结果
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} aria-labelledby="inspection-confirm-title">
        <DialogTitle id="inspection-confirm-title">提交后不能修改</DialogTitle>
        <DialogContent>
          <DialogContentText>
            提交后验货记录将被锁定，你和卖家都不能再修改。
            {inspection.items.some((i) => drafts[i.code]?.result === 'MISMATCH') &&
              ' 存在「与声明不一致」的条目：提交后订单会转为待处理，不能再确认面交或核销，双方可协商取消。'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">再检查一下</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => {
              setConfirmOpen(false);
              onSubmit(payload());
            }}
          >
            确认提交
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}
