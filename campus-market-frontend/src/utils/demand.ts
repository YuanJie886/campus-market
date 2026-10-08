import { SCOPE_LABEL, type BuildingScope } from './geo';

/**
 * 需求雷达的前端<b>展示</b>规则：理由码与档位的中文映射、条件描述、输入长度限制。
 *
 * <p>这里刻意<b>没有</b>任何评分或档位推导逻辑（模块 3.0A）：REST 模式下分数、档位、
 * 理由码全部由服务端给出，界面只负责把机器码映射成文字与样式。
 * 离线 Mock 需要自己评分，那份实现放在 api/mock/demandScoring.ts，
 * 并有源码扫描保证非 Mock 代码不会引用它。
 */

/** 规范化后的关键词最大长度，与后端 DemandText.MAX_KEYWORD_LENGTH 一致。 */
export const MAX_KEYWORD_LENGTH = 40;

/** 每位用户同时启用的订阅上限，与后端一致。 */
export const MAX_ACTIVE_SUBSCRIPTIONS = 50;

export type ReasonCode =
  | 'TEXTBOOK_EXACT'
  | 'KEYWORD_TITLE_EXACT' | 'KEYWORD_TITLE' | 'KEYWORD_DESCRIPTION'
  | 'CATEGORY' | 'SAME_BUILDING' | 'SAME_ZONE' | 'SAME_CAMPUS' | 'PRICE_CLOSE';

/** 理由码的中文展示。中文只在这里出现，从不参与任何判断。 */
export const REASON_LABEL: Readonly<Record<ReasonCode, string>> = Object.freeze({
  TEXTBOOK_EXACT: '正是你订阅的教材版本',
  KEYWORD_TITLE_EXACT: '标题与关键词完全一致',
  KEYWORD_TITLE: '标题包含关键词',
  KEYWORD_DESCRIPTION: '描述包含关键词',
  CATEGORY: '分类相符',
  SAME_BUILDING: '同一栋楼',
  SAME_ZONE: '同一园区',
  SAME_CAMPUS: '同一校区',
  PRICE_CLOSE: '价格接近预算中心',
});

/**
 * 理由码 → 文案。服务端将来新增理由码时，旧前端不应报错或显示空白：
 * 未知的码安全降级为通用说法。
 */
export function reasonLabel(code: string): string {
  return (REASON_LABEL as Record<string, string>)[code] ?? '其他匹配理由';
}

/** 服务端给出的匹配档位。 */
export type MatchTier = 'HIGH' | 'NORMAL';

export const TIER_LABEL: Readonly<Record<MatchTier, string>> = Object.freeze({ HIGH: '高匹配', NORMAL: '一般匹配' });

/** 档位 → 文案。未知档位同样安全降级，不回退到用分数自行推导。 */
export function tierLabel(tier: string): string {
  return (TIER_LABEL as Record<string, string>)[tier] ?? '匹配';
}

/* ---------------------------- 条件的展示 ---------------------------- */


export interface DescribableConditions {
  keyword?: string | null;
  category?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  geoScope?: BuildingScope | null;
  campusId?: string | null;
  zone?: string | null;
  buildingName?: string | null;
  /** 模块 4：精确教材版本订阅 */
  textbook?: { title: string; editionLabel: string; isbn?: string | null } | null;
  /** 模块 6：圈子范围订阅 */
  circle?: { id: string; name: string | null } | null;
}

/** 地理范围的明确说明：不只写「本楼」，而是写清是哪一栋楼、哪个园区。 */
export function describeScope(c: DescribableConditions): string {
  // 模块 6：圈子订阅的范围就是这个圈子，写出具体圈子名称
  if (c.circle) return `圈子：${c.circle.name ?? '已不可见的圈子'}`;
  switch (c.geoScope ?? 'SCHOOL') {
    case 'BUILDING': return `${SCOPE_LABEL.BUILDING}：${c.zone ?? ''}${c.buildingName ?? ''}`;
    case 'ZONE': return `${SCOPE_LABEL.ZONE}：${c.campusId ?? ''}${c.zone ?? ''}`;
    case 'CAMPUS': return `${SCOPE_LABEL.CAMPUS}：${c.campusId ?? ''}`;
    default: return SCOPE_LABEL.SCHOOL;
  }
}

/** 一行文字描述订阅条件，用于收件箱与订阅管理。 */
export function describeConditions(c: DescribableConditions): string {
  const parts: string[] = [];
  // 精确版本订阅：写出具体版本，而不是只写「教材书籍」
  if (c.textbook) parts.push(`教材《${c.textbook.title}》${c.textbook.editionLabel}${c.textbook.isbn ? `（ISBN ${c.textbook.isbn}）` : ''}`);
  if (c.keyword) parts.push(`关键词「${c.keyword}」`);
  if (c.category) parts.push(c.category);
  if (c.minPrice != null && c.maxPrice != null) parts.push(`¥${c.minPrice}–¥${c.maxPrice}`);
  else if (c.minPrice != null) parts.push(`¥${c.minPrice} 起`);
  else if (c.maxPrice != null) parts.push(`¥${c.maxPrice} 以内`);
  parts.push(describeScope(c));
  return parts.join(' · ');
}
