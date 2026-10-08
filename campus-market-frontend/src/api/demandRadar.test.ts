import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import type { DemandConditions } from './contracts';
import type { Campus, Category } from '../types';
import { describeConditions } from '../utils/demand';
import { mockTier, normalizeDemandText, scoreDemandMatch } from './mock/demandScoring';
import { fullDisclosure } from '../test/inspectionFixtures';

/**
 * 需求雷达的 Mock 契约（2.6）与楼栋 Mock 完整性（1.7B）。
 *
 * <p>期望值与后端 DemandRadarIT 对同一场景的断言一一对应：
 * 同样的规范化、幂等、上限、范围、评分、失效与隐私边界。
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

let api: MockCampusMarketApi;
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: { localStorage: new MemoryStorage() }, configurable: true });
  api = new MockCampusMarketApi();
});

const tag = () => `r${Math.random().toString(36).slice(2, 10)}`;

async function as(prefix: string, campus: Campus = '东校区') {
  const s = await api.register({
    account: `${prefix}-${Math.random().toString(36).slice(2)}`, password: 'test-password',
    nickname: prefix, campus, contact: '13800000000',
  });
  return s.user;
}

async function login(user: { account: string }) {
  await api.login({ account: user.account, password: 'test-password' });
}

async function publish(title: string, opts: { campus?: Campus; buildingId?: string | null; description?: string; category?: Category; price?: number } = {}) {
  return api.createProduct({
    title, description: opts.description ?? '需求雷达测试商品', price: opts.price ?? 50,
    category: opts.category ?? '生活用品', condition: '全新', campus: opts.campus ?? '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000', buildingId: opts.buildingId ?? null,
    inspection: fullDisclosure(opts.category ?? '生活用品'),
  });
}

async function code(p: Promise<unknown>): Promise<number> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}

async function inboxProductIds(): Promise<string[]> {
  return (await api.listDemandMatches(1, 100)).items.map((m) => m.product.id);
}

describe('1.7B Mock 楼栋完整性', () => {
  it('1. 停用楼栋不出现在列表；列表顺序与后端 COLLATE "C" 一致（松园在沁园之前）', async () => {
    const east = await api.listBuildings('东校区');
    expect(east.map((b) => b.id)).toEqual([
      'east-songyuan-4', 'east-songyuan-5', 'east-qinyuan-1', 'east-qinyuan-2', 'east-qinyuan-3',
    ]);
    expect(Object.keys(east[0]).sort()).toEqual(['campusId', 'id', 'latitude', 'longitude', 'name', 'zone']);
  });

  it('2. 资料与商品都不能引用停用楼栋，错误码与 REST 一致（400）', async () => {
    await as('seller');
    expect(await code(api.updateProfile({ dormBuildingId: 'east-songyuan-6' }))).toBe(400);
    expect(await code(publish('x', { buildingId: 'east-songyuan-6' }))).toBe(400);
  });
});

describe('2.2 订阅（Mock）', () => {
  it('3. 幂等：大小写与全角空格不同也返回 EXISTING；停用后再建为 REACTIVATED', async () => {
    await as('buyer');
    const t = tag();
    const first = await api.createDemandSubscription({ keyword: `${t} 台灯` });
    expect(first.outcome).toBe('CREATED');
    const again = await api.createDemandSubscription({ keyword: `  ${t.toUpperCase()}　台灯 ` });
    expect(again.outcome).toBe('EXISTING');
    expect(again.subscription.id).toBe(first.subscription.id);

    await api.deleteDemandSubscription(first.subscription.id);
    const revived = await api.createDemandSubscription({ keyword: `${t} 台灯` });
    expect(revived.outcome).toBe('REACTIVATED');
    expect(revived.subscription.id).toBe(first.subscription.id);
  });

  it('4. 不接受身份与指纹字段；至少要有关键词或分类', async () => {
    await as('buyer');
    for (const field of ['userId', 'schoolId', 'fingerprint', 'active', 'zone']) {
      expect(await code(api.createDemandSubscription({ keyword: tag(), [field]: 'x' } as DemandConditions))).toBe(400);
    }
    expect(await code(api.createDemandSubscription({}))).toBe(400);
    expect(await code(api.createDemandSubscription({ keyword: tag(), minPrice: 10, maxPrice: 1 }))).toBe(400);
  });

  it('5. 范围规则：无宿舍楼的 BUILDING 409；停用楼 400；不存在 404；ZONE 同园区换锚点仍是同一订阅', async () => {
    await as('buyer');
    expect(await code(api.createDemandSubscription({ keyword: tag(), geoScope: 'BUILDING' }))).toBe(409);
    expect(await code(api.createDemandSubscription({ keyword: tag(), geoScope: 'BUILDING', buildingId: 'east-songyuan-6' }))).toBe(400);
    expect(await code(api.createDemandSubscription({ keyword: tag(), geoScope: 'BUILDING', buildingId: 'no-such' }))).toBe(404);
    const t = tag();
    const a = await api.createDemandSubscription({ keyword: t, geoScope: 'ZONE', buildingId: 'east-qinyuan-1' });
    expect(a.subscription.zone).toBe('沁园');
    expect((await api.createDemandSubscription({ keyword: t, geoScope: 'ZONE', buildingId: 'east-qinyuan-3' })).outcome).toBe('EXISTING');
  });

  it('6. 上限 50：第 51 条 409；停用一条后可再建', async () => {
    await as('buyer');
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await api.createDemandSubscription({ keyword: tag() })).subscription.id);
    expect(await code(api.createDemandSubscription({ keyword: tag() }))).toBe(409);
    await api.deleteDemandSubscription(ids[0]);
    expect((await api.createDemandSubscription({ keyword: tag() })).outcome).toBe('CREATED');
  });

  it('7. 修改条件：与本人另一条启用订阅撞车 409', async () => {
    await as('buyer');
    const a = tag(), b = tag();
    await api.createDemandSubscription({ keyword: a });
    const second = await api.createDemandSubscription({ keyword: b });
    expect(await code(api.updateDemandSubscription(second.subscription.id, { keyword: a }))).toBe(409);
  });
});

describe('2.3 同步匹配（Mock）', () => {
  it('8. 发布返回时匹配已存在；卖家自己的订阅不命中', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t });
    const seller = await as('seller');
    await api.createDemandSubscription({ keyword: t });
    const product = await publish(`${t} 台灯`);

    expect(await inboxProductIds()).toEqual([]);   // 卖家本人：不命中
    await login(buyer);
    expect(await inboxProductIds()).toEqual([product.id]);
    expect(seller).toBeTruthy();
  });

  it('9. 四种范围与后端 DemandRadarIT 同一场景结果一致', async () => {
    const t = tag();
    const users: Record<string, { account: string }> = {};
    for (const [key, cond] of [
      ['building', { keyword: t, geoScope: 'BUILDING', buildingId: 'east-qinyuan-1' }],
      ['zone', { keyword: t, geoScope: 'ZONE', buildingId: 'east-qinyuan-1' }],
      ['campus', { keyword: t, geoScope: 'CAMPUS', campusId: '东校区' }],
      ['school', { keyword: t, geoScope: 'SCHOOL' }],
    ] as const) {
      users[key] = await as(key);
      await api.createDemandSubscription(cond as DemandConditions);
    }
    await as('seller');
    const a = await publish(`${t} A`, { buildingId: 'east-qinyuan-1' });
    const b = await publish(`${t} B`, { buildingId: 'east-qinyuan-2' });
    const c = await publish(`${t} C`, { buildingId: 'east-songyuan-4' });
    const d = await publish(`${t} D`, { campus: '西校区', buildingId: 'west-zhuyuan-1' });
    const e = await publish(`${t} E`);

    const expect_ = async (key: string, ids: string[]) => {
      await login(users[key]);
      expect((await inboxProductIds()).sort()).toEqual(ids.sort());
    };
    await expect_('building', [a.id]);
    await expect_('zone', [a.id, b.id]);
    await expect_('campus', [a.id, b.id, c.id, e.id]);
    await expect_('school', [a.id, b.id, c.id, d.id, e.id]);
  });

  it('10. % 与 _ 是字面字符；中文全角空格规范化后匹配', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: `${t}50%` });
    await api.createDemandSubscription({ keyword: `${t}　护眼   台灯` });
    await as('seller');
    const literal = await publish(`${t}50%新`);
    await publish(`${t}50元`);
    const chinese = await publish(`全新 ${t} 护眼 台灯`);
    await login(buyer);
    expect((await inboxProductIds()).sort()).toEqual([literal.id, chinese.id].sort());
  });

  it('11. 分类与价格是硬条件；精确标题 + 分类 + 同楼 + 价格居中 = 100 分', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t, category: '数码电子', minPrice: 100, maxPrice: 300, geoScope: 'BUILDING', buildingId: 'east-qinyuan-1' });
    await as('seller');
    const perfect = await publish(t, { buildingId: 'east-qinyuan-1', category: '数码电子', price: 200 });
    await publish(t, { buildingId: 'east-qinyuan-1', category: '生活用品', price: 200 });
    await publish(t, { buildingId: 'east-qinyuan-1', category: '数码电子', price: 301 });
    await login(buyer);
    const { items } = await api.listDemandMatches();
    expect(items.map((m) => m.product.id)).toEqual([perfect.id]);
    expect(items[0].reasonCodes).toEqual(['KEYWORD_TITLE_EXACT', 'CATEGORY', 'SAME_BUILDING', 'PRICE_CLOSE']);
    expect(items[0].score).toBe(100);
  });

  it('12. 编辑：新满足则新增、不再满足则失效但保留、改回来恢复且不重复', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t });
    const seller = await as('seller');
    const product = await publish('还没有关键词');
    await api.updateProduct(product.id, { title: `${t} 改后` });
    await login(buyer);
    expect(await inboxProductIds()).toEqual([product.id]);

    await login(seller);
    await api.updateProduct(product.id, { title: '改成别的' });
    await login(buyer);
    let [match] = (await api.listDemandMatches()).items;
    expect(match.valid).toBe(false);
    expect(match.invalidReason).toBe('NO_LONGER_MATCHES');
    expect(await api.getDemandUnreadCount()).toBe(0);

    await login(seller);
    await api.updateProduct(product.id, { title: `${t} 又改回来` });
    await login(buyer);
    const all = (await api.listDemandMatches()).items;
    expect(all).toHaveLength(1);
    [match] = all;
    expect(match.valid).toBe(true);
  });

  it('13. 下架 / 售出不可购买，重新上架恢复；被预约时即时显示 NOT_ON_SALE', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t });
    const seller = await as('seller');
    const product = await publish(`${t} 台灯`);
    await api.setProductStatus(product.id, '已下架');
    await login(buyer);
    expect((await api.listDemandMatches()).items[0].valid).toBe(false);

    await login(seller);
    await api.setProductStatus(product.id, '在售');
    await login(buyer);
    expect((await api.listDemandMatches()).items[0].valid).toBe(true);

    // 通过订单流程锁定：Mock 与 REST 一样在读取时按商品状态判断
    await api.createOrder({
      productId: product.id, meetingPointId: '东校区-library',
      meetingAtIso: new Date(Date.now() + 86_400_000).toISOString(), contact: '1', idempotencyKey: tag(),
    });
    const [reserved] = (await api.listDemandMatches()).items;
    expect(reserved.valid).toBe(false);
    expect(reserved.invalidReason).toBe('NOT_ON_SALE');
  });
});

describe('2.4 未读与隐私（Mock）', () => {
  it('14. 未读只计有效未读；已读幂等；忽略后从列表消失', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t });
    await as('seller');
    for (let i = 0; i < 3; i++) await publish(`${t} ${i}`);
    await login(buyer);
    expect(await api.getDemandUnreadCount()).toBe(3);
    const [first, second] = (await api.listDemandMatches()).items;
    expect(await api.markDemandMatchRead(first.id)).toBe(2);
    expect(await api.markDemandMatchRead(first.id)).toBe(2);
    expect(await api.dismissDemandMatch(second.id)).toBe(1);
    expect((await api.listDemandMatches()).items).toHaveLength(2);
  });

  it('15. 他人无法读写我的匹配；收件箱里的商品不带卖家联系方式', async () => {
    const buyer = await as('buyer');
    const t = tag();
    await api.createDemandSubscription({ keyword: t });
    await as('seller');
    await publish(`${t} 台灯`);
    await login(buyer);
    const [match] = (await api.listDemandMatches()).items;
    expect(match.product.contact).toBe('');

    await as('stranger');
    expect(await code(api.markDemandMatchRead(match.id))).toBe(404);
    expect(await code(api.dismissDemandMatch(match.id))).toBe(404);
    expect((await api.listDemandMatches()).items).toEqual([]);
  });
});

describe('2.6 Mock schema v4 迁移', () => {
  function v3Payload(): Record<string, unknown> {
    return {
      schemaVersion: 3,
      users: [{ id: 'u1', account: 'a', password: 'p', nickname: 'n', avatar: '', campus: '东校区', contact: 'c', createdAt: 1, dormBuildingId: 'east-qinyuan-1' }],
      buildings: [{ id: 'east-qinyuan-1', campusId: '东校区', zone: '沁园', name: '1号楼', latitude: 31, longitude: 121 }],
      market: {
        products: [{ id: 'p1', sellerId: 'u1', title: 't', description: 'd', price: 1, category: '生活用品', condition: '全新',
          campus: '东校区', images: [], status: '在售', views: 0, createdAt: 1, buildingId: 'east-qinyuan-1' }],
        orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 1, status: '待确认',
          canonicalStatus: 'PENDING_SELLER_CONFIRM', createdAt: 1, updatedAt: 1 }],
        comments: [], favorites: [], conversations: [], messages: [],
      },
      idempotency: {},
    };
  }
  const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

  it('16. v3 → v4：订阅与匹配为空数组，不伪造历史；楼栋补齐启用状态并加入停用演示楼', () => {
    const { db, applied } = migrateMockDatabase(v3Payload(), seed);
    // 模块 3、4 之后当前版本为 6：v3 库依次经过 v3→v4、v4→v5、v5→v6，v4 这一步的结果不变
    expect(applied).toHaveLength(MOCK_SCHEMA_VERSION - 3);
    expect(applied[0]).toMatch(/^v3→v4/);
    expect(applied[1]).toMatch(/^v4→v5/);
    expect(db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(db.demandSubscriptions).toEqual([]);
    expect(db.demandMatches).toEqual([]);
    expect(db.buildings.find((b) => b.id === 'east-qinyuan-1')?.active).toBe(true);
    expect(db.buildings.find((b) => b.id === 'east-songyuan-6')?.active).toBe(false);
  });

  it('17. 不影响楼栋关联与订单迁移结果；二次迁移幂等', () => {
    const first = migrateMockDatabase(v3Payload(), seed);
    expect(first.db.users[0].dormBuildingId).toBe('east-qinyuan-1');
    expect(first.db.market.products[0].buildingId).toBe('east-qinyuan-1');
    expect(first.db.market.orders[0].canonicalStatus).toBe('PENDING_SELLER_CONFIRM');

    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });
});

describe('前端规则与后端一致', () => {
  it('18. 规范化：全角空格、连续空白、大小写', () => {
    expect(normalizeDemandText('  AirPods　Pro   2 ')).toBe('airpods pro 2');
  });

  it('19. 评分表与后端 DemandScorer 一致（覆盖每个理由码）', () => {
    const base = { normalizedKeyword: 'kw', category: null, minPrice: null, maxPrice: null, geoScope: 'SCHOOL' as const, campusId: null, buildingId: null, anchorZone: null };
    const product = { normalizedTitle: 'kw', normalizedDescription: '', category: '数码电子', price: 50, campus: '东校区', buildingId: 'b1', zone: 'Z' };
    expect(scoreDemandMatch(base, product)).toEqual({ score: 50, reasonCodes: ['KEYWORD_TITLE_EXACT'] });
    expect(scoreDemandMatch(base, { ...product, normalizedTitle: 'kw x' }).score).toBe(40);
    expect(scoreDemandMatch(base, { ...product, normalizedTitle: 'x', normalizedDescription: 'kw' }).score).toBe(20);
    expect(scoreDemandMatch({ ...base, geoScope: 'ZONE', campusId: '东校区', buildingId: 'b2', anchorZone: 'Z' }, product).reasonCodes).toContain('SAME_ZONE');
    expect(scoreDemandMatch({ ...base, geoScope: 'CAMPUS', campusId: '东校区' }, product).reasonCodes).toContain('SAME_CAMPUS');
    expect(scoreDemandMatch({ ...base, minPrice: 0, maxPrice: 100 }, product).reasonCodes).toContain('PRICE_CLOSE');
    expect(scoreDemandMatch({ ...base, minPrice: 0, maxPrice: 100 }, { ...product, price: 80 }).reasonCodes).not.toContain('PRICE_CLOSE');
    expect(mockTier(60)).toBe('HIGH');
    expect(mockTier(59)).toBe('NORMAL');
  });

  it('20. 条件描述写清具体范围', () => {
    expect(describeConditions({ keyword: '台灯', category: '生活用品', minPrice: 10, maxPrice: 50, geoScope: 'BUILDING', zone: '沁园', buildingName: '1号楼' }))
      .toBe('关键词「台灯」 · 生活用品 · ¥10–¥50 · 本楼：沁园1号楼');
  });
});

describe('REST 适配层路径', () => {
  it('21. 八个接口走约定路径，身份字段从不出现在请求体', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(url), init?.body as string | undefined]);
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { count: 0, items: [], outcome: 'CREATED', subscription: {} } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.createDemandSubscription({ keyword: '台灯' });
    await rest.listDemandSubscriptions();
    await rest.updateDemandSubscription('s1', { active: false });
    await rest.deleteDemandSubscription('s1');
    await rest.listDemandMatches(2, 10);
    await rest.getDemandUnreadCount();
    await rest.markDemandMatchRead('m1');
    await rest.dismissDemandMatch('m1');
    expect(calls.map(([m, u]) => `${m} ${u}`)).toEqual([
      'POST /v1/demand-subscriptions', 'GET /v1/demand-subscriptions', 'PATCH /v1/demand-subscriptions/s1',
      'DELETE /v1/demand-subscriptions/s1', 'GET /v1/demand-matches?page=2&pageSize=10',
      'GET /v1/demand-matches/unread-count', 'POST /v1/demand-matches/m1/read', 'POST /v1/demand-matches/m1/dismiss',
    ]);
    for (const [, , body] of calls) {
      if (body) expect(body).not.toMatch(/userId|schoolId|fingerprint/);
    }
  });
});
