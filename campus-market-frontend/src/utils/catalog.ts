/**
 * 课程教材图谱（模块 4）的展示映射。机器码 → 中文只在这里；未知码安全降级。
 */
import type { Term, TextbookUsage } from '../api/contracts';

/** 固定说明：目录是虚构的演示数据，不来自任何学校教务系统。 */
export const DEMO_CATALOG_NOTE = '当前为演示目录：课程与教材均为虚构数据，不来自任何学校的教务系统，也不代表真实课程安排。';
/** 固定说明：普通用户的建议不会自动公开。 */
export const SUGGESTION_NOTE = '建议只有你自己能看到，不会出现在公开的课程页上，也不会自动变成正式教材。正式上线前需要可信的审核入口。';

const TERM_LABEL: Record<Term, string> = { SPRING: '春季学期', SUMMER: '夏季学期', AUTUMN: '秋季学期', WINTER: '冬季学期' };
export const TERM_OPTIONS: Term[] = ['AUTUMN', 'SPRING', 'SUMMER', 'WINTER'];
export function termLabel(code: string | null | undefined): string {
  return (code && TERM_LABEL[code as Term]) || '学期未知';
}

const USAGE_LABEL: Record<TextbookUsage, string> = { REQUIRED: '指定教材', RECOMMENDED: '推荐教材', REFERENCE: '参考书' };
export const USAGE_OPTIONS: TextbookUsage[] = ['REQUIRED', 'RECOMMENDED', 'REFERENCE'];
export function usageLabel(code: string | null | undefined): string {
  return (code && USAGE_LABEL[code as TextbookUsage]) || '用途未知';
}

const SUGGESTION_STATUS_LABEL: Record<string, string> = { PENDING: '待审核（未公开）', WITHDRAWN: '已撤回' };
export function suggestionStatusLabel(code: string | null | undefined): string {
  return (code && SUGGESTION_STATUS_LABEL[code]) || '状态未知';
}

export function offeringLabel(o: { academicYear: string; term: string; instructorName?: string | null }): string {
  return `${o.academicYear} ${termLabel(o.term)}${o.instructorName ? ` · ${o.instructorName}` : ''}`;
}
