import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import type { FilterState, Category } from '../types';
import { CATEGORIES, CONDITIONS, DEFAULT_FILTER, SORT_OPTIONS } from '../types';
import type { CampusInfo } from '../api/contracts';
import { CATEGORY_EMOJI } from '../utils/constants';

interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** 工具条最前面的控件（首页放范围切换） */
  leading?: ReactNode;
  /** 「本楼 / 本校区」由范围决定校区，此时不提供校区筛选（与小程序一致） */
  hideCampus?: boolean;
  /** 校区筛选的选项：只列本人学校的校区（来自 /v1/schools）；为空时不提供校区筛选 */
  campusOptions?: readonly CampusInfo[];
}

const ALL_TABS: (Category | '全部')[] = ['全部', ...CATEGORIES];

/** 二级筛选里生效的条件数（校区只在可选时计入） */
export function activeFilterCount(value: FilterState, hideCampus = false): number {
  return [
    !hideCampus && value.campus !== '全部',
    value.condition !== '全部',
    value.minPrice !== '',
    value.maxPrice !== '',
    value.sort !== DEFAULT_FILTER.sort,
  ].filter(Boolean).length;
}

/**
 * 首页工具条：范围切换 + 分类 + 「筛选与排序」在同一行（手机上分两行），
 * 分类过多时只在分类轨道内部横向滚动，页面本身不会横向滚动。
 */
export default function FilterBar({ value, onChange, leading, hideCampus = false, campusOptions = [] }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const count = activeFilterCount(value, hideCampus);

  const patch = (partial: Partial<FilterState>) => onChange({ ...value, ...partial });

  const priceInvalid =
    value.minPrice !== '' && value.maxPrice !== '' && Number(value.minPrice) > Number(value.maxPrice);

  const priceInput = (key: 'minPrice' | 'maxPrice', label: string) => (
    <TextField
      size="small"
      label={label}
      type="number"
      value={value[key]}
      onChange={(e) => {
        const raw = e.target.value.trim();
        patch({ [key]: raw === '' ? '' : Math.max(0, Number(raw)) } as Partial<FilterState>);
      }}
      error={priceInvalid}
      inputProps={{ min: 0, inputMode: 'decimal' }}
      sx={{ flex: 1, minWidth: 0 }}
    />
  );

  return (
    <div className="cm-toolbar">
      <div className="cm-toolbar-row">
        {leading && <div className="cm-toolbar-leading">{leading}</div>}

        <nav aria-label="商品分类" className="cm-chips no-scrollbar">
          {ALL_TABS.map((cat) => {
            const active = value.category === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => patch({ category: cat })}
                className={`cm-chip ${active ? 'is-active' : ''}`}
              >
                {cat !== '全部' && <span aria-hidden="true" className="cm-chip-emoji">{CATEGORY_EMOJI[cat]}</span>}
                {cat}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((prev) => !prev)}
          className={`cm-filter-toggle ${expanded || count > 0 ? 'is-active' : ''}`}
        >
          <TuneIcon sx={{ fontSize: 17 }} aria-hidden="true" />
          <span>筛选与排序</span>
          {count > 0 && (
            <>
              <span className="cm-filter-count" aria-hidden="true">{count}</span>
              <span className="cm-visually-hidden">（已设置 {count} 项）</span>
            </>
          )}
          <KeyboardArrowDownRoundedIcon
            aria-hidden="true"
            sx={{ fontSize: 17, transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </button>
      </div>

      <div id={panelId} className="cm-filter-panel" hidden={!expanded}>
        {!hideCampus && campusOptions.length > 0 && (
          <TextField
            select
            size="small"
            label="校区"
            value={value.campus}
            onChange={(e) => patch({ campus: e.target.value as FilterState['campus'] })}
          >
            <MenuItem value="全部">全部校区</MenuItem>
            {campusOptions.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select
          size="small"
          label="成色"
          value={value.condition}
          onChange={(e) => patch({ condition: e.target.value as FilterState['condition'] })}
        >
          <MenuItem value="全部">不限成色</MenuItem>
          {CONDITIONS.map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="排序方式"
          value={value.sort}
          onChange={(e) => patch({ sort: e.target.value as FilterState['sort'] })}
        >
          {SORT_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </TextField>
        <div className="cm-price-range">
          {priceInput('minPrice', '最低价')}
          <span aria-hidden="true" className="cm-price-sep">—</span>
          {priceInput('maxPrice', '最高价')}
        </div>
        {priceInvalid && <p className="cm-field-error" role="alert">最低价不能高于最高价</p>}
        <div className="cm-filter-panel-actions">
          <button
            type="button"
            className="cm-text-button"
            onClick={() => patch({ campus: '全部', condition: '全部', minPrice: '', maxPrice: '', sort: DEFAULT_FILTER.sort })}
            disabled={count === 0}
          >
            清空筛选与排序
          </button>
          <button type="button" className="cm-button-secondary" onClick={() => setExpanded(false)}>
            收起
          </button>
        </div>
      </div>
    </div>
  );
}
