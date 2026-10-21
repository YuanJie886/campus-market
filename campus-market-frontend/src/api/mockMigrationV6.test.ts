// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, freshCatalog, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';

/**
 * 4.7 Mock schema v6：v1～v5 均可升级；植入演示目录（参考数据），不猜旧商品版本、不伪造选课 / 订阅 / 建议。
 */
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

const users = [
  { id: 'u1', account: 'seller', password: 'test-password', nickname: '卖家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
  { id: 'u2', account: 'buyer', password: 'test-password', nickname: '买家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
];
function payload(version: number | null): Record<string, unknown> {
  const base: Record<string, unknown> = {
    users,
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '微积分教程（演示） 第 8 版', description: '旧的教材商品', price: 20, category: '教材书籍',
        condition: '全新', campus: '东校区', images: [], status: '在售', views: 0, createdAt: 1, buildingId: null }],
      orders: [], comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {},
  };
  if (version !== null) base.schemaVersion = version;
  if (version !== null && version >= 3) base.buildings = [{ id: 'east-qinyuan-1', campusId: '东校区', zone: '沁园', name: '1号楼', latitude: 31, longitude: 121, active: true }];
  if (version !== null && version >= 4) {
    base.demandSubscriptions = [{ id: 'ds1', userId: 'u2', schoolId: 'pilot', keyword: '微积分', normalizedKeyword: '微积分', category: '教材书籍',
      minPrice: null, maxPrice: null, geoScope: 'SCHOOL', campusId: null, buildingId: null,
      fingerprint: 'v1\nkw=微积分\ncat=教材书籍\nmin=\nmax=\ngeo=SCHOOL\nanchor=', active: true, createdAt: 1, updatedAt: 1 }];
    base.demandMatches = [];
  }
  if (version !== null && version >= 5) {
    Object.assign(base, { productDisclosures: {}, orderInspections: {}, meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [] });
  }
  return base;
}

beforeEach(() => window.localStorage.clear());

describe('4.7 schema v6 迁移', () => {
  // 模块 5 起当前版本为 7：v5→v6 之后还有一步 v6→v7
  it.each([null, 1, 2, 3, 4, 5])(
    '起点 v%s → 当前版本：依次执行到当前版本，包含 v5→v6；目录为演示数据，商品未被猜版本，旧订阅原样',
    (from) => {
      const { db, applied, discarded } = migrateMockDatabase(payload(from), seed);
      expect(discarded).toBe(false);
      expect(applied).toHaveLength(MOCK_SCHEMA_VERSION - (from ?? 1));
      expect(applied.filter((name) => /^v5→v6/.test(name))).toHaveLength(1);
      expect(db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
      expect(db.catalog).toEqual(freshCatalog());
      expect(db.catalog.courses.every((c) => c.isDemo)).toBe(true);
      expect(db.productTextbooks).toEqual({});
      expect(db.textbookSuggestions).toEqual([]);
      if (from !== null && from >= 4) {
        expect(db.demandSubscriptions[0].fingerprint).toBe('v1\nkw=微积分\ncat=教材书籍\nmin=\nmax=\ngeo=SCHOOL\nanchor=');
        expect(db.demandSubscriptions[0].textbookEditionId ?? null).toBeNull();
      }
    });

  it('幂等：v6 再迁移是空操作，内容完全一致', () => {
    const first = migrateMockDatabase(payload(5), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(second.skippedRecords).toBe(0);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('单条损坏的目录行 / 关联 / 建议只丢弃该条；目录整体损坏时回退演示目录', () => {
    const db = JSON.parse(JSON.stringify(migrateMockDatabase(payload(5), seed).db));
    db.catalog.courses.push(null, { id: 'x' });
    db.catalog.editions.push({ id: 'bad', title: 't' });
    db.productTextbooks = { p1: 'broken', p2: { textbookEditionId: 'demo-calculus-8', schoolId: 'pilot' } };
    db.textbookSuggestions = [{ id: 's1', submitterId: 'u2' }, 42];
    const result = migrateMockDatabase(db, seed);
    expect(result.discarded).toBe(false);
    expect(result.skippedRecords).toBe(5);
    expect(result.db.catalog.courses).toHaveLength(5);
    expect(Object.keys(result.db.productTextbooks)).toEqual(['p2']);
    expect(result.db.textbookSuggestions).toHaveLength(1);

    const broken = JSON.parse(JSON.stringify(migrateMockDatabase(payload(5), seed).db));
    broken.catalog = 'not-an-object';
    expect(migrateMockDatabase(broken, seed).db.catalog).toEqual(freshCatalog());
  });

  it('装载旧 v5 负载：落盘为当前版本、不动无关 key；旧教材商品 textbook 为 null；旧订阅照常可用', async () => {
    window.localStorage.setItem('unrelated_key', 'keep-me');
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(payload(5)));
    const api = new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(window.localStorage.getItem('unrelated_key')).toBe('keep-me');
    // 6.1A 起读取商品需要登录
    await api.login({ account: 'buyer', password: 'test-password' });
    expect((await api.getProduct('p1')).textbook).toBeNull();
    const subs = await api.listDemandSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].textbook ?? null).toBeNull();
    expect((await api.listCourses({})).total).toBe(5);
  });

  it('更高版本（v7）不被 v6 代码降级或覆盖', () => {
    const future = JSON.stringify({ ...payload(5), schemaVersion: MOCK_SCHEMA_VERSION + 1 });
    window.localStorage.setItem(DB_STORAGE_KEY, future);
    new MockCampusMarketApi();
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBe(future);
  });
});
