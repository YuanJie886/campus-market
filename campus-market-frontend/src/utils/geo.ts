import type { Building } from '../types';

/**
 * 楼栋集市的地理计算与范围规则（模块 1）。
 *
 * <p>这是前端<b>唯一</b>的距离公式与降级顺序定义：Mock 适配层、REST 适配层、
 * 界面提示与校园示意地图全部引用这里。同一套规则一旦在两处各写一遍，
 * 迟早会出现「后端降到园区、前端说降到校区」这种没人能一眼看出的错位。
 *
 * <p>所有距离都是<b>直线估算</b>，基于楼栋与面交点的公共中心点坐标。
 * 不是导航距离，实际路线以校园道路为准。既不引入地图 SDK，也不读取浏览器定位。
 */

/** 地球平均半径（米）。与后端 SQL 中的 Haversine 取同一个值。 */
const EARTH_RADIUS_METERS = 6_371_000;

/** 步行速度，米/分钟。与后端 BuildingFeedService.WALK_METERS_PER_MINUTE 一致。 */
export const WALK_METERS_PER_MINUTE = 80;

export interface Coordinate {
  latitude?: number | null;
  longitude?: number | null;
}

type FixedPoint = { latitude: number; longitude: number };

function hasCoordinates(point: Coordinate | null | undefined): point is Coordinate & FixedPoint {
  return (
    !!point &&
    typeof point.latitude === 'number' && Number.isFinite(point.latitude) &&
    typeof point.longitude === 'number' && Number.isFinite(point.longitude)
  );
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * 两点间的近似直线距离（米）。
 *
 * <p>任一端缺坐标时返回 null，而不是 0——「不知道多远」和「就在眼前」
 * 是完全不同的两件事，返回 0 会让界面显示出一个自信而错误的数字。
 */
export function haversineMeters(from: Coordinate | null | undefined, to: Coordinate | null | undefined): number | null {
  if (!hasCoordinates(from) || !hasCoordinates(to)) return null;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}

/** 直线距离 → 约几分钟步行。至少 1 分钟：不存在「0 分钟」的路程。 */
export function walkMinutes(meters: number | null | undefined): number | null {
  if (typeof meters !== 'number' || !Number.isFinite(meters)) return null;
  return Math.max(1, Math.ceil(meters / WALK_METERS_PER_MINUTE));
}

/* ------------------------------- 范围层级 ------------------------------- */

/** 楼栋集市的范围层级，与后端 BuildingScope 枚举一一对应。 */
export type BuildingScope = 'BUILDING' | 'ZONE' | 'CAMPUS' | 'SCHOOL';

/** 降级顺序的唯一定义。Mock 与 REST 必须完全一致。 */
export const SCOPE_FALLBACK_ORDER: readonly BuildingScope[] = Object.freeze([
  'BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL',
]);

/** 范围的中文名称。仅用于展示，绝不参与任何业务判断。 */
export const SCOPE_LABEL: Readonly<Record<BuildingScope, string>> = Object.freeze({
  BUILDING: '本楼',
  ZONE: '本园区',
  CAMPUS: '本校区',
  SCHOOL: '全校',
});

/** 从某个范围开始的降级链。 */
export function fallbackChain(scope: BuildingScope): BuildingScope[] {
  const start = SCOPE_FALLBACK_ORDER.indexOf(scope);
  return SCOPE_FALLBACK_ORDER.slice(start < 0 ? 0 : start) as BuildingScope[];
}

/**
 * 该范围是否允许自动降级。
 * 只有用户主动开启「只看本楼」时才降级；普通浏览结果为空就是空。
 */
export function allowsFallback(scope: BuildingScope): boolean {
  return scope === 'BUILDING';
}

/* ---------------------------- 面交点推荐 ---------------------------- */

export interface MeetingPointCandidate extends Coordinate {
  id: string;
  name: string;
}

export interface RankedMeetingPoint<T extends MeetingPointCandidate> {
  point: T;
  /** 买家楼栋到该点的直线距离（米）；无法计算时为 null */
  buyerMeters: number | null;
  /** 商品楼栋到该点的直线距离（米）；无法计算时为 null */
  productMeters: number | null;
  /** 两段之和，用于排序；任一段缺失时为 null */
  totalMeters: number | null;
  /** 是否为推荐项（排序第一且距离可算） */
  recommended: boolean;
}

/**
 * 按「买家楼栋 + 商品楼栋到面交点的距离之和」推荐面交点。
 *
 * <p>任一楼栋缺坐标时<b>不做伪精确推荐</b>：保持面交点的原有顺序，
 * 只是把距离字段留空，并且不标记任何一项为推荐。宁可不给建议，
 * 也不能用一个看似精确实则无依据的排序引导用户走错地方。
 *
 * <p>推荐永远只是建议：最终面交点仍由用户确认。
 */
export function rankMeetingPoints<T extends MeetingPointCandidate>(
  points: readonly T[],
  buyerBuilding: Coordinate | null | undefined,
  productBuilding: Coordinate | null | undefined,
): RankedMeetingPoint<T>[] {
  const ranked = points.map((point) => {
    const buyerMeters = haversineMeters(buyerBuilding, point);
    const productMeters = haversineMeters(productBuilding, point);
    const totalMeters =
      buyerMeters === null || productMeters === null ? null : buyerMeters + productMeters;
    return { point, buyerMeters, productMeters, totalMeters, recommended: false };
  });

  const allMeasurable = ranked.every((entry) => entry.totalMeters !== null);
  if (!allMeasurable) return ranked;

  // 距离相同时按 id 收敛，保证同样的输入永远得到同样的顺序
  ranked.sort((a, b) =>
    (a.totalMeters as number) - (b.totalMeters as number) || a.point.id.localeCompare(b.point.id),
  );
  if (ranked.length > 0) ranked[0].recommended = true;
  return ranked;
}

/** 从楼栋列表里查坐标。找不到时返回 null，调用方据此降级。 */
export function buildingCoordinate(
  buildings: readonly Building[],
  buildingId: string | null | undefined,
): Coordinate | null {
  if (!buildingId) return null;
  const building = buildings.find((item) => item.id === buildingId);
  return building ? { latitude: building.latitude, longitude: building.longitude } : null;
}
