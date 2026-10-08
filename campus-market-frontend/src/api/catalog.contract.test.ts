// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { seedCourseTextbooks, seedCourses, seedEditions, seedOfferings } from '../data/courseCatalog';
import { fullDisclosure } from '../test/inspectionFixtures';
import type { Category } from '../types';

/**
 * 模块 4 的 Mock 契约：与后端 CourseTextbookIT 的关键断言逐条对应（查询、学校隔离、商品关联、
 * 精确版本订阅、教材建议），并与 V6 迁移的种子逐字段比对。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
const V6_SQL = Object.values(import.meta.glob('../../../campus-market-backend/src/main/resources/db/migration/V6__course_textbook_graph.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)[0] ?? '';
const V7_SQL = Object.values(import.meta.glob('../../../campus-market-backend/src/main/resources/db/migration/V7__graduation_supply_engine.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)[0] ?? '';
const CALCULUS_8 = 'demo-calculus-8';
/** 测试自己加入的本校教材（真实格式的 ISBN-10 / 13，不是演示数据），用于 ISBN 精确查询。 */
const TEST_ISBN_EDITION = { id: 'isbn10-book', schoolId: 'pilot', isbn10: '080442957X', isbn13: '9780804429573', normalizedIsbn: '9780804429573',
  title: '十位书号教材', authors: ['a'], publisher: 'p', editionLabel: '第 2 版', publishedYear: null, workKey: null, noIsbnFingerprint: null, isDemo: false };
const CALCULUS_7 = 'demo-calculus-7';

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function code(p: Promise<unknown>): Promise<number> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}
const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label = 'u', dorm?: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  if (dorm) await api.updateProfile({ dormBuildingId: dorm });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });
async function book(title: string, editionId: string | null, extra: Record<string, unknown> = {}) {
  return api.createProduct({
    title, description: '课程教材图谱契约测试', price: 25, category: '教材书籍' as Category, condition: '几乎全新', campus: '东校区',
    images: [], contact: '13800000000', inspection: fullDisclosure('教材书籍'),
    ...(editionId ? { textbookEditionId: editionId } : {}), ...extra,
  });
}
/** 直接改 localStorage 里的目录，再重新装载（模拟他校数据 / 非公开关系）。 */
function patchCatalog(mutate: (db: Record<string, any>) => void) {
  const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
  mutate(raw);
  window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}

describe('4.2 演示目录与 V6 种子一致', () => {
  it('课程、开课、版本、关系逐项与 V6 SQL 相同，并应用了 V7 的 4.8 修正：演示教材全部无 ISBN、指纹与 V7 一致', () => {
    expect(V6_SQL).toContain('CREATE TABLE courses');
    for (const c of seedCourses) {
      expect(V6_SQL).toContain(`('${c.id}',`);
      expect(V6_SQL).toContain(`'${c.name}'`);
      expect(c.isDemo).toBe(true);
      expect(c.name.startsWith('演示课程')).toBe(true);
    }
    for (const o of seedOfferings) {
      expect(V6_SQL).toMatch(new RegExp(`\\('${o.id}',\\s*'${o.courseId}',\\s*'${o.schoolId}',\\s*'${o.academicYear}',\\s*'${o.term}'`));
      if (o.instructorName) expect(o.instructorName.startsWith('演示教师')).toBe(true);
    }
    for (const e of seedEditions) {
      expect(V6_SQL).toContain(`('${e.id}',`);
      expect(e.normalizedIsbn, e.id).toBeNull();
      expect(e.isbn13, e.id).toBeNull();
      expect(e.noIsbnFingerprint, e.id).toMatch(/^[0-9a-f]{64}$/);
      // V6 植入时带 ISMN 的 5 条：指纹必须与 V7 修正语句里的逐字相同
      if (new RegExp(`\\('${e.id}',\\s*'9790`).test(V7_SQL)) {
        expect(V7_SQL).toMatch(new RegExp(`\\('${e.id}',\\s*'9790\\d{9}',[^)]*'${e.noIsbnFingerprint}'\\)`));
      }
      expect(V6_SQL).toContain(`'${e.editionLabel}'`);
    }
    for (const t of seedCourseTextbooks) {
      expect(V6_SQL).toMatch(new RegExp(`\\('${t.courseOfferingId}',\\s*'${t.textbookEditionId}',\\s*'pilot',\\s*'${t.usageType}',\\s*'${t.verificationStatus}'`));
    }
    expect([seedCourses.length, seedOfferings.length, seedEditions.length, seedCourseTextbooks.length]).toEqual([5, 6, 6, 7]);
  });
});

describe('4.3 查询', () => {
  it('课程搜索：名称子串 / 代码前缀 / 学期 / 校区 / 分页；% 是字面字符；非法学期 400；未登录 401', async () => {
    expect(await code(api.listCourses({}))).toBe(401);
    await user();
    const all = await api.listCourses({});
    expect(all.total).toBe(5);
    expect(all.items.every((c) => c.isDemo)).toBe(true);
    expect((await api.listCourses({ q: '线性' })).items.map((c) => c.id)).toEqual(['demo-linear-algebra']);
    expect((await api.listCourses({ q: 'demo-ma' })).items.map((c) => c.id).sort()).toEqual(['demo-calculus-1', 'demo-linear-algebra']);
    expect((await api.listCourses({ term: 'SPRING' })).items.map((c) => c.id)).toEqual(['demo-calculus-1']);
    expect((await api.listCourses({ campus: '西校区' })).items.map((c) => c.id)).toEqual(['demo-linear-algebra']);
    expect((await api.listCourses({ q: '%' })).total).toBe(0);
    const paged = await api.listCourses({ page: 2, pageSize: 2 });
    expect(paged.items).toHaveLength(2);
    expect(await code(api.listCourses({ term: 'FALL' as never }))).toBe(400);
  });

  it('课程详情：学期倒序；只含 VERIFIED（注入的 PENDING / REJECTED 不出现）；在售数只计在售', async () => {
    const seller = await user('seller');
    const onSale = await book('在售的第 8 版', CALCULUS_8);
    const sold = await book('已售出的第 8 版', CALCULUS_8);
    await api.setProductStatus(sold.id, '已售出');
    void seller;
    patchCatalog((db) => {
      db.catalog.courseTextbooks.push({ courseOfferingId: 'demo-calculus-1-2026a', textbookEditionId: 'demo-programming-2', schoolId: 'pilot', usageType: 'RECOMMENDED', verificationStatus: 'PENDING', sourceNote: null });
      db.catalog.courseTextbooks.push({ courseOfferingId: 'demo-calculus-1-2026a', textbookEditionId: 'demo-physics-5', schoolId: 'pilot', usageType: 'REFERENCE', verificationStatus: 'REJECTED', sourceNote: null });
    });
    await user('viewer');
    const course = await api.getCourse('demo-calculus-1');
    expect(course.offerings.map((o) => o.id)).toEqual(['demo-calculus-1-2026a', 'demo-calculus-1-2025s']);
    const current = course.offerings[0].textbooks;
    expect(current.map((t) => [t.edition.id, t.usageType])).toEqual([[CALCULUS_8, 'REQUIRED'], [CALCULUS_7, 'REFERENCE']]);
    expect(current[0].edition.onSaleCount).toBe(1);
    expect(JSON.stringify(course)).not.toMatch(/submitter|subscriber|waiting|dormBuildingId|contact|13800000000/);
    expect(onSale.textbook?.editionId).toBe(CALCULUS_8);
    const offering = await api.getCourseOffering('demo-calculus-1-2026a');
    expect(offering.course.id).toBe('demo-calculus-1');
    expect(offering.textbooks).toHaveLength(2);
  });

  it('学校隔离：他校课程 / 开课 / 版本 / ISBN 一律 404；列表不出现他校课程', async () => {
    await user();
    patchCatalog((db) => {
      db.catalog.courses.push({ id: 'other-course', schoolId: 'other-school', courseCode: null, name: '他校课程', normalizedName: '他校课程', department: null, isDemo: true });
      db.catalog.offerings.push({ id: 'other-offering', courseId: 'other-course', schoolId: 'other-school', academicYear: '2026-2027', term: 'AUTUMN', instructorName: null, campusId: null });
      db.catalog.editions.push({ id: 'other-edition', schoolId: 'other-school', isbn13: '9780306406157', normalizedIsbn: '9780306406157', title: '他校教材', authors: ['a'], publisher: 'p', editionLabel: '第 1 版', publishedYear: null, workKey: null, noIsbnFingerprint: null, isDemo: true });
    });
    expect(await code(api.getCourse('other-course'))).toBe(404);
    expect(await code(api.getCourseOffering('other-offering'))).toBe(404);
    expect(await code(api.getTextbook('other-edition'))).toBe(404);
    expect(await code(api.getTextbookByIsbn('9780306406157'))).toBe(404);
    expect((await api.listCourses({ pageSize: 50 })).items.map((c) => c.id)).not.toContain('other-course');
  });

  it('教材详情：关联课程；精确版本与其他版本分两组；只列在售；无宿舍楼按最新、有宿舍楼按距离', async () => {
    await user('seller');
    const exact = await book('精确第 8 版', CALCULUS_8);
    const older = await book('旧的第 7 版', CALCULUS_7);
    const plain = await book('微积分教程（演示） 第 8 版 未关联', null);
    const hidden = await book('下架的第 8 版', CALCULUS_8);
    await api.setProductStatus(hidden.id, '已下架');
    await user('viewer');
    const detail = await api.getTextbook(CALCULUS_8);
    expect(detail.isbn).toBeNull();
    expect(JSON.stringify(detail)).not.toContain('9790');
    expect(detail.courses.map((c) => `${c.courseId}/${c.usageType}`)).toContain('demo-calculus-1/REQUIRED');
    expect(detail.listings.map((p) => p.id)).toEqual([exact.id]);
    expect(detail.otherEditions.map((e) => e.id)).toEqual([CALCULUS_7]);
    expect(detail.otherEditionListings.map((p) => p.id)).toEqual([older.id]);
    expect([...detail.listings, ...detail.otherEditionListings].map((p) => p.id)).not.toContain(plain.id);
    expect(detail.listingSort).toBe('latest');

    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    expect((await api.getTextbook(CALCULUS_8)).listingSort).toBe('nearest');
    expect((await api.getTextbook(CALCULUS_8, 'latest')).listingSort).toBe('latest');
  });

  it('ISBN 查询：空格与连字符可用；校验位错误 400；979-0（ISMN）400；本校目录没有 404', async () => {
    await user();
    patchCatalog((db) => { db.catalog.editions.push(TEST_ISBN_EDITION); });
    expect((await api.getTextbookByIsbn('978-0-8044-2957-3')).id).toBe('isbn10-book');
    expect((await api.getTextbookByIsbn('0-8044-2957-x')).id).toBe('isbn10-book');
    const ismn = await api.getTextbookByIsbn('979-0-000001-02-2').catch((x) => x);
    expect((ismn as ApiError).code).toBe(400);
    expect((ismn as ApiError).message).toContain('乐谱号');
    const e = await api.getTextbookByIsbn('9780804429574').catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(400);
    expect((e as ApiError).message).toContain('校验位');
    expect(await code(api.getTextbookByIsbn('9780000000019'))).toBe(404);
  });
});

describe('4.5 商品与教材版本', () => {
  it('关联：商品投影带具体版本（ISBN、版次、出版社、课程）；非教材分类 400；未知 / 服务端字段 400', async () => {
    await user();
    const p = await book('关联了版本的教材', CALCULUS_8);
    expect(p.textbook).toMatchObject({ editionId: CALCULUS_8, isbn: null, editionLabel: '第 8 版', publisher: '演示大学出版社' });
    expect(p.textbook?.courseNames).toContain('演示课程·微积分（一）');
    const listed = (await api.listProducts({ page: 1, pageSize: 100, sort: 'latest' })).items.find((x) => x.id === p.id);
    expect(listed?.textbook?.editionId).toBe(CALCULUS_8);
    expect(await code(api.createProduct({ title: '数码', description: 'd', price: 1, category: '数码电子', condition: '全新', campus: '东校区',
      images: [], contact: '1', inspection: fullDisclosure('数码电子'), textbookEditionId: CALCULUS_8 }))).toBe(400);
    expect(await code(book('他校版本', 'no-such-edition'))).toBe(404);
    for (const field of ['schoolId', 'isbnSnapshot', 'titleSnapshot', 'verificationStatus', 'sellerId']) {
      expect(await code(book(`白名单 ${field}`, CALCULUS_8, { [field]: 'x' })), field).toBe(400);
    }
  });

  it('编辑：同一版本不改写快照；换版本整体替换；切离教材分类自动解除；显式 null 解除；旧商品为 null', async () => {
    await user();
    const p = await book('会被编辑的教材', CALCULUS_8);
    const snapshot = () => JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).productTextbooks[p.id];
    const first = snapshot();
    await api.updateProduct(p.id, { textbookEditionId: CALCULUS_8, title: '会被编辑的教材 v2' });
    expect(snapshot()).toEqual(first);
    expect((await api.updateProduct(p.id, { textbookEditionId: CALCULUS_7 })).textbook?.editionLabel).toBe('第 7 版');
    const digital = await api.updateProduct(p.id, { category: '数码电子', inspection: fullDisclosure('数码电子') });
    expect(digital.textbook).toBeNull();
    expect(snapshot()).toBeUndefined();

    const q = await book('将被解除', CALCULUS_8);
    expect((await api.updateProduct(q.id, { textbookEditionId: null })).textbook).toBeNull();
    const legacy = await book('旧的教材商品', null);
    expect((await api.getProduct(legacy.id)).textbook).toBeNull();
  });
});

describe('4.6 精确教材版本订阅', () => {
  it('创建：分类自动为教材书籍；相同条件幂等；同版本不同条件 409；关键词 / 他类 400；不存在 404；PATCH 不能改版本', async () => {
    await user('buyer');
    const created = await api.createDemandSubscription({ textbookEditionId: CALCULUS_8 });
    expect(created.outcome).toBe('CREATED');
    expect(created.subscription).toMatchObject({ category: '教材书籍', keyword: null });
    expect(created.subscription.textbook?.isbn).toBeNull();
    expect((await api.createDemandSubscription({ textbookEditionId: CALCULUS_8 })).outcome).toBe('EXISTING');
    expect(await code(api.createDemandSubscription({ textbookEditionId: CALCULUS_8, maxPrice: 30 }))).toBe(409);
    expect(await code(api.createDemandSubscription({ textbookEditionId: CALCULUS_7, keyword: '微积分' }))).toBe(400);
    expect(await code(api.createDemandSubscription({ textbookEditionId: CALCULUS_7, category: '数码电子' }))).toBe(400);
    expect(await code(api.createDemandSubscription({ textbookEditionId: 'no-such-edition' }))).toBe(404);
    expect(await code(api.updateDemandSubscription(created.subscription.id, { textbookEditionId: CALCULUS_7 }))).toBe(400);
    expect((await api.updateDemandSubscription(created.subscription.id, { maxPrice: 40 })).maxPrice).toBe(40);
  });

  it('匹配：只命中同一版本（TEXTBOOK_EXACT 在首位、HIGH 档）；相似书名 / 其他版本 / 卖家自己都不命中；解除后失效、恢复后同一条', async () => {
    const buyer = await user('buyer');
    await api.createDemandSubscription({ textbookEditionId: CALCULUS_8 });
    const seller = await user('seller');
    const exact = await book('雷达精确版本', CALCULUS_8);
    const sameTitle = await book('微积分教程（演示） 第 8 版', null);
    const other = await book('雷达第 7 版', CALCULUS_7);
    await as(buyer);
    let inbox = (await api.listDemandMatches()).items;
    expect(inbox.map((m) => m.product.id)).toEqual([exact.id]);
    expect(inbox[0].reasonCodes[0]).toBe('TEXTBOOK_EXACT');
    expect(inbox[0].tier).toBe('HIGH');
    expect(inbox[0].score).toBeLessThanOrEqual(100);
    expect([sameTitle.id, other.id]).not.toContain(inbox[0].product.id);
    const firstId = inbox[0].id;

    await as(seller);
    await api.createDemandSubscription({ textbookEditionId: CALCULUS_8 });
    await book('卖家自己的第 8 版', CALCULUS_8);
    expect((await api.listDemandMatches()).items).toHaveLength(0);

    await api.updateProduct(exact.id, { textbookEditionId: null });
    await as(buyer);
    inbox = (await api.listDemandMatches()).items;
    expect(inbox.find((m) => m.product.id === exact.id)).toMatchObject({ valid: false, invalidReason: 'NO_LONGER_MATCHES' });
    await as(seller);
    await api.updateProduct(exact.id, { textbookEditionId: CALCULUS_8 });
    await as(buyer);
    const restored = (await api.listDemandMatches()).items.filter((m) => m.product.id === exact.id);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: firstId, valid: true });
  });

  it('兼容：普通关键词订阅的指纹与 V4 时代逐字节相同；命中关联版本的商品时理由仍是 KEYWORD_*', async () => {
    const buyer = await user('buyer');
    const keyword = `兼容${rnd()}`;
    await api.createDemandSubscription({ keyword, category: '教材书籍' });
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    expect(raw.demandSubscriptions[0].fingerprint).toBe(['v1', `kw=${keyword.toLowerCase()}`, 'cat=教材书籍', 'min=', 'max=', 'geo=SCHOOL', 'anchor='].join('\n'));
    expect(raw.demandSubscriptions[0].textbookEditionId ?? null).toBeNull();
    await user('seller');
    const linked = await book(`${keyword} 关联版本的教材`, CALCULUS_8);
    await as(buyer);
    const match = (await api.listDemandMatches()).items.find((m) => m.product.id === linked.id)!;
    expect(match.reasonCodes).toContain('KEYWORD_TITLE');
    expect(match.reasonCodes).not.toContain('TEXTBOOK_EXACT');
  });
});

describe('4.4 教材建议', () => {
  it('默认 PENDING；只本人可见与撤回；不进入公开课程页；撤回幂等；投影不含提交人', async () => {
    const author = await user('author');
    const result = await api.createTextbookSuggestion({ courseOfferingId: 'demo-programming-2026a', textbookEditionId: 'demo-linear-algebra-3', usageType: 'REFERENCE', note: '老师课上提过' });
    expect(result.suggestion.status).toBe('PENDING');
    expect(JSON.stringify(result)).not.toMatch(/submitter/);
    await user('stranger');
    const course = await api.getCourse('demo-programming');
    expect(JSON.stringify(course)).not.toMatch(/demo-linear-algebra-3|老师课上提过/);
    expect(await api.listMyTextbookSuggestions()).toEqual([]);
    expect(await code(api.withdrawTextbookSuggestion(result.suggestion.id))).toBe(404);
    await as(author);
    expect((await api.withdrawTextbookSuggestion(result.suggestion.id)).status).toBe('WITHDRAWN');
    expect((await api.withdrawTextbookSuggestion(result.suggestion.id)).status).toBe('WITHDRAWN');
  });

  it('输入：目录已有的 ISBN 自动指向版本；无 ISBN 必须有书名 / 出版社 / 版次；校验位 / 尖括号 / 未知字段 400', async () => {
    await user();
    patchCatalog((db) => { db.catalog.editions.push(TEST_ISBN_EDITION); });
    const byIsbn = await api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', isbn: '978-0-8044-2957-3' });
    expect(byIsbn.suggestion).toMatchObject({ textbookEditionId: 'isbn10-book', isbn: null });
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', isbn: '9790000001022' }))).toBe(400);
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a' }))).toBe(400);
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', title: '只有书名' }))).toBe(400);
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', isbn: '9780306406158' }))).toBe(400);
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', title: '<script>', publisher: 'p', editionLabel: 'v' }))).toBe(400);
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'no-such-offering', isbn: '9780306406157' }))).toBe(404);
    for (const field of ['submitterId', 'status', 'verificationStatus', 'schoolId', 'createdAt']) {
      expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', isbn: '9780306406157', [field]: 'VERIFIED' } as never)), field).toBe(400);
    }
  });

  it('幂等与每日上限：重复提交返回原记录且不计数；第 11 条新建议 429', async () => {
    await user();
    const first = { courseOfferingId: 'demo-academic-en-2026a', isbn: '9780306406157' };
    expect((await api.createTextbookSuggestion(first)).outcome).toBe('CREATED');
    for (let i = 0; i < 3; i++) expect((await api.createTextbookSuggestion(first)).outcome).toBe('EXISTING');
    for (let i = 0; i < 9; i++) {
      expect((await api.createTextbookSuggestion({ courseOfferingId: 'demo-academic-en-2026a', title: `讲义 ${i}`, publisher: 'p', editionLabel: 'v1' })).outcome).toBe('CREATED');
    }
    expect(await code(api.createTextbookSuggestion({ courseOfferingId: 'demo-academic-en-2026a', title: '第 11 条', publisher: 'p', editionLabel: 'v1' }))).toBe(429);
    expect((await api.createTextbookSuggestion(first)).outcome).toBe('EXISTING');
  });
});

describe('REST 适配层', () => {
  it('8 个接口走约定路径；请求体从不携带学校、提交人、审核状态或时间', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(url), init?.body as string | undefined]);
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.listCourses({ q: '微积分', term: 'AUTUMN', page: 2 });
    await rest.getCourse('c1');
    await rest.getCourseOffering('o1');
    await rest.getTextbook('e1', 'latest');
    await rest.getTextbookByIsbn('978-0-8044-2957-3');
    await rest.createTextbookSuggestion({ courseOfferingId: 'o1', isbn: '9780804429573' });
    await rest.listMyTextbookSuggestions();
    await rest.withdrawTextbookSuggestion('s1');
    expect(calls.map(([m, u]) => `${m} ${u.replace(/^https?:\/\/[^/]+/, '')}`)).toEqual([
      `GET /v1/courses?q=${encodeURIComponent('微积分')}&term=AUTUMN&page=2`,
      'GET /v1/courses/c1',
      'GET /v1/course-offerings/o1',
      'GET /v1/textbooks/e1?sort=latest',
      'GET /v1/textbooks/isbn/978-0-8044-2957-3',
      'POST /v1/textbook-suggestions',
      'GET /v1/textbook-suggestions/mine',
      'DELETE /v1/textbook-suggestions/s1',
    ]);
    for (const [, , body] of calls) {
      if (body) expect(body).not.toMatch(/schoolId|submitterId|verificationStatus|"status"|createdAt/);
    }
  });
});
