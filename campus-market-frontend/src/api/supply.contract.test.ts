// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { PRICE_GUIDANCE_NOTE, type BundleItemInput, type ListingPayload } from './contracts';
import { fullDisclosure } from '../test/inspectionFixtures';
import { percentileCont, roundGuidance, sampleBucket, sha256Hex } from './mock/supplyRules';
import type { Category } from '../types';

/**
 * 模块 5 的 Mock 契约：与后端 ListingBatchIT / BundleListingIT / AssistInviteIT / PriceGuidanceIT
 * 的关键断言逐条对应，保证离线演示与真实服务端行为一致。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
const code = async (p: Promise<unknown>) => (await failure(p)).code;
const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label = 'u', campus: '东校区' | '西校区' = '东校区') {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus, contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });

function single(category: Category, title: string, price: number): ListingPayload {
  return {
    title, description: '毕业季供给测试', price, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}),
  };
}
function bundleItems(n: number): BundleItemInput[] {
  const categories: Category[] = ['生活用品', '教材书籍', '数码电子', '服饰鞋包', '运动户外', '其他'];
  return Array.from({ length: n }, (_, i) => ({ name: `明细${i + 1}`, category: categories[i % 6], condition: '轻微使用痕迹', quantity: 1 + (i % 3), note: `第 ${i + 1} 件` }));
}
async function readyBatch(n: number, prefix: string) {
  const categories: Category[] = ['数码电子', '生活用品', '教材书籍', '服饰鞋包', '运动户外', '其他'];
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push((await api.createListingDraft({ draftType: 'SINGLE', payload: single(categories[i % 6], `${prefix}-${i + 1}`, 10 + i) })).id);
  return (await api.createListingBatch({ draftIds: ids })).id;
}

describe('5.1A 草稿', () => {
  it('部分保存；他人 404；白名单；READY 需要正式校验；乐观锁 409 带当前版本；丢弃幂等；过期显式 EXPIRED', async () => {
    await user('owner');
    const draft = await api.createListingDraft({ draftType: 'SINGLE', payload: { title: '只填了标题' } });
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1, access: 'OWNER', editedByAssistant: false, batchId: null });
    for (const field of ['sellerId', 'status', 'schoolId', 'listingKind']) {
      expect(await code(api.createListingDraft({ payload: { title: 't', [field]: 'x' } as never })), field).toBe(400);
    }
    const notReady = await failure(api.updateListingDraft(draft.id, { expectedVersion: 1, status: 'READY' }));
    expect(notReady.code).toBe(400);
    expect(notReady.details).toMatchObject({ code: 'MISSING_FIELD' });
    const ready = await api.updateListingDraft(draft.id, { expectedVersion: 1, payload: single('生活用品', '台灯', 20), status: 'READY' });
    expect(ready).toMatchObject({ status: 'READY', version: 2 });
    await api.updateListingDraft(draft.id, { expectedVersion: 2, payload: single('生活用品', 'A 页', 20) });
    const stale = await failure(api.updateListingDraft(draft.id, { expectedVersion: 2, payload: single('生活用品', 'B 页', 25) }));
    expect(stale.code).toBe(409);
    expect(stale.details).toEqual({ currentVersion: 3 });
    expect((await api.getListingDraft(draft.id)).payload.title).toBe('A 页');

    const stranger = await user('stranger');
    expect(await code(api.getListingDraft(draft.id))).toBe(404);
    expect(await code(api.updateListingDraft(draft.id, { expectedVersion: 3, payload: {} }))).toBe(404);
    expect(await api.listListingDrafts()).toEqual([]);
    void stranger;
  });

  it('过期与丢弃：不删除数据；已关闭的草稿不可再写', async () => {
    await user();
    const d = await api.createListingDraft({ payload: { title: '会过期' } });
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    raw.listingDrafts.find((x: { id: string }) => x.id === d.id).expiresAt = Date.now() - 1000;
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    expect((await api.getListingDraft(d.id)).status).toBe('EXPIRED');
    expect(await code(api.updateListingDraft(d.id, { expectedVersion: 1, payload: {} }))).toBe(409);
    const e = await api.createListingDraft({ payload: { title: '会丢弃' } });
    expect((await api.discardListingDraft(e.id)).status).toBe('DISCARDED');
    expect((await api.discardListingDraft(e.id)).status).toBe('DISCARDED');
    expect((await api.listListingDrafts()).map((x) => x.id)).toEqual(expect.arrayContaining([d.id, e.id]));
  });
});

describe('5.1B / 5.2 批次与发布', () => {
  it('逐项校验码与后端一致；有一项不通过则整批 400，details.items 定位到条目，什么都不写', async () => {
    await user();
    const cases: Array<[string, ListingPayload]> = [
      ['VALID', single('数码电子', '合格', 30)],
      ['MISSING_FIELD', { title: '只有标题' }],
      ['INVALID_CATEGORY', { ...single('生活用品', '分类错', 10), category: '奢侈品' }],
      ['INVALID_PRICE', { ...single('生活用品', '价格错', 10), price: -5 }],
      ['INVALID_BUILDING', { ...single('生活用品', '楼栋错', 10), buildingId: 'west-zhuyuan-1' }],
      ['INVALID_INSPECTION', (() => { const p = single('数码电子', '缺验货', 10); delete p.inspection; return p })()],
      ['INVALID_TEXTBOOK', { ...single('生活用品', '非教材', 10), textbookEditionId: 'demo-calculus-8' }],
      ['INVALID_BUNDLE', { ...single('生活用品', '单件带明细', 10), bundleItems: bundleItems(2) }],
    ];
    const ids: string[] = [];
    for (const [, payload] of cases) ids.push((await api.createListingDraft({ draftType: 'SINGLE', payload })).id);
    const batch = await api.createListingBatch({ draftIds: ids });
    expect(batch.items.map((i) => i.validation?.code)).toEqual(cases.map(([c]) => c));
    expect(batch.allValid).toBe(false);
    const before = (await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total;
    const rejected = await failure(api.publishListingBatch(batch.id, 'reject-key-0001'));
    expect(rejected.code).toBe(400);
    const items = (rejected.details as { items: Array<{ position: number; draftId: string }> }).items;
    expect(items).toHaveLength(cases.length - 1);
    expect(items[0]).toMatchObject({ position: 2, draftId: ids[1] });
    expect((await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total).toBe(before);
    expect((await api.getListingBatch(batch.id)).status).toBe('OPEN');
  });

  it('上限 20、同一草稿不能进两个未发布批次、在批次里的草稿不能丢弃、批次乐观锁、空批次不能发布', async () => {
    await user();
    const ids: string[] = [];
    for (let i = 0; i < 21; i += 1) ids.push((await api.createListingDraft({ payload: { title: `d${i}` } })).id);
    expect(await code(api.createListingBatch({ draftIds: ids }))).toBe(400);
    const first = await api.createListingBatch({ draftIds: ids.slice(0, 20) });
    expect(await code(api.createListingBatch({ draftIds: [ids[3]] }))).toBe(409);
    expect(await code(api.discardListingDraft(ids[3]))).toBe(409);
    await api.updateListingBatch(first.id, { expectedVersion: 1, draftIds: ids.slice(0, 2) });
    expect(await code(api.updateListingBatch(first.id, { expectedVersion: 1, draftIds: ids.slice(0, 3) }))).toBe(409);
    const empty = await api.createListingBatch({});
    expect(await code(api.publishListingBatch(empty.id, 'empty-key-0001'))).toBe(400);
  });

  it('发布 20 件：一次成功、按顺序返回；published 草稿只读；同键重放不重复创建；同键不同批次 409；已发布批次换键 409；短键 400', async () => {
    const owner = await user('owner');
    const batch = await readyBatch(20, '毕业二十件');
    const result = await api.publishListingBatch(batch, 'publish-key-0001');
    expect(result).toMatchObject({ publishedCount: 20, replayed: false });
    expect(JSON.stringify(result)).not.toMatch(/match|demand|subscriber/);
    const titles = await Promise.all(result.productIds.map(async (id) => (await api.getProduct(id)).title));
    expect(titles).toEqual(Array.from({ length: 20 }, (_, i) => `毕业二十件-${i + 1}`));
    const replay = await api.publishListingBatch(batch, 'publish-key-0001');
    expect(replay).toMatchObject({ replayed: true, productIds: result.productIds });
    expect((await api.listProducts({ page: 1, pageSize: 500, sort: 'latest', keyword: '毕业二十件' })).total).toBe(20);
    const other = await readyBatch(1, '另一批');
    expect(await code(api.publishListingBatch(other, 'publish-key-0001'))).toBe(409);
    expect(await code(api.publishListingBatch(batch, 'publish-key-0002'))).toBe(409);
    expect(await code(api.publishListingBatch(other, 'short'))).toBe(400);
    const draftId = (await api.getListingBatch(batch)).items[0].draft.id;
    expect(await code(api.updateListingDraft(draftId, { expectedVersion: 1, payload: {} }))).toBe(409);
    void owner;
  });

  it('故障注入：第 10 件创建失败 → 整批回滚（内存与 localStorage 都没有中间状态）；修复后同一键重试成功', async () => {
    await user();
    const batch = await readyBatch(20, '第十件故障');
    const stored = window.localStorage.getItem(DB_STORAGE_KEY);
    const original = (api as unknown as { createProductAs: (...args: unknown[]) => unknown }).createProductAs.bind(api);
    let calls = 0;
    const spy = vi.spyOn(api as never, 'createProductAs' as never).mockImplementation(((...args: unknown[]) => {
      calls += 1;
      if (calls === 10) throw new Error('模拟第 10 件失败');
      return original(...args);
    }) as never);
    await expect(api.publishListingBatch(batch, 'fail-tenth-key')).rejects.toThrow();
    expect(calls).toBe(10);
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBe(stored);
    expect((await api.listProducts({ page: 1, pageSize: 500, sort: 'latest', keyword: '第十件故障' })).total).toBe(0);
    expect((await api.getListingBatch(batch)).status).toBe('OPEN');
    expect((await api.listListingDrafts()).every((d) => d.status === 'DRAFT')).toBe(true);
    spy.mockRestore();
    const retried = await api.publishListingBatch(batch, 'fail-tenth-key');
    expect(retried).toMatchObject({ replayed: false, publishedCount: 20 });
  });
});

describe('5.1C / 5.4 整套打包', () => {
  it('明细 2～30；分类 / 数量 / 重复编码 400；单件不能带明细；详情带明细，卡片带摘要；形态不能切换；只生成一个订单', async () => {
    await user('seller');
    const base = { title: '宿舍整套', description: 'd', price: 120, category: '其他' as Category, condition: '轻微使用痕迹' as const, campus: '东校区' as const, images: ['https://example.invalid/a.png'], contact: '1' };
    expect(await code(api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: bundleItems(1) }))).toBe(400);
    expect(await code(api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: bundleItems(31) }))).toBe(400);
    expect(await code(api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: [{ ...bundleItems(2)[0], category: '奢侈品' as Category }, bundleItems(2)[1]] }))).toBe(400);
    expect(await code(api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: [{ ...bundleItems(2)[0], quantity: 0 }, bundleItems(2)[1]] }))).toBe(400);
    expect(await code(api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: bundleItems(3).map((i) => ({ ...i, itemCode: 'DUP' })) }))).toBe(400);
    expect(await code(api.createProduct({ ...base, bundleItems: bundleItems(2) }))).toBe(400);
    const thirty = await api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: bundleItems(30) });
    const p = await api.createProduct({ ...base, listingKind: 'BUNDLE', bundleItems: bundleItems(5) });
    expect(p.bundle).toEqual({ itemCount: 5, totalQuantity: 1 + 2 + 3 + 1 + 2, categoryCount: 5 });
    const detail = await api.getProduct(p.id);
    expect(detail.bundleItems?.map((i) => i.itemCode)).toEqual(['I01', 'I02', 'I03', 'I04', 'I05']);
    expect((await api.listProducts({ page: 1, pageSize: 100, sort: 'latest', keyword: '宿舍整套' })).items.find((x) => x.id === p.id)?.bundle?.itemCount).toBe(5);
    expect(await code(api.updateProduct(p.id, { listingKind: 'SINGLE' } as never))).toBe(400);
    expect(await code(api.updateProduct(p.id, { bundleItems: bundleItems(1) }))).toBe(400);
    expect((await api.updateProduct(p.id, { bundleItems: bundleItems(3) })).bundle?.itemCount).toBe(3);
    void thirty;

    await user('buyer');
    const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0);
    const order = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: at.toISOString(), contact: '1', idempotencyKey: rnd() });
    expect((await api.getProduct(p.id)).status).toBe('预约中');
    const flow = await api.getOrderFlow(order.id);
    expect(flow.inspection.items.map((i) => i.code)).toEqual(['B01_I01', 'B02_I02', 'B03_I03']);
    expect(flow.inspection.items[2].description).toContain('核对要点');
    await user('second');
    expect(await code(api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: at.toISOString(), contact: '1', idempotencyKey: rnd() }))).toBe(409);
    expect(JSON.stringify(order)).not.toContain('priceSnapshot');
  });
});

describe('5.1D / 5.5 协助整理发布', () => {
  it('邀请码只返回一次、localStorage 只有哈希；一次性；统一 404；协助人边界；撤销立即失效；所有者发布并记录协助人', async () => {
    const owner = await user('owner');
    const draft = await api.createListingDraft({ payload: single('生活用品', '请室友帮忙', 20) });
    const batch = await api.createListingBatch({ draftIds: [draft.id] });
    const created = await api.createAssistInvite({ batchId: batch.id });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = window.localStorage.getItem(DB_STORAGE_KEY)!;
    expect(stored).not.toContain(created.token);
    expect(stored).toContain(sha256Hex(created.token));
    expect(JSON.stringify(await api.listAssistInvites())).not.toContain(created.token);
    expect(await code(api.redeemAssistInvite(created.token))).toBe(404);   // 不能兑换自己的邀请

    const assistant = await user('assistant');
    const redeemed = await api.redeemAssistInvite(created.token);
    expect(redeemed.drafts.map((d) => d.id)).toEqual([draft.id]);
    expect(redeemed.drafts[0].payload).not.toHaveProperty('contact');
    expect(redeemed.drafts[0].access).toBe('ASSISTANT');
    await user('late');
    const reused = await failure(api.redeemAssistInvite(created.token));
    const unknown = await failure(api.redeemAssistInvite('x'.repeat(43)));
    expect([reused.code, unknown.code]).toEqual([404, 404]);
    expect(reused.message).toBe(unknown.message);

    await as(assistant);
    const edit = { ...single('生活用品', '协助后的台灯', 18) };
    delete edit.contact;
    const saved = await api.updateListingDraft(draft.id, { expectedVersion: 1, payload: edit });
    expect(saved.editedByAssistant).toBe(true);
    expect(await code(api.updateListingDraft(draft.id, { expectedVersion: 2, payload: { ...edit, contact: 'x' } }))).toBe(403);
    expect(await code(api.updateListingDraft(draft.id, { expectedVersion: 2, payload: { ...edit, condition: '全新' } }))).toBe(403);
    expect(await code(api.updateListingDraft(draft.id, { expectedVersion: 2, status: 'READY' }))).toBe(403);
    expect(await code(api.publishListingBatch(batch.id, 'assistant-key-01'))).toBe(404);
    expect(await code(api.getListingBatch(batch.id))).toBe(404);
    expect(await code(api.createAssistInvite({ draftId: draft.id }))).toBe(404);

    await as(owner);
    const b = await api.getListingBatch(batch.id);
    expect(b.assisted).toBe(true);
    const result = await api.publishListingBatch(batch.id, 'owner-key-00001');
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    const assistantId = raw.users.find((u: { account: string }) => u.account === assistant).id;
    const ownerId = raw.users.find((u: { account: string }) => u.account === owner).id;
    expect(raw.productAttribution[result.productIds[0]]).toEqual({ publishedBy: ownerId, assistedBy: assistantId });
    expect((await api.listAssistEvents(created.invite.id)).map((e) => e.code))
      .toEqual(['INVITE_CREATED', 'INVITE_REDEEMED', 'ASSIST_DRAFT_EDITED', 'PUBLISHED_AFTER_ASSIST']);

    const second = await api.createListingDraft({ payload: { title: '会撤销' } });
    const invite = await api.createAssistInvite({ draftId: second.id, expiresInHours: 168 });
    expect(await code(api.createAssistInvite({ draftId: second.id, expiresInHours: 169 }))).toBe(400);
    await as(assistant);
    await api.redeemAssistInvite(invite.token);
    expect((await api.getListingDraft(second.id)).access).toBe('ASSISTANT');
    await as(owner);
    expect((await api.revokeAssistInvite(invite.invite.id)).status).toBe('REVOKED');
    expect((await api.revokeAssistInvite(invite.invite.id)).status).toBe('REVOKED');
    await as(assistant);
    expect(await code(api.getListingDraft(second.id))).toBe(404);
    expect(await code(api.updateListingDraft(second.id, { expectedVersion: 1, payload: { title: '撤销后' } }))).toBe(404);
  });

  it('兑换失败按账号限流：第 11 次 429 带 Retry-After', async () => {
    await user();
    let last: ApiError | null = null;
    for (let i = 0; i < 11; i += 1) last = await failure(api.redeemAssistInvite(`guess-${i}-${'x'.repeat(30)}`));
    expect(last!.code).toBe(429);
    expect(last!.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('5.6 价格参考', () => {
  it('与 PostgreSQL percentile_cont 相同的插值；取整与样本数档位与后端一致', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect([percentileCont(values, 0.5), percentileCont(values, 0.25), percentileCont(values, 0.75)]).toEqual([55, 32.5, 77.5]);
    expect([roundGuidance(32.5), roundGuidance(77.5), roundGuidance(1234.56), roundGuidance(9999)]).toEqual([33, 78, 1230, 10000]);
    expect([sampleBucket(8), sampleBucket(9), sampleBucket(10), sampleBucket(14), sampleBucket(23)]).toEqual([8, 8, 10, 10, 20]);
  });

  it('少于 8 笔不给区间也不给样本数；只统计已完成、有快照、单件、本校；改价不影响；维度白名单', async () => {
    await user('viewer');
    const empty = await api.getPriceGuidance({ category: '生活用品' });
    expect(empty).toMatchObject({ sufficient: false, sampleCount: null, minimumSample: 8, note: PRICE_GUIDANCE_NOTE });
    expect(empty).not.toHaveProperty('median');
    // 直接写入已完成的历史订单（与后端 IT 相同的造数方式）
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    const add = (price: number, patch: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => {
      const id = `pg-${rnd()}`;
      raw.market.products.push({ id, title: '价格参考样本', description: 'd', price, category: '生活用品', condition: '全新', campus: '东校区', images: [], contact: '', sellerId: 'seed', status: '已售出', views: 0, createdAt: Date.now(), listingKind: 'SINGLE', ...product });
      raw.market.orders.push({ id: `o-${id}`, productId: id, buyerId: 'b', sellerId: 'seed', price, status: '已完成', canonicalStatus: 'COMPLETED', createdAt: Date.now(), updatedAt: Date.now(), priceSnapshot: price, currency: 'CNY',
        schoolIdSnapshot: 'pilot', categorySnapshot: '生活用品', conditionSnapshot: '全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: null, ...patch });
      return id;
    };
    const samples: string[] = [];
    for (let i = 1; i <= 10; i += 1) samples.push(add(i * 10));
    add(9999, { listingKindSnapshot: 'BUNDLE' }, { listingKind: 'BUNDLE' });
    add(9999, { canonicalStatus: 'CANCELLED', status: '已取消' });
    add(9999, { canonicalStatus: 'EXPIRED' });
    add(9999, { canonicalStatus: 'DISPUTED' });
    add(9999, { priceSnapshot: null, currency: null, schoolIdSnapshot: null, categorySnapshot: null, conditionSnapshot: null, listingKindSnapshot: null });
    // V7～V8 之间的旧订单：有成交价、没有维度快照
    add(9999, { schoolIdSnapshot: null, categorySnapshot: null, conditionSnapshot: null, listingKindSnapshot: null });
    // 学校隔离看订单快照：商品就在本校区，但快照属于别校
    add(9999, { schoolIdSnapshot: 'other-school' });
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    const g = await api.getPriceGuidance({ category: '生活用品' });
    expect(g).toMatchObject({ sufficient: true, sampleCount: 10, median: 55, lowerQuartile: 33, upperQuartile: 78 });
    expect(g.periodStart).toMatch(/^\d{4}-\d{2}$/);
    expect(JSON.stringify(g)).not.toMatch(/价格参考样本|seed|pg-/);
    // 5.7：商品成交后改分类、成色、校区、形态、教材关联，统计完全不变
    const edited = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    for (const p of edited.market.products) {
      if (samples.includes(p.id)) Object.assign(p, { category: '其他', condition: '明显使用痕迹', campus: '不存在的校区', price: 1 });
    }
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(edited));
    api = new MockCampusMarketApi();
    expect(await api.getPriceGuidance({ category: '生活用品' })).toEqual(g);
    expect((await api.getPriceGuidance({ category: '其他' })).sufficient).toBe(false);
    expect(await code(api.getPriceGuidance({ category: '生活用品', groupBy: 'seller' } as never))).toBe(400);
    expect(await code(api.getPriceGuidance({ category: '奢侈品' as Category }))).toBe(400);
    expect(await code(api.getPriceGuidance({ category: '生活用品', textbookEditionId: 'demo-calculus-8' }))).toBe(400);
  });

  it('下单写入成交价快照；取消后改价不改写旧订单', async () => {
    await user('seller');
    const p = await api.createProduct({ ...single('生活用品', '快照台灯', 88), images: ['https://example.invalid/a.png'] } as never);
    await user('buyer');
    const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0);
    const order = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: at.toISOString(), contact: '1', idempotencyKey: rnd() });
    const snapshot = () => JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).market.orders.find((o: { id: string }) => o.id === order.id);
    expect(snapshot()).toMatchObject({ priceSnapshot: 88, currency: 'CNY', schoolIdSnapshot: 'pilot', categorySnapshot: '生活用品',
      conditionSnapshot: '几乎全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: null });
    expect(JSON.stringify(order)).not.toMatch(/Snapshot/);
  });
});

describe('REST 适配层', () => {
  it('路径与方法；幂等键只在请求头；邀请码只在请求体；价格参考只带白名单参数', async () => {
    const calls: Array<{ method: string; url: string; body?: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.createListingDraft({ draftType: 'BUNDLE', payload: { title: 't' } });
    await rest.updateListingDraft('d1', { expectedVersion: 3, payload: {} });
    await rest.createListingBatch({ draftIds: ['d1'] });
    await rest.publishListingBatch('b1', 'idem-key-123456');
    await rest.createAssistInvite({ batchId: 'b1', expiresInHours: 24 });
    await rest.redeemAssistInvite('SECRET-TOKEN-abcdefghijklmnopqrstuvwxyz');
    await rest.revokeAssistInvite('i1');
    await rest.getPriceGuidance({ category: '教材书籍', condition: '全新', textbookEditionId: 'demo-calculus-8' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/listing-drafts', 'PATCH /v1/listing-drafts/d1', 'POST /v1/listing-batches', 'POST /v1/listing-batches/b1/publish',
      'POST /v1/listing-assist-invites', 'POST /v1/listing-assist-invites/redeem', 'POST /v1/listing-assist-invites/i1/revoke',
      `GET /v1/price-guidance?category=${encodeURIComponent('教材书籍')}&condition=${encodeURIComponent('全新')}&textbookEditionId=demo-calculus-8`,
    ]);
    expect(calls[3].headers['idempotency-key']).toBe('idem-key-123456');
    expect(calls[3].body).toBeUndefined();
    expect(calls[5].url).not.toContain('SECRET');
    expect(calls[5].body).toBe(JSON.stringify({ token: 'SECRET-TOKEN-abcdefghijklmnopqrstuvwxyz' }));
    for (const c of calls) expect(c.body ?? '').not.toMatch(/ownerId|sellerId|publishedBy|assistedBy|schoolId/);
  });
});
