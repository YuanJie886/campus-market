import { useState } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import type { Campus, Category, Condition, ProductInput } from '../types';
import { CAMPUSES, CATEGORIES, CONDITIONS } from '../types';
import { IMAGE_PRESETS, CATEGORY_EMOJI, CATEGORY_GRADIENT } from '../utils/constants';
import { isValidPhone, isValidStudentId } from '../utils/format';
import { useNotify } from '../context/NotificationContext';
import ImageWithFallback from './ImageWithFallback';

export interface ProductFormValue {
  title: string;
  description: string;
  price: string;
  originalPrice: string;
  category: Category;
  condition: Condition;
  campus: Campus;
  contact: string;
  images: string[];
}

export const emptyProductForm: ProductFormValue = {
  title: '',
  description: '',
  price: '',
  originalPrice: '',
  category: '数码电子',
  condition: '几乎全新',
  campus: '东校区',
  contact: '',
  images: [],
};

interface ProductFormProps {
  initial?: Partial<ProductFormValue>;
  submitLabel?: string;
  /** 提交回调，不含 sellerId（由调用方补充） */
  onSubmit: (data: Omit<ProductInput, 'sellerId'>) => void;
  onCancel?: () => void;
  /** 紧凑模式：用于弹窗内 */
  compact?: boolean;
}

type FieldErrors = Partial<Record<'title' | 'description' | 'price' | 'contact' | 'images', string>>;

/**
 * 商品表单：发布页与「编辑商品」弹窗共用。
 * 负责字段校验与图片选择（预置图片，不做真实文件上传）。
 */
export default function ProductForm({
  initial,
  submitLabel = '立即发布',
  onSubmit,
  onCancel,
  compact = false,
}: ProductFormProps) {
  const { error } = useNotify();
  const [value, setValue] = useState<ProductFormValue>({
    ...emptyProductForm,
    ...initial,
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const patch = (partial: Partial<ProductFormValue>) => {
    setValue((prev) => ({ ...prev, ...partial }));
  };

  const toggleImage = (url: string) => {
    setValue((prev) => {
      const exists = prev.images.includes(url);
      if (exists) {
        return { ...prev, images: prev.images.filter((i) => i !== url) };
      }
      if (prev.images.length >= 5) {
        error('最多选择 5 张图片');
        return prev;
      }
      return { ...prev, images: [...prev.images, url] };
    });
  };

  const validate = (): boolean => {
    const next: FieldErrors = {};
    if (!value.title.trim()) next.title = '请输入商品标题';
    else if (value.title.trim().length < 4) next.title = '标题至少 4 个字';

    if (!value.description.trim()) next.description = '请输入商品描述';
    else if (value.description.trim().length < 10) next.description = '描述至少 10 个字，便于买家了解';

    const priceNum = Number(value.price);
    if (value.price === '' || Number.isNaN(priceNum)) next.price = '请输入价格';
    else if (priceNum <= 0) next.price = '价格必须大于 0';
    else if (priceNum > 1000000) next.price = '价格过于离谱啦';

    if (!value.contact.trim()) next.contact = '请输入联系方式';
    else if (
      !isValidPhone(value.contact.trim()) &&
      !isValidStudentId(value.contact.trim())
    ) {
      next.contact = '请输入有效的手机号或学号';
    }

    if (value.images.length === 0) next.images = '请至少选择一张商品图片';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) {
      error('请检查表单中标红的字段');
      return;
    }
    const originalPriceNum = value.originalPrice === '' ? undefined : Number(value.originalPrice);
    onSubmit({
      title: value.title.trim(),
      description: value.description.trim(),
      price: Number(value.price),
      originalPrice:
        originalPriceNum !== undefined && !Number.isNaN(originalPriceNum)
          ? originalPriceNum
          : undefined,
      category: value.category,
      condition: value.condition,
      campus: value.campus,
      images: value.images,
      contact: value.contact.trim(),
    });
  };

  return (
    <Stack spacing={compact ? 2 : 2.5}>
      <TextField
        label="商品标题"
        placeholder="例如：iPhone 13 128G 蓝色 国行"
        value={value.title}
        onChange={(e) => patch({ title: e.target.value })}
        error={Boolean(errors.title)}
        helperText={errors.title ?? '一句话说清楚是什么，更容易被搜到'}
        fullWidth
        required
      />

      <TextField
        label="商品描述"
        placeholder="成色、入手时间、使用情况、配件是否齐全、可面交地点…"
        value={value.description}
        onChange={(e) => patch({ description: e.target.value })}
        error={Boolean(errors.description)}
        helperText={errors.description}
        multiline
        minRows={compact ? 3 : 4}
        fullWidth
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label="出售价格（元）"
          type="number"
          value={value.price}
          onChange={(e) => patch({ price: e.target.value })}
          error={Boolean(errors.price)}
          helperText={errors.price}
          inputProps={{ min: 0, step: 1 }}
          fullWidth
          required
        />
        <TextField
          label="原价（元，选填）"
          type="number"
          value={value.originalPrice}
          onChange={(e) => patch({ originalPrice: e.target.value })}
          helperText="填写后可展示划线原价，更有吸引力"
          inputProps={{ min: 0, step: 1 }}
          fullWidth
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField
          select
          label="分类"
          value={value.category}
          onChange={(e) => patch({ category: e.target.value as Category })}
          fullWidth
        >
          {CATEGORIES.map((c) => (
            <MenuItem key={c} value={c}>
              {CATEGORY_EMOJI[c]} {c}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="成色"
          value={value.condition}
          onChange={(e) => patch({ condition: e.target.value as Condition })}
          fullWidth
        >
          {CONDITIONS.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="交易地点（校区）"
          value={value.campus}
          onChange={(e) => patch({ campus: e.target.value as Campus })}
          fullWidth
        >
          {CAMPUSES.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
      </div>

      <TextField
        label="联系方式"
        placeholder="手机号或学号，方便买家联系你"
        value={value.contact}
        onChange={(e) => patch({ contact: e.target.value })}
        error={Boolean(errors.contact)}
        helperText={errors.contact ?? '仅登录用户可见，平台不会公开你的隐私'}
        fullWidth
        required
      />

      {/* 图片选择器 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            商品图片（{value.images.length}/5）
          </Typography>
          {errors.images && (
            <Typography variant="caption" color="error">
              {errors.images}
            </Typography>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {IMAGE_PRESETS.map((url, index) => {
            const selected = value.images.includes(url);
            return (
              <button
                key={url}
                type="button"
                onClick={() => toggleImage(url)}
                className={`relative overflow-hidden rounded-xl border-2 transition ${
                  selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-transparent'
                }`}
                aria-label={`选择图片 ${index + 1}`}
                aria-pressed={selected}
              >
                <ImageWithFallback
                  src={url}
                  alt={`预置图片 ${index + 1}`}
                  emoji={CATEGORY_EMOJI[value.category]}
                  gradient={CATEGORY_GRADIENT[value.category]}
                  className="aspect-square w-full"
                />
                <Checkbox
                  checked={selected}
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    color: '#fff',
                    '&.Mui-checked': { color: '#0d8a84' },
                  }}
                />
              </button>
            );
          })}
        </div>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked disabled />}
          label={
            <span className="text-xs text-slate-400">
              演示版使用预置图片，不支持真实文件上传
            </span>
          }
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button onClick={onCancel} color="inherit">
            取消
          </Button>
        )}
        <Button variant="contained" size="large" onClick={handleSubmit}>
          {submitLabel}
        </Button>
      </div>
    </Stack>
  );
}
