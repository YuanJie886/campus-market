import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS } from '../../api/contracts';
import { CAMPUSES, CATEGORIES, CONDITIONS, type Campus, type Category, type Condition, type ProductInput } from '../../types';
import { IMAGE_PRESETS } from '../../utils/constants';
import { averagePerItem } from '../../utils/supply';
import BuildingSelect from '../BuildingSelect';
import ErrorSummary, { type ErrorSummaryItem } from '../trust/ErrorSummary';
import BundleEditor, { emptyBundleRow, itemsFromRows, type BundleRow } from './BundleEditor';
import PriceGuidanceCard from './PriceGuidanceCard';
import VisibilityPicker from '../circle/VisibilityPicker';
import type { ProductVisibility } from '../../api/contracts';

interface Props {
  initial: { contact: string; campus: Campus; buildingId: string | null };
  onSubmit: (data: Omit<ProductInput, 'sellerId'>) => void | Promise<void>;
  onCancel?: () => void;
}

/**
 * 整套打包发布（5.4）：一个商品主体（标题、总价、主分类或「其他 / 混合物品」）+ 2～30 条明细。
 * 整套出售，不支持单独下单；验货时逐条核对明细。分类与成色都不预选。
 */
export default function BundleProductForm({ initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [campus, setCampus] = useState<Campus>(initial.campus);
  const [buildingId, setBuildingId] = useState<string | null>(initial.buildingId);
  const [contact, setContact] = useState(initial.contact);
  const [images, setImages] = useState<string[]>([]);
  const [rows, setRows] = useState<BundleRow[]>(() => [emptyBundleRow(), emptyBundleRow()]);
  const [visibility, setVisibility] = useState<ProductVisibility>('PUBLIC');
  const [circleIds, setCircleIds] = useState<string[]>([]);
  const [summary, setSummary] = useState<ErrorSummaryItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focus = (id: string) => () => document.getElementById(id)?.focus();

  const quantity = rows.reduce((n, r) => n + (/^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : 0), 0);
  const average = /^\d+(\.\d{1,2})?$/.test(price.trim()) ? averagePerItem(Number(price), quantity) : null;

  const submit = async () => {
    const problems: ErrorSummaryItem[] = [];
    if (!title.trim()) problems.push({ key: 'title', message: '请填写整套标题', focus: focus('bundle-title') });
    if (!description.trim()) problems.push({ key: 'description', message: '请填写描述', focus: focus('bundle-description') });
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) problems.push({ key: 'price', message: '请填写整套总价（最多两位小数）', focus: focus('bundle-price') });
    if (!category) problems.push({ key: 'category', message: '请选择主分类（混合物品请选「其他 / 混合物品」）', focus: focus('bundle-category') });
    if (!condition) problems.push({ key: 'condition', message: '请选择整体成色', focus: focus('bundle-condition') });
    if (!images.length) problems.push({ key: 'images', message: '请至少选择一张图片', focus: focus('bundle-image-0') });
    if (rows.length < BUNDLE_MIN_ITEMS || rows.length > BUNDLE_MAX_ITEMS) {
      problems.push({ key: 'rows', message: `打包明细需要 ${BUNDLE_MIN_ITEMS}～${BUNDLE_MAX_ITEMS} 行`, focus: focus('bundle-form-bundle-add') });
    }
    rows.forEach((r, i) => {
      if (!r.name.trim() || !r.category || !r.condition || !/^\d+$/.test(r.quantity.trim())) {
        problems.push({ key: r.key, message: `第 ${i + 1} 行明细还没填完整（名称、分类、成色、数量）`, focus: focus(`bundle-form-bundle-name-${i}`) });
      }
    });
    if (visibility === 'CIRCLE_ONLY' && !circleIds.length) {
      problems.push({ key: 'circleIds', message: '圈子可见需要至少选择一个圈子', focus: focus('bundle-visibility') });
    }
    setSummary(problems);
    if (problems.length) { window.setTimeout(() => summaryRef.current?.focus(), 0); return }
    setSubmitting(true);
    try {
      await onSubmit({
        listingKind: 'BUNDLE', bundleItems: itemsFromRows(rows),
        title: title.trim(), description: description.trim(), price: Number(price), category: category as Category,
        condition: condition as Condition, campus, buildingId, images, contact: contact.trim(),
        visibility, ...(visibility === 'CIRCLE_ONLY' ? { circleIds } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Alert severity="info" role="note">整套出售，不支持单独下单。买家一次买下整套，面交时逐条核对明细。</Alert>
      <ErrorSummary ref={summaryRef} title="还有内容需要补充" items={summary} />
      <TextField id="bundle-title" label="整套标题" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" inputProps={{ maxLength: 100 }} />
      <TextField id="bundle-description" label="描述" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" multiline minRows={2} inputProps={{ maxLength: 4000 }} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField id="bundle-price" label="整套总价（元）" value={price} onChange={(e) => setPrice(e.target.value)} size="small" inputProps={{ inputMode: 'decimal', maxLength: 12 }}
          helperText={average ? `平均每件约 ¥${average}（仅供展示）` : ' '} />
        <TextField id="bundle-category" select label="主分类" value={category} onChange={(e) => setCategory(e.target.value)} size="small">
          {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c === '其他' ? '其他 / 混合物品' : c}</MenuItem>)}
        </TextField>
        <TextField id="bundle-condition" select label="整体成色" value={condition} onChange={(e) => setCondition(e.target.value)} size="small">
          {CONDITIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
      </div>
      <p className="text-xs text-slate-600">整套打包不参与同类单件的成交价统计，下面的参考只针对主分类的单件商品。</p>
      <PriceGuidanceCard category={category} />
      <TextField select label="校区" value={campus} onChange={(e) => { setCampus(e.target.value as Campus); setBuildingId(null) }} size="small">
        {CAMPUSES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
      </TextField>
      <BuildingSelect campus={campus} value={buildingId} onChange={setBuildingId} emptyLabel="不指定楼栋" zoneLabel="取货园区" buildingLabel="取货楼栋" />
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-slate-700">商品图片（{images.length}/9，演示版使用预置图片）</legend>
        <div className="grid grid-cols-6 gap-2">
          {IMAGE_PRESETS.slice(0, 6).map((url, i) => {
            const selected = images.includes(url);
            return (
              <button key={url} id={`bundle-image-${i}`} type="button" aria-pressed={selected} aria-label={`整套选择图片 ${i + 1}`}
                onClick={() => setImages(selected ? images.filter((x) => x !== url) : [...images, url].slice(0, 9))}
                className={`h-10 rounded-lg border-2 text-xs ${selected ? 'border-teal-700 bg-teal-50' : 'border-slate-200'}`}>
                {selected ? '已选' : `图 ${i + 1}`}
              </button>
            );
          })}
        </div>
      </fieldset>
      <TextField label="联系方式" value={contact} onChange={(e) => setContact(e.target.value)} size="small" fullWidth inputProps={{ maxLength: 100 }} />
      <BundleEditor rows={rows} onChange={setRows} idPrefix="bundle-form-bundle" />
      <div id="bundle-visibility" tabIndex={-1}>
        <VisibilityPicker visibility={visibility} circleIds={circleIds}
          onChange={(next) => { setVisibility(next.visibility); setCircleIds(next.circleIds) }} />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button color="inherit" onClick={onCancel}>取消</Button>}
        <Button variant="contained" onClick={() => void submit()} disabled={submitting}>发布整套</Button>
      </div>
    </div>
  );
}
