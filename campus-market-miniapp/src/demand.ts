/**
 * 需求订阅的展示与表单规则（纯函数，不依赖 Taro，便于测试），与 Web utils/demand.ts、DemandSubscribeDialog、DemandsPage 一致。
 * 这里没有任何评分或档位推导：分数、档位、理由码全部由服务端给出，界面只把机器码映射成文字。
 */
import { CATEGORIES, type BuildingScope, type Campus, type Category, type DemandConditions, type DemandSubscribeResult } from './model';

/** 规范化后的关键词最大长度（与后端 DemandText.MAX_KEYWORD_LENGTH 一致）。 */
export const MAX_KEYWORD_LENGTH = 40;
/** 每位用户同时启用的订阅上限。 */
export const MAX_ACTIVE_SUBSCRIPTIONS = 50;

export const SCOPE_ORDER: BuildingScope[] = ['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL'];
export const SCOPE_LABEL: Record<BuildingScope, string> = { BUILDING: '本楼', ZONE: '本园区', CAMPUS: '本校区', SCHOOL: '全校' };

const REASON_LABEL: Record<string, string> = {
  TEXTBOOK_EXACT: '正是你订阅的教材版本',
  KEYWORD_TITLE_EXACT: '标题与关键词完全一致',
  KEYWORD_TITLE: '标题包含关键词',
  KEYWORD_DESCRIPTION: '描述包含关键词',
  CATEGORY: '分类相符',
  SAME_BUILDING: '同一栋楼',
  SAME_ZONE: '同一园区',
  SAME_CAMPUS: '同一校区',
  PRICE_CLOSE: '价格接近预算中心',
};
/** 服务端将来新增的理由码安全降级为通用说法。 */
export const reasonLabel = (code: string) => REASON_LABEL[code] ?? '其他匹配理由';
const TIER_LABEL: Record<string, string> = { HIGH: '高匹配', NORMAL: '一般匹配' };
export const tierLabel = (tier: string) => TIER_LABEL[tier] ?? '匹配';
export const INVALID_LABEL = { NO_LONGER_MATCHES: '已不再符合你的条件', NOT_ON_SALE: '已售出或下架，暂不可联系' } as const;

export const DEMANDS_INTRO = '你订阅的条件有新商品命中时会出现在这里。只在站内提醒，不发短信、微信或系统通知。';
export const FORM_INTRO = '有新商品符合条件时，会出现在「需求匹配」里。不会发短信、微信或系统通知。';
export const FORM_RULES = ['按关键词字面匹配：「耳机」能匹配「蓝牙耳机」，但不会匹配同义词。', '只匹配之后新发布或新编辑的商品，不回查已有商品。', '不保证一定能收到匹配。'];
export const NO_MATCHES = '还没有匹配。在首页搜索没有结果时，可以直接订阅那个需求。';
export const NO_SUBSCRIPTIONS = '还没有订阅。';
export const EMPTY_CTA = '没有找到？订阅一下，有货第一时间通知你。';
export const DELETED_DONE = '已删除这条订阅，历史匹配仍会保留';
export const TEXTBOOK_SUBSCRIBE_NOTE = '只匹配关联了这个版本的商品，不按书名猜测；同名书的其他版次不会通知你。';
export const circleScopeText = (name: string | null) => `范围：只匹配圈子「${name ?? '已不可见的圈子'}」里新发布的商品（范围固定，不能修改）。退出圈子后这条订阅会自动停用。`;

export interface DescribableConditions {
  keyword?: string | null; category?: string | null; minPrice?: number | null; maxPrice?: number | null;
  geoScope?: BuildingScope | null; campusId?: string | null; zone?: string | null; buildingName?: string | null;
  textbook?: { title: string; editionLabel: string; isbn?: string | null } | null;
  circle?: { id: string; name: string | null } | null;
}
/** 校区 id → 显示名称（页面传入 campusLabel；缺省原样显示）。 */
export type CampusLabeler = (id: string | null | undefined) => string;
const rawLabel: CampusLabeler = (id) => id ?? '';
/** 地理范围写清是哪一栋楼、哪个园区；校区显示名称，不显示 id。 */
export function describeScope(c: DescribableConditions, label: CampusLabeler = rawLabel): string {
  if (c.circle) return `圈子：${c.circle.name ?? '已不可见的圈子'}`;
  switch (c.geoScope ?? 'SCHOOL') {
    case 'BUILDING': return `${SCOPE_LABEL.BUILDING}：${c.zone ?? ''}${c.buildingName ?? ''}`;
    case 'ZONE': return `${SCOPE_LABEL.ZONE}：${label(c.campusId)}${c.zone ?? ''}`;
    case 'CAMPUS': return `${SCOPE_LABEL.CAMPUS}：${label(c.campusId)}`;
    default: return SCOPE_LABEL.SCHOOL;
  }
}
export function describeConditions(c: DescribableConditions, label: CampusLabeler = rawLabel): string {
  const parts: string[] = [];
  if (c.textbook) parts.push(`教材《${c.textbook.title}》${c.textbook.editionLabel}${c.textbook.isbn ? `（ISBN ${c.textbook.isbn}）` : ''}`);
  if (c.keyword) parts.push(`关键词「${c.keyword}」`);
  if (c.category) parts.push(c.category);
  if (c.minPrice != null && c.maxPrice != null) parts.push(`¥${c.minPrice}–¥${c.maxPrice}`);
  else if (c.minPrice != null) parts.push(`¥${c.minPrice} 起`);
  else if (c.maxPrice != null) parts.push(`¥${c.maxPrice} 以内`);
  parts.push(describeScope(c, label));
  return parts.join(' · ');
}

export interface DemandForm { keyword: string; category: Category | ''; minPrice: string; maxPrice: string; geoScope: BuildingScope; campusId: Campus; buildingId: string | null }
export function demandFormFrom(initial: DemandConditions, userCampus: Campus): DemandForm {
  return {
    keyword: initial.keyword ?? '', category: (initial.category as Category) ?? '',
    minPrice: initial.minPrice != null ? String(initial.minPrice) : '', maxPrice: initial.maxPrice != null ? String(initial.maxPrice) : '',
    geoScope: initial.geoScope ?? 'SCHOOL', campusId: initial.campusId ?? userCampus, buildingId: initial.buildingId ?? null,
  };
}
/**
 * 提交前的检查与请求体（与 Web DemandSubscribeDialog.submit 逐条一致）：
 * 只提交当前范围需要的锚点；圈子订阅范围固定为全校（服务端按圈子限定）。
 */
export function demandSubmit(f: DemandForm, circleScope = false): { error: string } | { conditions: DemandConditions } {
  if (!f.keyword.trim() && !f.category) return { error: '请至少填写关键词或选择分类' };
  const min = f.minPrice === '' ? null : Number(f.minPrice);
  const max = f.maxPrice === '' ? null : Number(f.maxPrice);
  if ((min !== null && (Number.isNaN(min) || min < 0)) || (max !== null && (Number.isNaN(max) || max < 0))) return { error: '价格需为非负数' };
  if (min !== null && max !== null && min > max) return { error: '最低价不能高于最高价' };
  if (circleScope) return { conditions: { keyword: f.keyword.trim() || null, category: f.category || null, minPrice: min, maxPrice: max, geoScope: 'SCHOOL', campusId: null, buildingId: null } };
  return { conditions: {
    keyword: f.keyword.trim() || null, category: f.category || null, minPrice: min, maxPrice: max, geoScope: f.geoScope,
    campusId: f.geoScope === 'CAMPUS' ? f.campusId : null,
    buildingId: f.geoScope === 'BUILDING' || f.geoScope === 'ZONE' ? f.buildingId : null,
  } };
}
export function subscribeResultText(result: Pick<DemandSubscribeResult, 'outcome'>): string {
  return result.outcome === 'EXISTING' ? '你已经订阅过相同条件，没有重复创建' : '订阅成功，有匹配的新商品时会出现在「需求匹配」里';
}

/** 搜索空态的预填：地理范围取自状态（范围开关、校区筛选），不取展示文案。 */
export function demandPrefill(filter: { keyword?: string; category?: Category | ''; minPrice?: number; maxPrice?: number; campus?: Campus }, scope: BuildingScope, userCampus: Campus): DemandConditions {
  const building = scope === 'BUILDING';
  // 「本校区」范围就是本人所在校区；全校浏览时按校区筛选同样记为校区范围
  const campus = building ? null : scope === 'CAMPUS' ? userCampus : filter.campus ?? null;
  return {
    keyword: filter.keyword?.trim() || null, category: filter.category || null,
    minPrice: filter.minPrice ?? null, maxPrice: filter.maxPrice ?? null,
    geoScope: building ? 'BUILDING' : campus ? 'CAMPUS' : 'SCHOOL', campusId: campus, buildingId: null,
  };
}

/** 教材版本订阅：没有宿舍楼时只能选校区 / 全校，不替用户猜楼栋。 */
export const textbookScopes = (hasDorm: boolean) => SCOPE_ORDER.filter((s) => hasDorm || s === 'CAMPUS' || s === 'SCHOOL');
export function textbookSubscribeInput(editionId: string, scope: BuildingScope, maxPrice: string): { error: string } | { conditions: DemandConditions } {
  const price = maxPrice.trim() === '' ? null : Number(maxPrice);
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: '预算应为不小于 0 的数字' };
  return { conditions: { textbookEditionId: editionId, geoScope: scope, ...(price !== null ? { maxPrice: price } : {}) } };
}
export const textbookSubscribedText = (r: Pick<DemandSubscribeResult, 'outcome'>) => r.outcome === 'EXISTING' ? '你已经订阅过这个版本' : '已订阅：有同版本的新货时会出现在「需求匹配」里';
export const circleSubscribedText = (r: Pick<DemandSubscribeResult, 'outcome'>) => r.outcome === 'EXISTING' ? '已有相同的圈子订阅' : '已订阅这个圈子的新商品，可在「需求匹配」里查看';

export const DEMAND_CATEGORIES = CATEGORIES;
