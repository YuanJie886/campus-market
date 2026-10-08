import { ApiError } from '../api/errors';
import type { BundleItem, BundleItemInput, ListingPayload, ListingValidationCode } from '../api/contracts';

/**
 * 模块 5 的界面辅助。所有判断都基于服务端给出的机器码（validation.code、draft.status、HTTP 状态码），
 * 中文只用于展示，不参与任何业务分支。
 */

/** 校验码 → 展示文案 */
export const VALIDATION_LABEL: Record<ListingValidationCode, string> = {
  VALID: '可以发布',
  MISSING_FIELD: '还有必填项没填',
  INVALID_CATEGORY: '分类无效',
  INVALID_PRICE: '价格无效',
  INVALID_FIELD: '内容格式有误',
  INVALID_BUILDING: '取货楼栋无效',
  INVALID_INSPECTION: '验货声明不完整',
  INVALID_TEXTBOOK: '教材版本无效',
  INVALID_BUNDLE: '打包明细有误',
  INVALID_CIRCLE: '圈子可见范围有误',
  DRAFT_CLOSED: '草稿已发布、已丢弃或已过期',
};

/** 必填字段名 → 展示文案（服务端 MISSING_FIELD 的 field 是逗号分隔的字段名） */
export const FIELD_LABEL: Record<string, string> = {
  title: '标题', description: '描述', price: '价格', category: '分类', condition: '成色', campus: '校区',
  images: '图片', bundleItems: '打包明细', circleIds: '圈子', buildingId: '取货楼栋', inspection: '验货声明', textbookEditionId: '教材版本', status: '状态',
};

export function missingText(field: string | null): string {
  if (!field) return '';
  return field.split(',').map((f) => FIELD_LABEL[f] ?? f).join('、');
}

/**
 * 「复制上一件的通用字段」只复制与物品本身无关、同一个人连续发布时通常相同的字段。
 * 分类、价格、成色、验货声明、图片、打包明细都是每件物品自己的事实，绝不复制。
 */
export const COMMON_FIELDS = ['campus', 'buildingId', 'contact'] as const;

export function copyCommonFields(from: ListingPayload): ListingPayload {
  const result: ListingPayload = {};
  for (const key of COMMON_FIELDS) {
    if (from[key] !== undefined && from[key] !== null && from[key] !== '') (result as Record<string, unknown>)[key] = from[key];
  }
  return result;
}

/** 一次发布尝试的幂等键；同一次尝试的重试沿用同一个键。 */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `batch-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 409 且带 currentVersion：另一个页面或协助人已经保存过更新的版本 */
export function versionConflict(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 409) return null;
  const details = error.details as { currentVersion?: unknown } | undefined;
  return typeof details?.currentVersion === 'number' ? details.currentVersion : null;
}

/**
 * 协助链接：邀请码放在 URL fragment（# 之后），浏览器不会把 fragment 发给服务器，
 * 也不会出现在 Referer 或服务端访问日志里。兑换时由页面读出并只放进请求体。
 */
export function assistLink(origin: string, token: string): string {
  return `${origin}/assist#code=${encodeURIComponent(token)}`;
}

export function tokenFromFragment(hash: string): string | null {
  const match = /^#code=([A-Za-z0-9_%-]{20,200})$/.exec(hash);
  return match ? decodeURIComponent(match[1]) : null;
}

export interface BundleTotals { rows: number; quantity: number; categories: number }

export function bundleTotals(items: Array<Pick<BundleItem, 'quantity' | 'category'> | BundleItemInput>): BundleTotals {
  return {
    rows: items.length,
    quantity: items.reduce((n, i) => n + (Number.isInteger(i.quantity) ? i.quantity : 0), 0),
    categories: new Set(items.map((i) => i.category)).size,
  };
}

/** 平均每件价格：只用于展示，保留两位小数，不参与任何计算或下单。 */
export function averagePerItem(total: number, quantity: number): string | null {
  if (!quantity || !Number.isFinite(total)) return null;
  return (Math.round((total / quantity) * 100) / 100).toFixed(2);
}

/** 草稿 payload 里的价格统一以字符串编辑，保存时再转成数字（无法解析的原样交给服务端校验）。 */
export function priceValue(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return /^\d+(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : trimmed;
}
