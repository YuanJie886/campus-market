import type { DemandConditions, FeedPage, FeedQuery } from '../api/contracts';
import type { Campus, FilterState } from '../types';
import type { BuildingScope } from './geo';

/**
 * 首页的范围切换：本楼 / 本校区 / 全校。语义、降级与文案与小程序 src/feed.ts 一一对应（小程序是主产品，Web 对齐它）：
 *   · 本楼：GET /v1/products/feed?scope=BUILDING。本楼没有时由服务端按 本楼 → 本园区 → 本校区 → 全校 放宽，筛选条件不变；
 *   · 本校区：scope=CAMPUS（本人所在校区），为空就是空，不自动放宽；
 *   · 全校：普通浏览（原来的商品列表），与原来完全一样。
 * 宿舍楼只来自本人在资料里填写的楼栋：不定位、不猜。401 → 去登录；409 → 去资料里设置宿舍楼。
 */
export type MarketScope = Extract<BuildingScope, 'BUILDING' | 'CAMPUS' | 'SCHOOL'>;

export const MARKET_SCOPES: readonly { key: MarketScope; label: string }[] = [
  { key: 'BUILDING', label: '本楼' },
  { key: 'CAMPUS', label: '本校区' },
  { key: 'SCHOOL', label: '全校' },
];
export const DEFAULT_MARKET_SCOPE: MarketScope = 'SCHOOL';

export const LOGIN_NEEDED = '登录后才能知道你住哪栋楼。我们不会自动定位，也不会替你猜。';
export const DORM_NEEDED = '还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。';
export const NOTHING_ANYWHERE = '全校都没有符合条件的商品。试着放宽筛选，或发布一条求购。';
export const fallbackText = (label: string) => `本楼暂无匹配，已为你展示${label}的商品（筛选条件保持不变）。`;

/** 空态（与小程序集市页一致） */
export const EMPTY_TITLE = '暂时没有找到合适的好物';
export const EMPTY_DESCRIPTION = '换个关键词，或者放宽筛选条件试试。';

/** feed 每页条数（后端上限 100） */
export const FEED_PAGE_SIZE = 40;

/** 「全校」走普通列表；其余走 feed。 */
export const usesFeed = (scope: MarketScope): boolean => scope !== 'SCHOOL';

/**
 * 首页筛选 → feed 查询：关键词、分类、成色、价格、排序逐条保留，只换范围。
 * 校区筛选不下发——范围本身决定了校区（与小程序 feedQueryFrom 相同）。
 */
export function feedQueryFrom(filter: FilterState, scope: MarketScope, page: number, pageSize = FEED_PAGE_SIZE): FeedQuery {
  const query: FeedQuery = { scope, sort: filter.sort, page, pageSize };
  const keyword = filter.keyword.trim();
  if (keyword) query.keyword = keyword;
  if (filter.category !== '全部') query.category = filter.category;
  if (filter.condition !== '全部') query.condition = filter.condition;
  if (filter.minPrice !== '') query.minPrice = Number(filter.minPrice);
  if (filter.maxPrice !== '') query.maxPrice = Number(filter.maxPrice);
  return query;
}

/** 结果上方的提示：已放宽（非阻塞）或全校都没有；其余情况（含「本校区」为空）不提示。 */
export function feedNotice(page: Pick<FeedPage, 'requestedScope' | 'fallbackApplied' | 'effectiveScopeLabel' | 'total'> | null): string {
  if (!page || page.requestedScope !== 'BUILDING') return '';
  if (page.fallbackApplied && page.total > 0) return fallbackText(page.effectiveScopeLabel);
  if (page.total === 0) return NOTHING_ANYWHERE;
  return '';
}

/**
 * 空态订阅的预填（与小程序 demandPrefill 相同）：地理范围取自<b>状态</b>，不取任何展示文案。
 * 「本楼」省略 buildingId 即使用本人宿舍楼；「本校区」就是本人所在校区；全校浏览时按校区筛选同样记为校区范围。
 */
export function demandPrefillFor(filter: FilterState, scope: MarketScope, userCampus: Campus): DemandConditions {
  const building = scope === 'BUILDING';
  const campus: Campus | null = building ? null : scope === 'CAMPUS' ? userCampus : filter.campus === '全部' ? null : filter.campus;
  return {
    keyword: filter.keyword.trim() || null,
    category: filter.category === '全部' ? null : filter.category,
    minPrice: filter.minPrice === '' ? null : Number(filter.minPrice),
    maxPrice: filter.maxPrice === '' ? null : Number(filter.maxPrice),
    geoScope: building ? 'BUILDING' : campus ? 'CAMPUS' : 'SCHOOL',
    campusId: campus,
    buildingId: null,
  };
}

/**
 * 小程序的集市是常驻的 tab 页：去看商品详情再回来，范围保持不变，直到小程序被关闭。
 * Web 的首页会随路由卸载，因此把所选范围记在 sessionStorage（只在本标签页、本次会话内有效，关闭即消失）。
 * 只存范围本身，不含任何个人信息。
 */
export const MARKET_SCOPE_KEY = 'campus_market_scope_v1';

export function readStoredScope(): MarketScope {
  try {
    const raw = window.sessionStorage.getItem(MARKET_SCOPE_KEY);
    return MARKET_SCOPES.some((s) => s.key === raw) ? (raw as MarketScope) : DEFAULT_MARKET_SCOPE;
  } catch {
    return DEFAULT_MARKET_SCOPE;
  }
}

export function storeScope(scope: MarketScope): void {
  try { window.sessionStorage.setItem(MARKET_SCOPE_KEY, scope) } catch { /* 隐私模式可忽略 */ }
}
