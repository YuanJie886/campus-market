import { ApiError } from '../errors';
import { CATEGORIES, CONDITIONS } from '../../types';
import type { BundleItem, ListingKind, ListingPayload, ListingValidation } from '../contracts';
import { BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS } from '../contracts';

/**
 * 离线 Mock 的模块 5 规则：与后端 ListingPayload / ListingValidator / BundleService / PriceGuidanceService
 * 逐条对齐的纯函数。Mock 与 REST 的契约测试用同一组输入对照两边的结果。
 */

// ---------------------------------------------------------------------------
// 草稿字段白名单（ListingPayload.sanitize）
// ---------------------------------------------------------------------------

export const PAYLOAD_FIELDS: readonly string[] = ['title', 'description', 'price', 'originalPrice', 'category', 'condition', 'campus',
  'images', 'contact', 'contactPublic', 'buildingId', 'inspection', 'textbookEditionId', 'bundleItems', 'visibility', 'circleIds'];
/** 协助人可以整理的字段（5.5），与后端 ListingPayload.ASSISTANT_FIELDS 一致 */
export const ASSISTANT_FIELDS: readonly string[] = ['title', 'description', 'category', 'price', 'bundleItems', 'buildingId'];
const INSPECTION_KEYS: readonly string[] = ['itemCode', 'condition', 'note'];
const BUNDLE_KEYS: readonly string[] = ['itemCode', 'name', 'category', 'condition', 'quantity', 'note'];

const bad = (message: string) => ApiError.mock({ code: 400, message });

function str(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw bad(`${label} 格式无效`);
  if (value.length > max) throw bad(`${label} 最多 ${max} 个字`);
  return value;
}

function list<T>(value: unknown, max: number, label: string, each: (v: unknown) => T): T[] {
  if (!Array.isArray(value)) throw bad(`${label} 格式无效`);
  if (value.length > max) throw bad(`${label} 最多 ${max} 项`);
  return value.map(each);
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`${label} 格式无效`);
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!keys.includes(key)) throw bad(`${label}包含不支持的字段：${key}`);
    if ((v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number') || (typeof v === 'string' && v.length > 200)) {
      throw bad(`${label}的「${key}」格式无效`);
    }
    result[key] = v;
  }
  return result;
}

/** 草稿只做形状与长度检查；协助人不能写联系方式（403）。 */
export function sanitizePayload(raw: unknown, assistant: boolean): ListingPayload {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('草稿内容格式无效');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PAYLOAD_FIELDS.includes(key)) throw bad(`草稿包含不支持的字段：${key}`);
    if (assistant && (key === 'contact' || key === 'contactPublic')) throw ApiError.mock({ code: 403, message: '协助人不能填写联系方式' });
    if (value === null || value === undefined) { result[key] = null; continue; }
    switch (key) {
      case 'title': result[key] = str(value, 100, '标题'); break;
      case 'description': result[key] = str(value, 4000, '描述'); break;
      case 'contactPublic': if (typeof value !== 'boolean') throw ApiError.mock({ code: 400, message: 'contactPublic 必须是布尔值' }); result[key] = value; break;
      case 'contact': result[key] = str(value, 100, '联系方式'); break;
      case 'category': case 'condition': case 'campus': result[key] = str(value, 20, key); break;
      case 'buildingId': case 'textbookEditionId': result[key] = str(value, 64, key); break;
      case 'visibility': result[key] = str(value, 20, key); break;
      case 'circleIds': result[key] = list(value, 6, '圈子', (v) => str(v, 64, '圈子 id')); break;
      case 'price': case 'originalPrice':
        if (typeof value !== 'number' && !(typeof value === 'string' && value.length <= 20)) throw bad(`${key} 格式无效`);
        result[key] = value; break;
      case 'images': result[key] = list(value, 9, '图片', (v) => str(v, 2048, '图片地址')); break;
      case 'inspection': result[key] = list(value, 40, '验货清单', (v) => object(v, INSPECTION_KEYS, '验货条目')); break;
      case 'bundleItems': result[key] = list(value, BUNDLE_MAX_ITEMS + 1, '打包明细', (v) => object(v, BUNDLE_KEYS, '打包明细')); break;
      default: throw bad(`草稿包含不支持的字段：${key}`);
    }
  }
  return result as ListingPayload;
}

// ---------------------------------------------------------------------------
// 打包明细（BundleService.parse）
// ---------------------------------------------------------------------------

function itemText(raw: unknown, max: number, label: string): string {
  if (typeof raw !== 'string') throw bad(`${label}格式无效`);
  const value = raw.trim().replace(/\s+/gu, ' ');
  if (value.length > max) throw bad(`${label}最多 ${max} 个字`);
  if (/[<>]/.test(value)) throw bad(`${label}不能包含尖括号`);
  return value;
}

export function parseBundleItems(raw: unknown): BundleItem[] {
  if (!Array.isArray(raw)) throw bad('整套打包需要提供明细列表');
  if (raw.length < BUNDLE_MIN_ITEMS || raw.length > BUNDLE_MAX_ITEMS) {
    throw bad(`整套打包需要 ${BUNDLE_MIN_ITEMS}～${BUNDLE_MAX_ITEMS} 条明细`);
  }
  const codes = new Set<string>();
  return raw.map((element, i) => {
    const n = i + 1;
    if (!element || typeof element !== 'object' || Array.isArray(element)) throw bad(`第 ${n} 条明细格式无效`);
    const item = element as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!BUNDLE_KEYS.includes(key)) throw bad(`明细包含不支持的字段：${key}`);
    const code = item.itemCode === undefined || item.itemCode === null ? `I${String(n).padStart(2, '0')}` : String(item.itemCode);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code)) throw bad(`第 ${n} 条明细的编号无效`);
    if (codes.has(code)) throw bad(`明细编号重复：${code}`);
    codes.add(code);
    const name = itemText(item.name, 60, `第 ${n} 条明细的名称`);
    if (!name) throw bad(`第 ${n} 条明细缺少名称`);
    if (!(CATEGORIES as readonly string[]).includes(String(item.category))) throw bad(`第 ${n} 条明细的分类无效`);
    if (!(CONDITIONS as readonly string[]).includes(String(item.condition))) throw bad(`第 ${n} 条明细的成色无效`);
    const q = item.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 99) throw bad(`第 ${n} 条明细的数量应为 1～99 的整数`);
    const note = item.note === undefined || item.note === null ? '' : itemText(item.note, 200, `第 ${n} 条明细的备注`);
    return { itemCode: code, name, category: item.category as BundleItem['category'], condition: item.condition as BundleItem['condition'], quantity: q, note, sortOrder: i };
  });
}

// ---------------------------------------------------------------------------
// 正式校验（ListingValidator）
// ---------------------------------------------------------------------------

export interface ValidationContext {
  /** 返回楼栋；不存在为 null */
  building(id: string): { campusId: string; active: boolean } | null;
  /** 该分类的验货声明解析（抛 ApiError 表示不通过） */
  parseDisclosure(category: string, raw: unknown): unknown;
  /** 版本是否存在且属于该校区所在学校 */
  editionInSchoolOf(editionId: string, campus: string): boolean;
  /** 模块 6：所有者能否把商品发到这些圈子（在用、同校、所有者在籍） */
  circlesUsable(circleIds: string[], campus: string): boolean;
  /** 6.1A：校区存在且属于所有者本人的学校 */
  campusValid(campus: string): boolean;
}

/** 规则函数只抛 ApiError；取出它给出的原因文本，放进逐项校验结果。 */
function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : '内容格式无效';
}

export const VALID: ListingValidation = { code: 'VALID', field: null, message: null };
const REQUIRED = ['title', 'description', 'price', 'category', 'condition', 'campus', 'images'] as const;

function priceOk(raw: unknown): boolean {
  if (typeof raw !== 'number' && typeof raw !== 'string') return false;
  const text = String(raw).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return false;
  const value = Number(text);
  return value >= 0 && value <= 99_999_999;
}

function result(code: ListingValidation['code'], field: string | null, message: string): ListingValidation {
  return { code, field, message };
}

export function validateListing(payload: ListingPayload, draftType: ListingKind, ctx: ValidationContext): ListingValidation {
  const p = payload as Record<string, unknown>;
  const missing: string[] = REQUIRED.filter((k) => {
    const v = p[k];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  });
  if (draftType === 'BUNDLE' && (p.bundleItems === undefined || p.bundleItems === null)) missing.push('bundleItems');
  if (missing.length) return result('MISSING_FIELD', missing.join(','), '还有必填项没有填写');

  const category = String(p.category);
  if (!(CATEGORIES as readonly string[]).includes(category)) return result('INVALID_CATEGORY', 'category', '分类无效');
  if (!priceOk(p.price) || (p.originalPrice !== undefined && p.originalPrice !== null && !priceOk(p.originalPrice))) {
    return result('INVALID_PRICE', 'price', '价格最多两位小数');
  }
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  const description = typeof p.description === 'string' ? p.description.trim() : '';
  if (!title || title.length > 100) return result('INVALID_FIELD', null, 'title 长度无效');
  if (!description || description.length > 4000) return result('INVALID_FIELD', null, 'description 长度无效');
  if (!(CONDITIONS as readonly string[]).includes(String(p.condition))) return result('INVALID_FIELD', null, '成色无效');
  const campus = String(p.campus);
  if (!ctx.campusValid(campus)) return result('INVALID_FIELD', null, '校区无效');
  const images = p.images;
  if (!Array.isArray(images) || images.length > 9 || images.some((u) => typeof u !== 'string' || u.length > 2048 || !/^https?:\/\//.test(u))) {
    return result('INVALID_FIELD', null, '图片必须使用 HTTP(S) 地址');
  }
  if (p.contact !== undefined && p.contact !== null && (typeof p.contact !== 'string' || p.contact.trim().length > 100)) {
    return result('INVALID_FIELD', null, 'contact 长度无效');
  }
  if (p.visibility !== undefined || p.circleIds !== undefined) {
    const visibility = p.visibility ?? 'PUBLIC';
    const circleIds = Array.isArray(p.circleIds) ? (p.circleIds as unknown[]).map(String) : [];
    if (visibility !== 'PUBLIC' && visibility !== 'CIRCLE_ONLY') return result('INVALID_CIRCLE', 'circleIds', '可见范围无效');
    if (visibility === 'PUBLIC' && circleIds.length) return result('INVALID_CIRCLE', 'circleIds', '全校公开的商品不需要选择圈子');
    if (visibility === 'CIRCLE_ONLY') {
      if (circleIds.length < 1 || circleIds.length > 5 || new Set(circleIds).size !== circleIds.length) return result('INVALID_CIRCLE', 'circleIds', '圈子可见需要选择 1～5 个圈子');
      if (!ctx.circlesUsable(circleIds, campus)) return result('INVALID_CIRCLE', 'circleIds', '圈子不存在、已归档，或所有者不是这个圈子的成员');
    }
  }
  if (typeof p.buildingId === 'string' && p.buildingId.trim()) {
    const b = ctx.building(p.buildingId);
    if (!b || !b.active || b.campusId !== campus) return result('INVALID_BUILDING', 'buildingId', '取货楼栋不存在、已停用或不属于该校区');
  }
  if (draftType === 'BUNDLE') {
    if (p.inspection !== undefined && p.inspection !== null) return result('INVALID_INSPECTION', 'inspection', '整套打包商品按每条明细验货，不需要商品级验货清单');
    if (p.textbookEditionId !== undefined && p.textbookEditionId !== null) return result('INVALID_TEXTBOOK', 'textbookEditionId', '整套打包商品不能关联单一教材版本');
    try {
      parseBundleItems(p.bundleItems);
    } catch (e) {
      return result('INVALID_BUNDLE', 'bundleItems', reasonOf(e));
    }
    return VALID;
  }
  if (p.bundleItems !== undefined && p.bundleItems !== null) return result('INVALID_BUNDLE', 'bundleItems', '只有整套打包商品可以有明细');
  try {
    ctx.parseDisclosure(category, p.inspection);
  } catch (e) {
    return result('INVALID_INSPECTION', 'inspection', reasonOf(e));
  }
  if (typeof p.textbookEditionId === 'string' && p.textbookEditionId.trim()) {
    if (category !== '教材书籍') return result('INVALID_TEXTBOOK', 'textbookEditionId', '只有教材书籍分类可以关联教材版本');
    if (!ctx.editionInSchoolOf(p.textbookEditionId, campus)) return result('INVALID_TEXTBOOK', 'textbookEditionId', '教材版本不存在');
  }
  return VALID;
}

// ---------------------------------------------------------------------------
// 价格参考（PriceGuidanceService）
// ---------------------------------------------------------------------------

/** 与 PostgreSQL percentile_cont 相同的线性插值。values 必须非空。 */
export function percentileCont(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** 样本数下界档位：8、9 → 8；10 及以上向下取到 5 的倍数。 */
export function sampleBucket(count: number): number {
  return count < 10 ? 8 : count - (count % 5);
}

/** 按量级取整：百元以下到 1 元、千元以下到 5 元、以上到 10 元（四舍五入）。 */
export function roundGuidance(value: number): number {
  const step = value < 100 ? 1 : value < 1000 ? 5 : 10;
  return Math.round(Math.round(value * 100) / 100 / step) * step;
}

// ---------------------------------------------------------------------------
// SHA-256（同步实现，用于邀请码哈希）。Mock 与后端一样只保存哈希，原始邀请码不落 localStorage。
// ---------------------------------------------------------------------------

const K = /* @__PURE__ */ new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** 32 字节随机数的 base64url（与后端同样的长度与字母表）。 */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
