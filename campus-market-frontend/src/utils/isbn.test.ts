import { describe, expect, it } from 'vitest';
import { formatIsbn, isbnProblem, parseIsbn, stripIsbn } from './isbn';

/** 与后端 IsbnTest 同一组号码：两端的规范化与校验结果必须一致。 */
describe('ISBN 规范化与校验（与后端 Isbn.java 对照）', () => {
  it('规范化：空格、半角 / 全角连字符去掉，末位 x 转大写，ISBN-10 转为规范 ISBN-13', () => {
    expect(parseIsbn('978-0-306-40615-7')).toEqual({ ok: true, isbn10: null, isbn13: '9780306406157' });
    expect(parseIsbn(' 978 0306 40615 7 ')).toMatchObject({ ok: true, isbn13: '9780306406157' });
    expect(parseIsbn('978－0－306－40615－7')).toMatchObject({ ok: true, isbn13: '9780306406157' });
    expect(parseIsbn('0-8044-2957-x')).toEqual({ ok: true, isbn10: '080442957X', isbn13: '9780804429573' });
    expect(parseIsbn('0306406152')).toMatchObject({ ok: true, isbn13: '9780306406157' });
    expect(parseIsbn('979-10-90636-07-1')).toMatchObject({ ok: true, isbn13: '9791090636071' });
    expect(parseIsbn('979-8-6500-0001-3')).toMatchObject({ ok: true, isbn13: '9798650000013' });
    expect(stripIsbn('97 9-0')).toBe('9790');
  });

  it('校验位 / 长度 / 前缀 / X 位置错误一律拒绝，并给出可读原因', () => {
    for (const bad of ['9780306406158', '0306406153', '978030640615', '1234567890123', '08044X2957', 'abc', '']) {
      expect(parseIsbn(bad).ok, bad).toBe(false);
    }
    expect(isbnProblem('9780306406158')).toContain('校验位');
    expect(isbnProblem('1234567890123')).toContain('978');
    expect(isbnProblem('')).toBe('请输入 ISBN');
    expect(formatIsbn('9780306406157')).toBe('978-0306406157');
    expect(formatIsbn(null)).toBe('无 ISBN');
  });

  it('4.8：979-0 是乐谱号（ISMN）号段——即使校验位合法也不是图书 ISBN', () => {
    for (const ismn of ['9790000001022', '979-0-000001-01-5', '979 0 000001 03 9']) {
      expect(parseIsbn(ismn), ismn).toEqual({ ok: false, reason: 'ISMN' });
      expect(isbnProblem(ismn)).toContain('乐谱号');
    }
  });
});
