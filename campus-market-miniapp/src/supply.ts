/**
 * 毕业季快速发布 / 整套打包 / 协助整理的界面规则（纯函数，不依赖 Taro，便于测试），与 Web utils/supply.ts、
 * BundleEditor、BundleProductForm、ListingItemEditor、SupplyWorkbenchPage 一致。
 * 业务判断只看服务端给出的机器码（validation.code、draft.status、HTTP 状态码），中文只用于展示。
 */
import { ApiError } from './api/transport';
import {
  BUNDLE_MAX_ITEMS, BUNDLE_MIN_ITEMS, CATEGORIES, CONDITIONS,
  type AssistInviteStatus, type BatchPublishProblem, type BundleItemInput, type Campus, type Category, type Condition,
  type ListingDraft, type ListingPayload, type ListingValidation, type ListingValidationCode, type ProductInput, type ProductVisibility,
} from './model';

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
export const FIELD_LABEL: Record<string, string> = {
  title: '标题', description: '描述', price: '价格', category: '分类', condition: '成色', campus: '校区',
  images: '图片', bundleItems: '打包明细', circleIds: '圈子', buildingId: '取货楼栋', inspection: '验货声明', textbookEditionId: '教材版本', status: '状态',
};
export function missingText(field: string | null): string {
  if (!field) return '';
  return field.split(',').map((f) => FIELD_LABEL[f] ?? f).join('、');
}
/** 「第 N 件：原因（缺的字段）」——批次检查与整批发布被拒时共用。 */
export function problemText(position: number, v: Pick<ListingValidation, 'code' | 'field'>): string {
  return `第 ${position} 件：${VALIDATION_LABEL[v.code] ?? '内容格式有误'}${v.code === 'MISSING_FIELD' ? `（${missingText(v.field)}）` : ''}`;
}

export const BATCH_INTRO = '一次整理多件闲置（最多 20 件），逐件保存为草稿，全部检查通过后一次确认发布：要么全部发布，要么一件都不发布。任何时候都可以用。';
export const PUBLISH_ALL_OR_NOTHING = '全部成功或全部不发布：任何一件失败，这个批次都不会发布任何商品。';
export const PUBLISH_CONTACT_NOTE = '发布后，联系方式按每件商品的展示选项公开，或经你同意联系申请后向对应买家展示。';
export const BATCH_REJECTED = '整个批次都没有发布。请按下面的清单逐件修改，其他已填写的内容都还在。';
export const BATCH_CONFLICT = '这个批次已在其他页面更新过。请点「重新加载批次」查看最新内容后再操作，本页不会覆盖对方的修改。';
/** 协助整理后发布时，发布确认必须如实写出的文字。 */
export const ASSISTED_PUBLISH_TEXT = '内容由他人协助整理，商品所有者已检查并确认发布。';
export const ASSIST_SCOPE_TEXT = '对方可以帮你整理标题、描述、分类、价格建议、打包明细与取货楼栋建议并保存；不能发布，看不到你的联系方式、联系申请或其他草稿，也不能再邀请别人。你可以随时撤销。';
export const ASSISTANT_ROLE_TEXT = '你正在协助整理发布：可以修改标题、描述、分类、价格建议、打包明细与取货楼栋建议并保存。最终由商品所有者检查并发布；你看不到所有者的联系方式、联系申请或其他草稿。';
export const ASSIST_TOKEN_ONCE = '邀请码只显示这一次，关闭后无法再次查看；只能使用一次。需要时请撤销后重新生成。';
export const ASSIST_REVOKED_DONE = '邀请已撤销，对方将无法再查看或修改这些草稿';
export const ASSIST_INVITE_STATUS: Record<AssistInviteStatus, string> = { PENDING: '等待对方兑换', ACTIVE: '协助中', REVOKED: '已撤销', EXPIRED: '已过期' };
export const ASSIST_EXPIRY_OPTIONS = [
  { hours: 1, label: '1 小时' }, { hours: 24, label: '24 小时（默认）' }, { hours: 72, label: '3 天' }, { hours: 168, label: '7 天（最长）' },
];
export const BUNDLE_NOTICE = '整套展示，感兴趣的买家可申请查看联系方式，具体沟通由双方自行联系。';
export const BUNDLE_ROWS_HELP = '整套展示，请逐项填写内容，方便买家了解商品。';
/** 协助人只能整理这些字段（与后端 ListingPayload.ASSISTANT_FIELDS 一致）。 */
export const ASSISTANT_FIELDS: readonly string[] = ['title', 'description', 'category', 'price', 'bundleItems', 'buildingId'];

/** 「复制上一件的通用字段」只复制与物品本身无关的字段；分类、价格、成色、声明、图片、明细都不复制。 */
export const COMMON_FIELDS = ['campus', 'buildingId', 'contact'] as const;
export function copyCommonFields(from: ListingPayload): ListingPayload {
  const result: ListingPayload = {};
  for (const key of COMMON_FIELDS) {
    if (from[key] !== undefined && from[key] !== null && from[key] !== '') (result as Record<string, unknown>)[key] = from[key];
  }
  return result;
}

/** 一次发布尝试的幂等键；同一次尝试（含网络失败后的重试）沿用同一个键。小程序没有 crypto，只需要不重复。 */
export function newIdempotencyKey(random: () => number = Math.random, now: () => number = Date.now): string {
  let hex = '';
  for (let i = 0; i < 24; i += 1) hex += Math.floor(random() * 16).toString(16);
  return `batch-${now().toString(16)}-${hex}`;
}

/** 409 且带 currentVersion：另一个页面或协助人已经保存过更新的版本。 */
export function versionConflict(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 409) return null;
  const details = error.details as { currentVersion?: unknown } | undefined;
  return typeof details?.currentVersion === 'number' ? details.currentVersion : null;
}

export interface BatchProblem { position: number; draftId: string; text: string }
/** 整批发布被拒（400 且 details.items 有逐项原因）→ 清单；其他错误返回 null（没有任何商品被发布）。 */
export function batchPublishProblems(error: unknown): BatchProblem[] | null {
  if (!(error instanceof ApiError) || error.code !== 400) return null;
  const items = (error.details as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || !items.length) return null;
  return (items as BatchPublishProblem[]).map((p) => ({ position: p.position, draftId: p.draftId, text: problemText(p.position, p) }));
}
/** 发布前「检查全部」：批次里还不能发布的逐项列出。 */
export function batchCheckProblems(items: { position: number; draft: { id: string }; validation?: ListingValidation }[]): BatchProblem[] {
  return items.filter((i) => i.validation && i.validation.code !== 'VALID')
    .map((i) => ({ position: i.position, draftId: i.draft.id, text: problemText(i.position, i.validation!) }));
}
export const publishFailedText = (message: string) => `发布没有完成，没有任何商品被发布：${message}`;

// ---------------- 整套打包明细 ----------------
/** 编辑中的一行：分类与成色可以暂时为空（不替卖家预选），数量以文本编辑。 */
export interface BundleRow { key: string; itemCode?: string; name: string; category: string; condition: string; quantity: string; note: string }
let rowSeq = 0;
export const emptyBundleRow = (): BundleRow => ({ key: `row-${(rowSeq += 1)}`, name: '', category: '', condition: '', quantity: '1', note: '' });
export function rowsFromItems(items: BundleItemInput[] | undefined | null): BundleRow[] {
  return (items ?? []).map((i) => ({
    key: `row-${(rowSeq += 1)}`, itemCode: i.itemCode, name: i.name ?? '', category: i.category ?? '', condition: i.condition ?? '',
    quantity: i.quantity === undefined || i.quantity === null ? '' : String(i.quantity), note: i.note ?? '',
  }));
}
/** 转成提交体：空字段原样留空，交给服务端逐条校验，前端不替卖家补默认值。 */
export function itemsFromRows(rows: BundleRow[]): BundleItemInput[] {
  return rows.map((r) => {
    const quantity = /^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : (r.quantity as unknown as number);
    const item: Record<string, unknown> = { name: r.name, category: r.category, condition: r.condition, quantity };
    if (r.itemCode) item.itemCode = r.itemCode;
    if (r.note.trim()) item.note = r.note;
    return item as unknown as BundleItemInput;
  });
}
export interface BundleTotals { rows: number; quantity: number; categories: number }
export function rowTotals(rows: BundleRow[]): BundleTotals {
  return { rows: rows.length, quantity: rows.reduce((n, r) => n + (/^\d+$/.test(r.quantity.trim()) ? Number(r.quantity.trim()) : 0), 0), categories: new Set(rows.map((r) => r.category).filter(Boolean)).size };
}
export const rowsSummary = (rows: BundleRow[]) => { const t = rowTotals(rows); return `共 ${t.rows} 行（需要 ${BUNDLE_MIN_ITEMS}～${BUNDLE_MAX_ITEMS} 行）· 包含 ${t.categories} 类 / ${t.quantity} 件`; };
/** 平均每件价格：只用于展示，不参与任何计算。 */
export function averagePerItem(total: number, quantity: number): string | null {
  if (!quantity || !Number.isFinite(total)) return null;
  return (Math.round((total / quantity) * 100) / 100).toFixed(2);
}
/** 草稿里的价格以文本编辑，保存时再转成数字（无法解析的原样交给服务端校验）。 */
export function priceValue(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return /^\d+(\.\d{1,2})?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export interface BundleForm {
  title: string; description: string; price: string; category: string; condition: string; campus: Campus; buildingId: string | null;
  images: string[]; uploading: boolean; contact: string; contactPublic: boolean; rows: BundleRow[]; visibility: ProductVisibility; circleIds: string[];
}
/** 整套打包发布前的检查（与 Web BundleProductForm 逐条一致），返回需要补充的问题清单。 */
export function bundleFormProblems(f: BundleForm): string[] {
  const problems: string[] = [];
  if (!f.title.trim()) problems.push('请填写整套标题');
  if (!f.description.trim()) problems.push('请填写描述');
  if (!/^\d+(\.\d{1,2})?$/.test(f.price.trim())) problems.push('请填写整套总价（最多两位小数）');
  if (!f.category) problems.push('请选择主分类（混合物品请选「其他 / 混合物品」）');
  if (!f.condition) problems.push('请选择整体成色');
  if (!f.images.length) problems.push('请至少上传或选择一张图片');
  if (f.uploading) problems.push('图片还在上传，请稍候再提交');
  if (f.rows.length < BUNDLE_MIN_ITEMS || f.rows.length > BUNDLE_MAX_ITEMS) problems.push(`打包明细需要 ${BUNDLE_MIN_ITEMS}～${BUNDLE_MAX_ITEMS} 行`);
  f.rows.forEach((r, i) => {
    if (!r.name.trim() || !r.category || !r.condition || !/^\d+$/.test(r.quantity.trim())) problems.push(`第 ${i + 1} 行明细还没填完整（名称、分类、成色、数量）`);
  });
  if (f.visibility === 'CIRCLE_ONLY' && !f.circleIds.length) problems.push('圈子可见需要至少选择一个圈子');
  return problems;
}
/** 整套打包的发布请求体（listingKind = BUNDLE；没有商品级验货声明与教材版本）。 */
export function bundleInput(f: BundleForm): ProductInput {
  return {
    listingKind: 'BUNDLE', bundleItems: itemsFromRows(f.rows),
    title: f.title.trim(), description: f.description.trim(), price: Number(f.price), category: f.category as Category,
    condition: f.condition as Condition, campus: f.campus, buildingId: f.buildingId, images: f.images, contact: f.contact.trim(), contactPublic: f.contactPublic,
    visibility: f.visibility, ...(f.visibility === 'CIRCLE_ONLY' ? { circleIds: f.circleIds } : {}),
  };
}
export const categoryOptionLabel = (c: string, bundle: boolean) => bundle && c === '其他' ? '其他 / 混合物品' : c;
export const BUNDLE_CATEGORIES = CATEGORIES;
export const BUNDLE_CONDITIONS = CONDITIONS;

// ---------------- 批量发布中的一件（也用于协助整理） ----------------
export interface DraftForm {
  title: string; description: string; price: string; category: string; condition: string; campus: string; buildingId: string | null;
  images: string[]; contact: string; contactPublic: boolean; declarations: Record<string, { condition: string; note: string }>; rows: BundleRow[];
  visibility: ProductVisibility; circleIds: string[];
}
export function draftFormFrom(payload: ListingPayload): DraftForm {
  const declarations: DraftForm['declarations'] = {};
  for (const item of payload.inspection ?? []) declarations[item.itemCode] = { condition: item.condition, note: item.note ?? '' };
  return {
    title: payload.title ?? '', description: payload.description ?? '',
    price: payload.price === undefined || payload.price === null ? '' : String(payload.price),
    category: String(payload.category ?? ''), condition: String(payload.condition ?? ''), campus: String(payload.campus ?? ''),
    buildingId: payload.buildingId ?? null, images: [...(payload.images ?? [])], contact: payload.contact ?? '', contactPublic: payload.contactPublic === true,
    declarations, rows: rowsFromItems(payload.bundleItems),
    visibility: payload.visibility === 'CIRCLE_ONLY' ? 'CIRCLE_ONLY' : 'PUBLIC', circleIds: [...(payload.circleIds ?? [])],
  };
}
/**
 * 保存草稿的 payload。协助人：以所有者的原内容为底，只覆盖可以整理的字段（联系方式、可见范围等原样保留，服务端也会拒绝改动）。
 * 所有者：以表单为准，保留表单未展示的字段；留空的字段不提交。templateReady=false 时保留原有声明，不因「还没拿到模板」清掉。
 */
export function draftPayload(draft: Pick<ListingDraft, 'payload' | 'draftType'>, form: DraftForm, options: { assistant: boolean; hasTemplate: boolean; templateReady: boolean }): ListingPayload {
  const base: ListingPayload = JSON.parse(JSON.stringify(draft.payload));
  const bundle = draft.draftType === 'BUNDLE';
  const set = (key: keyof ListingPayload, value: unknown) => {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete (base as Record<string, unknown>)[key];
    else (base as Record<string, unknown>)[key] = value;
  };
  set('title', form.title.trim() || undefined);
  set('description', form.description.trim() || undefined);
  set('price', priceValue(form.price));
  set('category', form.category || undefined);
  (base as Record<string, unknown>).buildingId = form.buildingId;
  if (bundle) set('bundleItems', form.rows.length ? itemsFromRows(form.rows) : undefined);
  if (!options.assistant) {
    set('condition', form.condition || undefined);
    set('campus', form.campus || undefined);
    set('images', form.images);
    set('contact', form.contact.trim() || undefined);
    set('contactPublic', form.contactPublic);
    set('visibility', form.visibility === 'CIRCLE_ONLY' ? 'CIRCLE_ONLY' : undefined);
    set('circleIds', form.visibility === 'CIRCLE_ONLY' ? form.circleIds : undefined);
    if (!bundle && options.templateReady) {
      const inspection = Object.entries(form.declarations).filter(([, d]) => d.condition)
        .map(([itemCode, d]) => ({ itemCode, condition: d.condition as NonNullable<ProductInput['inspection']>[number]['condition'], ...(d.note.trim() ? { note: d.note.trim() } : {}) }));
      set('inspection', options.hasTemplate ? inspection : undefined);
    }
  }
  return base;
}
export const draftTitle = (d: Pick<ListingDraft, 'payload' | 'draftType'>) => `${d.payload.title || '未命名'}${d.draftType === 'BUNDLE' ? '（整套）' : ''}`;
export const conflictText = (version: number) => `这件商品已在其他页面或被协助人保存过（最新是第 ${version} 版）。本页的修改没有保存，也不会自动合并；重新加载会显示最新内容并放弃本页未保存的修改。`;

/**
 * 输入框里的邀请码：可以是邀请码本身，也可以是 Web 发出的邀请链接（…#code=…）。
 * 只取出邀请码，放进兑换请求的请求体；不保存。
 */
export function tokenFromInput(raw: string): string {
  const text = raw.trim();
  const match = /[#?&]code=([A-Za-z0-9_%-]{20,200})/.exec(text);
  if (match) { try { return decodeURIComponent(match[1]); } catch { return match[1]; } }
  return text;
}
