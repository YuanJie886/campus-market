// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, freshCatalog, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { seedEditions } from '../data/courseCatalog';

/**
 * 十一、Mock schema v7：v1～v6 均可升级；只补空结构，旧商品为单件、旧订单不猜成交价、不伪造协助关系；
 * 4.8 只修正与 V6 种子逐项精确匹配的演示 ISMN；损坏记录逐条隔离；更高版本不降级；邀请码不以明文落盘。
 */
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);
const users = [
  { id: 'u1', account: 'seller', password: 'test-password', nickname: '卖家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
  { id: 'u2', account: 'buyer', password: 'test-password', nickname: '买家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
];
/** V6 时代写入的演示教材（带 979-0 号码） */
const V6_EDITIONS = seedEditions.map((e) => {
  const ismn: Record<string, string> = {
    'demo-calculus-7': '9790000001015', 'demo-calculus-8': '9790000001022', 'demo-linear-algebra-3': '9790000002012',
    'demo-physics-5': '9790000003019', 'demo-programming-2': '9790000004016',
  };
  return ismn[e.id] ? { ...e, isbn13: ismn[e.id], normalizedIsbn: ismn[e.id], noIsbnFingerprint: null } : { ...e };
});

function payload(version: number | null): Record<string, unknown> {
  const base: Record<string, unknown> = {
    users,
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '旧的台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区', images: [], status: '已售出', views: 0, createdAt: 1, buildingId: null }],
      orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '已完成', canonicalStatus: 'COMPLETED', createdAt: 1, updatedAt: 1 }],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {},
  };
  if (version !== null) base.schemaVersion = version;
  if (version !== null && version >= 3) base.buildings = [];
  if (version !== null && version >= 4) { base.demandSubscriptions = []; base.demandMatches = [] }
  if (version !== null && version >= 5) Object.assign(base, { productDisclosures: {}, orderInspections: {}, meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [] });
  if (version !== null && version >= 6) {
    base.catalog = { ...freshCatalog(), editions: V6_EDITIONS.map((e) => ({ ...e, authors: [...e.authors] })) };
    base.productTextbooks = { p1: { schoolId: 'pilot', textbookEditionId: 'demo-calculus-8', isbnSnapshot: '9790000001022', titleSnapshot: 't', editionSnapshot: '第 8 版', publisherSnapshot: 'p', createdAt: 1, updatedAt: 1 } };
    base.textbookSuggestions = [];
  }
  return base;
}

beforeEach(() => window.localStorage.clear());

describe('十一 Mock schema v7 迁移', () => {
  it.each([null, 1, 2, 3, 4, 5, 6])(
    '起点 v%s → 当前版本：包含 v6→v7；旧商品为单件、旧订单不猜成交价、不伪造草稿 / 批次 / 邀请',
    (from) => {
      const { db, applied, discarded } = migrateMockDatabase(payload(from), seed);
      expect(discarded).toBe(false);
      expect(applied).toHaveLength(MOCK_SCHEMA_VERSION - (from ?? 1));
      expect(applied.filter((name) => /^v6→v7/.test(name))).toHaveLength(1);
      expect(db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
      expect(db.market.products[0].listingKind).toBe('SINGLE');
      expect(db.market.orders[0].priceSnapshot).toBeNull();
      expect(db.market.orders[0].currency).toBeNull();
      expect([db.listingDrafts, db.listingBatches, db.listingPublishRequests, db.listingAssistInvites, db.listingAssistEvents]).toEqual([[], [], [], [], []]);
      expect(db.bundleItems).toEqual({});
      expect(db.productAttribution).toEqual({});
      expect(db.catalog.editions.filter((e) => e.normalizedIsbn?.startsWith('9790'))).toEqual([]);
    });

  it('4.8：只修正逐项精确匹配的 5 条演示 ISMN；被改过的演示行与用户数据原样保留；已修正版本的商品快照去掉号码', () => {
    const v6 = payload(6) as { catalog: { editions: Array<Record<string, unknown>> }; productTextbooks: Record<string, Record<string, unknown>> };
    v6.catalog.editions.find((e) => e.id === 'demo-physics-5')!.title = '大学物理（演示）· 上册（维护者修订）';
    v6.catalog.editions.push({ id: 'user-sheet-music', schoolId: 'pilot', isbn13: '9790000009998', normalizedIsbn: '9790000009998', title: '用户录入的乐谱', authors: ['a'], publisher: 'p', editionLabel: '第 1 版', publishedYear: null, workKey: null, noIsbnFingerprint: null, isDemo: false });
    v6.productTextbooks.p2 = { schoolId: 'pilot', textbookEditionId: 'demo-physics-5', isbnSnapshot: '9790000003019', titleSnapshot: 't', editionSnapshot: '第 5 版', publisherSnapshot: 'p', createdAt: 1, updatedAt: 1 };
    const { db } = migrateMockDatabase(v6, seed);
    const byId = new Map(db.catalog.editions.map((e) => [e.id, e]));
    for (const id of ['demo-calculus-7', 'demo-calculus-8', 'demo-linear-algebra-3', 'demo-programming-2']) {
      expect(byId.get(id)).toMatchObject({ isbn13: null, normalizedIsbn: null, noIsbnFingerprint: seedEditions.find((e) => e.id === id)!.noIsbnFingerprint });
    }
    expect(byId.get('demo-physics-5')).toMatchObject({ normalizedIsbn: '9790000003019', noIsbnFingerprint: null });
    expect(byId.get('user-sheet-music')).toMatchObject({ normalizedIsbn: '9790000009998', isDemo: false });
    expect(db.productTextbooks.p1.isbnSnapshot).toBeNull();
    expect(db.productTextbooks.p2.isbnSnapshot).toBe('9790000003019');
  });

  it('幂等：v7 再迁移是空操作，内容深度相等', () => {
    const first = migrateMockDatabase(payload(6), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(second.skippedRecords).toBe(0);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('损坏记录逐条隔离：坏草稿 / 批次 / 带明文邀请码或形状不对的邀请 / 坏明细只丢弃该条', () => {
    const db = JSON.parse(JSON.stringify(migrateMockDatabase(payload(6), seed).db));
    db.listingDrafts = [{ id: 'd1', ownerId: 'u1', editorId: 'u1', draftType: 'SINGLE', payload: {}, version: 1, status: 'DRAFT', expiresAt: 9e15, publishedProductId: null, createdAt: 1, updatedAt: 1 }, { id: 'broken' }, 7];
    db.listingBatches = [{ id: 'b1', ownerId: 'u1', items: [] }, { id: 'b2' }];
    db.listingAssistInvites = [
      { id: 'i1', ownerId: 'u1', tokenHash: 'a'.repeat(64), status: 'PENDING' },
      { id: 'i2', ownerId: 'u1', tokenHash: 'a'.repeat(64), token: 'plain-text-token', status: 'PENDING' },
      { id: 'i3', ownerId: 'u1', tokenHash: 'not-a-hash' },
    ];
    db.bundleItems = { p9: [{ name: 'x', quantity: 1 }], p8: 'broken' };
    const result = migrateMockDatabase(db, seed);
    expect(result.discarded).toBe(false);
    expect(result.skippedRecords).toBe(6);
    expect(result.db.listingDrafts.map((d) => d.id)).toEqual(['d1']);
    expect(result.db.listingBatches.map((b) => b.id)).toEqual(['b1']);
    expect(result.db.listingAssistInvites.map((i) => i.id)).toEqual(['i1']);
    expect(Object.keys(result.db.bundleItems)).toEqual(['p9']);
  });

  it('装载旧 v6 负载：落盘为 v7、不动无关 key；更高版本不被降级或覆盖', () => {
    window.localStorage.setItem('unrelated_key', 'keep-me');
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(payload(6)));
    new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(window.localStorage.getItem('unrelated_key')).toBe('keep-me');

    const future = JSON.stringify({ ...payload(6), schemaVersion: MOCK_SCHEMA_VERSION + 1 });
    window.localStorage.setItem(DB_STORAGE_KEY, future);
    new MockCampusMarketApi();
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBe(future);
  });

  it('邀请码不以明文写入任何浏览器存储', async () => {
    const api = new MockCampusMarketApi();
    await api.register({ account: `o-${Math.random()}`, password: 'test-password', nickname: 'o', campus: '东校区', contact: '1' });
    const draft = await api.createListingDraft({ payload: { title: 't' } });
    const { token } = await api.createAssistInvite({ draftId: draft.id });
    const everything = [...Object.keys(window.localStorage).map((k) => window.localStorage.getItem(k)),
      ...Object.keys(window.sessionStorage).map((k) => window.sessionStorage.getItem(k))].join('\n');
    expect(everything).not.toContain(token);
  });
});
