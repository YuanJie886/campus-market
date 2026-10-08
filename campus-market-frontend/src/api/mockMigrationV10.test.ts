// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, PILOT_CAMPUS_SCHOOLS, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';

/**
 * 模块 6.1 / 7 Mock schema v10：v1～v9 都能升级；不伪造工作人员、举报、处罚或爽约；旧取消订单不猜原因；
 * 旧用户没有任何限制；更高版本不降级；损坏记录逐条隔离。
 */
const DB = 'campus_market_mock_database_v1';
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);

function v9(): Record<string, unknown> {
  return {
    schemaVersion: 9,
    users: [
      { id: 'u1', account: 'seller', password: 'p', nickname: 's', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
      { id: 'u2', account: 'buyer', password: 'p', nickname: 'b', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
    ],
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区',
        images: [], status: '在售', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE', visibility: 'PUBLIC' }],
      orders: [{ id: 'o1', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '已取消', canonicalStatus: 'CANCELLED',
        createdAt: 1, updatedAt: 1, priceSnapshot: 20, currency: 'CNY', visibilitySnapshot: null }],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    idempotency: {}, buildings: [], demandSubscriptions: [], demandMatches: [], productDisclosures: {}, orderInspections: {},
    meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [],
    productTextbooks: {}, textbookSuggestions: [], listingDrafts: [], listingBatches: [], listingPublishRequests: [],
    listingAssistInvites: [], listingAssistEvents: [], assistSeq: 0, bundleItems: {}, productAttribution: {},
    circles: [], circleMemberships: [], circleInvites: [], circleEvents: [], circleSeq: 0, productCircleVisibility: {},
  };
}

beforeEach(() => window.localStorage.clear());

describe('6.1 / 7 Mock schema v10', () => {
  it('v9 → v10：校区登记为试点学校；治理集合全部为空；旧取消订单不补取消原因；旧商品未被隐藏；二次迁移深度相等', () => {
    const first = migrateMockDatabase(v9(), seed);
    expect(first.applied.filter((n) => /^v9→v10/.test(n))).toHaveLength(1);
    expect(first.db.schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    expect(first.db.campusSchools).toEqual(PILOT_CAMPUS_SCHOOLS);
    for (const key of ['cancellationRecords', 'noShowReports', 'staffMembers', 'moderationReports', 'moderationCases', 'moderationActions',
      'moderationAppeals', 'userRestrictions'] as const) {
      expect(first.db[key], key).toEqual([]);
    }
    expect(first.db.market.products[0].moderationHiddenAt).toBeNull();
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('v1～v9 任一版本都能升到 v10，且不会凭空多出工作人员、举报、处罚或爽约', () => {
    for (let version = 1; version <= 9; version += 1) {
      const result = migrateMockDatabase({ ...v9(), schemaVersion: version }, seed);
      expect(result.db.schemaVersion, `v${version}`).toBe(MOCK_SCHEMA_VERSION);
      expect(result.db.staffMembers, `v${version}`).toEqual([]);
      expect(result.db.userRestrictions, `v${version}`).toEqual([]);
      expect(result.db.noShowReports, `v${version}`).toEqual([]);
      expect(result.db.cancellationRecords, `v${version}`).toEqual([]);
    }
  });

  it('更高版本不降级、不覆盖：本次会话在内存里跑，存储里的原数据保持原样', () => {
    const future = { ...v9(), schemaVersion: MOCK_SCHEMA_VERSION + 1 };
    expect(migrateMockDatabase(future, seed).persistable).toBe(false);
    window.localStorage.setItem(DB, JSON.stringify(future));
    void new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION + 1);
  });

  it('损坏记录逐条隔离：学校不符 / 不存在的工作人员、超过 30 天的限制、对应未取消订单的取消记录、两个申诉对象都有的申诉只丢弃该条', () => {
    const raw = {
      // v10 形状的负载（7.1 起由 v10→v11 迁移补齐限制的决定时间与依据，再做逐条容错）
      ...v9(), schemaVersion: 10, campusSchools: { ...PILOT_CAMPUS_SCHOOLS },
      staffMembers: [
        { userId: 'u1', schoolId: 'pilot', role: 'MODERATOR', active: true, createdAt: 1 },
        { userId: 'u2', schoolId: 'other-school', role: 'SENIOR_MODERATOR', active: true, createdAt: 1 },
        { userId: 'ghost', schoolId: 'pilot', role: 'MODERATOR', active: true, createdAt: 1 },
      ],
      userRestrictions: [
        { id: 'r1', userId: 'u2', schoolId: 'pilot', scope: 'BOOKING', source: 'CASE', caseId: 'c', noShowReportId: null, createdBy: 'u1', reasonCode: 'OTHER', startsAt: 0, endsAt: 86_400_000, createdAt: 0, revokedAt: null, revokedBy: null, revokeReason: null },
        { id: 'r2', userId: 'u2', schoolId: 'pilot', scope: 'BOOKING', source: 'CASE', caseId: 'c', noShowReportId: null, createdBy: 'u1', reasonCode: 'OTHER', startsAt: 0, endsAt: 31 * 86_400_000, createdAt: 0, revokedAt: null, revokedBy: null, revokeReason: null },
      ],
      cancellationRecords: [
        { orderId: 'o1', schoolId: 'pilot', actorId: 'u2', phase: 'BEFORE_SELLER_CONFIRM', reasonCode: null, note: null, createdAt: 1 },
        { orderId: 'o-live', schoolId: 'pilot', actorId: 'u2', phase: 'AFTER_SELLER_CONFIRM', reasonCode: 'OTHER', note: 'x', createdAt: 1 },
      ],
      moderationAppeals: [{ id: 'a1', schoolId: 'pilot', userId: 'u2', restrictionId: 'r1', actionId: 'x', caseId: null, reason: 'x', status: 'PENDING', decidedBy: null, decidedAt: null, createdAt: 1 }],
      noShowReports: [], moderationReports: [], moderationCases: [], moderationActions: [],
    };
    const result = migrateMockDatabase(raw, seed);
    expect(result.db.staffMembers.map((s) => s.userId)).toEqual(['u1']);
    expect(result.db.userRestrictions.map((r) => r.id)).toEqual(['r1']);
    expect(result.db.cancellationRecords.map((c) => c.orderId)).toEqual(['o1']);
    expect(result.db.moderationAppeals).toEqual([]);
    expect(result.skippedRecords).toBeGreaterThanOrEqual(5);
  });

  it('全新种子：没有工作人员（演示工作人员只能通过 Mock 的显式演示开关产生）', async () => {
    const api = new MockCampusMarketApi();
    await api.register({ account: `fresh-${Date.now()}`, password: 'test-password', nickname: 'n', campus: '东校区', contact: '1' });
    expect(JSON.parse(window.localStorage.getItem(DB)!).staffMembers).toEqual([]);
    expect((await api.getStaffStatus()).staff).toBe(false);
  });
});
