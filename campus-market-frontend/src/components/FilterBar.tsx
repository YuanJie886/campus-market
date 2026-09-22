import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import TuneIcon from '@mui/icons-material/Tune';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import type { FilterState, Category } from '../types';
import {
  CAMPUSES,
  CATEGORIES,
  CONDITIONS,
  DEFAULT_FILTER,
  SORT_OPTIONS,
} from '../types';

interface FilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
}

const ALL_TABS: (Category | '全部')[] = ['全部', ...CATEGORIES];

/**
 * 具有 Apple 级平滑滑动胶囊指示器的吸顶分类导航与高级筛选栏
 */
export default function FilterBar({ value, onChange, resultCount }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [gliderStyle, setGliderStyle] = useState({ left: 0, width: 0, opacity: 0 });

  const activeIndex = ALL_TABS.indexOf(value.category as Category | '全部');

  // 计算并平滑滑行到激活分类标签的尺寸与位置
  const updateGlider = () => {
    const activeTab = tabRefs.current[activeIndex >= 0 ? activeIndex : 0];
    const container = containerRef.current;
    if (activeTab && container) {
      const containerLeft = container.getBoundingClientRect().left;
      const tabRect = activeTab.getBoundingClientRect();
      setGliderStyle({
        left: tabRect.left - containerLeft + container.scrollLeft,
        width: tabRect.width,
        opacity: 1,
      });
    }
  };

  useLayoutEffect(() => {
    updateGlider();
  }, [value.category]);

  useEffect(() => {
    const handleResize = () => updateGlider();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [value.category]);

  const patch = (partial: Partial<FilterState>) => {
    onChange({ ...value, ...partial });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_FILTER, keyword: value.keyword });
  };

  const priceInvalid =
    value.minPrice !== '' &&
    value.maxPrice !== '' &&
    Number(value.minPrice) > Number(value.maxPrice);

  const activeFilterCount = [
    value.campus !== '全部',
    value.condition !== '全部',
    value.minPrice !== '',
    value.maxPrice !== '',
    value.sort !== DEFAULT_FILTER.sort,
  ].filter(Boolean).length;

  return (
    <nav aria-label="商品分类筛选" className="cm-apple-filterbar">
      {/* 顶部：滑动胶囊分类栏与筛选切换 */}
      <div className="cm-apple-filter-top">
        {/* 滑动分类选项胶囊 */}
        <div
          ref={containerRef}
          className="cm-apple-tabs-track no-scrollbar"
        >
          {/* 滑动的背景药丸 (Glider Pill) */}
          <div
            className="cm-apple-tab-glider"
            style={{
              transform: `translate3d(${gliderStyle.left}px, 0, 0)`,
              width: `${gliderStyle.width}px`,
              opacity: gliderStyle.opacity,
            }}
            aria-hidden="true"
          />

          {ALL_TABS.map((cat, idx) => {
            const isActive = value.category === cat;
            return (
              <button
                key={cat}
                ref={(el) => { tabRefs.current[idx] = el; }}
                type="button"
                onClick={() => patch({ category: cat })}
                className={`cm-apple-tab-btn ${isActive ? 'is-active' : ''}`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* 筛选触发器与计数器 */}
        <div className="cm-apple-filter-actions">
          {activeFilterCount > 0 && (
            <span className="cm-apple-filter-badge">
              <FilterAltOutlinedIcon sx={{ fontSize: 13 }} />
              {activeFilterCount}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className={`cm-apple-filter-toggle-btn ${expanded ? 'is-expanded' : ''}`}
          >
            <TuneIcon sx={{ fontSize: 16 }} />
            <span>筛选与排序</span>
            <KeyboardArrowDownRoundedIcon
              sx={{
                fontSize: 16,
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </button>
        </div>
      </div>

      {/* 辅助状态条：当前结果与快速重置 */}
      <div className="cm-apple-filter-status">
        <p className="cm-apple-status-text">
          <span>{value.category}</span>
          <span className="cm-apple-status-divider">·</span>
          <span>{resultCount} 件正在流转</span>
          {value.keyword && (
            <>
              <span className="cm-apple-status-divider">·</span>
              <span className="cm-apple-keyword-tag">关键词「{value.keyword}」</span>
            </>
          )}
        </p>

        {(activeFilterCount > 0 || value.category !== '全部' || value.keyword) && (
          <button
            type="button"
            onClick={handleReset}
            className="cm-apple-reset-text-btn"
          >
            <RestartAltIcon sx={{ fontSize: 14 }} />
            重置全部条件
          </button>
        )}
      </div>

      {/* 展开式二级精细筛选器 (抽屉) */}
      <Collapse in={expanded} timeout={280}>
        <div className="cm-apple-filter-drawer">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ flexWrap: 'wrap' }}
            useFlexGap
          >
            <TextField
              select
              size="small"
              label="校区"
              value={value.campus}
              onChange={(e) => patch({ campus: e.target.value as FilterState['campus'] })}
              sx={{ minWidth: 140, flex: { xs: '1 1 100%', sm: '1 1 160px' } }}
            >
              <MenuItem value="全部">全部校区</MenuItem>
              {CAMPUSES.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="成色"
              value={value.condition}
              onChange={(e) => patch({ condition: e.target.value as FilterState['condition'] })}
              sx={{ minWidth: 140, flex: { xs: '1 1 100%', sm: '1 1 160px' } }}
            >
              <MenuItem value="全部">全部成色</MenuItem>
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
              sx={{ minWidth: 140, flex: { xs: '1 1 100%', sm: '1 1 160px' } }}
            >
              {SORT_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>

            {/* 价格区间 */}
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <TextField
                size="small"
                label="最低价"
                type="number"
                value={value.minPrice}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  patch({ minPrice: val === '' ? '' : Math.max(0, Number(val)) });
                }}
                error={priceInvalid}
                inputProps={{ min: 0 }}
                sx={{ flex: 1 }}
              />
              <span className="text-slate-400 select-none">—</span>
              <TextField
                size="small"
                label="最高价"
                type="number"
                value={value.maxPrice}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  patch({ maxPrice: val === '' ? '' : Math.max(0, Number(val)) });
                }}
                error={priceInvalid}
                helperText={priceInvalid ? '最低价不能高于最高价' : undefined}
                inputProps={{ min: 0 }}
                sx={{ flex: 1 }}
              />
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="text"
                size="small"
                startIcon={<RestartAltIcon />}
                onClick={() =>
                  patch({
                    campus: '全部',
                    condition: '全部',
                    minPrice: '',
                    maxPrice: '',
                    sort: DEFAULT_FILTER.sort,
                  })
                }
                sx={{
                  color: 'text.secondary',
                  alignSelf: { xs: 'stretch', sm: 'center' },
                  borderRadius: 2,
                }}
              >
                清空二级筛选
              </Button>
            )}
          </Stack>
        </div>
      </Collapse>
    </nav>
  );
}
