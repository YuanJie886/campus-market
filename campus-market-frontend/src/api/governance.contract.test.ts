// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import type { ProductCreateInput } from './contracts';
import { fullDisclosure } from '../test/inspectionFixtures';
import type { Category } from '../types';

/**
 * 模块 6.1 / 7 的 Mock 契约：与后端 SchoolIsolationIT、CircleMemberLimitIT、CommitmentIT、ModerationIT 的关键断言对应，
 * 保证离线演示与真实服务端的权限结论一致。全部是 API 调用的行为断言。
 *
 * <p>平台已改为只展示商品与联系方式：订单取消记录（7.1）与爽约报告（7.2）随交易 / 预约功能移除（Mock 返回 410）。
 */

const DB = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
const code = async (p: Promise<unknown>) => (await failure(p)).code;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
const LAKE = '湖畔校区';

/** 在 Mock 存储里登记第二所学校（多校部署只需要登记校区），然后重新装载 */
function addLakeSchool() {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.campusSchools[LAKE] = 'lake';
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
async function user(label: string, campus: string = '东校区') {
  const account = `${label}-${rnd()}`;
  const session = await api.register({ account, password: 'test-password', nickname: label, campus: campus as never, contact: '13800000000' });
  accounts.set(label, account);
  return session.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
function product(title: string, extra: Partial<ProductCreateInput> = {}, category: Category = '其他'): ProductCreateInput {
  return {
    title, description: '治理契约测试', price: 30, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}), ...extra,
  } as ProductCreateInput;
}
/** 测试夹具：与运维手册的受控 SQL 等价，直接登记一名工作人员 */
function makeStaff(userId: string, role: 'MODERATOR' | 'SENIOR_MODERATOR' = 'MODERATOR', school = 'pilot') {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.staffMembers.push({ userId, schoolId: school, role, active: true, createdAt: Date.now() });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
describe('6.1A 学校隔离', () => {
  it('未登录不能读取商品；列表 / 搜索总数 / feed / 详情 / 评论 / 他人资料都不跨校；schoolId 参数 400；写入不能跨校', async () => {
    addLakeSchool();
    await user('pilot');
    const a = (await api.createProduct(product('隔离 试点'))).id;
    await user('lake', LAKE);
    const b = (await api.createProduct(product('隔离 湖畔', { campus: LAKE as never }))).id;
    const pilotId = (await api.login({ account: accounts.get('pilot')!, password: 'test-password' })).user.id;

    await api.logout();
    expect(await code(api.listProducts({ sort: 'latest', page: 1, pageSize: 20 }))).toBe(401);
    expect(await code(api.getProduct(a))).toBe(401);
    expect(await code(api.feedProducts({ scope: 'SCHOOL', sort: 'latest', page: 1, pageSize: 20 }))).toBe(401);
    expect(await code(api.listComments(a))).toBe(401);
    expect(await code(api.getUser(pilotId))).toBe(401);

    await as('pilot');
    const list = await api.listProducts({ keyword: '隔离', sort: 'latest', page: 1, pageSize: 20 });
    expect(list.items.map((p) => p.id)).toEqual([a]);
    expect(list.total).toBe(1);
    expect((await api.feedProducts({ keyword: '隔离', scope: 'SCHOOL', sort: 'latest', page: 1, pageSize: 20 })).items.map((p) => p.id)).toEqual([a]);
    const hidden = await failure(api.getProduct(b));
    const missing = await failure(api.getProduct('p-missing'));
    expect([hidden.code, hidden.message]).toEqual([404, missing.message]);
    expect(await code(api.listComments(b))).toBe(404);
    expect(await code(api.setFavorite(b, true))).toBe(404);
    expect(await code(api.requestContact(b))).toBe(404);
    expect(await code(api.getOrCreateConversation(b))).toBe(404);
    expect(await code(api.listProducts({ campus: LAKE as never, sort: 'latest', page: 1, pageSize: 20 }))).toBe(400);
    expect(await code(api.listProducts({ schoolId: 'lake', sort: 'latest', page: 1, pageSize: 20 } as never))).toBe(400);
    expect(await code(api.createProduct(product('发到他校', { campus: LAKE as never })))).toBe(400);
    expect(await code(api.updateProfile({ campus: LAKE as never }))).toBe(400);
    const lakeUser = (await api.login({ account: accounts.get('lake')!, password: 'test-password' })).user.id;
    await as('pilot');
    expect(await code(api.getUser(lakeUser))).toBe(404);
    expect(await code(api.register({ account: `x-${rnd()}`, password: 'test-password', nickname: 'x', campus: '火星校区' as never }))).toBe(400);
  });
});

describe('6.1C 成员分页与人数上限', () => {
  it('默认 20、最大 100；total/page/size；满员 409 且邀请码不被消耗；已在籍幂等兑换不占名额', async () => {
    await user('owner');
    const circle = await api.createCircle({ type: 'CLUB', name: '千人圈' });
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    for (let i = 0; i < 998; i += 1) {
      const uid = `filler-${i}`;
      raw.users.push({ id: uid, account: uid, password: 'x', nickname: `成员${i}`, avatar: '', campus: '东校区', contact: '', createdAt: 1 });
      raw.circleMemberships.push({ circleId: circle.id, userId: uid, role: 'MEMBER', status: 'ACTIVE', joinedAt: 1000 + i, updatedAt: 1000 + i, endedAt: null });
    }
    window.localStorage.setItem(DB, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    const first = await api.listCircleMembers(circle.id);
    expect([first.page, first.size, first.total, first.items.length]).toEqual([1, 20, 999, 20]);
    expect(first.items[0].role).toBe('OWNER');
    expect((await api.listCircleMembers(circle.id, 10, 100)).items).toHaveLength(99);
    expect(await code(api.listCircleMembers(circle.id, 1, 101))).toBe(400);

    const t1 = (await api.createCircleInvite(circle.id)).token;
    await user('last');
    await api.redeemCircleInvite(t1);
    await as('owner');
    const t2 = (await api.createCircleInvite(circle.id)).token;
    await user('late');
    expect(await code(api.redeemCircleInvite(t2))).toBe(409);
    expect(JSON.parse(window.localStorage.getItem(DB)!).circleInvites.find((i: { redeemedBy: string | null; status: string }) => i.status === 'PENDING')).toBeTruthy();
    await as('last');
    await as('owner');
    const t3 = (await api.createCircleInvite(circle.id)).token;
    await as('last');
    expect((await api.redeemCircleInvite(t3)).myRole).toBe('MEMBER');
    await as('owner');
    expect((await api.listCircleMembers(circle.id)).total).toBe(1000);
  });
});

describe('7.3～7.5 工作人员、举报、限制、申诉', () => {
  it('没有默认工作人员；非工作人员 403；工作人员只看本校；举报不能枚举私密商品；举报人身份不外泄；限制与申诉', async () => {
    addLakeSchool();
    expect(JSON.parse(window.localStorage.getItem(DB)!).staffMembers).toEqual([]);
    const sellerId = await user('seller');
    const secretCircle = await api.createCircle({ type: 'CLUB', name: '私密治理' });
    const secret = (await api.createProduct(product('私密商品', { visibility: 'CIRCLE_ONLY', circleIds: [secretCircle.id] }))).id;
    const open = (await api.createProduct(product('公开商品'))).id;
    const reporterId = await user('reporter');
    expect(await code(api.listModerationCases({}))).toBe(403);
    expect((await api.getStaffStatus()).staff).toBe(false);
    const hiddenErr = await failure(api.createModerationReport({ targetType: 'PRODUCT', targetId: secret, reasonCode: 'SPAM' }));
    const missingErr = await failure(api.createModerationReport({ targetType: 'PRODUCT', targetId: 'p-none', reasonCode: 'SPAM' }));
    expect([hiddenErr.code, hiddenErr.message]).toEqual([404, missingErr.message]);
    const mine = await api.createModerationReport({ targetType: 'PRODUCT', targetId: open, reasonCode: 'MISLEADING' });
    expect((await api.createModerationReport({ targetType: 'PRODUCT', targetId: open, reasonCode: 'MISLEADING' })).id).toBe(mine.id);
    expect(mine.status).toBe('RECEIVED');

    const staffA = await user('staffA');
    makeStaff(staffA);
    const staffB = await user('staffB');
    makeStaff(staffB, 'SENIOR_MODERATOR');
    const lakeStaff = await user('lakeStaff', LAKE);
    makeStaff(lakeStaff, 'SENIOR_MODERATOR', 'lake');
    await as('lakeStaff');
    expect((await api.listModerationCases({})).items).toEqual([]);
    await as('staffA');
    const list = await api.listModerationCases({ status: 'OPEN' });
    expect(list.items).toHaveLength(1);
    const caseId = list.items[0].id;
    await as('lakeStaff');
    expect(await code(api.getModerationCase(caseId))).toBe(404);
    await as('staffA');
    const detail = await api.getModerationCase(caseId);
    expect(JSON.stringify(detail)).not.toContain(reporterId);
    expect(JSON.stringify(detail)).not.toContain('13800000000');
    expect(detail.allowedActions).toContain('HIDE_PRODUCT');
    expect(await code(api.decideModerationCase(caseId, { action: 'RESTRICT_PUBLISHING', reasonCode: 'POLICY_VIOLATION', durationHours: 169 }))).toBe(403);
    const decided = await api.decideModerationCase(caseId, { action: 'HIDE_PRODUCT', reasonCode: 'PROHIBITED_ITEM' });
    expect(decided.status).toBe('RESOLVED');
    expect(decided.requestId).toBeTruthy();
    expect(await code(api.decideModerationCase(caseId, { action: 'NO_ACTION', reasonCode: 'DUPLICATE' }))).toBe(409);

    await as('reporter');
    expect(await code(api.getProduct(open))).toBe(404);
    expect((await api.listMyModerationReports())[0]).toMatchObject({ status: 'CLOSED', outcome: 'ACTION_TAKEN' });
    expect(JSON.stringify(await api.listMyModerationReports())).not.toMatch(/HIDE_PRODUCT|staff/);
    await as('seller');
    expect((await api.getProduct(open)).moderationHidden).toBe(true);
    const g = await api.getMyGovernance();
    expect(JSON.stringify(g)).not.toContain(reporterId);
    const notice = g.notices[0];
    expect(notice).toMatchObject({ actionCode: 'HIDE_PRODUCT', active: true, canAppeal: true });
    const appeal = await api.submitAppeal({ actionId: notice.actionId, reason: '这件商品不违规' });
    expect(await code(api.submitAppeal({ actionId: notice.actionId, reason: '再申诉' }))).toBe(409);
    await as('staffA');
    expect(await code(api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' }))).toBe(403);
    await as('staffB');
    expect((await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' })).status).toBe('ACCEPTED');
    await as('reporter');
    expect((await api.getProduct(open)).id).toBe(open);
    void sellerId;
  });

  it('限制只挡对应入口：发布受限不能发布但能保存草稿、下架；建圈受限不能建圈；限制最长 30 天；演示开关只存在于 Mock', async () => {
    const targetId = await user('target');
    const mineProduct = (await api.createProduct(product('受限者的商品'))).id;
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId, reasonCode: 'SPAM' });
    const staffId = await user('staff');
    makeStaff(staffId, 'SENIOR_MODERATOR');
    await as('staff');
    const c1 = (await api.listModerationCases({ status: 'OPEN' })).items[0].id;
    expect(await code(api.decideModerationCase(c1, { action: 'RESTRICT_PUBLISHING', reasonCode: 'POLICY_VIOLATION', durationHours: 721 }))).toBe(400);
    await api.decideModerationCase(c1, { action: 'RESTRICT_PUBLISHING', reasonCode: 'POLICY_VIOLATION', durationHours: 720 });
    const c2 = await api.openModerationCase({ targetType: 'USER', targetId });
    await api.decideModerationCase(c2.id, { action: 'RESTRICT_CIRCLE_CREATION', reasonCode: 'POLICY_VIOLATION', durationHours: 24 });
    await as('target');
    expect(await code(api.createProduct(product('受限发布')))).toBe(403);
    const draft = await api.createListingDraft({ payload: { title: '草稿照常保存' } });
    expect(draft.status).toBe('DRAFT');
    expect((await api.setProductStatus(mineProduct, '已下架')).status).toBe('已下架');
    expect(await code(api.createCircle({ type: 'CLUB', name: '受限新圈' }))).toBe(403);
    const g = await api.getMyGovernance();
    expect(g.restrictions.map((r) => r.scope).sort()).toEqual(['CIRCLE_CREATION', 'PUBLISHING']);
    expect(Math.max(...g.restrictions.map((r) => r.endsAt - r.startsAt))).toBe(30 * 86_400_000);
    expect('demoBecomeStaff' in RestCampusMarketApi.prototype).toBe(false);
    expect((await api.demoBecomeStaff()).staff).toBe(true);
  });
});

describe('阶段 1（V16）治理收口', () => {
  it('新的限制动作是 RESTRICT_CONTACT；RESTRICT_BOOKING / CONFIRM_NO_SHOW / REJECT_NO_SHOW 与处理原因 CONFIRMED_NO_SHOW 一律 400；不再提供的动作也不出现在 allowedActions', async () => {
    const targetId = await user('target');
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId, reasonCode: 'HARASSMENT' });
    makeStaff(await user('staff'), 'SENIOR_MODERATOR');
    await as('staff');
    const caseId = (await api.listModerationCases({ status: 'OPEN' })).items[0].id;
    const detail = await api.getModerationCase(caseId);
    expect(detail.allowedActions).toEqual(['RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION', 'NO_ACTION']);
    for (const action of ['RESTRICT_BOOKING', 'CONFIRM_NO_SHOW', 'REJECT_NO_SHOW']) {
      expect(await code(api.decideModerationCase(caseId, { action: action as never, reasonCode: 'POLICY_VIOLATION', durationHours: 24 })), action).toBe(400);
    }
    expect(await code(api.decideModerationCase(caseId, { action: 'RESTRICT_CONTACT', reasonCode: 'CONFIRMED_NO_SHOW' as never, durationHours: 24 }))).toBe(400);
    const decided = await api.decideModerationCase(caseId, { action: 'RESTRICT_CONTACT', reasonCode: 'HARASSMENT', durationHours: 24 });
    expect([decided.status, decided.resolutionCode]).toEqual(['RESOLVED', 'RESTRICT_CONTACT']);
    await as('target');
    const g = await api.getMyGovernance();
    expect(Object.keys(g).sort()).toEqual(['notices', 'restrictions']);
    expect(g.restrictions[0]).toMatchObject({ scope: 'CONTACT', source: 'CASE', active: true, canAppeal: true });
  });

  it('订单与爽约复核不能再被举报或立案（400）；爽约复核的举报原因 400；案件列表仍可按历史类型筛选', async () => {
    await user('reporter');
    for (const targetType of ['ORDER', 'NO_SHOW']) {
      expect(await code(api.createModerationReport({ targetType: targetType as never, targetId: 'x1', reasonCode: 'OTHER', note: '历史对象' })), targetType).toBe(400);
    }
    const sellerId = await user('seller');
    void sellerId;
    const p = (await api.createProduct(product('举报原因校验'))).id;
    await as('reporter');
    expect(await code(api.createModerationReport({ targetType: 'PRODUCT', targetId: p, reasonCode: 'NO_SHOW_REVIEW' as never }))).toBe(400);
    makeStaff(await user('staff'));
    await as('staff');
    expect(await code(api.openModerationCase({ targetType: 'ORDER' as never, targetId: 'o1' }))).toBe(400);
    expect((await api.listModerationCases({ targetType: 'ORDER' })).items).toEqual([]);
    expect(await code(api.listModerationCases({ targetType: 'BOOKING' as never }))).toBe(400);
  });

  it('历史数据：爽约规则的自动限制已撤销（RULE_RETIRED）、历史爽约确认 active=false 且不能申诉、订单案件以「不采取措施」结案且只读', async () => {
    const targetId = await user('target');
    const staffId = await user('staff');
    const now = Date.now();
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    raw.schemaVersion = 12;
    raw.staffMembers.push({ userId: staffId, schoolId: 'pilot', role: 'MODERATOR', active: true, createdAt: now });
    raw.market.orders.push({ id: 'legacy-order', productId: 'p-gone', buyerId: targetId, sellerId: staffId, price: 10, status: '交易中',
      canonicalStatus: 'PENDING_MEETING', createdAt: now - 10, updatedAt: now - 10 });
    raw.noShowReports.push({ id: 'ns1', orderId: 'legacy-order', meetingRevision: 1, schoolId: 'pilot', reporterId: staffId, reportedId: targetId,
      status: 'CONFIRMED', reasonCode: 'DID_NOT_ARRIVE', note: null, responseNote: null, createdAt: now - 10, respondedAt: null, decidedAt: now - 5,
      decidedBy: staffId, confirmedAt: now - 5 });
    raw.userRestrictions.push({ id: 'rule-r', userId: targetId, schoolId: 'pilot', scope: 'BOOKING', source: 'SYSTEM_RULE', caseId: null,
      noShowReportId: 'ns1', createdBy: null, reasonCode: 'CONFIRMED_NO_SHOW', startsAt: now - 5, endsAt: now + 86_400_000, createdAt: now - 5,
      revokedAt: null, revokedBy: null, revokeReason: null, ruleVersion: 'NO_SHOW_V1', decidedAt: now - 5, basis: [{ reportId: 'ns1', confirmedAt: now - 5 }], lastCorrectionId: null });
    raw.moderationActions.push({ id: 'act-ns', schoolId: 'pilot', caseId: null, appealId: null, staffId: 'someone', actionCode: 'CONFIRM_NO_SHOW',
      reasonCode: 'CONFIRMED_NO_SHOW', note: null, targetType: 'NO_SHOW', targetId: 'ns1', restrictionId: null, expiresAt: null, effective: true,
      createdAt: now - 5, subjectId: targetId });
    raw.moderationCases.push({ id: 'case-order', schoolId: 'pilot', targetType: 'ORDER', targetId: 'legacy-order', status: 'OPEN', assignedStaffId: null,
      resolutionCode: null, reportCount: 1, createdAt: now - 10, updatedAt: now - 10, resolvedAt: null, noShowReportId: null });
    window.localStorage.setItem(DB, JSON.stringify(raw));
    api = new MockCampusMarketApi();

    await as('target');
    const g = await api.getMyGovernance();
    expect(g.restrictions[0]).toMatchObject({ id: 'rule-r', active: false, canAppeal: false, revokeReason: 'RULE_RETIRED', source: 'SYSTEM_RULE' });
    expect(g.notices[0]).toMatchObject({ actionId: 'act-ns', actionCode: 'CONFIRM_NO_SHOW', active: false, canAppeal: false });
    expect(await code(api.submitAppeal({ actionId: 'act-ns', reason: '历史记录' }))).toBe(409);
    expect(await code(api.submitAppeal({ restrictionId: 'rule-r', reason: '已撤销' }))).toBe(409);
    await as('staff');
    // 本人参与过这张历史订单：利益回避同样适用于历史案件
    expect((await failure(api.getModerationCase('case-order'))).details).toEqual({ code: 'CONFLICT_OF_INTEREST', reason: 'OWN_ORDER' });
    const persisted = JSON.parse(window.localStorage.getItem(DB)!);
    expect(persisted.moderationCases.find((c: { id: string }) => c.id === 'case-order')).toMatchObject({ status: 'DISMISSED', resolutionCode: 'NO_ACTION' });
    expect(persisted.market.orders.find((o: { id: string }) => o.id === 'legacy-order').canonicalStatus).toBe('EXPIRED');
  });
});

describe('REST 适配层（模块 6.1 / 7，阶段 1）', () => {
  it('路径与方法；成员分页参数；新的限制动作 RESTRICT_CONTACT 只在请求体；工作人员接口在 /v1/moderation 下；没有订单 / 爽约接口', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.listCircleMembers('c1', 3, 50);
    await rest.createModerationReport({ targetType: 'PRODUCT', targetId: 'p1', reasonCode: 'SPAM' });
    await rest.listMyModerationReports();
    await rest.getMyGovernance();
    await rest.submitAppeal({ restrictionId: 'x1', reason: '申诉' });
    await rest.getStaffStatus();
    await rest.listModerationCases({ status: 'OPEN', page: 2, size: 20 });
    await rest.listModerationCases({ targetType: 'ORDER' });
    await rest.getModerationCase('k1');
    await rest.openModerationCase({ targetType: 'USER', targetId: 'u1' });
    await rest.claimModerationCase('k1');
    await rest.decideModerationCase('k1', { action: 'RESTRICT_CONTACT', reasonCode: 'HARASSMENT', durationHours: 72 });
    await rest.decideModerationCase('k2', { action: 'NO_ACTION', reasonCode: 'DUPLICATE' });
    await rest.listModerationAppeals({ status: 'PENDING' });
    await rest.decideModerationAppeal('a1', { accept: false, reasonCode: 'APPEAL_REJECTED' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/circles/c1/members?page=3&size=50',
      'POST /v1/moderation-reports', 'GET /v1/moderation-reports/mine', 'GET /v1/me/governance', 'POST /v1/me/appeals', 'GET /v1/me/staff',
      'GET /v1/moderation/cases?status=OPEN&page=2&size=20', 'GET /v1/moderation/cases?targetType=ORDER', 'GET /v1/moderation/cases/k1', 'POST /v1/moderation/cases',
      'POST /v1/moderation/cases/k1/claim', 'POST /v1/moderation/cases/k1/decision', 'POST /v1/moderation/cases/k2/decision',
      'GET /v1/moderation/appeals?status=PENDING', 'POST /v1/moderation/appeals/a1/decision',
    ]);
    // 请求体只带接口列出的字段（后端 DECISION_FIELDS / REPORT_FIELDS，未知字段 400）
    expect(calls[1].body).toBe(JSON.stringify({ targetType: 'PRODUCT', targetId: 'p1', reasonCode: 'SPAM' }));
    expect(calls[11].body).toBe(JSON.stringify({ action: 'RESTRICT_CONTACT', reasonCode: 'HARASSMENT', durationHours: 72 }));
    expect(calls[12].body).toBe(JSON.stringify({ action: 'NO_ACTION', reasonCode: 'DUPLICATE' }));
    for (const c of calls) expect(c.body ?? '').not.toMatch(/schoolId|staffId|reporterId|actorUserId/);
    for (const c of calls) expect(c.url).not.toMatch(/\/v1\/(orders|no-show-reports|meeting-points|price-guidance)|trade-(history|summary)/);
    // 订单、爽约、交易履历与价格参考的方法已从 REST 适配层移除
    for (const retired of ['createOrder', 'transitionOrder', 'listOrders', 'addReview', 'getOrderFlow', 'getOrderNoShow', 'reportNoShow',
      'acknowledgeNoShow', 'disputeNoShow', 'getOwnTradeHistory', 'getPublicTradeSummary', 'getPriceGuidance', 'listMeetingPoints']) {
      expect(retired in RestCampusMarketApi.prototype, retired).toBe(false);
    }
  });
});
