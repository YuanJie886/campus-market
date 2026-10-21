import type { Category, OrderStatus } from '../types';

/** 分类对应的 emoji（图片加载失败时兜底展示） */
export const CATEGORY_EMOJI: Record<Category, string> = {
  数码电子: '💻',
  教材书籍: '📚',
  生活用品: '🧴',
  服饰鞋包: '👕',
  运动户外: '🏀',
  其他: '📦',
};

/** 分类对应的渐变背景（图片加载失败时兜底展示） */
export const CATEGORY_GRADIENT: Record<Category, string> = {
  数码电子: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
  教材书籍: 'linear-gradient(135deg,#f6d365 0%,#fda085 100%)',
  生活用品: 'linear-gradient(135deg,#a1c4fd 0%,#c2e9fb 100%)',
  服饰鞋包: 'linear-gradient(135deg,#ff9a9e 0%,#fecfef 100%)',
  运动户外: 'linear-gradient(135deg,#84fab0 0%,#8fd3f4 100%)',
  其他: 'linear-gradient(135deg,#cfd9df 0%,#a8b8c8 100%)',
};

/** 订单状态对应的 MUI Chip 颜色 */
export const ORDER_STATUS_COLOR: Record<
  OrderStatus,
  'default' | 'warning' | 'info' | 'success' | 'error'
> = {
  待确认: 'warning',
  交易中: 'info',
  已完成: 'success',
  已取消: 'default',
};

/** 成色对应的展示色（用于小圆点 / 标签） */
export const CONDITION_COLOR: Record<string, string> = {
  全新: '#16a34a',
  几乎全新: '#0d8a84',
  轻微使用痕迹: '#f59e0b',
  明显使用痕迹: '#ef4444',
};

/** 分类封面的两个渐变色（与 CATEGORY_GRADIENT 相同） */
const CATEGORY_COVER_STOPS: Record<Category, readonly [string, string]> = {
  数码电子: ['#667eea', '#764ba2'],
  教材书籍: ['#f6d365', '#fda085'],
  生活用品: ['#a1c4fd', '#c2e9fb'],
  服饰鞋包: ['#ff9a9e', '#fecfef'],
  运动户外: ['#84fab0', '#8fd3f4'],
  其他: ['#cfd9df', '#a8b8c8'],
};

/** 本地绘制的分类封面：内联 SVG（渐变 + 分类 emoji），不向任何外部主机请求。xmlns 只是 SVG 命名空间标识，不会被请求 */
function drawCategoryCover(category: Category): string {
  const [from, to] = CATEGORY_COVER_STOPS[category];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="400" height="300" fill="url(#g)"/>`
    + `<text x="200" y="150" font-size="120" text-anchor="middle" dominant-baseline="central">${CATEGORY_EMOJI[category]}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 分类封面图（首页分类导航用）：本地绘制，见 drawCategoryCover */
export const CATEGORY_COVER: Record<Category, string> = {
  数码电子: drawCategoryCover('数码电子'),
  教材书籍: drawCategoryCover('教材书籍'),
  生活用品: drawCategoryCover('生活用品'),
  服饰鞋包: drawCategoryCover('服饰鞋包'),
  运动户外: drawCategoryCover('运动户外'),
  其他: drawCategoryCover('其他'),
};
