/**
 * 演示模式（只打进演示构建）的第二部分规则：草稿白名单与正式校验、打包明细、需求评分、演示课程目录、邀请码。
 * 与后端 ListingPayload / ListingValidator / BundleService / DemandScorer 以及 Web 的 api/mock 逐条对齐；
 * REST 构建里不引用这个文件（界面不得用这里的函数重新计算分数或校验结果）。
 */
import { ApiError } from './transport';
import { BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS, CATEGORIES, CONDITIONS, type BundleItem, type BuildingScope, type Campus, type ListingKind, type ListingPayload, type ListingValidation, type Term, type TextbookUsage } from '../model';

const bad = (message: string) => new ApiError(message, 400);

// ---------------- 草稿字段白名单（ListingPayload.sanitize） ----------------
export const PAYLOAD_FIELDS: readonly string[] = ['title', 'description', 'price', 'originalPrice', 'category', 'condition', 'campus',
  'images', 'contact', 'contactPublic', 'buildingId', 'inspection', 'textbookEditionId', 'bundleItems', 'visibility', 'circleIds'];
export const ASSISTANT_FIELDS: readonly string[] = ['title', 'description', 'category', 'price', 'bundleItems', 'buildingId'];
const INSPECTION_KEYS: readonly string[] = ['itemCode', 'condition', 'note'];
const BUNDLE_KEYS: readonly string[] = ['itemCode', 'name', 'category', 'condition', 'quantity', 'note'];
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
    if ((v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number') || (typeof v === 'string' && v.length > 200)) throw bad(`${label}的「${key}」格式无效`);
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
    if (assistant && (key === 'contact' || key === 'contactPublic')) throw new ApiError('协助人不能填写联系方式', 403);
    if (value === null || value === undefined) { result[key] = null; continue; }
    switch (key) {
      case 'title': result[key] = str(value, 100, '标题'); break;
      case 'description': result[key] = str(value, 4000, '描述'); break;
      case 'contactPublic': if (typeof value !== 'boolean') throw bad('contactPublic 必须是布尔值'); result[key] = value; break;
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

// ---------------- 打包明细（BundleService.parse） ----------------
function itemText(raw: unknown, max: number, label: string): string {
  if (typeof raw !== 'string') throw bad(`${label}格式无效`);
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > max) throw bad(`${label}最多 ${max} 个字`);
  if (/[<>]/.test(value)) throw bad(`${label}不能包含尖括号`);
  return value;
}
export function parseBundleItems(raw: unknown): BundleItem[] {
  if (!Array.isArray(raw)) throw bad('整套打包需要提供明细列表');
  if (raw.length < BUNDLE_MIN_ITEMS || raw.length > BUNDLE_MAX_ITEMS) throw bad(`整套打包需要 ${BUNDLE_MIN_ITEMS}～${BUNDLE_MAX_ITEMS} 条明细`);
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
    return { itemCode: code, name, category: item.category as BundleItem['category'], condition: item.condition as BundleItem['condition'], quantity: q, note: note || null, sortOrder: i };
  });
}

// ---------------- 正式校验（ListingValidator） ----------------
export interface ValidationContext {
  building(id: string): { campusId: string } | null;
  editionInSchoolOf(editionId: string, campus: string): boolean;
  circlesUsable(circleIds: string[], campus: string): boolean;
  campusValid(campus: string): boolean;
  /** 演示没有商品情况清单：分类不需要声明。 */
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
const result = (code: ListingValidation['code'], field: string | null, message: string): ListingValidation => ({ code, field, message });
/** 演示上传的图片引用、本地示意插画或 HTTP(S) 地址。 */
const imageOk = (u: unknown) => typeof u === 'string' && u.length <= 2048 && (/^https?:\/\//.test(u) || /^upload:[0-9a-fA-F-]{36}$/.test(u) || /^\/assets\/goods\/[a-z]+\.png$/.test(u));
export function validateListing(payload: ListingPayload, draftType: ListingKind, ctx: ValidationContext): ListingValidation {
  const p = payload as Record<string, unknown>;
  const missing: string[] = REQUIRED.filter((k) => { const v = p[k]; return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0); });
  if (draftType === 'BUNDLE' && (p.bundleItems === undefined || p.bundleItems === null)) missing.push('bundleItems');
  if (missing.length) return result('MISSING_FIELD', missing.join(','), '还有必填项没有填写');
  const category = String(p.category);
  if (!(CATEGORIES as readonly string[]).includes(category)) return result('INVALID_CATEGORY', 'category', '分类无效');
  if (!priceOk(p.price) || (p.originalPrice !== undefined && p.originalPrice !== null && !priceOk(p.originalPrice))) return result('INVALID_PRICE', 'price', '价格最多两位小数');
  const title = typeof p.title === 'string' ? p.title.trim() : '', description = typeof p.description === 'string' ? p.description.trim() : '';
  if (!title || title.length > 100) return result('INVALID_FIELD', null, 'title 长度无效');
  if (!description || description.length > 4000) return result('INVALID_FIELD', null, 'description 长度无效');
  if (!(CONDITIONS as readonly string[]).includes(String(p.condition))) return result('INVALID_FIELD', null, '成色无效');
  const campus = String(p.campus);
  if (!ctx.campusValid(campus)) return result('INVALID_FIELD', null, '校区无效');
  const images = p.images;
  if (!Array.isArray(images) || images.length > 9 || images.some((u) => !imageOk(u))) return result('INVALID_FIELD', null, '图片必须是上传的图片或 HTTP(S) 地址');
  if (p.contact !== undefined && p.contact !== null && (typeof p.contact !== 'string' || p.contact.trim().length > 100)) return result('INVALID_FIELD', null, 'contact 长度无效');
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
    if (!b || b.campusId !== campus) return result('INVALID_BUILDING', 'buildingId', '取货楼栋不存在、已停用或不属于该校区');
  }
  if (draftType === 'BUNDLE') {
    if (p.inspection !== undefined && p.inspection !== null) return result('INVALID_INSPECTION', 'inspection', '整套打包商品按每条明细验货，不需要商品级验货清单');
    if (p.textbookEditionId !== undefined && p.textbookEditionId !== null) return result('INVALID_TEXTBOOK', 'textbookEditionId', '整套打包商品不能关联单一教材版本');
    try { parseBundleItems(p.bundleItems); } catch (e) { return result('INVALID_BUNDLE', 'bundleItems', e instanceof ApiError ? e.message : '内容格式无效'); }
    return VALID;
  }
  if (p.bundleItems !== undefined && p.bundleItems !== null) return result('INVALID_BUNDLE', 'bundleItems', '只有整套打包商品可以有明细');
  if (typeof p.textbookEditionId === 'string' && p.textbookEditionId.trim()) {
    if (category !== '教材书籍') return result('INVALID_TEXTBOOK', 'textbookEditionId', '只有教材书籍分类可以关联教材版本');
    if (!ctx.editionInSchoolOf(p.textbookEditionId, campus)) return result('INVALID_TEXTBOOK', 'textbookEditionId', '教材版本不存在');
  }
  return VALID;
}

// ---------------- 需求匹配评分（DemandScorer） ----------------
export const normalizeDemandText = (raw: string | null | undefined) => (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const POINTS: Record<string, number> = { TEXTBOOK_EXACT: 50, KEYWORD_TITLE_EXACT: 50, KEYWORD_TITLE: 40, KEYWORD_DESCRIPTION: 20, CATEGORY: 20, SAME_BUILDING: 20, SAME_ZONE: 12, SAME_CAMPUS: 6, PRICE_CLOSE: 10 };
export interface ScoringSubscription { normalizedKeyword: string | null; category: string | null; minPrice: number | null; maxPrice: number | null; geoScope: BuildingScope; campusId: string | null; buildingId: string | null; anchorZone: string | null; textbookEditionId: string | null }
export interface ScoringProduct { title: string; description: string; category: string; price: number; campus: string; buildingId: string | null; zone: string | null; textbookEditionId: string | null }
export function scoreDemandMatch(s: ScoringSubscription, p: ScoringProduct): { score: number; reasonCodes: string[] } {
  const reasons: string[] = [];
  const title = normalizeDemandText(p.title), description = normalizeDemandText(p.description);
  if (s.textbookEditionId && s.textbookEditionId === p.textbookEditionId) reasons.push('TEXTBOOK_EXACT');
  if (s.normalizedKeyword) {
    if (s.normalizedKeyword === title) reasons.push('KEYWORD_TITLE_EXACT');
    else if (title.includes(s.normalizedKeyword)) reasons.push('KEYWORD_TITLE');
    else if (description.includes(s.normalizedKeyword)) reasons.push('KEYWORD_DESCRIPTION');
  }
  if (s.category && s.category === p.category) reasons.push('CATEGORY');
  if (s.geoScope === 'BUILDING' || s.geoScope === 'ZONE') {
    if (s.buildingId && s.buildingId === p.buildingId) reasons.push('SAME_BUILDING');
    else if (s.anchorZone && s.anchorZone === p.zone && s.campusId === p.campus) reasons.push('SAME_ZONE');
  } else if (s.geoScope === 'CAMPUS' && s.campusId && s.campusId === p.campus) reasons.push('SAME_CAMPUS');
  if (s.minPrice !== null && s.maxPrice !== null && s.maxPrice > s.minPrice) {
    const center = (s.minPrice + s.maxPrice) / 2, quarter = (s.maxPrice - s.minPrice) / 4;
    if (Math.abs(p.price - center) <= quarter) reasons.push('PRICE_CLOSE');
  }
  return { score: Math.min(100, reasons.reduce((sum, code) => sum + POINTS[code], 0)), reasonCodes: reasons };
}
export const mockTier = (score: number) => score >= 60 ? 'HIGH' : 'NORMAL';

// ---------------- 演示课程目录（虚构数据：课程名带「演示课程」前缀，教材一律无 ISBN，不占用任何真实书号） ----------------
export interface DemoCourse { id: string; school: string; courseCode: string; name: string; department: string }
export interface DemoOffering { id: string; courseId: string; school: string; academicYear: string; term: Term; instructorName: string | null; campusId: Campus | null }
export interface DemoEdition { id: string; school: string; isbn: string | null; title: string; subtitle: string | null; authors: string[]; publisher: string; editionLabel: string; publishedYear: number | null; workKey: string | null }
export interface DemoCourseTextbook { offeringId: string; editionId: string; usageType: TextbookUsage }
const A = 'demo-school-a';
export const DEMO_COURSES: DemoCourse[] = [
  { id: 'demo-calculus-1', school: A, courseCode: 'DEMO-MA101', name: '演示课程·微积分（一）', department: '演示数学学院' },
  { id: 'demo-linear-algebra', school: A, courseCode: 'DEMO-MA102', name: '演示课程·线性代数', department: '演示数学学院' },
  { id: 'demo-programming', school: A, courseCode: 'DEMO-CS101', name: '演示课程·程序设计基础', department: '演示计算机学院' },
];
export const DEMO_OFFERINGS: DemoOffering[] = [
  { id: 'demo-calculus-1-2025s', courseId: 'demo-calculus-1', school: A, academicYear: '2025-2026', term: 'SPRING', instructorName: '演示教师甲', campusId: '东校区' },
  { id: 'demo-calculus-1-2026a', courseId: 'demo-calculus-1', school: A, academicYear: '2026-2027', term: 'AUTUMN', instructorName: '演示教师甲', campusId: '东校区' },
  { id: 'demo-linear-algebra-2026a', courseId: 'demo-linear-algebra', school: A, academicYear: '2026-2027', term: 'AUTUMN', instructorName: '演示教师乙', campusId: '西校区' },
  { id: 'demo-programming-2026a', courseId: 'demo-programming', school: A, academicYear: '2026-2027', term: 'AUTUMN', instructorName: null, campusId: null },
];
export const DEMO_EDITIONS: DemoEdition[] = [
  { id: 'demo-ed-calculus-7', school: A, isbn: null, title: '演示教材·高等数学（上册）', subtitle: null, authors: ['演示作者甲'], publisher: '演示教育出版社', editionLabel: '第 7 版', publishedYear: 2014, workKey: 'demo-calculus' },
  { id: 'demo-ed-calculus-8', school: A, isbn: null, title: '演示教材·高等数学（上册）', subtitle: null, authors: ['演示作者甲'], publisher: '演示教育出版社', editionLabel: '第 8 版', publishedYear: 2023, workKey: 'demo-calculus' },
  { id: 'demo-ed-linear-6', school: A, isbn: null, title: '演示教材·线性代数', subtitle: null, authors: ['演示作者乙'], publisher: '演示大学出版社', editionLabel: '第 6 版', publishedYear: 2021, workKey: null },
  { id: 'demo-ed-programming-3', school: A, isbn: null, title: '演示教材·程序设计入门', subtitle: '讲义', authors: ['演示作者丙', '演示作者丁'], publisher: '演示计算机出版社', editionLabel: '第 3 版', publishedYear: 2022, workKey: null },
];
export const DEMO_COURSE_TEXTBOOKS: DemoCourseTextbook[] = [
  { offeringId: 'demo-calculus-1-2025s', editionId: 'demo-ed-calculus-7', usageType: 'REQUIRED' },
  { offeringId: 'demo-calculus-1-2026a', editionId: 'demo-ed-calculus-8', usageType: 'REQUIRED' },
  { offeringId: 'demo-linear-algebra-2026a', editionId: 'demo-ed-linear-6', usageType: 'REQUIRED' },
  { offeringId: 'demo-programming-2026a', editionId: 'demo-ed-programming-3', usageType: 'RECOMMENDED' },
];
export const TERM_ORDER: Record<Term, number> = { AUTUMN: 0, SUMMER: 1, SPRING: 2, WINTER: 3 };
export const USAGE_ORDER: Record<TextbookUsage, number> = { REQUIRED: 0, RECOMMENDED: 1, REFERENCE: 2 };

// ---------------- 邀请码（演示只保存摘要，原始邀请码只出现在创建结果里） ----------------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** 43 位 base64url 字符（与后端同样的长度与字母表）；演示用 Math.random，不用于真实安全场景。 */
export function randomToken(random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < 43; i += 1) token += ALPHABET[Math.floor(random() * 64)];
  return token;
}
/** 演示库里邀请码的摘要（cyrb53 双 32 位）；只为不把原始邀请码写进本地缓存。 */
export function tokenDigest(token: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
