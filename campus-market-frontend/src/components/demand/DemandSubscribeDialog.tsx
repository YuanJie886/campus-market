import { useEffect, useId, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { CAMPUSES, CATEGORIES, type Campus, type Category } from '../../types';
import type { DemandConditions } from '../../api/contracts';
import { SCOPE_FALLBACK_ORDER, SCOPE_LABEL, type BuildingScope } from '../../utils/geo';
import { MAX_KEYWORD_LENGTH } from '../../utils/demand';
import BuildingSelect from '../BuildingSelect';

interface Props {
  open: boolean;
  title: string;
  submitLabel: string;
  initial: DemandConditions;
  /** 用户所在校区：CAMPUS 默认值与楼栋列表都以它为准 */
  userCampus: Campus;
  busy?: boolean;
  /** 服务端返回的错误，显示在表单底部并与提交按钮关联 */
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (conditions: DemandConditions) => void;
  /** 模块 6：圈子范围订阅。范围固定为这个圈子（显示圈子名），不再提供地理范围选项 */
  circleScope?: { name: string | null } | null;
}

/**
 * 需求订阅表单。创建（搜索空态）与编辑（订阅管理）共用。
 *
 * <p>提交前每一项都可以改：预填只是省事，不是替用户做决定。
 * 地理范围用 canonical 的 BUILDING/ZONE/CAMPUS/SCHOOL 保存，中文只做选项文字。
 */
export default function DemandSubscribeDialog({
  open, title, submitLabel, initial, userCampus, busy = false, errorMessage, onCancel, onSubmit, circleScope = null,
}: Props) {
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [geoScope, setGeoScope] = useState<BuildingScope>('SCHOOL');
  const [campusId, setCampusId] = useState<Campus>(userCampus);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const errorId = useId();

  // 每次打开都按 initial 重置，避免上一次的输入残留
  useEffect(() => {
    if (!open) return;
    setKeyword(initial.keyword ?? '');
    setCategory((initial.category as Category) ?? '');
    setMinPrice(initial.minPrice != null ? String(initial.minPrice) : '');
    setMaxPrice(initial.maxPrice != null ? String(initial.maxPrice) : '');
    setGeoScope(initial.geoScope ?? 'SCHOOL');
    setCampusId((initial.campusId as Campus) ?? userCampus);
    setBuildingId(initial.buildingId ?? null);
    setLocalError(null);
  }, [open, initial, userCampus]);

  const submit = () => {
    if (!keyword.trim() && !category) {
      setLocalError('请至少填写关键词或选择分类');
      return;
    }
    const min = minPrice === '' ? null : Number(minPrice);
    const max = maxPrice === '' ? null : Number(maxPrice);
    if ((min !== null && (Number.isNaN(min) || min < 0)) || (max !== null && (Number.isNaN(max) || max < 0))) {
      setLocalError('价格需为非负数');
      return;
    }
    if (min !== null && max !== null && min > max) {
      setLocalError('最低价不能高于最高价');
      return;
    }
    setLocalError(null);
    if (circleScope) {
      onSubmit({ keyword: keyword.trim() || null, category: category || null, minPrice: min, maxPrice: max, geoScope: 'SCHOOL', campusId: null, buildingId: null });
      return;
    }
    onSubmit({
      keyword: keyword.trim() || null,
      category: category || null,
      minPrice: min,
      maxPrice: max,
      geoScope,
      // 只提交当前范围需要的锚点，其余一律不传，避免与服务端的范围规则冲突
      campusId: geoScope === 'CAMPUS' ? campusId : null,
      buildingId: geoScope === 'BUILDING' || geoScope === 'ZONE' ? buildingId : null,
    });
  };

  const shownError = localError ?? errorMessage ?? null;
  const describedBy = shownError ? errorId : undefined;

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm" aria-labelledby={`${errorId}-title`}>
      <DialogTitle id={`${errorId}-title`}>{title}</DialogTitle>
      <DialogContent className="space-y-4">
        <p className="text-sm text-slate-500">
          有新商品符合条件时，会出现在「需求匹配」里。不会发短信、微信或系统通知。
        </p>
        {/* 3.0B：简短说明三条限制，不做成需要勾选的长协议 */}
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500" aria-label="订阅说明">
          <li>按关键词字面匹配：「耳机」能匹配「蓝牙耳机」，但不会匹配同义词。</li>
          <li>只匹配之后新发布或新编辑的商品，不回查已有商品。</li>
          <li>不保证一定能收到匹配。</li>
        </ul>
        <TextField
          fullWidth label="关键词" value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          inputProps={{ maxLength: MAX_KEYWORD_LENGTH * 2, 'aria-describedby': describedBy }}
          helperText={`最多 ${MAX_KEYWORD_LENGTH} 个字，大小写与空格不影响匹配`}
        />
        <TextField
          select fullWidth label="分类（选填）" value={category}
          onChange={(e) => setCategory(e.target.value as Category | '')}
          SelectProps={{ inputProps: { 'aria-describedby': describedBy } }}
        >
          <MenuItem value="">不限分类</MenuItem>
          {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="最低价（选填）" type="number" value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)} inputProps={{ min: 0, 'aria-describedby': describedBy }} />
          <TextField label="最高价（选填）" type="number" value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)} inputProps={{ min: 0, 'aria-describedby': describedBy }} />
        </div>
        {circleScope ? (
          <p className="rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-900" data-scope="CIRCLE">
            范围：只匹配圈子「{circleScope.name ?? '已不可见的圈子'}」里新发布的商品（范围固定，不能修改）。退出圈子后这条订阅会自动停用。
          </p>
        ) : (
        <TextField
          select fullWidth label="地理范围" value={geoScope}
          onChange={(e) => setGeoScope(e.target.value as BuildingScope)}
        >
          {SCOPE_FALLBACK_ORDER.map((scope) => (
            <MenuItem key={scope} value={scope}>{SCOPE_LABEL[scope]}</MenuItem>
          ))}
        </TextField>
        )}
        {!circleScope && geoScope === 'CAMPUS' && (
          <TextField select fullWidth label="校区" value={campusId}
            onChange={(e) => setCampusId(e.target.value as Campus)}>
            {CAMPUSES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
        )}
        {!circleScope && (geoScope === 'BUILDING' || geoScope === 'ZONE') && (
          <BuildingSelect
            campus={userCampus}
            value={buildingId}
            onChange={setBuildingId}
            emptyLabel="使用我的宿舍楼"
            buildingLabel={geoScope === 'ZONE' ? '以哪栋楼所在园区为准' : '楼栋'}
            helperText={geoScope === 'ZONE' ? '园区由所选楼栋推导' : undefined}
          />
        )}
        {shownError && (
          <p id={errorId} role="alert" className="text-sm text-red-600">{shownError}</p>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy} aria-describedby={describedBy}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
