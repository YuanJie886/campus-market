import type { BuildingScope } from '../../utils/geo';
import type { ReasonCode } from '../../utils/demand';

/**
 * 离线 Mock 专用的需求匹配规则：文本规范化、评分与档位。
 *
 * <p><b>只允许 Mock 适配层引用。</b>REST 模式下这些结果全部由后端
 * DemandText / DemandScorer 给出，界面不得用这里的函数重新计算分数或档位
 * （模块 3.0A）。源码扫描测试会拒绝任何非 Mock 文件引入本模块。
 *
 * <p>规则与后端逐条对应，并由测试对照同一组输入的结果。
 */

/**
 * Unicode 空白（含全角空格）折叠为单个空格、去首尾空白、转小写。
 * JS 的 \s 本身就覆盖 Unicode 空白，与后端的 (?U)\s 等价。
 */
export function normalizeDemandText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 字面子串包含：% 与 _ 都是普通字符，不是通配符。 */
export function containsKeyword(text: string, keyword: string | null | undefined): boolean {
  return !!keyword && text.includes(keyword);
}

/** 理由码 → 分值。与后端 DemandScorer 的表格一一对应。 */
export const REASON_POINTS: Readonly<Record<ReasonCode, number>> = Object.freeze({
  TEXTBOOK_EXACT: 50,
  KEYWORD_TITLE_EXACT: 50,
  KEYWORD_TITLE: 40,
  KEYWORD_DESCRIPTION: 20,
  CATEGORY: 20,
  SAME_BUILDING: 20,
  SAME_ZONE: 12,
  SAME_CAMPUS: 6,
  PRICE_CLOSE: 10,
});

export interface ScoringSubscription {
  normalizedKeyword: string | null;
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  geoScope: BuildingScope;
  campusId: string | null;
  buildingId: string | null;
  anchorZone: string | null;
  /** 模块 4：精确教材版本订阅 */
  textbookEditionId?: string | null;
}

export interface ScoringProduct {
  normalizedTitle: string;
  normalizedDescription: string;
  category: string;
  price: number;
  campus: string;
  buildingId: string | null;
  zone: string | null;
  /** 模块 4：商品关联的教材版本 */
  textbookEditionId?: string | null;
}

/** 评分。只对已通过全部硬性条件的订阅调用。规则与后端 DemandScorer 相同。 */
export function scoreDemandMatch(s: ScoringSubscription, p: ScoringProduct): { score: number; reasonCodes: ReasonCode[] } {
  const reasons: ReasonCode[] = [];
  // 与后端一致：版本 id 精确相等才算，排在理由第一位；教材版本订阅不带关键词，与关键词理由互斥
  if (s.textbookEditionId && s.textbookEditionId === p.textbookEditionId) reasons.push('TEXTBOOK_EXACT');
  if (s.normalizedKeyword) {
    if (s.normalizedKeyword === p.normalizedTitle) reasons.push('KEYWORD_TITLE_EXACT');
    else if (containsKeyword(p.normalizedTitle, s.normalizedKeyword)) reasons.push('KEYWORD_TITLE');
    else if (containsKeyword(p.normalizedDescription, s.normalizedKeyword)) reasons.push('KEYWORD_DESCRIPTION');
  }
  if (s.category && s.category === p.category) reasons.push('CATEGORY');

  if (s.geoScope === 'BUILDING' || s.geoScope === 'ZONE') {
    if (s.buildingId && s.buildingId === p.buildingId) reasons.push('SAME_BUILDING');
    else if (s.anchorZone && s.anchorZone === p.zone && s.campusId === p.campus) reasons.push('SAME_ZONE');
  } else if (s.geoScope === 'CAMPUS') {
    if (s.campusId && s.campusId === p.campus) reasons.push('SAME_CAMPUS');
  }

  if (s.minPrice !== null && s.maxPrice !== null && s.maxPrice > s.minPrice) {
    const center = (s.minPrice + s.maxPrice) / 2;
    const quarter = (s.maxPrice - s.minPrice) / 4;
    if (Math.abs(p.price - center) <= quarter) reasons.push('PRICE_CLOSE');
  }

  const total = reasons.reduce((sum, code) => sum + REASON_POINTS[code], 0);
  return { score: Math.min(100, total), reasonCodes: reasons };
}

/**
 * 分数 → 展示档位。界面统一只展示档位，不展示原始分数，避免两套口径并存。
 * 档位边界：≥60 高匹配，其余为一般匹配。
 */
export function matchLevel(score: number): 'HIGH' | 'NORMAL' {
  return score >= 60 ? 'HIGH' : 'NORMAL';
}

export const MATCH_LEVEL_LABEL = Object.freeze({ HIGH: '高匹配', NORMAL: '一般匹配' });


/** 与后端 DemandScorer.HIGH_TIER_MIN_SCORE 一致。仅供 Mock 生成 tier 字段。 */
export function mockTier(score: number): 'HIGH' | 'NORMAL' {
  return score >= 60 ? 'HIGH' : 'NORMAL';
}
