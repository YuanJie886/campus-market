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
const meetingAt = () => { const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0); return at.toISOString() };
const orderInput = (productId: string) => ({ productId, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() });
/**
 * 把订单的档期挪到过去（开始于 minutesAgo 分钟前、时长 60 分钟），模拟面交时间已过。
 * 7.1A 起档期在接受时冻结：订单与对应版本的快照一起平移（与后端测试的 SlotClock 相同）。
 */
function meetingPast(orderId: string, minutesAgo = 120) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  const o = raw.market.orders.find((x: { id: string }) => x.id === orderId);
  const start = Date.now() - minutesAgo * 60_000;
  o.meetingAtIso = new Date(start).toISOString();
  o.meetingEndsAtIso = new Date(start + 60 * 60_000).toISOString();
  for (const a of raw.slotAgreements) if (a.orderId === orderId && a.revision === (o.meetingRevision ?? 0)) Object.assign(a, { startsAt: start, endsAt: start + 60 * 60_000 });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
/** 测试夹具：与运维手册的受控 SQL 等价，直接登记一名工作人员 */
function makeStaff(userId: string, role: 'MODERATOR' | 'SENIOR_MODERATOR' = 'MODERATOR', school = 'pilot') {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.staffMembers.push({ userId, schoolId: school, role, active: true, createdAt: Date.now() });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
async function deal(accept = true) {
  const sellerId = await user('seller');
  const pid = (await api.createProduct(product(`承诺 ${rnd()}`))).id;
  const buyerId = await user('buyer');
  const order = await api.createOrder(orderInput(pid));
  if (accept) { await as('seller'); await api.transitionOrder(order.id, { to: 'PENDING_MEETING' }) }
  return { sellerId, buyerId, pid, orderId: order.id };
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
    expect(await code(api.createOrder(orderInput(b)))).toBe(404);
    expect(await code(api.listProducts({ campus: LAKE as never, sort: 'latest', page: 1, pageSize: 20 }))).toBe(400);
    expect(await code(api.listProducts({ schoolId: 'lake', sort: 'latest', page: 1, pageSize: 20 } as never))).toBe(400);
    expect(await code(api.createProduct(product('发到他校', { campus: LAKE as never })))).toBe(400);
    expect(await code(api.updateProfile({ campus: LAKE as never }))).toBe(400);
    const lakeUser = (await api.login({ account: accounts.get('lake')!, password: 'test-password' })).user.id;
    await as('pilot');
    expect(await code(api.getUser(lakeUser))).toBe(404);
    expect(await code(api.getPublicTradeSummary(lakeUser))).toBe(404);
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

describe('7.1 取消记录', () => {
  it('确认前无责取消（原因选填）；确认后必须选原因；「其他」需说明；幂等不重复记录；阶段由服务端判定；客户端不能伪造字段', async () => {
    const early = await deal(false);
    await as('buyer');
    expect(await code(api.transitionOrder(early.orderId, { to: 'CANCELLED', phase: 'AFTER_MEETING_AGREED' } as never))).toBe(400);
    await api.transitionOrder(early.orderId, { to: 'CANCELLED' });
    const d = await deal();
    await as('buyer');
    expect(await code(api.transitionOrder(d.orderId, { to: 'CANCELLED' }))).toBe(400);
    expect(await code(api.transitionOrder(d.orderId, { to: 'CANCELLED', reasonCode: 'OTHER' }))).toBe(400);
    expect(await code(api.transitionOrder(d.orderId, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND', note: '<b>x</b>' }))).toBe(400);
    await api.transitionOrder(d.orderId, { to: 'CANCELLED', reasonCode: 'SCHEDULE_CONFLICT' });
    await as('seller');
    expect((await api.transitionOrder(d.orderId, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND' })).canonicalStatus).toBe('CANCELLED');
    const records = JSON.parse(window.localStorage.getItem(DB)!).cancellationRecords;
    expect(records.map((r: { phase: string }) => r.phase)).toEqual(['BEFORE_SELLER_CONFIRM', 'AFTER_SELLER_CONFIRM']);
    expect(records[1]).toMatchObject({ reasonCode: 'SCHEDULE_CONFLICT', actorId: d.buyerId });
    const flow = await api.getOrderFlow(d.orderId);
    expect(flow.cancellation).toMatchObject({ phase: 'AFTER_SELLER_CONFIRM', byMe: false });
  });
});

describe('7.2 爽约报告', () => {
  it('资格：没有确认档期 / 太早 / 见面后都不能报告；只能报告对方；单方报告不处罚；承认才计数；第 2 次限制预约 24 小时', async () => {
    const pending = await deal(false);
    meetingPast(pending.orderId);
    await as('buyer');
    expect((await api.getOrderNoShow(pending.orderId)).eligibility.code).toBe('NO_AGREED_MEETING');
    const d = await deal();
    await as('buyer');
    expect((await api.getOrderNoShow(d.orderId)).eligibility.code).toBe('TOO_EARLY');
    meetingPast(d.orderId);
    await as('buyer');
    expect(await code(api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE', reportedUserId: d.buyerId } as never))).toBe(400);
    const r = await api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
    expect(r).toMatchObject({ status: 'PENDING', byMe: true, canRespond: false });
    expect((await api.getOrderNoShow(d.orderId)).eligibility.code).toBe('ALREADY_REPORTED');
    await as('seller');
    expect((await api.getMyGovernance()).restrictions).toEqual([]);
    expect(await code(api.createOrder(orderInput((await api.createProduct(product('卖家也能买'))).id)))).toBe(403);
    // ↑ 自己的商品不能买（403），与限制无关；换一件别人的商品验证 BOOKING 不受 PENDING 影响
    await as('buyer');
    const other = (await api.createProduct(product('买家的商品'))).id;
    await as('seller');
    expect((await api.createOrder(orderInput(other))).productId).toBe(other);

    await as('buyer');
    expect(await code(api.acknowledgeNoShow(r.id))).toBe(404);
    await as('seller');
    expect((await api.acknowledgeNoShow(r.id)).status).toBe('ACKNOWLEDGED');
    expect((await api.getMyGovernance()).noShowWarning).toEqual({ confirmedCount: 1, windowDays: 30 });
    expect((await api.getMyGovernance()).restrictions).toEqual([]);

    // 第二次已确认的爽约：限制预约 24 小时，来源是公开规则
    const buyer2 = await user('buyer2');
    void buyer2;
    await as('seller');
    const p2 = (await api.createProduct(product('第二次'))).id;
    await as('buyer2');
    const o2 = await api.createOrder(orderInput(p2));
    await as('seller');
    await api.transitionOrder(o2.id, { to: 'PENDING_MEETING' });
    meetingPast(o2.id);
    await as('buyer2');
    const r2 = await api.reportNoShow(o2.id, { reasonCode: 'DID_NOT_ARRIVE' });
    await as('seller');
    await api.acknowledgeNoShow(r2.id);
    const g = await api.getMyGovernance();
    expect(g.restrictions).toHaveLength(1);
    // 7.1B：自动限制来源为 SYSTEM_RULE，带规则版本与两次依据
    expect(g.restrictions[0]).toMatchObject({ scope: 'BOOKING', source: 'SYSTEM_RULE', ruleVersion: 'NO_SHOW_V1', active: true, canAppeal: true });
    expect(g.restrictions[0].basis).toHaveLength(2);
    expect(g.restrictions[0].endsAt - g.restrictions[0].startsAt).toBe(24 * 3_600_000);
    const blocked = await failure(api.createOrder(orderInput(other)));
    expect(blocked.code).toBe(403);
    expect(blocked.details).toMatchObject({ code: 'RESTRICTED', scope: 'BOOKING' });
    // 已有订单照常可以取消 / 浏览不受影响
    expect((await api.getProduct(other)).id).toBe(other);
  });

  it('异议进入复核并不计数；改约让旧档期上的报告失效；见面（买家确认）后不能报告', async () => {
    const d = await deal();
    meetingPast(d.orderId);
    await as('buyer');
    const r = await api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
    await as('seller');
    expect(await code(api.disputeNoShow(r.id, ''))).toBe(400);
    expect((await api.disputeNoShow(r.id, '我到了')).status).toBe('DISPUTED');
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    expect(raw.moderationCases.filter((c: { targetType: string; status: string }) => c.targetType === 'NO_SHOW' && c.status === 'OPEN')).toHaveLength(1);
    expect((await api.getMyGovernance()).noShowWarning).toBeNull();

    const r2deal = await deal();
    meetingPast(r2deal.orderId);
    await as('seller');
    const old = await api.reportNoShow(r2deal.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
    const start = new Date(Date.now() + 2 * 86_400_000); start.setMinutes(0, 0, 0);
    await as('buyer');
    const flow = await api.proposeMeeting(r2deal.orderId, { meetingPointId: '东校区-library', startsAtIso: start.toISOString(), endsAtIso: new Date(start.getTime() + 3_600_000).toISOString() });
    const proposal = flow.proposals.find((p) => p.status === 'PENDING')!;
    await as('seller');
    await api.acceptMeeting(r2deal.orderId, proposal.id);
    await as('buyer');
    expect((await api.getOrderNoShow(r2deal.orderId)).reports.find((x) => x.id === old.id)?.status).toBe('EXPIRED');
    expect(await code(api.acknowledgeNoShow(old.id))).toBe(409);
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

describe('REST 适配层（模块 6.1 / 7）', () => {
  it('路径与方法；成员分页参数；取消原因只在请求体；工作人员接口在 /v1/moderation 下', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.listCircleMembers('c1', 3, 50);
    await rest.transitionOrder('o1', { to: 'CANCELLED', reasonCode: 'CHANGED_MIND', note: '有事' });
    await rest.getOrderNoShow('o1');
    await rest.reportNoShow('o1', { reasonCode: 'DID_NOT_ARRIVE' });
    await rest.acknowledgeNoShow('r1');
    await rest.disputeNoShow('r1', '我到了');
    await rest.createModerationReport({ targetType: 'PRODUCT', targetId: 'p1', reasonCode: 'SPAM' });
    await rest.listMyModerationReports();
    await rest.getMyGovernance();
    await rest.submitAppeal({ restrictionId: 'x1', reason: '申诉' });
    await rest.getStaffStatus();
    await rest.listModerationCases({ status: 'OPEN', page: 2, size: 20 });
    await rest.getModerationCase('k1');
    await rest.openModerationCase({ targetType: 'USER', targetId: 'u1' });
    await rest.claimModerationCase('k1');
    await rest.decideModerationCase('k1', { action: 'NO_ACTION', reasonCode: 'DUPLICATE' });
    await rest.listModerationAppeals({ status: 'PENDING' });
    await rest.decideModerationAppeal('a1', { accept: false, reasonCode: 'APPEAL_REJECTED' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/circles/c1/members?page=3&size=50', 'POST /v1/orders/o1/transitions', 'GET /v1/orders/o1/no-show-reports',
      'POST /v1/orders/o1/no-show-reports', 'POST /v1/no-show-reports/r1/acknowledge', 'POST /v1/no-show-reports/r1/dispute',
      'POST /v1/moderation-reports', 'GET /v1/moderation-reports/mine', 'GET /v1/me/governance', 'POST /v1/me/appeals', 'GET /v1/me/staff',
      'GET /v1/moderation/cases?status=OPEN&page=2&size=20', 'GET /v1/moderation/cases/k1', 'POST /v1/moderation/cases',
      'POST /v1/moderation/cases/k1/claim', 'POST /v1/moderation/cases/k1/decision', 'GET /v1/moderation/appeals?status=PENDING',
      'POST /v1/moderation/appeals/a1/decision',
    ]);
    expect(calls[1].body).toBe(JSON.stringify({ to: 'CANCELLED', reasonCode: 'CHANGED_MIND', note: '有事' }));
    for (const c of calls) expect(c.body ?? '').not.toMatch(/schoolId|staffId|reporterId|actorUserId/);
  });
});
