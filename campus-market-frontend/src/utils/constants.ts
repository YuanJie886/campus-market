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

/** 发布页可选的预置图片（稳定公开占位图，避免真实文件上传） */
export const IMAGE_PRESETS: string[] = Array.from({ length: 12 }, (_, i) =>
  `https://picsum.photos/seed/cm-preset-${i + 1}/600/600`,
);

/** 分类封面图（首页分类导航用） */
export const CATEGORY_COVER: Record<Category, string> = {
  数码电子: 'https://picsum.photos/seed/cm-cat-digital/400/300',
  教材书籍: 'https://picsum.photos/seed/cm-cat-book/400/300',
  生活用品: 'https://picsum.photos/seed/cm-cat-life/400/300',
  服饰鞋包: 'https://picsum.photos/seed/cm-cat-cloth/400/300',
  运动户外: 'https://picsum.photos/seed/cm-cat-sport/400/300',
  其他: 'https://picsum.photos/seed/cm-cat-other/400/300',
};
