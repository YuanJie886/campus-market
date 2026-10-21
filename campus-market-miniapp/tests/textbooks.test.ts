import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { RestApi } from '../src/api/rest';
import { Transport, type RequestPort } from '../src/api/transport';
import { describeLinked, formatIsbn, isbnProblem, parseIsbn, suggestionDoneText, suggestionInput, suggestionProblems, type SuggestionForm } from '../src/catalog';
import { textbookScopes, textbookSubscribeInput } from '../src/demand';
import { listingInput } from '../src/listing';
import type { ProductInput } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}
const BLOCKED = '内容可能包含违规信息，请修改后再提交';
const form = (part: Partial<SuggestionForm> = {}): SuggestionForm => ({ offeringId: 'demo-calculus-1-2026a', mode: 'isbn', isbn: '', title: '', authors: '', publisher: '', editionLabel: '', usage: 'REQUIRED', note: '', ...part });

describe('ISBN：与后端 Isbn.java 逐条一致', () => {
  it('规范化、ISBN-10 转 13、校验位、979-0 乐谱号与提示文案', () => {
    expect(parseIsbn('978-7-04-039663-8')).toEqual({ ok: true, isbn10: null, isbn13: '9787040396638' });
    expect(parseIsbn('7-04-039663-9')).toMatchObject({ ok: false, reason: 'CHECKSUM' });
    expect(parseIsbn('0-306-40615-2')).toEqual({ ok: true, isbn10: '0306406152', isbn13: '9780306406157' });
    expect(isbnProblem('')).toBe('请输入 ISBN');
    expect(isbnProblem('12345')).toBe('ISBN 应为 10 位或 13 位（可以包含空格或连字符）');
    expect(isbnProblem('9790000000001')).toBe('979-0 开头的是乐谱号（ISMN），不是图书 ISBN，请核对号码');
    expect(isbnProblem('9771234567003')).toBe('ISBN-13 应以 978 或 979 开头');
    expect(isbnProblem('9787040396637')).toBe('校验位不正确，请核对号码');
    expect(formatIsbn('9787040396638')).toBe('978-7040396638');
    expect(describeLinked({ title: '高数', editionLabel: '第 8 版', isbn: null })).toBe('高数 第 8 版 · 无 ISBN');
  });
});

describe('课程 → 开课 → 教材 与 ISBN 查找', () => {
  it('演示目录（虚构、无 ISBN）：课程搜索、开课的指定教材、教材详情分区展示精确版本与其他版本；ISBN 查不到时 404 原样文案', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const page = await api.courses({ q: '微积分' });
    expect(page.items.map((c) => [c.id, c.offeringCount, c.textbookCount, c.isDemo])).toEqual([['demo-calculus-1', 2, 2, true]]);
    expect((await api.courses({ q: 'demo-ma1' })).total).toBe(2);
    const course = await api.course('demo-calculus-1');
    expect(course.offerings.map((o) => [o.id, o.textbooks.map((t) => [t.usageType, t.edition.id, t.edition.isbn])])).toEqual([
      ['demo-calculus-1-2026a', [['REQUIRED', 'demo-ed-calculus-8', null]]],
      ['demo-calculus-1-2025s', [['REQUIRED', 'demo-ed-calculus-7', null]]],
    ]);
    const detail = await api.textbook('demo-ed-calculus-8');
    expect(detail.listings.map((p) => p.id)).toEqual(['demo-product-1']);
    expect(detail.listings[0].textbook).toMatchObject({ editionId: 'demo-ed-calculus-8', courseNames: ['演示课程·微积分（一）'] });
    expect(detail.otherEditions.map((e) => [e.id, e.editionLabel])).toEqual([['demo-ed-calculus-7', '第 7 版']]);
    expect(detail.otherEditionListings).toEqual([]);
    await expect(api.textbookByIsbn('9787040396638')).rejects.toMatchObject({ code: 404, message: '本校教材目录中没有这个 ISBN' });
    await expect(api.textbookByIsbn('123')).rejects.toMatchObject({ code: 400, message: 'ISBN 应为 10 位或 13 位（可以包含空格或连字符）' });
    await expect(api.course('nope')).rejects.toMatchObject({ code: 404, message: '课程不存在' });
  });
  it('REST：ISBN 查找命中返回版本；404 原样带给页面', async () => {
    const edition = { id: 'e1', isbn: '9787040396638', isbn10: null, title: '高等数学', subtitle: null, authors: ['甲'], publisher: '某出版社', editionLabel: '第 8 版', publishedYear: 2023, coverUrl: null, isDemo: false, onSaleCount: 2 };
    const handler = vi.fn<RequestPort>(async (input) => input.url.includes('9787040396638') ? { statusCode: 200, data: { code: 0, data: edition, message: 'ok' } } : { statusCode: 404, data: { code: 404, message: '本校教材目录中没有这个 ISBN' } });
    const api = new RestApi(new Transport(handler, 'https://campus.example', true));
    expect(await api.textbookByIsbn('9787040396638')).toEqual(edition);
    await expect(api.textbookByIsbn('9780306406157')).rejects.toMatchObject({ code: 404, message: '本校教材目录中没有这个 ISBN' });
  });
  it('发布时关联教材版本：只有教材书籍分类；关联后商品卡片与详情带版本快照；切离教材分类自动解除', async () => {
    const api = setup();
    await api.login('seller001', 'demo12345');
    const base: ProductInput = { title: '线代课本', description: '有少量笔记', price: 15, category: '教材书籍', condition: '轻微使用痕迹', campus: '西校区', images: ['/assets/goods/books.png'], contact: '13800000000', contactPublic: false };
    const created = await api.publish(listingInput(base, { buildingId: null, visibility: 'PUBLIC', circleIds: [], textbookEditionId: 'demo-ed-linear-6' }));
    expect(created.textbook).toMatchObject({ editionId: 'demo-ed-linear-6', editionLabel: '第 6 版', isbn: null });
    await expect(api.publish({ ...base, category: '其他', textbookEditionId: 'demo-ed-linear-6' })).rejects.toMatchObject({ code: 400, message: '只有教材书籍分类的商品可以关联教材版本' });
    await expect(api.publish({ ...base, textbookEditionId: 'nope' })).rejects.toMatchObject({ code: 404, message: '教材版本不存在' });
    const original = { visibility: 'PUBLIC' as const, circleIds: [], textbookEditionId: 'demo-ed-linear-6', bundle: false };
    const moved = await api.publish(listingInput({ ...base, category: '其他' }, { buildingId: null, visibility: 'PUBLIC', circleIds: [], textbookEditionId: 'demo-ed-linear-6' }, original), created.id);
    expect(moved.textbook).toBeNull();
    expect((await api.textbook('demo-ed-linear-6')).onSaleCount).toBe(0);
  });
  it('教材版本订阅：没有宿舍楼只能选校区 / 全校；预算非负；同一版本只有一条启用订阅', async () => {
    expect(textbookScopes(false)).toEqual(['CAMPUS', 'SCHOOL']);
    expect(textbookScopes(true)).toEqual(['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL']);
    expect(textbookSubscribeInput('e1', 'SCHOOL', '-3')).toEqual({ error: '预算应为不小于 0 的数字' });
    expect(textbookSubscribeInput('e1', 'SCHOOL', '')).toEqual({ conditions: { textbookEditionId: 'e1', geoScope: 'SCHOOL' } });
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const r = await api.createSubscription({ textbookEditionId: 'demo-ed-calculus-7', geoScope: 'SCHOOL', maxPrice: 30 });
    expect(r.subscription).toMatchObject({ category: '教材书籍', textbook: { id: 'demo-ed-calculus-7', editionLabel: '第 7 版' } });
    await expect(api.createSubscription({ textbookEditionId: 'demo-ed-calculus-7', geoScope: 'CAMPUS' })).rejects.toMatchObject({ code: 409, message: '你已订阅这个教材版本，可以修改原订阅的范围或预算' });
    await expect(api.createSubscription({ keyword: '高数', textbookEditionId: 'demo-ed-calculus-8' })).rejects.toMatchObject({ code: 400, message: '教材版本订阅按版本精确匹配，不需要关键词' });
  });
});

describe('我的教材建议', () => {
  it('表单检查与请求体（与 Web 一致）', () => {
    expect(suggestionProblems(form({ offeringId: '', isbn: '123' }))).toEqual({ offering: '请选择开课学期', isbn: 'ISBN 应为 10 位或 13 位（可以包含空格或连字符）' });
    expect(suggestionProblems(form({ mode: 'metadata' }))).toEqual({ title: '请填写书名', publisher: '没有 ISBN 时请填写出版社', edition: '没有 ISBN 时请填写版次' });
    expect(suggestionInput(form({ isbn: '9787040396638', note: ' 老师推荐 ' }))).toEqual({ courseOfferingId: 'demo-calculus-1-2026a', isbn: '9787040396638', usageType: 'REQUIRED', note: '老师推荐' });
    expect(suggestionInput(form({ mode: 'metadata', title: '讲义', publisher: '自印', editionLabel: '2026 版', usage: 'REFERENCE' }))).toEqual({ courseOfferingId: 'demo-calculus-1-2026a', title: '讲义', publisher: '自印', editionLabel: '2026 版', usageType: 'REFERENCE' });
  });
  it('提交 / 重复提交 / 撤回；内容安全拦截 400 原样文案（演示与 REST 一致）', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const created = await api.createTextbookSuggestion(suggestionInput(form({ isbn: '9787040396638' })));
    expect(created).toMatchObject({ outcome: 'CREATED', suggestion: { status: 'PENDING', isbn: '9787040396638', courseName: '演示课程·微积分（一）' } });
    expect(suggestionDoneText(created.outcome)).toBe('建议已提交，状态为「待审核（未公开）」');
    expect((await api.createTextbookSuggestion(suggestionInput(form({ isbn: '978-7-04-039663-8' })))).outcome).toBe('EXISTING');
    await expect(api.createTextbookSuggestion(suggestionInput(form({ mode: 'metadata', title: '代写论文指南', publisher: '自印', editionLabel: '1' })))).rejects.toMatchObject({ code: 400, message: BLOCKED });
    await expect(api.createTextbookSuggestion(suggestionInput(form({ isbn: '9787040396638', note: '可以办证' })))).rejects.toMatchObject({ code: 400, message: BLOCKED });
    expect((await api.withdrawTextbookSuggestion(created.suggestion.id)).status).toBe('WITHDRAWN');
    expect((await api.myTextbookSuggestions()).map((s) => s.status)).toEqual(['WITHDRAWN']);
    await expect(api.withdrawTextbookSuggestion('nope')).rejects.toMatchObject({ code: 404, message: '建议不存在' });

    const handler = vi.fn<RequestPort>(async () => ({ statusCode: 400, data: { code: 400, message: BLOCKED } }));
    const rest = new RestApi(new Transport(handler, 'https://campus.example', true));
    await expect(rest.createTextbookSuggestion(suggestionInput(form({ isbn: '9787040396638', note: '可以办证' })))).rejects.toMatchObject({ code: 400, message: BLOCKED });
  });
});
