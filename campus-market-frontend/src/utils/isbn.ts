/**
 * ISBN 规范化与校验——与后端 textbook/Isbn.java 逐条一致（isbn.test.ts 用同一组号码对照）。
 * 979-0 开头的是乐谱号（ISMN），不是图书 ISBN，一律拒绝（4.8）。
 *
 * <p>前端只用来<b>即时提示</b>格式问题；最终是否合法、目录里有没有这个版本，都以服务端为准。
 * 这里不根据书名猜版本，也不做任何联网查询。
 */

export type IsbnResult =
  | { ok: true; isbn13: string; isbn10: string | null }
  | { ok: false; reason: 'EMPTY' | 'LENGTH' | 'CHARACTERS' | 'PREFIX' | 'ISMN' | 'CHECKSUM' };

/** 979-0 是国际标准乐谱号（ISMN）的号段，不分配给图书。 */
export const ISMN_PREFIX = '9790';

/** 去掉空白与各种连字符（半角、全角、长破折号），末位 x 转大写。 */
export function stripIsbn(raw: string): string {
  return raw.replace(/[\s\-‐-―−－]/g, '').toUpperCase();
}

function valid10(v: string): boolean {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const c = v[i];
    if (c === 'X' && i !== 9) return false;
    sum += (c === 'X' ? 10 : Number(c)) * (10 - i);
  }
  return sum % 11 === 0;
}

function valid13(v: string): boolean {
  let sum = 0;
  for (let i = 0; i < 13; i += 1) sum += Number(v[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

function to13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

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

export function isbnProblem(raw: string): string | null {
  const result = parseIsbn(raw);
  return result.ok ? null : REASON_TEXT[result.reason];
}

/** 展示用分组：978-7-000000-00-0 这样的通用分组无法准确还原，统一 3-10 分段即可。 */
export function formatIsbn(isbn13: string | null | undefined): string {
  if (!isbn13) return '无 ISBN';
  return isbn13.length === 13 ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : isbn13;
}
