import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { getApiClient } from '../../api/client';
import { CIRCLE_MAX_PER_PRODUCT, type Circle, type ProductVisibility } from '../../api/contracts';
import { CIRCLE_TYPE_LABEL } from '../../utils/circle';

interface Props {
  visibility: ProductVisibility;
  circleIds: string[];
  onChange: (next: { visibility: ProductVisibility; circleIds: string[] }) => void;
  /** 服务端给出的错误（例如 INVALID_CIRCLE） */
  error?: string | null;
}

/**
 * 发布时的可见范围：默认「全校公开」；「圈子可见」必须由卖家主动选择，并勾选 1～5 个自己在籍的圈子。
 * 不会默认勾选任何圈子，也不会把商品发进全部圈子。下面始终写清楚谁能看到。
 */
export default function VisibilityPicker({ visibility, circleIds, onChange, error }: Props) {
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const labelId = useId();
  const listId = useId();
  const whoId = useId();

  // 只在选择「圈子可见」后才读取我的圈子：全校公开的商品（包括批量工作台的几十件草稿）不产生额外请求
  const wantCircles = visibility === 'CIRCLE_ONLY';
  useEffect(() => {
    if (!wantCircles || circles !== null) return;
    let active = true;
    getApiClient().listMyCircles()
      .then((list) => { if (active) setCircles(list.filter((c) => c.status === 'ACTIVE')) })
      .catch(() => { if (active) setCircles([]) });
    return () => { active = false };
  }, [wantCircles, circles]);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...circleIds, id] : circleIds.filter((x) => x !== id);
    onChange({ visibility, circleIds: next.slice(0, CIRCLE_MAX_PER_PRODUCT) });
  };
  const selectedNames = (circles ?? []).filter((c) => circleIds.includes(c.id)).map((c) => c.name);

  return (
    <section aria-labelledby={labelId} aria-describedby={whoId} className="space-y-2 rounded-2xl border border-slate-200 p-4">
      <h3 id={labelId} className="text-sm font-bold text-slate-800">谁能看到这件商品</h3>
      <div role="group" aria-label="可见范围" className="flex flex-wrap gap-2">
        {([['PUBLIC', '全校公开'], ['CIRCLE_ONLY', '圈子可见']] as const).map(([value, label]) => (
          <Button key={value} size="small" variant={visibility === value ? 'contained' : 'outlined'} aria-pressed={visibility === value}
            onClick={() => onChange({ visibility: value, circleIds: value === 'PUBLIC' ? [] : circleIds })}>
            {label}
          </Button>
        ))}
      </div>
      <p id={whoId} role="status" className="text-xs text-slate-700">
        {visibility === 'PUBLIC'
          ? '本校登录的同学都能看到（未登录的访客与他校同学看不到）。'
          : selectedNames.length
            ? `只有「${selectedNames.join('」「')}」的在籍成员和你自己能看到；已经成立的订单不受之后的成员变化影响。`
            : `请选择 1～${CIRCLE_MAX_PER_PRODUCT} 个圈子；只有所选圈子的在籍成员和你自己能看到。`}
      </p>
      {visibility === 'CIRCLE_ONLY' && (
        circles === null ? <p className="text-xs text-slate-600">正在读取你的圈子…</p>
          : circles.length === 0 ? (
            <p className="text-xs text-slate-700">你还没有加入任何圈子。<Link to="/circles" className="text-teal-800 underline">创建或加入圈子</Link></p>
          ) : (
            <fieldset id={listId}>
              <legend className="text-xs font-semibold text-slate-700">选择圈子（已选 {circleIds.length} / 最多 {CIRCLE_MAX_PER_PRODUCT} 个）</legend>
              <div className="flex flex-col">
                {circles.map((c) => {
                  const checked = circleIds.includes(c.id);
                  return (
                    <FormControlLabel key={c.id}
                      control={<Checkbox size="small" checked={checked} disabled={!checked && circleIds.length >= CIRCLE_MAX_PER_PRODUCT}
                        onChange={(e) => toggle(c.id, e.target.checked)} />}
                      label={<span className="text-sm">{c.name}<span className="ml-1 text-xs text-slate-600">（{CIRCLE_TYPE_LABEL[c.type]} · 用户创建）</span></span>} />
                  );
                })}
              </div>
            </fieldset>
          )
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
