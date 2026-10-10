import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { getApiClient } from '../../api/client';
import { toUserMessage } from '../../api/errors';
import type { DisclosureInput, InspectionTemplate, ListingDraft, ListingPayload, ListingValidation } from '../../api/contracts';
import { CAMPUSES, CATEGORIES, CONDITIONS, type Campus } from '../../types';
import { IMAGE_PRESETS } from '../../utils/constants';
import { VALIDATION_LABEL, missingText, priceValue, versionConflict } from '../../utils/supply';
import BuildingSelect from '../BuildingSelect';
import InspectionDeclarationFields, { type DeclarationValue } from '../trust/InspectionDeclarationFields';
import BundleEditor, { itemsFromRows, rowsFromItems, type BundleRow } from './BundleEditor';
import VisibilityPicker from '../circle/VisibilityPicker';
import type { ProductVisibility } from '../../api/contracts';

export interface ListingItemEditorHandle { focusTitle: () => void }

interface Props {
  draft: ListingDraft;
  /** 协助人模式：只显示可以整理的字段（标题、描述、分类、价格建议、打包明细、取货楼栋建议），没有联系方式 */
  assistant?: boolean;
  /** 批次给出的逐项校验结果 */
  validation?: ListingValidation;
  /** 标题前缀，例如「第 3 件」 */
  label: string;
  onSaved: (draft: ListingDraft) => void;
  /** 发生版本冲突后，用户选择重新加载服务端的最新版本 */
  onReload: () => void;
}

interface FormState {
  title: string; description: string; price: string; category: string; condition: string; campus: string;
  buildingId: string | null; images: string[]; contact: string; contactPublic: boolean; declarations: DeclarationValue; bundleRows: BundleRow[];
  visibility: ProductVisibility; circleIds: string[];
}

function formFrom(payload: ListingPayload): FormState {
  const declarations: DeclarationValue = {};
  for (const item of payload.inspection ?? []) declarations[item.itemCode] = { condition: item.condition, note: item.note ?? '' };
  return {
    title: payload.title ?? '', description: payload.description ?? '',
    price: payload.price === undefined || payload.price === null ? '' : String(payload.price),
    category: String(payload.category ?? ''), condition: String(payload.condition ?? ''), campus: String(payload.campus ?? ''),
    buildingId: payload.buildingId ?? null, images: [...(payload.images ?? [])], contact: payload.contact ?? '', contactPublic: payload.contactPublic === true,
    declarations, bundleRows: rowsFromItems(payload.bundleItems),
    visibility: payload.visibility === 'CIRCLE_ONLY' ? 'CIRCLE_ONLY' : 'PUBLIC', circleIds: [...(payload.circleIds ?? [])],
  };
}

/**
 * 批量发布中的一件商品（也用于协助整理页）。草稿允许不完整：留空的字段不提交，
 * 进入发布前由服务端逐项校验。这里<b>不</b>替卖家预选分类、成色或任何验货状态。
 */
const ListingItemEditor = forwardRef<ListingItemEditorHandle, Props>(function ListingItemEditor(
  { draft, assistant = false, validation, label, onSaved, onReload }, ref,
) {
  const [form, setForm] = useState<FormState>(() => formFrom(draft.payload));
  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  // 模板还在加载时保存：保留原有声明，不能因为「还没拿到模板」把卖家填过的声明清掉
  const [templateLoading, setTemplateLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bundle = draft.draftType === 'BUNDLE';
  const idPrefix = `item-${draft.id}`;

  useImperativeHandle(ref, () => ({ focusTitle: () => titleRef.current?.focus() }));

  useEffect(() => {
    if (bundle || assistant || !(CATEGORIES as string[]).includes(form.category)) { setTemplate(null); setTemplateLoading(false); return }
    let active = true;
    setTemplateLoading(true);
    getApiClient().getInspectionTemplate(form.category as never)
      .then((t) => { if (active) setTemplate(t) })
      .catch(() => { if (active) setTemplate(null) })
      .finally(() => { if (active) setTemplateLoading(false) });
    return () => { active = false };
  }, [form.category, bundle, assistant]);

  const patch = (next: Partial<FormState>) => { setForm((f) => ({ ...f, ...next })); setStatus('') };

  /** 协助人：以所有者的原内容为底，只覆盖可以整理的字段。所有者：以表单为准，保留表单未展示的字段。 */
  const toPayload = (): ListingPayload => {
    const base: ListingPayload = JSON.parse(JSON.stringify(draft.payload));
    const set = (key: keyof ListingPayload, value: unknown) => {
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete (base as Record<string, unknown>)[key];
      else (base as Record<string, unknown>)[key] = value;
    };
    set('title', form.title.trim() || undefined);
    set('description', form.description.trim() || undefined);
    set('price', priceValue(form.price));
    set('category', form.category || undefined);
    (base as Record<string, unknown>).buildingId = form.buildingId;
    if (bundle) set('bundleItems', form.bundleRows.length ? itemsFromRows(form.bundleRows) : undefined);
    if (!assistant) {
      set('condition', form.condition || undefined);
      set('campus', form.campus || undefined);
      set('images', form.images);
      set('contact', form.contact.trim() || undefined);
      set('contactPublic', form.contactPublic);
      // 可见范围只有所有者能选；协助人保存时沿用所有者的原值（服务端也会拒绝协助人改动这两个字段）
      set('visibility', form.visibility === 'CIRCLE_ONLY' ? 'CIRCLE_ONLY' : undefined);
      set('circleIds', form.visibility === 'CIRCLE_ONLY' ? form.circleIds : undefined);
      if (!bundle) {
        const inspection: DisclosureInput[] = Object.entries(form.declarations)
          .filter(([, d]) => d.condition)
          .map(([itemCode, d]) => ({ itemCode, condition: d.condition!, ...(d.note.trim() ? { note: d.note.trim() } : {}) }));
        if (!templateLoading) set('inspection', template ? inspection : undefined);
      }
    }
    return base;
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      const saved = await getApiClient().updateListingDraft(draft.id, { expectedVersion: draft.version, payload: toPayload() });
      setStatus(`${label}已保存`);
      onSaved(saved);
    } catch (e) {
      const current = versionConflict(e);
      if (current !== null) setConflict(current);
      else setError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const problem = validation && validation.code !== 'VALID' ? validation : null;
  const campus = (CAMPUSES as string[]).includes(form.campus) ? (form.campus as Campus) : null;
  return (
    <section aria-labelledby={`${idPrefix}-heading`} className="space-y-3">
      <h2 id={`${idPrefix}-heading`} className="text-base font-bold text-slate-800">
        {label}{bundle ? '（整套打包）' : ''}
      </h2>
      {problem && (
        <Alert severity="warning" role="note">
          {VALIDATION_LABEL[problem.code]}
          {problem.code === 'MISSING_FIELD' ? `：${missingText(problem.field)}` : problem.message ? `：${problem.message}` : ''}
        </Alert>
      )}
      {conflict !== null && (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" onClick={onReload}>重新加载这件</Button>}
        >
          这件商品已在其他页面或被协助人保存过（最新是第 {conflict} 版）。本页的修改没有保存，也不会自动合并；
          重新加载会显示最新内容并放弃本页未保存的修改。
        </Alert>
      )}
      <TextField label="标题" value={form.title} inputRef={titleRef} fullWidth size="small" inputProps={{ maxLength: 100 }}
        onChange={(e) => patch({ title: e.target.value })} />
      <TextField label="描述" value={form.description} fullWidth size="small" multiline minRows={2} inputProps={{ maxLength: 4000 }}
        onChange={(e) => patch({ description: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={bundle ? '整套总价（元）' : assistant ? '价格建议（元）' : '价格（元）'} value={form.price} size="small"
          inputProps={{ inputMode: 'decimal', maxLength: 12 }} onChange={(e) => patch({ price: e.target.value })} />
        <TextField select label={bundle ? '主分类' : '分类'} value={form.category} size="small"
          onChange={(e) => patch({ category: e.target.value, declarations: {} })}>
          {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{bundle && c === '其他' ? '其他 / 混合物品' : c}</MenuItem>)}
        </TextField>
        {!assistant && (
          <TextField select label={bundle ? '整体成色' : '成色'} value={form.condition} size="small" onChange={(e) => patch({ condition: e.target.value })}>
            {CONDITIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
        )}
      </div>

      {!assistant && (
        <TextField select label="校区" value={form.campus} size="small" onChange={(e) => patch({ campus: e.target.value, buildingId: null })}>
          {CAMPUSES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
      )}
      {campus ? (
        <BuildingSelect campus={campus} value={form.buildingId} onChange={(buildingId) => patch({ buildingId })}
          emptyLabel="不指定楼栋" zoneLabel="取货园区" buildingLabel={assistant ? '取货楼栋建议' : '取货楼栋'} />
      ) : (
        <p className="text-xs text-slate-600">{assistant ? '所有者还没有选择校区，暂时不能建议取货楼栋。' : '先选择校区，再选择取货楼栋（可不指定）。'}</p>
      )}
      {!assistant && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold text-slate-700">商品图片（{form.images.length}/9，演示版使用预置图片）</legend>
          <div className="grid grid-cols-6 gap-2">
            {IMAGE_PRESETS.slice(0, 6).map((url, i) => {
              const selected = form.images.includes(url);
              return (
                <button key={url} type="button" aria-pressed={selected} aria-label={`${label}选择图片 ${i + 1}`}
                  onClick={() => patch({ images: selected ? form.images.filter((x) => x !== url) : [...form.images, url].slice(0, 9) })}
                  className={`h-10 rounded-lg border-2 text-xs ${selected ? 'border-teal-700 bg-teal-50' : 'border-slate-200'}`}>
                  {selected ? '已选' : `图 ${i + 1}`}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {!assistant && (
        <TextField label="联系方式（只有你自己能看到草稿里的联系方式）" value={form.contact} size="small" fullWidth inputProps={{ maxLength: 100 }}
          onChange={(e) => patch({ contact: e.target.value })} />
      )}
      {!assistant && <div>
        <FormControlLabel control={<Checkbox checked={form.contactPublic} onChange={(e) => patch({ contactPublic: e.target.checked })} />} label="公开展示联系方式" />
        <p className="text-xs text-slate-500">未勾选时，买家需点击“我想要”，经你同意后才能查看联系方式。</p>
      </div>}
      {bundle && (
        <BundleEditor rows={form.bundleRows} onChange={(bundleRows) => patch({ bundleRows })} idPrefix={`${idPrefix}-bundle`}
          error={problem?.code === 'INVALID_BUNDLE' ? problem.message : null} />
      )}
      {!bundle && template && (
        <InspectionDeclarationFields template={template} value={form.declarations} errors={{}}
          onChange={(code, d) => patch({ declarations: { ...form.declarations, [code]: d } })} />
      )}
      {!assistant && (
        <VisibilityPicker visibility={form.visibility} circleIds={form.circleIds}
          onChange={(next) => patch(next)} error={problem?.code === 'INVALID_CIRCLE' ? problem.message : null} />
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="contained" onClick={save} disabled={saving || conflict !== null}>保存这件</Button>
        <span role="status" aria-live="polite" className="text-sm text-emerald-800">{status}</span>
      </div>
    </section>
  );
});

export default ListingItemEditor;
