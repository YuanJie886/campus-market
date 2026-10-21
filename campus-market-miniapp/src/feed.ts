/**
 * 集市页的范围切换（楼栋集市，见 docs/building-market.md），纯函数，不依赖 Taro，便于测试。
 * - 本楼：GET /v1/products/feed?scope=BUILDING，本楼没有时由服务端按 本楼 → 本园区 → 本校区 → 全校 放宽，筛选条件不变；
 * - 本校区：scope=CAMPUS（本人所在校区），为空就是空，不自动放宽；
 * - 全校：普通浏览（GET /v1/products），与原来完全一样。
 * 宿舍楼只来自本人在资料里填写的楼栋：不定位、不猜。401 → 去登录；409 → 去资料里设置宿舍楼。
 */
import { ApiError } from './api/transport';
import type { BuildingScope, Category, FeedPage, FeedQuery, Query } from './model';

export type MarketScope = Extract<BuildingScope, 'BUILDING' | 'CAMPUS' | 'SCHOOL'>;
export const MARKET_SCOPES: { key: MarketScope; label: string }[] = [
  { key: 'BUILDING', label: '本楼' }, { key: 'CAMPUS', label: '本校区' }, { key: 'SCHOOL', label: '全校' },
];
/** 本人校区还没有启用的楼栋时不显示「本楼」（本校区 / 全校照常）。 */
export const marketScopes = (campusHasBuildings: boolean) => MARKET_SCOPES.filter((s) => campusHasBuildings || s.key !== 'BUILDING');
/** 当前范围在可选范围里没有（例如楼栋目录显示本校区还没有楼栋）时回到「全校」。 */
export const effectiveScope = (scope: MarketScope, campusHasBuildings: boolean): MarketScope => scope === 'BUILDING' && !campusHasBuildings ? 'SCHOOL' : scope;
export const LOGIN_NEEDED = '登录后才能知道你住哪栋楼。我们不会自动定位，也不会替你猜。';
export const DORM_NEEDED = '还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。';
export const NOTHING_ANYWHERE = '全校都没有符合条件的商品。试着放宽筛选，或发布一条求购。';
export const fallbackText = (label: string) => `本楼暂无匹配，已为你展示${label}的商品（筛选条件保持不变）。`;

/** 「全校」走普通列表；其余走 feed。 */
export const usesFeed = (scope: MarketScope) => scope !== 'SCHOOL';

/** 集市页的查询 → feed 查询：关键词、分类、成色、价格、排序逐条保留，只换范围（校区筛选由范围本身决定）。 */
export function feedQueryFrom(query: Query, category: Category | '' | undefined, scope: MarketScope, page: number): FeedQuery {
  const q: FeedQuery = { scope, sort: query.sort, page, pageSize: query.pageSize };
  if (query.keyword) q.keyword = query.keyword;
  if (category) q.category = category;
  if (query.condition) q.condition = query.condition;
  if (query.minPrice !== undefined) q.minPrice = query.minPrice;
  if (query.maxPrice !== undefined) q.maxPrice = query.maxPrice;
  return q;
}

/** 401 / 409 不是「出错了」，而是「还差一步」：给出可执行的引导。 */
export function feedAction(error: unknown): 'login' | 'set-dorm-building' | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 401) return 'login';
  if (error.code === 409) return 'set-dorm-building';
  return null;
}

/** 结果上方的提示：已放宽（非阻塞）或全校都没有；其余情况不提示。 */
export function feedNotice(page: Pick<FeedPage, 'requestedScope' | 'fallbackApplied' | 'effectiveScopeLabel' | 'total'> | null): string {
  if (!page || page.requestedScope !== 'BUILDING') return '';
  if (page.fallbackApplied && page.total > 0) return fallbackText(page.effectiveScopeLabel);
  if (page.total === 0) return NOTHING_ANYWHERE;
  return '';
}

/** feed 商品卡片上的距离：同楼栋不显示距离，缺坐标不显示，其余写成约几分钟步行（直线估算）。 */
export function distanceText(item: { sameBuilding?: boolean; approximateWalkMinutes?: number | null }): string {
  if (item.sameBuilding) return '同楼栋';
  return typeof item.approximateWalkMinutes === 'number' ? `约 ${item.approximateWalkMinutes} 分钟步行` : '';
}
