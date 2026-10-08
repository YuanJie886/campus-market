// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';

/**
 * 模块 6 Mock schema v9：旧商品一律 PUBLIC；不创建任何圈子、不替任何人入圈、不编造班级或社团身份；
 * 更高版本不降级；邀请码原文不落盘；幂等。
 */
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

function v8(): Record<string, unknown> {
  return {
    schemaVersion: 8,
    users: [
      { id: 'u1', account: 'seller', password: 'p', nickname: 's', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
      { id: 'u2', account: 'buyer', password: 'p', nickname: 'b', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
    ],
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区',
        images: [], status: '在售', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE' }],
      orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '已完成', canonicalStatus: 'COMPLETED',
        createdAt: 1, updatedAt: 1, priceSnapshot: 20, currency: 'CNY', schoolIdSnapshot: 'pilot', categorySnapshot: '生活用品',
        conditionSnapshot: '全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: null }],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {}, buildings: [],
    demandSubscriptions: [{ id: 's1', userId: 'u2', keyword: '台灯', normalizedKeyword: '台灯', category: null, minPrice: null, maxPrice: null,
      geoScope: 'SCHOOL', campusId: null, buildingId: null, zone: null, fingerprint: 'f', active: true, createdAt: 1, updatedAt: 1 }],
    demandMatches: [], productDisclosures: {}, orderInspections: {},
    meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [],
    productTextbooks: {}, textbookSuggestions: [], listingDrafts: [], listingBatches: [], listingPublishRequests: [],
    listingAssistInvites: [], listingAssistEvents: [], assistSeq: 0, bundleItems: {}, productAttribution: {},
  };
}

beforeEach(() => window.localStorage.clear());

describe('6 Mock schema v9', () => {
  it('v8 → v9：旧商品 PUBLIC；圈子相关集合为空；旧订阅 circleId=null；旧订单可见性快照 null；二次迁移深度相等', () => {
    const first = migrateMockDatabase(v8(), seed);
    expect(first.applied.filter((name) => /^v8→v9/.test(name))).toHaveLength(1);
    expect(first.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(first.db.market.products[0].visibility).toBe('PUBLIC');
    expect(first.db.circles).toEqual([]);
    expect(first.db.circleMemberships).toEqual([]);
    expect(first.db.circleInvites).toEqual([]);
    expect(first.db.productCircleVisibility).toEqual({});
    expect((first.db.demandSubscriptions[0] as { circleId?: unknown }).circleId).toBeNull();
    expect(first.db.market.orders[0].visibilitySnapshot).toBeNull();
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('v1～v8 任一版本都能升到 v9，且不会替任何人创建圈子或入圈', () => {
    for (let version = 1; version <= 8; version += 1) {
      const raw = { ...v8(), schemaVersion: version };
      const result = migrateMockDatabase(raw, seed);
      expect(result.db.schemaVersion, `v${version}`).toBe(MOCK_SCHEMA_VERSION);
      expect(result.db.circles, `v${version}`).toEqual([]);
      expect(result.db.circleMemberships, `v${version}`).toEqual([]);
      expect(result.db.market.products.every((p) => p.visibility === 'PUBLIC'), `v${version}`).toBe(true);
    }
  });

  it('更高版本不降级、不覆盖：本次会话用种子在内存里跑，存储里的原数据保持原样', () => {
    const future = { ...v8(), schemaVersion: MOCK_SCHEMA_VERSION + 1, circles: [{ id: 'future' }] };
    const result = migrateMockDatabase(future, seed);
    expect(result.persistable).toBe(false);
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(future));
    const api = new MockCampusMarketApi();
    void api;
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION + 1);
  });

  it('损坏或带明文邀请码 / official 字段的圈子记录逐条丢弃；损坏的可见关系不会让私密商品变成公开', () => {
    const raw = {
      ...v8(), schemaVersion: MOCK_SCHEMA_VERSION,
      circles: [
        { id: 'c1', schoolId: 'pilot', type: 'CLUB', name: '好圈', description: '', visibility: 'PRIVATE', ownerId: 'u1', status: 'ACTIVE', createdAt: 1, updatedAt: 1, archivedAt: null },
        { id: 'c2', schoolId: 'pilot', type: 'CLASS', name: '冒充官方', ownerId: 'u1', official: true },
        'garbage',
      ],
      circleMemberships: [
        { circleId: 'c1', userId: 'u1', role: 'OWNER', status: 'ACTIVE', joinedAt: 1, updatedAt: 1, endedAt: null },
        { circleId: 'c2', userId: 'u1', role: 'OWNER', status: 'ACTIVE', joinedAt: 1, updatedAt: 1, endedAt: null },
        { circleId: 'c1', userId: 'u2', role: 'ADMIN', status: 'ACTIVE' },
      ],
      circleInvites: [
        { id: 'i1', circleId: 'c1', tokenHash: 'a'.repeat(64), status: 'PENDING' },
        { id: 'i2', circleId: 'c1', tokenHash: 'b'.repeat(64), token: 'plain-text-token', status: 'PENDING' },
      ],
      circleEvents: [], circleSeq: 0,
      productCircleVisibility: { p1: ['c1', 'missing-circle'] },
    };
    ((raw as Record<string, unknown>).market as { products: Array<Record<string, unknown>> }).products[0].visibility = 'CIRCLE_ONLY';
    const result = migrateMockDatabase(raw, seed);
    expect(result.db.circles.map((c) => c.id)).toEqual(['c1']);
    expect(result.db.circleMemberships.map((m) => `${m.circleId}:${m.userId}`)).toEqual(['c1:u1']);
    expect(result.db.circleInvites.map((i) => i.id)).toEqual(['i1']);
    expect(JSON.stringify(result.db)).not.toContain('plain-text-token');
    expect(result.db.productCircleVisibility).toEqual({});
    expect(result.db.market.products[0].visibility).toBe('CIRCLE_ONLY');
    expect(result.skippedRecords).toBeGreaterThan(0);
  });

  it('全新种子不含任何圈子：没有预置的班级 / 社团身份', async () => {
    const api = new MockCampusMarketApi();
    await api.register({ account: `fresh-${Date.now()}`, password: 'test-password', nickname: 'n', campus: '东校区', contact: '1' });
    expect(await api.listMyCircles()).toEqual([]);
    expect(await api.discoverCircles()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).circles).toEqual([]);
  });
});
