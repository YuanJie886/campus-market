import { useState } from 'react';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import TuneIcon from '@mui/icons-material/Tune';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import type { FilterState } from '../types';
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
  /** 结果数量，用于展示「共 N 件」 */
  resultCount: number;
}

/** 搜索 / 分类 / 筛选 / 排序 工具条 */
export default function FilterBar({ value, onChange, resultCount }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const patch = (partial: Partial<FilterState>) => {
    onChange({ ...value, ...partial });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_FILTER, keyword: value.keyword });
  };

  // 价格区间校验：最低价与最高价均已填写且最低价高于最高价时给出提示
  const priceInvalid =
    value.minPrice !== '' &&
    value.maxPrice !== '' &&
    Number(value.minPrice) > Number(value.maxPrice);

  const activeFilterCount = [
    value.category !== '全部',
    value.campus !== '全部',
    value.condition !== '全部',
    value.minPrice !== '',
    value.maxPrice !== '',
    value.sort !== DEFAULT_FILTER.sort,
  ].filter(Boolean).length;

  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-soft md:p-5">
      {/* 分类导航 */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip
          label="全部"
          clickable
          color={value.category === '全部' ? 'primary' : 'default'}
          variant={value.category === '全部' ? 'filled' : 'outlined'}
          onClick={() => patch({ category: '全部' })}
          sx={{
            fontWeight: 700,
            borderRadius: 2.5,
            height: 34,
            '&.MuiChip-outlined': { borderColor: '#e2e8f0', bgcolor: '#fff' },
          }}
        />
        {CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            clickable
            color={value.category === cat ? 'primary' : 'default'}
            variant={value.category === cat ? 'filled' : 'outlined'}
            onClick={() => patch({ category: cat })}
            sx={{
              fontWeight: 700,
              flexShrink: 0,
              borderRadius: 2.5,
              height: 34,
              '&.MuiChip-outlined': { borderColor: '#e2e8f0', bgcolor: '#fff' },
            }}
          />
        ))}
      </div>

      {/* 摘要 + 展开筛选 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          共 <span className="font-bold text-brand-700">{resultCount}</span> 件闲置
          {value.keyword && (
            <span className="ml-1 text-slate-400">
              · 关键词「{value.keyword}」
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <Chip
              icon={<FilterAltOutlinedIcon sx={{ fontSize: 15 }} />}
              label={`已选 ${activeFilterCount}`}
              size="small"
              sx={{
                bgcolor: '#effdfb',
                color: '#0d8a84',
                fontWeight: 700,
                borderRadius: 2,
              }}
            />
          )}
          <Button
            size="small"
            startIcon={<TuneIcon />}
            onClick={() => setExpanded((prev) => !prev)}
            sx={{
              color: 'text.primary',
              bgcolor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 2.5,
              px: 1.5,
              '&:hover': { bgcolor: '#f1f5f9' },
            }}
          >
            {expanded ? '收起筛选' : '筛选 / 排序'}
          </Button>
        </div>
      </div>

      <Collapse in={expanded} timeout={220}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{
            mt: 2.5,
            pt: 2.5,
            flexWrap: 'wrap',
            borderTop: '1px solid #f1f5f9',
          }}
          useFlexGap
        >
          <TextField
            select
            label="校区"
            value={value.campus}
            onChange={(e) => patch({ campus: e.target.value as FilterState['campus'] })}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="全部">全部校区</MenuItem>
            {CAMPUSES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="成色"
            value={value.condition}
            onChange={(e) =>
              patch({ condition: e.target.value as FilterState['condition'] })
            }
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="全部">全部成色</MenuItem>
            {CONDITIONS.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="最低价"
            type="number"
            value={value.minPrice}
            onChange={(e) =>
              patch({
                minPrice: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            sx={{ width: 110 }}
            inputProps={{ min: 0 }}
          />

          <TextField
            label="最高价"
            type="number"
            value={value.maxPrice}
            error={priceInvalid}
            helperText={priceInvalid ? '最低价不能高于最高价' : undefined}
            onChange={(e) =>
              patch({
                maxPrice: e.target.value === '' ? '' : Number(e.target.value),
              })
            }
            sx={{ width: 110 }}
            inputProps={{ min: 0 }}
          />

          <TextField
            select
            label="排序"
            value={value.sort}
            onChange={(e) => patch({ sort: e.target.value as FilterState['sort'] })}
            sx={{ minWidth: 150 }}
          >
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Button
            variant="outlined"
            startIcon={<RestartAltIcon />}
            onClick={handleReset}
            sx={{
              alignSelf: { xs: 'stretch', sm: 'center' },
              borderColor: '#cbd5e1',
              color: '#475569',
              borderRadius: 2.5,
            }}
          >
            重置
          </Button>
        </Stack>
      </Collapse>
    </div>
  );
}
