// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';

/** 5.7 Mock schema v8：订单增加冻结的统计维度；旧订单一律为 null，不从商品当前值回填；幂等。 */
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

function v7(): Record<string, unknown> {
  return {
    schemaVersion: 7,
    users: [{ id: 'u1', account: 'seller', password: 'p', nickname: 's', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 }],
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区',
        images: [], status: '已售出', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE' }],
      orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '已完成', canonicalStatus: 'COMPLETED',
        createdAt: 1, updatedAt: 1, priceSnapshot: 20, currency: 'CNY' }],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {}, buildings: [], demandSubscriptions: [], demandMatches: [], productDisclosures: {}, orderInspections: {},
    meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [],
    productTextbooks: {}, textbookSuggestions: [], listingDrafts: [], listingBatches: [], listingPublishRequests: [],
    listingAssistInvites: [], listingAssistEvents: [], assistSeq: 0, bundleItems: {}, productAttribution: {},
  };
}

beforeEach(() => window.localStorage.clear());

describe('5.7 Mock schema v8', () => {
  it('v7 → v8：V7 时期的订单保留成交价快照，五个维度显式为 null，不从商品回填；二次迁移深度相等', () => {
    const first = migrateMockDatabase(v7(), seed);
    expect(first.applied.filter((name) => /^v7→v8/.test(name))).toHaveLength(1);
    const order = first.db.market.orders[0];
    expect(order.priceSnapshot).toBe(20);
    expect([order.schoolIdSnapshot, order.categorySnapshot, order.conditionSnapshot, order.listingKindSnapshot, order.textbookEditionIdSnapshot])
      .toEqual([null, null, null, null, null]);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });
});
