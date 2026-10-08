import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import type { FeedQuery } from './contracts';
import type { Campus } from '../types';
import { fullDisclosure } from '../test/inspectionFixtures';

/**
 * 楼栋集市的 Mock 契约（1.2 / 1.3 / 1.6）。
 *
 * <p>Mock 必须和 REST 讲同一个故事：同样的降级顺序、同样的错误码、同样的字段。
 * 否则离线演示里「本楼有 3 件」，连上后端变成「本楼没有」，没人能说清谁对。
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

const DB_KEY = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true });
  api = new MockCampusMarketApi();
});

async function registerAs(prefix: string, campus: Campus = '东校区') {
  return api.register({
    account: `${prefix}-${Math.random().toString(36).slice(2)}`,
    password: 'test-password', nickname: prefix, campus, contact: '13800000000',
  });
}

async function publish(tag: string, campus: Campus, buildingId: string | null, category = '生活用品' as const) {
  return api.createProduct({
    title: `${tag} 商品`, description: tag, price: 30, category, condition: '全新', campus,
    images: ['https://example.invalid/a.png'], contact: '13800000000', buildingId,
    inspection: fullDisclosure(category),
  });
}

function query(overrides: Partial<FeedQuery>): FeedQuery {
  return { scope: 'SCHOOL', sort: 'latest', page: 1, pageSize: 50, ...overrides };
}

const tag = () => `t${Math.random().toString(36).slice(2, 10)}`;

async function expectApiError(promise: Promise<unknown>, code: number) {
  const error = await promise.then(() => null).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe(code);
}

describe('1.2 楼栋查询与资料', () => {
  it('1. 按校区列楼栋，zone 可过滤，字段与 REST 一致', async () => {
    const east = await api.listBuildings('东校区');
    expect(east).toHaveLength(5);
    expect(Object.keys(east[0]).sort()).toEqual(['campusId', 'id', 'latitude', 'longitude', 'name', 'zone']);

    const songyuan = await api.listBuildings('东校区', '松园');
    expect(songyuan.map((b) => b.name)).toEqual(['4号楼', '5号楼']);
  });

  it('2. 宿舍楼：同校区成功、跨校区 400、不存在 404、可显式清空', async () => {
    await registerAs('dorm');
    expect((await api.updateProfile({ dormBuildingId: 'east-qinyuan-2' })).dormBuildingId).toBe('east-qinyuan-2');
    await expectApiError(api.updateProfile({ dormBuildingId: 'west-zhuyuan-1' }), 400);
    await expectApiError(api.updateProfile({ dormBuildingId: 'no-such' }), 404);
    expect((await api.updateProfile({ dormBuildingId: null })).dormBuildingId).toBeNull();
  });

  it('3. 同时改校区与宿舍楼时按新校区校验', async () => {
    await registerAs('move');
    const moved = await api.updateProfile({ campus: '西校区', dormBuildingId: 'west-meiyuan-3' });
    expect(moved.campus).toBe('西校区');
    expect(moved.dormBuildingId).toBe('west-meiyuan-3');
  });

  it('4. 公共用户投影不含宿舍楼', async () => {
    const session = await registerAs('priv');
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    const publicUser = await api.getUser(session.user.id);
    // 白名单投影：与后端 DomainMapper.user(row, false) 的字段集合完全一致
    expect(Object.keys(publicUser).sort()).toEqual(['avatar', 'campus', 'createdAt', 'id', 'nickname']);
    expect(JSON.stringify(publicUser)).not.toContain('east-qinyuan-1');
  });
});

describe('1.2 商品取货楼栋', () => {
  it('5. 创建时关联楼栋并带出楼名与园区；跨校区 400；不存在 404', async () => {
    await registerAs('seller');
    const product = await publish(tag(), '东校区', 'east-songyuan-4');
    expect(product.buildingName).toBe('4号楼');
    expect(product.buildingZone).toBe('松园');

    await expectApiError(publish(tag(), '东校区', 'west-zhuyuan-1'), 400);
    await expectApiError(publish(tag(), '东校区', 'no-such'), 404);
  });

  it('6. 不指定楼栋合法，旧商品 buildingId=null 仍可读', async () => {
    await registerAs('seller');
    const product = await publish(tag(), '东校区', null);
    const detail = await api.getProduct(product.id);
    expect(detail.buildingId).toBeNull();
    expect(detail.buildingName).toBeNull();
    expect(detail.campus).toBe('东校区');
  });

  it('7. 切换校区语义与 REST 一致：原楼栋不属于新校区且未给 buildingId → 400', async () => {
    await registerAs('seller');
    const product = await publish(tag(), '东校区', 'east-qinyuan-1');

    await expectApiError(api.updateProduct(product.id, { campus: '西校区' }), 400);
    expect((await api.getProduct(product.id)).campus).toBe('东校区');

    const moved = await api.updateProduct(product.id, { campus: '西校区', buildingId: 'west-zhuyuan-2' });
    expect(moved.buildingId).toBe('west-zhuyuan-2');

    const cleared = await api.updateProduct(product.id, { campus: '南校区', buildingId: null });
    expect(cleared.buildingId).toBeNull();
  });
});

describe('1.3 Mock feed 与 REST 行为一致', () => {
  async function resident() {
    await registerAs('seller');
    return async (fn: () => Promise<void>) => {
      await registerAs('resident');
      await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
      await fn();
    };
  }

  it('8. 四级降级依次为 BUILDING → ZONE → CAMPUS → SCHOOL，最后才是真空态', async () => {
    const cases: Array<[string | null, Campus, string]> = [
      ['east-qinyuan-1', '东校区', 'BUILDING'],
      ['east-qinyuan-2', '东校区', 'ZONE'],
      ['east-songyuan-4', '东校区', 'CAMPUS'],
      ['west-zhuyuan-1', '西校区', 'SCHOOL'],
    ];
    for (const [building, campus, expected] of cases) {
      await registerAs('seller');
      const t = tag();
      await publish(t, campus, building);
      await registerAs('resident');
      await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
      const page = await api.feedProducts(query({ scope: 'BUILDING', keyword: t }));
      expect(page.effectiveScope, `商品在 ${building} 时应落在 ${expected}`).toBe(expected);
      expect(page.fallbackApplied).toBe(expected !== 'BUILDING');
    }

    const empty = await api.feedProducts(query({ scope: 'BUILDING', keyword: tag() }));
    expect(empty.effectiveScope).toBe('SCHOOL');
    expect(empty.fallbackReason).toBe('NO_RESULTS_IN_ANY_SCOPE');
    expect(empty.items).toEqual([]);
  });

  it('9. 降级保留分类条件，不拿别的分类凑数', async () => {
    const run = await resident();
    const t = tag();
    await publish(t, '东校区', 'east-qinyuan-1', '生活用品');
    await (async () => {
      // 在同一个卖家会话下补一件同园区的数码
      await api.createProduct({
        title: `${t} 数码`, description: t, price: 30, category: '数码电子', condition: '全新', campus: '东校区',
        images: ['https://example.invalid/a.png'], contact: '1', buildingId: 'east-qinyuan-2',
        inspection: fullDisclosure('数码电子'),
      });
    })();
    await run(async () => {
      const page = await api.feedProducts(query({ scope: 'BUILDING', keyword: t, category: '数码电子' }));
      expect(page.effectiveScope).toBe('ZONE');
      expect(page.items.every((item) => item.category === '数码电子')).toBe(true);
    });
  });

  it('10. 普通浏览（CAMPUS）为空时不扩大范围', async () => {
    await registerAs('seller');
    const t = tag();
    await publish(t, '西校区', 'west-zhuyuan-1');
    await registerAs('resident');
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    const page = await api.feedProducts(query({ scope: 'CAMPUS', keyword: t }));
    expect(page.effectiveScope).toBe('CAMPUS');
    expect(page.fallbackApplied).toBe(false);
    expect(page.total).toBe(0);
  });

  it('11. 未登录 401、未设宿舍楼 409——不用全校结果冒充本楼', async () => {
    await expectApiError(api.feedProducts(query({ scope: 'BUILDING' })), 401);
    await registerAs('nodorm');
    await expectApiError(api.feedProducts(query({ scope: 'BUILDING' })), 409);
    await expectApiError(api.feedProducts(query({ scope: 'SCHOOL', sort: 'nearest' })), 409);
  });

  it('12. nearest：同楼栋第一、按距离、无楼栋最后；同楼栋不给假距离', async () => {
    await registerAs('seller');
    const t = tag();
    const none = await publish(t, '东校区', null);
    const far = await publish(t, '东校区', 'east-songyuan-4');
    const near = await publish(t, '东校区', 'east-qinyuan-2');
    const home = await publish(t, '东校区', 'east-qinyuan-1');
    await registerAs('resident');
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });

    const page = await api.feedProducts(query({ scope: 'CAMPUS', sort: 'nearest', keyword: t }));
    expect(page.items.map((i) => i.id)).toEqual([home.id, near.id, far.id, none.id]);
    expect(page.items[0].sameBuilding).toBe(true);
    expect(page.items[0].approximateWalkMinutes).toBeNull();
    expect(page.items[1].approximateWalkMinutes).toBe(2);
    expect(page.items[2].approximateWalkMinutes).toBe(5);
    expect(page.items[3].approximateDistanceMeters).toBeNull();
  });

  it('13. 范围在分页前确定：第二页为空也不降级', async () => {
    await registerAs('seller');
    const t = tag();
    for (let i = 0; i < 2; i++) await publish(t, '东校区', 'east-qinyuan-1');
    for (let i = 0; i < 5; i++) await publish(t, '东校区', 'east-qinyuan-2');
    await registerAs('resident');
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });

    const page2 = await api.feedProducts(query({ scope: 'BUILDING', keyword: t, pageSize: 2, page: 2 }));
    expect(page2.effectiveScope).toBe('BUILDING');
    expect(page2.total).toBe(2);
    expect(page2.items).toEqual([]);
  });
});

describe('1.3 REST 适配层的 feed 请求', () => {
  it('14. 走独立的 /v1/products/feed，查询参数原样下发，0 元价格不被吞掉', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0, message: 'ok',
      data: { requestedScope: 'BUILDING', effectiveScope: 'ZONE', effectiveScopeLabel: '本园区',
        fallbackApplied: true, fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', items: [], page: 1, pageSize: 20, total: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    const page = await rest.feedProducts(query({ scope: 'BUILDING', minPrice: 0, keyword: '台灯' }));

    const url = String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain('/v1/products/feed?');
    expect(url).toContain('scope=BUILDING');
    expect(url).toContain('minPrice=0');
    expect(decodeURIComponent(url)).toContain('keyword=台灯');
    expect(page.effectiveScope).toBe('ZONE');
  });
});

describe('1.6 Mock schema 迁移（v3 楼栋部分，结果随后续版本前进）', () => {
  function v2Payload(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      users: [{ id: 'u1', account: 'a', password: 'p', nickname: 'n', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 }],
      market: {
        products: [{ id: 'p1', sellerId: 'u1', title: 't', description: 'd', price: 1, category: '生活用品',
          condition: '全新', campus: '东校区', images: [], status: '在售', views: 0, createdAt: 1 }],
        orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 1, status: '待确认',
          canonicalStatus: 'PENDING_SELLER_CONFIRM', createdAt: 1, updatedAt: 1 }],
        comments: [], favorites: [], conversations: [], messages: [],
      },
      idempotency: {},
    };
  }
  const seed = (): MockDatabase => ({ schemaVersion: MOCK_SCHEMA_VERSION, users: [], buildings: [],
    market: { products: [], orders: [], comments: [], favorites: [], conversations: [], messages: [] },
    idempotency: {}, currentUserId: null } as unknown as MockDatabase);

  it('15. v2 → v3：加入楼栋目录，但不替旧用户猜宿舍楼、不替旧商品分配楼栋', () => {
    const result = migrateMockDatabase(v2Payload(), seed);
    expect(result.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(result.db.buildings.length).toBeGreaterThanOrEqual(16);
    expect(result.db.users[0].dormBuildingId).toBeNull();
    expect(result.db.market.products[0].buildingId).toBeNull();
  });

  it('16. 二次迁移幂等，且不破坏 0.9 的订单迁移结果', () => {
    const first = migrateMockDatabase(v2Payload(), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
    expect(second.db.market.orders[0].canonicalStatus).toBe('PENDING_SELLER_CONFIRM');
  });

  it('17. 从 v1（无版本号的旧数据）一路迁到 v3', () => {
    const v1 = v2Payload();
    delete v1.schemaVersion;
    const orders = (v1.market as { orders: Array<Record<string, unknown>> }).orders;
    delete orders[0].canonicalStatus;
    const result = migrateMockDatabase(v1, seed);
    // v1→v2→v3→v4，每一步都执行
    expect(result.applied).toHaveLength(MOCK_SCHEMA_VERSION - 1);
    expect(result.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(result.db.market.orders[0].canonicalStatus).toBe('PENDING_SELLER_CONFIRM');
    expect(result.db.buildings.length).toBeGreaterThan(0);
  });

  it('18. 真实装载路径：旧 v2 数据被迁移落盘，无关 key 不受影响', () => {
    window.localStorage.setItem('unrelated', 'keep');
    window.localStorage.setItem(DB_KEY, JSON.stringify(v2Payload()));
    new MockCampusMarketApi();
    const persisted = JSON.parse(window.localStorage.getItem(DB_KEY) as string);
    expect(persisted.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(persisted.buildings.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
  });
});
