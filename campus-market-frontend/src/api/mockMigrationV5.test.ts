// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';

/**
 * 3.7A Mock schema v5：v1～v4 均可升级到 v5；只补空结构，不伪造任何验货、档期或到达事实。
 */
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

function market() {
  return {
    products: [{ id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 1, category: '生活用品', condition: '全新',
      campus: '东校区', images: [], status: '预约中', views: 0, createdAt: 1, buildingId: null }],
    orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 1, status: '交易中',
      canonicalStatus: 'PENDING_MEETING', meetingPointId: '东校区-library', meetingAtIso: '2030-01-01T10:00:00.000Z',
      createdAt: 1, updatedAt: 1 }],
    comments: [], favorites: [], conversations: [], messages: [],
  };
}
const users = [
  { id: 'u1', account: 'seller', password: 'test-password', nickname: '卖家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
  { id: 'u2', account: 'buyer', password: 'test-password', nickname: '买家', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
];
function payload(version: number | null): Record<string, unknown> {
  const base: Record<string, unknown> = { users, market: market(), idempotency: {} };
  if (version !== null) base.schemaVersion = version;
  if (version !== null && version >= 3) base.buildings = [{ id: 'east-qinyuan-1', campusId: '东校区', zone: '沁园', name: '1号楼', latitude: 31, longitude: 121, active: true }];
  if (version !== null && version >= 4) { base.demandSubscriptions = []; base.demandMatches = []; }
  return base;
}

function expectNoFabrication(db: MockDatabase) {
  expect(db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
  expect(db.productDisclosures).toEqual({});
  expect(db.orderInspections).toEqual({});
  expect(db.meetingProposals).toEqual([]);
  expect(db.presence).toEqual([]);
  expect(db.flowEvents).toEqual([]);
  const order = db.market.orders.find((o) => o.id === 'o1')!;
  expect(order.meetingRevision).toBe(0);
  expect(order.codeAttempts).toBe(0);
  expect(order.meetingAtIso).toBe('2030-01-01T10:00:00.000Z');
}

beforeEach(() => window.localStorage.clear());

describe('3.7A schema v5 迁移', () => {
  // 步数由当前版本推出：以后每加一个版本，每个起点多一步，v4→v5 这一步的结果不变
  it.each([null, 1, 2, 3, 4])('起点 v%s → 当前版本：依次执行到当前版本，其中包含 v4→v5，不伪造可信面交事实', (from) => {
    const result = migrateMockDatabase(payload(from), seed);
    expect(result.discarded).toBe(false);
    expect(result.applied).toHaveLength(MOCK_SCHEMA_VERSION - (from ?? 1));
    expect(result.applied.filter((name) => /^v4→v5/.test(name))).toHaveLength(1);
    expect(result.applied[result.applied.length - 1]).toMatch(new RegExp(`^v${MOCK_SCHEMA_VERSION - 1}→v${MOCK_SCHEMA_VERSION}`));
    expectNoFabrication(result.db);
  });

  it('幂等：v5 再迁移是空操作，内容完全一致', () => {
    const first = migrateMockDatabase(payload(4), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(second.skippedRecords).toBe(0);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('v5 中单条损坏的提议 / 到达 / 事件 / 快照只丢弃该条，其余完好', () => {
    const db = JSON.parse(JSON.stringify(migrateMockDatabase(payload(4), seed).db));
    db.meetingProposals = [null, 'x', { id: 'mp1', orderId: 'o1', status: 'PENDING' }];
    db.presence = [{ orderId: 'o1' }, { orderId: 'o1', userId: 'u2', revision: 0, status: 'DEPARTED' }];
    db.flowEvents = [{ seq: 7, orderId: 'o1', code: 'ORDER_CREATED', at: 1 }, { seq: 'bad' }];
    db.orderInspections = { o1: { status: 'PENDING', items: [] }, broken: 'nope' };
    db.productDisclosures = { p1: 42 };
    const result = migrateMockDatabase(db, seed);
    expect(result.discarded).toBe(false);
    expect(result.skippedRecords).toBe(6);
    expect(result.db.meetingProposals.map((p) => p.id)).toEqual(['mp1']);
    expect(result.db.presence).toHaveLength(1);
    expect(result.db.flowEvents.map((e) => e.seq)).toEqual([7]);
    expect(result.db.flowSeq).toBe(7);   // 新事件序号不会与已有事件冲突
    expect(Object.keys(result.db.orderInspections)).toEqual(['o1']);
    expect(result.db.productDisclosures).toEqual({});
    expect(result.db.market.orders).toHaveLength(1);
  });

  it('装载旧 v4 负载：落盘为当前版本、不动无关 key；旧商品无声明、旧订单为 LEGACY_NONE 且可继续交易', async () => {
    window.localStorage.setItem('unrelated_key', 'keep-me');
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(payload(4)));
    const api = new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(window.localStorage.getItem('unrelated_key')).toBe('keep-me');

    // 6.1A 起读取商品需要登录
    await api.login({ account: 'buyer', password: 'test-password' });
    expect((await api.getProduct('p1')).inspection).toBeNull();
    const flow = await api.getOrderFlow('o1');
    expect(flow.inspection).toEqual({ status: 'LEGACY_NONE', items: [] });
    expect(flow.presence.me.status).toBe('NOT_STARTED');
    expect(flow.proposals).toEqual([]);
    expect(flow.timeline).toEqual([]);
    const confirmed = await api.transitionOrder('o1', { to: 'BUYER_CONFIRMED' });
    expect(confirmed.canonicalStatus).toBe('BUYER_CONFIRMED');
  });

  it('更高版本（v6）不被 v5 代码降级或覆盖', () => {
    const future = JSON.stringify({ ...payload(4), schemaVersion: MOCK_SCHEMA_VERSION + 1 });
    window.localStorage.setItem(DB_STORAGE_KEY, future);
    new MockCampusMarketApi();
    expect(window.localStorage.getItem(DB_STORAGE_KEY)).toBe(future);
  });
});
