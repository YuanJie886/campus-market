// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';
import { MockCampusMarketApi } from './mockCampusMarketApi';

/**
 * Mock schema v13（阶段 1，与后端 V16 对应）：
 * 联系申请补决定时间与双方已读时间；历史交易数据收尾（未结束订单关闭、未决爽约报告失效、爽约规则限制撤销、
 * 订单 / 爽约案件结案、「预约中」商品在售），每一处改动都留痕；二次迁移是空操作；损坏的申请记录逐条丢弃。
 */
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);
const DB = 'campus_market_mock_database_v1';
const NOW = Date.now();

function v12(): Record<string, unknown> {
  return {
    schemaVersion: 12,
    campusSchools: { 东校区: 'pilot' },
    users: [
      { id: 'u1', account: 'seller', password: 'p', nickname: 's', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
      { id: 'u2', account: 'buyer', password: 'p', nickname: 'b', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
    ],
    market: {
      products: [
        { id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区',
          images: [], status: '预约中', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE', visibility: 'PUBLIC', moderationHiddenAt: null, contactPublic: false, contact: 'wx:old' },
        { id: 'p2', sellerId: 'u1', title: '旧书', description: 'd', price: 5, category: '其他', condition: '全新', campus: '东校区',
          images: [], status: '在售', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE', visibility: 'PUBLIC', moderationHiddenAt: null, contactPublic: false, contact: 'wx:old' },
      ],
      orders: [
        { id: 'open', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '交易中', canonicalStatus: 'PENDING_MEETING', createdAt: 1, updatedAt: 1 },
        { id: 'done', productId: 'p2', buyerId: 'u2', sellerId: 'u1', price: 5, status: '已完成', canonicalStatus: 'COMPLETED', createdAt: 1, updatedAt: 2 },
      ],
      comments: [], favorites: [], conversations: [], messages: [],
    },
    contactRequests: [
      { id: 'cr-pending', productId: 'p2', buyerId: 'u2', sellerId: 'u1', status: 'PENDING', createdAt: 10, updatedAt: 10 },
      { id: 'cr-approved', productId: 'p1', buyerId: 'u2', sellerId: 'u1', status: 'APPROVED', createdAt: 11, updatedAt: 12 },
      { id: 'cr-broken', productId: 'p1', status: 'MAYBE' },
    ],
    idempotency: {}, buildings: [], demandSubscriptions: [], demandMatches: [], productDisclosures: {}, orderInspections: {},
    meetingProposals: [], presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [],
    productTextbooks: {}, textbookSuggestions: [], listingDrafts: [], listingBatches: [], listingPublishRequests: [],
    listingAssistInvites: [], listingAssistEvents: [], assistSeq: 0, bundleItems: {}, productAttribution: {},
    circles: [], circleMemberships: [], circleInvites: [], circleEvents: [], circleSeq: 0, productCircleVisibility: {},
    cancellationRecords: [], slotAgreements: [], restrictionCorrections: [],
    noShowReports: [
      { id: 'ns-pending', orderId: 'open', meetingRevision: 1, schoolId: 'pilot', reporterId: 'u1', reportedId: 'u2', status: 'DISPUTED', reasonCode: 'DID_NOT_ARRIVE',
        note: null, responseNote: '我到了', createdAt: NOW, respondedAt: NOW, decidedAt: null, decidedBy: null, confirmedAt: null },
      { id: 'ns-confirmed', orderId: 'done', meetingRevision: 1, schoolId: 'pilot', reporterId: 'u1', reportedId: 'u2', status: 'CONFIRMED', reasonCode: 'DID_NOT_ARRIVE',
        note: null, responseNote: null, createdAt: NOW, respondedAt: null, decidedAt: NOW, decidedBy: 'u1', confirmedAt: NOW },
    ],
    staffMembers: [], moderationReports: [], moderationAppeals: [], moderationActions: [],
    moderationCases: [
      { id: 'k-order', schoolId: 'pilot', targetType: 'ORDER', targetId: 'open', status: 'UNDER_REVIEW', assignedStaffId: 'u9', resolutionCode: null,
        reportCount: 1, createdAt: 1, updatedAt: 1, resolvedAt: null, noShowReportId: null },
      { id: 'k-product', schoolId: 'pilot', targetType: 'PRODUCT', targetId: 'p2', status: 'OPEN', assignedStaffId: null, resolutionCode: null,
        reportCount: 1, createdAt: 1, updatedAt: 1, resolvedAt: null, noShowReportId: null },
    ],
    userRestrictions: [
      { id: 'rule', userId: 'u2', schoolId: 'pilot', scope: 'BOOKING', source: 'SYSTEM_RULE', caseId: null, noShowReportId: 'ns-confirmed', createdBy: null,
        reasonCode: 'CONFIRMED_NO_SHOW', startsAt: NOW - 1000, endsAt: NOW + 86_400_000, createdAt: NOW - 1000, revokedAt: null, revokedBy: null, revokeReason: null,
        ruleVersion: 'NO_SHOW_V1', decidedAt: NOW - 1000, basis: [{ reportId: 'ns-confirmed', confirmedAt: NOW }], lastCorrectionId: null },
      { id: 'manual-booking', userId: 'u2', schoolId: 'pilot', scope: 'BOOKING', source: 'CASE', caseId: 'k-product', noShowReportId: null, createdBy: 'u1',
        reasonCode: 'OTHER', startsAt: NOW - 1000, endsAt: NOW + 86_400_000, createdAt: NOW - 1000, revokedAt: null, revokedBy: null, revokeReason: null,
        ruleVersion: null, decidedAt: NOW - 1000, basis: [], lastCorrectionId: null },
    ],
  };
}

beforeEach(() => window.localStorage.clear());

describe('Mock schema v13（阶段 1）', () => {
  it('联系申请补决定时间与已读时间（与 V16 一致：已同意 / 已拒绝的决定时间 = 原 updatedAt，已读时间为空）；损坏的申请逐条丢弃', () => {
    const result = migrateMockDatabase(v12(), seed);
    expect(result.fromVersion).toBe(12);
    expect(result.db.schemaVersion).toBe(13);
    expect(result.applied).toHaveLength(1);
    expect(result.skippedRecords).toBe(1);
    expect(result.db.contactRequests).toEqual([
      { id: 'cr-pending', productId: 'p2', buyerId: 'u2', sellerId: 'u1', status: 'PENDING', createdAt: 10, updatedAt: 10, decidedAt: null, sellerSeenAt: null, buyerSeenAt: null },
      { id: 'cr-approved', productId: 'p1', buyerId: 'u2', sellerId: 'u1', status: 'APPROVED', createdAt: 11, updatedAt: 12, decidedAt: 12, sellerSeenAt: null, buyerSeenAt: null },
    ]);
  });

  it('历史交易收尾：未结束订单 → EXPIRED；未决爽约报告 → EXPIRED；爽约规则限制撤销（RULE_RETIRED）；订单案件以 NO_ACTION 结案；预约中 → 在售；每一处都留痕', () => {
    const db = migrateMockDatabase(v12(), seed).db;
    expect(db.market.orders.map((o) => [o.id, o.canonicalStatus])).toEqual([['open', 'EXPIRED'], ['done', 'COMPLETED']]);
    expect(db.noShowReports.map((r) => [r.id, r.status])).toEqual([['ns-pending', 'EXPIRED'], ['ns-confirmed', 'CONFIRMED']]);
    const rule = db.userRestrictions.find((r) => r.id === 'rule')!;
    expect([rule.revokeReason, typeof rule.revokedAt]).toEqual(['RULE_RETIRED', 'number']);
    // 人工的历史 BOOKING 限制不是爽约规则产生的：保持原样，到期前按「申请联系方式」限制生效
    expect(db.userRestrictions.find((r) => r.id === 'manual-booking')!.revokedAt).toBeNull();
    expect(db.moderationCases.find((c) => c.id === 'k-order')).toMatchObject({ status: 'DISMISSED', resolutionCode: 'NO_ACTION' });
    expect(db.moderationCases.find((c) => c.id === 'k-product')).toMatchObject({ status: 'OPEN', resolutionCode: null });
    expect(db.market.products.find((p) => p.id === 'p1')!.status).toBe('在售');
    expect(db.legacyTradeClosures.map((c) => [c.entityType, c.entityId, c.fromStatus, c.toStatus, c.reason])).toEqual([
      ['ORDER', 'open', 'PENDING_MEETING', 'EXPIRED', 'PLATFORM_TRADE_RETIRED'],
      ['NO_SHOW_REPORT', 'ns-pending', 'DISPUTED', 'EXPIRED', 'NO_SHOW_RULE_RETIRED'],
      ['RESTRICTION', 'rule', 'ACTIVE', 'REVOKED', 'NO_SHOW_RULE_RETIRED'],
      ['MODERATION_CASE', 'k-order', 'UNDER_REVIEW', 'DISMISSED', 'PLATFORM_TRADE_RETIRED'],
      ['PRODUCT', 'p1', '预约中', '在售', 'PLATFORM_TRADE_RETIRED'],
    ]);
  });

  it('二次迁移是空操作，结果深度相等；装载路径落盘为当前版本，迁移前已有的未读按查看者视角计算', async () => {
    const first = migrateMockDatabase(v12(), seed);
    const snapshot = JSON.parse(JSON.stringify(first.db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);

    window.localStorage.setItem(DB, JSON.stringify(v12()));
    const api = new MockCampusMarketApi();
    expect(JSON.parse(window.localStorage.getItem(DB)!).schemaVersion).toBe(MOCK_SCHEMA_VERSION);
    await api.login({ account: 'seller', password: 'p' });
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 1, updates: 0, total: 1 });
    await api.login({ account: 'buyer', password: 'p' });
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 0, updates: 1, total: 1 });
    // 迁移后的同意照常生效；人工的历史 BOOKING 限制拦截新的联系申请
    expect((await api.getProduct('p1')).contact).toBe('wx:old');
    await expect(api.requestContact('p2')).rejects.toMatchObject({ code: 403, details: { code: 'RESTRICTED', scope: 'CONTACT' } });
    expect((await api.getContactRequest('p2'))?.status).toBe('PENDING');
    expect((await api.getMyGovernance()).restrictions.find((r) => r.id === 'rule')).toMatchObject({ active: false, revokeReason: 'RULE_RETIRED' });
  });
});
