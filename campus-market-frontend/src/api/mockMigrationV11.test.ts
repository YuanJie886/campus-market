// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_SCHEMA_VERSION, migrateMockDatabase, type MockDatabase } from './mockMigrations';

/**
 * 模块 7.1 Mock schema v11（与后端 FlywayLegacyBaselineIT 场景 K 对应）：旧原始预约不补结束时间、不生成快照；
 * 真实被接受过的改约回填快照；NO_SHOW_RULE 改名 SYSTEM_RULE 并补规则版本与依据；人工限制只补决定时间；
 * 不隐藏任何评论或私信；二次迁移是空操作；损坏的快照 / 纠正记录逐条丢弃。
 */
const seed = () => ({ schemaVersion: MOCK_SCHEMA_VERSION } as unknown as MockDatabase);
const NOW = Date.now();

function v10(): Record<string, unknown> {
  return {
    schemaVersion: 10,
    campusSchools: { 东校区: 'pilot' },
    users: [
      { id: 'u1', account: 'seller', password: 'p', nickname: 's', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
      { id: 'u2', account: 'buyer', password: 'p', nickname: 'b', avatar: '', campus: '东校区', contact: 'c', createdAt: 1 },
    ],
    market: {
      products: [{ id: 'p1', sellerId: 'u1', title: '旧台灯', description: 'd', price: 20, category: '生活用品', condition: '全新', campus: '东校区',
        images: [], status: '预约中', views: 0, createdAt: 1, buildingId: null, listingKind: 'SINGLE', visibility: 'PUBLIC', moderationHiddenAt: null }],
      orders: [
        { id: 'legacy', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '交易中', canonicalStatus: 'PENDING_MEETING',
          meetingAtIso: new Date(NOW - 3 * 3_600_000).toISOString(), meetingEndsAtIso: null, meetingRevision: 0, createdAt: 1, updatedAt: 1 },
        { id: 'agreed', productId: 'p1', buyerId: 'u2', sellerId: 'u1', price: 20, status: '交易中', canonicalStatus: 'PENDING_MEETING',
          meetingAtIso: new Date(NOW - 5 * 3_600_000).toISOString(), meetingEndsAtIso: new Date(NOW - 4 * 3_600_000).toISOString(), meetingRevision: 1, createdAt: 1, updatedAt: 1 },
      ],
      comments: [{ id: 'c1', productId: 'p1', userId: 'u2', content: '旧留言', parentId: null, createdAt: 1 }],
      favorites: [], conversations: [], messages: [{ id: 'm1', conversationId: 'cv', senderId: 'u2', content: '旧消息', createdAt: 1 }],
    },
    idempotency: {}, buildings: [], demandSubscriptions: [], demandMatches: [], productDisclosures: {}, orderInspections: {},
    meetingProposals: [{ id: 'pr1', orderId: 'agreed', proposerId: 'u2', meetingPointId: '东校区-library', startsAt: NOW - 5 * 3_600_000,
      endsAt: NOW - 4 * 3_600_000, note: '', status: 'ACCEPTED', revision: 1, createdAt: NOW - 86_400_000, respondedAt: NOW - 80_000_000, respondedBy: 'u1' }],
    presence: [], flowEvents: [], flowSeq: 0, inactiveMeetingPoints: [],
    productTextbooks: {}, textbookSuggestions: [], listingDrafts: [], listingBatches: [], listingPublishRequests: [],
    listingAssistInvites: [], listingAssistEvents: [], assistSeq: 0, bundleItems: {}, productAttribution: {},
    circles: [], circleMemberships: [], circleInvites: [], circleEvents: [], circleSeq: 0, productCircleVisibility: {},
    cancellationRecords: [],
    noShowReports: [
      { id: 'n-legacy', orderId: 'legacy', meetingRevision: 0, schoolId: 'pilot', reporterId: 'u1', reportedId: 'u2', status: 'PENDING', reasonCode: 'DID_NOT_ARRIVE',
        note: null, responseNote: null, createdAt: NOW, respondedAt: null, decidedAt: null, decidedBy: null, confirmedAt: null },
      { id: 'n1', orderId: 'agreed', meetingRevision: 1, schoolId: 'pilot', reporterId: 'u1', reportedId: 'u2', status: 'ACKNOWLEDGED', reasonCode: 'DID_NOT_ARRIVE',
        note: null, responseNote: null, createdAt: NOW, respondedAt: NOW, decidedAt: null, decidedBy: null, confirmedAt: NOW - 1000 },
    ],
    staffMembers: [], moderationReports: [], moderationCases: [], moderationAppeals: [],
    moderationActions: [{ id: 'a1', schoolId: 'pilot', caseId: 'k', appealId: null, staffId: 'u1', actionCode: 'HIDE_PRODUCT', reasonCode: 'OTHER', note: null,
      targetType: 'PRODUCT', targetId: 'p1', restrictionId: null, expiresAt: null, effective: true, createdAt: 1 }],
    userRestrictions: [
      { id: 'rule', userId: 'u2', schoolId: 'pilot', scope: 'BOOKING', source: 'NO_SHOW_RULE', caseId: null, noShowReportId: 'n1', createdBy: null,
        reasonCode: 'CONFIRMED_NO_SHOW', startsAt: NOW, endsAt: NOW + 86_400_000, createdAt: NOW, revokedAt: null, revokedBy: null, revokeReason: null },
      { id: 'manual', userId: 'u1', schoolId: 'pilot', scope: 'PUBLISHING', source: 'CASE', caseId: 'k', noShowReportId: null, createdBy: 'u2',
        reasonCode: 'OTHER', startsAt: NOW, endsAt: NOW + 86_400_000, createdAt: NOW - 5, revokedAt: null, revokedBy: null, revokeReason: null },
    ],
  };
}

beforeEach(() => window.localStorage.clear());

describe('7.1 Mock schema v11', () => {
  it('v10 → v11：不猜旧原始预约；真实改约回填快照；SYSTEM_RULE 改名并补依据；人工限制只补决定时间；不隐藏任何内容；二次迁移深度相等', () => {
    const first = migrateMockDatabase(v10(), seed);
    expect(first.applied.filter((n) => /^v10→v11/.test(n))).toHaveLength(1);
    const db = first.db;
    expect(db.schemaVersion).toBe(11);
    expect(db.market.orders.find((o) => o.id === 'legacy')!.meetingEndsAtIso).toBeNull();
    expect(db.slotAgreements.filter((a) => a.orderId === 'legacy')).toEqual([]);
    expect(db.slotAgreements).toEqual([{ orderId: 'agreed', revision: 1, meetingPointId: '东校区-library', startsAt: NOW - 5 * 3_600_000,
      endsAt: NOW - 4 * 3_600_000, source: 'LEGACY_ACCEPTED_PROPOSAL', agreedAt: NOW - 80_000_000 }]);
    const rule = db.userRestrictions.find((r) => r.id === 'rule')!;
    expect(rule).toMatchObject({ source: 'SYSTEM_RULE', ruleVersion: 'NO_SHOW_V1', decidedAt: NOW, lastCorrectionId: null });
    expect(rule.basis).toEqual([{ reportId: 'n1', confirmedAt: NOW - 1000 }]);
    expect(db.userRestrictions.find((r) => r.id === 'manual')).toMatchObject({ source: 'CASE', ruleVersion: null, decidedAt: NOW - 5, basis: [] });
    expect(db.moderationActions[0].subjectId).toBe('u1');
    expect(db.market.comments[0].moderationHiddenAt).toBeNull();
    expect(db.market.messages[0].moderationQuarantinedAt).toBeNull();
    expect(db.restrictionCorrections).toEqual([]);
    const snapshot = JSON.parse(JSON.stringify(db));
    const second = migrateMockDatabase(snapshot, seed);
    expect(second.applied).toEqual([]);
    expect(JSON.parse(JSON.stringify(second.db))).toEqual(snapshot);
  });

  it('损坏记录逐条丢弃：超过 2 小时或结束早于开始的快照、会加重的纠正记录、没有规则版本的 SYSTEM_RULE 限制', () => {
    const raw = migrateMockDatabase(v10(), seed).db as unknown as Record<string, any>;
    raw.slotAgreements.push({ orderId: 'x', revision: 0, meetingPointId: 'p', startsAt: 0, endsAt: 3 * 3_600_000, source: 'SELLER_ACCEPTED_BOOKING', agreedAt: 0 });
    raw.slotAgreements.push({ orderId: 'y', revision: 0, meetingPointId: 'p', startsAt: 10, endsAt: 5, source: 'SELLER_ACCEPTED_BOOKING', agreedAt: 0 });
    raw.restrictionCorrections.push({ id: 'bad', restrictionId: 'rule', schoolId: 'pilot', causeReportId: 'n1', appealId: null, decidedBy: null,
      outcome: 'SHORTENED', ruleVersion: 'NO_SHOW_V1', remainingCount: 1, previousEndsAt: 10, newEndsAt: 20, createdAt: 1 });
    raw.userRestrictions.push({ ...raw.userRestrictions[0], id: 'no-version', ruleVersion: null });
    const result = migrateMockDatabase(raw, seed);
    expect(result.db.slotAgreements.map((a) => a.orderId)).toEqual(['agreed']);
    expect(result.db.restrictionCorrections).toEqual([]);
    expect(result.db.userRestrictions.map((r) => r.id)).toEqual(['rule', 'manual']);
    expect(result.skippedRecords).toBeGreaterThanOrEqual(4);
  });
});
