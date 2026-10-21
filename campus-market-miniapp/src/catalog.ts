/**
 * 课程教材（纯函数，不依赖 Taro，便于测试），与 Web utils/catalog.ts、utils/isbn.ts、教材各页一致。
 * ISBN 规则与后端 textbook/Isbn.java 逐条一致；前端只做即时提示，是否合法、目录里有没有都以服务端为准。
 */
import type { Term, TextbookEdition, TextbookSuggestionInput, TextbookUsage } from './model';

export const DEMO_CATALOG_NOTE = '当前为演示目录：课程与教材均为虚构数据，不来自任何学校的教务系统，也不代表真实课程安排。';
export const SUGGESTION_NOTE = '建议只有你自己能看到，不会出现在公开的课程页上，也不会自动变成正式教材。正式上线前需要可信的审核入口。';
export const COURSES_INTRO = '按课程找到指定的教材版本，再看本校有没有同版本在卖。';
export const ISBN_HELP = '输入书背面的 ISBN（可以带空格或连字符），在本校教材目录里查到对应版本后由你确认。系统不会根据书名替你选择版本。';
export const ISBN_NOT_FOUND = '本校教材目录中没有这个 ISBN。可以不关联教材目录继续发布，买家只会看到你填写的标题和描述。';
export const ISBN_CONFIRM_NOTE = '请对照书的封面与版权页。版次不同就是不同的书，买家会按这个版本查找。';
export const ISBN_DEMO_NOTE = '这是演示目录中的虚构教材。';
export const TEXTBOOK_CHANGED_NOTE = '更换或解除后，买家在商品页看到的教材版本信息会随之变化。';
export const OTHER_EDITIONS_NOTE = '以下是同一部教材的其他版次，内容与页码可能不同。请先确认课程是否接受这些版本再购买。';
export const SUGGESTION_NOTE_HELP = '请不要填写姓名、学号、联系方式';

const TERM_LABEL: Record<Term, string> = { SPRING: '春季学期', SUMMER: '夏季学期', AUTUMN: '秋季学期', WINTER: '冬季学期' };
export const TERM_OPTIONS: Term[] = ['AUTUMN', 'SPRING', 'SUMMER', 'WINTER'];
export const termLabel = (code: string | null | undefined) => (code && TERM_LABEL[code as Term]) || '学期未知';
const USAGE_LABEL: Record<TextbookUsage, string> = { REQUIRED: '指定教材', RECOMMENDED: '推荐教材', REFERENCE: '参考书' };
export const USAGE_OPTIONS: TextbookUsage[] = ['REQUIRED', 'RECOMMENDED', 'REFERENCE'];
export const usageLabel = (code: string | null | undefined) => (code && USAGE_LABEL[code as TextbookUsage]) || '用途未知';
const SUGGESTION_STATUS_LABEL: Record<string, string> = { PENDING: '待审核（未公开）', WITHDRAWN: '已撤回' };
export const suggestionStatusLabel = (code: string | null | undefined) => (code && SUGGESTION_STATUS_LABEL[code]) || '状态未知';
export const offeringLabel = (o: { academicYear: string; term: string; instructorName?: string | null }) => `${o.academicYear} ${termLabel(o.term)}${o.instructorName ? ` · ${o.instructorName}` : ''}`;

// ---------------- ISBN ----------------
export type IsbnResult = { ok: true; isbn13: string; isbn10: string | null } | { ok: false; reason: 'EMPTY' | 'LENGTH' | 'CHARACTERS' | 'PREFIX' | 'ISMN' | 'CHECKSUM' };
/** 979-0 是国际标准乐谱号（ISMN）的号段，不分配给图书。 */
export const ISMN_PREFIX = '9790';
export const stripIsbn = (raw: string) => raw.replace(/[\s\-‐-―−－]/g, '').toUpperCase();
function valid10(v: string) { let sum = 0; for (let i = 0; i < 10; i += 1) { const c = v[i]; if (c === 'X' && i !== 9) return false; sum += (c === 'X' ? 10 : Number(c)) * (10 - i); } return sum % 11 === 0; }
function valid13(v: string) { let sum = 0; for (let i = 0; i < 13; i += 1) sum += Number(v[i]) * (i % 2 === 0 ? 1 : 3); return sum % 10 === 0; }
function to13(isbn10: string) { const body = `978${isbn10.slice(0, 9)}`; let sum = 0; for (let i = 0; i < 12; i += 1) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3); return `${body}${(10 - (sum % 10)) % 10}`; }
export function parseIsbn(raw: string): IsbnResult {
  const v = stripIsbn(raw);
  if (!v) return { ok: false, reason: 'EMPTY' };
  if (v.length === 10) {
    if (!/^[0-9]{9}[0-9X]$/.test(v)) return { ok: false, reason: 'CHARACTERS' };
    if (!valid10(v)) return { ok: false, reason: 'CHECKSUM' };
    return { ok: true, isbn10: v, isbn13: to13(v) };
  }
  if (v.length === 13) {
    if (!/^[0-9]{13}$/.test(v)) return { ok: false, reason: 'CHARACTERS' };
    if (!v.startsWith('978') && !v.startsWith('979')) return { ok: false, reason: 'PREFIX' };
    if (v.startsWith(ISMN_PREFIX)) return { ok: false, reason: 'ISMN' };
    if (!valid13(v)) return { ok: false, reason: 'CHECKSUM' };
    return { ok: true, isbn10: null, isbn13: v };
  }
  return { ok: false, reason: 'LENGTH' };
}
const REASON_TEXT: Record<Exclude<IsbnResult, { ok: true }>['reason'], string> = {
  EMPTY: '请输入 ISBN',
  LENGTH: 'ISBN 应为 10 位或 13 位（可以包含空格或连字符）',
  CHARACTERS: 'ISBN 只能包含数字，ISBN-10 的末位可以是 X',
  PREFIX: 'ISBN-13 应以 978 或 979 开头',
  ISMN: '979-0 开头的是乐谱号（ISMN），不是图书 ISBN，请核对号码',
  CHECKSUM: '校验位不正确，请核对号码',
};
export function isbnProblem(raw: string): string | null { const r = parseIsbn(raw); return r.ok ? null : REASON_TEXT[r.reason]; }
export const formatIsbn = (isbn13: string | null | undefined) => !isbn13 ? '无 ISBN' : isbn13.length === 13 ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : isbn13;
export const describeLinked = (e: { title: string; editionLabel: string; isbn: string | null }) => e.isbn ? `${e.title} ${e.editionLabel} · ISBN ${formatIsbn(e.isbn)}` : `${e.title} ${e.editionLabel} · 无 ISBN`;
export const editionLines = (e: Pick<TextbookEdition, 'isbn' | 'authors' | 'publisher' | 'publishedYear'>) => [
  `ISBN ${formatIsbn(e.isbn)}`, `作者 ${e.authors.join('、')}`, `出版社 ${e.publisher}${e.publishedYear ? ` · ${e.publishedYear} 年` : ''}`,
];

// ---------------- 教材建议 ----------------
export interface SuggestionForm { offeringId: string; mode: 'isbn' | 'metadata'; isbn: string; title: string; authors: string; publisher: string; editionLabel: string; usage: TextbookUsage; note: string }
/** 提交前的检查（与 Web TextbookSuggestionDialog.validate 一致），返回出错的字段与文案。 */
export function suggestionProblems(f: SuggestionForm): Record<string, string> {
  const next: Record<string, string> = {};
  if (!f.offeringId) next.offering = '请选择开课学期';
  if (f.mode === 'isbn') { const problem = isbnProblem(f.isbn); if (problem) next.isbn = problem; }
  else {
    if (!f.title.trim()) next.title = '请填写书名';
    if (!f.publisher.trim()) next.publisher = '没有 ISBN 时请填写出版社';
    if (!f.editionLabel.trim()) next.edition = '没有 ISBN 时请填写版次';
  }
  return next;
}
export function suggestionInput(f: SuggestionForm): TextbookSuggestionInput {
  const input: TextbookSuggestionInput = f.mode === 'isbn'
    ? { courseOfferingId: f.offeringId, isbn: f.isbn, usageType: f.usage }
    : { courseOfferingId: f.offeringId, title: f.title, publisher: f.publisher, editionLabel: f.editionLabel, ...(f.authors.trim() ? { authors: f.authors } : {}), usageType: f.usage };
  if (f.note.trim()) input.note = f.note.trim();
  return input;
}
export const suggestionDoneText = (outcome: 'CREATED' | 'EXISTING') => outcome === 'EXISTING' ? '你已经提交过相同的建议' : '建议已提交，状态为「待审核（未公开）」';
