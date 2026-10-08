// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import type { ProductCreateInput } from './contracts';

/**
 * 模块 7.1 的 Mock 契约：与后端 GovernanceRulesIT 的编号逐条对应（A 明确档期、B 自动限制重算、C 利益回避、
 * D 邀请幂等边界、E 内容处置），保证离线演示与真实服务端的结论一致。全部是 API 调用的行为断言。
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
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string, campus = '东校区') {
  const account = `${label}-${rnd()}`;
  const session = await api.register({ account, password: 'test-password', nickname: label, campus: campus as never, contact: '13800000000' });
  accounts.set(label, account);
  return session.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const product = (title: string): ProductCreateInput => ({
  title, description: '7.1 测试', price: 20, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
} as ProductCreateInput);
const hourStart = (hours: number) => { const at = new Date(Date.now() + hours * 3_600_000); at.setMinutes(0, 0, 0); return at };
const orderInput = (productId: string, ends?: string) => ({
  productId, meetingPointId: '东校区-library', meetingAtIso: hourStart(26).toISOString(), contact: '1', idempotencyKey: rnd(),
  ...(ends ? { meetingEndsAtIso: ends } : {}),
});
function mutate(fn: (raw: Record<string, any>) => void) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  fn(raw);
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
/** 与后端 SlotClock.endedMinutesAgo 相同：订单行与冻结快照一起平移（时长 60 分钟） */
const endedMinutesAgo = (orderId: string, minutes: number) => mutate((raw) => {
  const o = raw.market.orders.find((x: { id: string }) => x.id === orderId);
  const end = Date.now() - minutes * 60_000;
  o.meetingAtIso = new Date(end - 3_600_000).toISOString();
  o.meetingEndsAtIso = new Date(end).toISOString();
  for (const a of raw.slotAgreements) if (a.orderId === orderId && a.revision === (o.meetingRevision ?? 0)) Object.assign(a, { startsAt: end - 3_600_000, endsAt: end });
});
/** 与后端 SlotClock.legacyWithoutEnd 相同：模拟 V11 之前没有结束时间、没有快照的原始预约 */
const legacyWithoutEnd = (orderId: string) => mutate((raw) => {
  const o = raw.market.orders.find((x: { id: string }) => x.id === orderId);
  o.meetingAtIso = new Date(Date.now() - 10 * 3_600_000).toISOString();
  o.meetingEndsAtIso = null;
  raw.slotAgreements = raw.slotAgreements.filter((a: { orderId: string }) => a.orderId !== orderId);
});
function makeStaff(userId: string, school = 'pilot') {
  mutate((raw) => raw.staffMembers.push({ userId, schoolId: school, role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() }));
}

/** 卖家 label 发布、买家 buyer 下单、卖家接单 */
async function accepted(buyer: string, seller = `s${rnd()}`) {
  await user(seller);
  const pid = (await api.createProduct(product(`7.1 ${rnd()}`))).id;
  await as(buyer);
  const order = await api.createOrder(orderInput(pid));
  await as(seller);
  await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
  return { seller, orderId: order.id, productId: pid };
}
/** 卖家报告、buyer 自行承认 */
async function acknowledged(d: { seller: string; orderId: string }, buyer: string) {
  endedMinutesAgo(d.orderId, 30);
  await as(d.seller);
  const r = await api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
  await as(buyer);
  await api.acknowledgeNoShow(r.id);
  return r.id;
}
/** 卖家报告、buyer 异议、staff 确认 */
async function staffConfirmed(d: { seller: string; orderId: string }, buyer: string, staff: string) {
  endedMinutesAgo(d.orderId, 30);
  await as(d.seller);
  const r = await api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
  await as(buyer);
  await api.disputeNoShow(r.id, '有异议');
  await as(staff);
  const c = (await api.listModerationCases({ targetType: 'NO_SHOW', size: 100 })).items.find((x) => x.targetId === r.id)!;
  await api.decideModerationCase(c.id, { action: 'CONFIRM_NO_SHOW', reasonCode: 'CONFIRMED_NO_SHOW' });
  return r.id;
}
const restrictionOf = (reportId: string) => JSON.parse(window.localStorage.getItem(DB)!).userRestrictions.find((r: { noShowReportId: string }) => r.noShowReportId === reportId);
const confirmActionOf = (reportId: string) => JSON.parse(window.localStorage.getItem(DB)!).moderationActions.find((a: { actionCode: string; targetId: string }) => a.actionCode === 'CONFIRM_NO_SHOW' && a.targetId === reportId).id as string;

describe('7.1A 明确档期（Mock）', () => {
  it('A1/A2：显式结束时间原样保存、默认 60 分钟明确写入；时长 / 顺序 / 格式校验 400；接单后生成同一快照', async () => {
    await user('a-seller');
    const p1 = (await api.createProduct(product('A1'))).id;
    const p2 = (await api.createProduct(product('A1b'))).id;
    await user('a-buyer');
    const start = hourStart(26);
    for (const bad of [start.toISOString(), new Date(start.getTime() + 10 * 60_000).toISOString(), new Date(start.getTime() + 121 * 60_000).toISOString(), '明天']) {
      expect((await failure(api.createOrder(orderInput(p1, bad)))).code).toBe(400);
    }
    const ends = new Date(start.getTime() + 45 * 60_000).toISOString();
    const o = await api.createOrder(orderInput(p1, ends));
    expect(o.meetingEndsAtIso).toBe(ends);
    expect(o.slotAgreed).toBe(false);
    const d = await api.createOrder(orderInput(p2));
    expect(Date.parse(d.meetingEndsAtIso!) - Date.parse(d.meetingAtIso!)).toBe(60 * 60_000);
    await as('a-seller');
    await api.transitionOrder(o.id, { to: 'PENDING_MEETING' });
    expect((await api.getOrderFlow(o.id)).agreement.explicitSlot).toBe(true);
    const snap = JSON.parse(window.localStorage.getItem(DB)!).slotAgreements.find((a: { orderId: string }) => a.orderId === o.id);
    expect(snap).toMatchObject({ revision: 0, source: 'SELLER_ACCEPTED_BOOKING', endsAt: Date.parse(ends) });
  });

  it('A4/A5/A6：资格只用快照；旧原始预约 NO_EXPLICIT_SLOT、不能报告；已有报告不能承认；工作人员没有 CONFIRM_NO_SHOW', async () => {
    await user('b-buyer');
    const d = await accepted('b-buyer');
    endedMinutesAgo(d.orderId, 14);
    await as(d.seller);
    expect((await api.getOrderNoShow(d.orderId)).eligibility.code).toBe('TOO_EARLY');
    endedMinutesAgo(d.orderId, 16);
    await as(d.seller);
    const e = (await api.getOrderNoShow(d.orderId)).eligibility;
    expect(e.canReport).toBe(true);
    expect(e.slot?.endsAt).toBe(e.reportableAt! - 15 * 60_000);
    const report = await api.reportNoShow(d.orderId, { reasonCode: 'DID_NOT_ARRIVE' });
    legacyWithoutEnd(d.orderId);
    await as(d.seller);
    expect((await api.getOrderNoShow(d.orderId)).eligibility).toMatchObject({ code: 'NO_EXPLICIT_SLOT', canReport: false, slot: null });
    await as('b-buyer');
    const ack = await failure(api.acknowledgeNoShow(report.id));
    expect(ack.code).toBe(409);
    expect(ack.details).toMatchObject({ code: 'NO_EXPLICIT_SLOT' });
    const staffId = await user('b-staff');
    makeStaff(staffId);
    await as(d.seller);
    await api.createModerationReport({ targetType: 'NO_SHOW', targetId: report.id, reasonCode: 'NO_SHOW_REVIEW' });
    await as('b-staff');
    const c = (await api.listModerationCases({ targetType: 'NO_SHOW' })).items[0];
    const detail = await api.getModerationCase(c.id);
    expect(detail.allowedActions).toEqual(['REJECT_NO_SHOW']);
    expect(detail.noShow?.meeting.explicit).toBe(false);
    expect((await failure(api.decideModerationCase(c.id, { action: 'CONFIRM_NO_SHOW', reasonCode: 'CONFIRMED_NO_SHOW' }))).code).toBe(400);
  });

  it('A7：旧预约通过改约握手确认完整新档期 → revision 1 快照，资格改用新快照', async () => {
    await user('c-buyer');
    const d = await accepted('c-buyer');
    legacyWithoutEnd(d.orderId);
    await as('c-buyer');
    const s = hourStart(3);
    await api.proposeMeeting(d.orderId, { meetingPointId: '东校区-library', startsAtIso: s.toISOString(), endsAtIso: new Date(s.getTime() + 30 * 60_000).toISOString() });
    await as(d.seller);
    const proposal = (await api.getOrderFlow(d.orderId)).proposals[0];
    const flow = await api.acceptMeeting(d.orderId, proposal.id);
    expect(flow.agreement).toMatchObject({ revision: 1, explicitSlot: true });
    const e = (await api.getOrderNoShow(d.orderId)).eligibility;
    expect(e.code).toBe('TOO_EARLY');
    expect(e.slot).toMatchObject({ revision: 1, endsAt: s.getTime() + 30 * 60_000 });
  });
});

describe('7.1B 自动限制重算（Mock）', () => {
  it('B1/B3：SYSTEM_RULE + 规则版本 + 依据；第二次被撤销后第三次的 72 小时缩短为 24 小时（SHORTENED），第二次的限制撤销', async () => {
    await user('d-buyer');
    const deals = [await accepted('d-buyer'), await accepted('d-buyer'), await accepted('d-buyer')];
    await acknowledged(deals[0], 'd-buyer');
    const second = await acknowledged(deals[1], 'd-buyer');
    const third = await acknowledged(deals[2], 'd-buyer');
    expect(restrictionOf(third)).toMatchObject({ source: 'SYSTEM_RULE', ruleVersion: 'NO_SHOW_V1' });
    expect(restrictionOf(third).basis).toHaveLength(3);
    expect(restrictionOf(third).endsAt - restrictionOf(third).startsAt).toBe(72 * 3_600_000);
    const staffId = await user('d-staff');
    makeStaff(staffId);
    await as('d-buyer');
    const appeal = await api.submitAppeal({ restrictionId: restrictionOf(second).id, reason: '请复核' });
    await as('d-staff');
    await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' });
    expect(restrictionOf(second).revokeReason).toBe('APPEAL_ACCEPTED');
    expect(restrictionOf(third).endsAt - restrictionOf(third).startsAt).toBe(24 * 3_600_000);
    await as('d-buyer');
    const mine = (await api.getMyGovernance()).restrictions.find((r) => r.id === restrictionOf(third).id)!;
    expect(mine.corrections).toMatchObject([{ outcome: 'SHORTENED', remainingCount: 2 }]);
    expect(mine.basis?.filter((b) => !b.stillConfirmed)).toHaveLength(1);
  });

  it('B4/B5/B6：推翻一次工作人员确认 → 剩 1 次时 REVOKED；已到期的不动；人工限制不受影响；原确认人不能决定', async () => {
    const buyerId = await user('e-buyer');
    const deals = [await accepted('e-buyer'), await accepted('e-buyer'), await accepted('e-buyer')];
    const confirmer = await user('e-confirmer');
    makeStaff(confirmer);
    const reviewer = await user('e-reviewer');
    makeStaff(reviewer);
    const first = await staffConfirmed(deals[0], 'e-buyer', 'e-confirmer');
    const second = await acknowledged(deals[1], 'e-buyer');
    const r2 = restrictionOf(second);
    await as('e-reviewer');
    await api.decideModerationCase((await api.openModerationCase({ targetType: 'USER', targetId: buyerId })).id,
      { action: 'RESTRICT_PUBLISHING', reasonCode: 'POLICY_VIOLATION', durationHours: 48 });
    const manualBefore = JSON.parse(window.localStorage.getItem(DB)!).userRestrictions.find((r: { source: string }) => r.source === 'CASE');
    await as('e-buyer');
    const appeal = await api.submitAppeal({ actionId: confirmActionOf(first), reason: '请复核' });
    await as('e-confirmer');
    expect(await failure(api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' }))).toMatchObject({ code: 403, details: { code: 'CONFLICT_OF_INTEREST', reason: 'OWN_ACTION' } });
    await as('e-reviewer');
    await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' });
    expect(restrictionOf(second)).toMatchObject({ id: r2.id, revokeReason: 'RULE_RECOMPUTED' });
    expect(JSON.parse(window.localStorage.getItem(DB)!).userRestrictions.find((r: { id: string }) => r.id === manualBefore.id)).toEqual(manualBefore);

    // B5：已到期的自动限制只保留审计
    const third = await acknowledged(deals[2], 'e-buyer');
    void third;
    mutate((raw) => { for (const r of raw.userRestrictions) if (r.source === 'SYSTEM_RULE' && !r.revokedAt) Object.assign(r, { startsAt: Date.now() - 3 * 86_400_000, endsAt: Date.now() - 2 * 86_400_000 }) });
    const expired = JSON.parse(window.localStorage.getItem(DB)!).userRestrictions.filter((r: { source: string; revokedAt: number | null }) => r.source === 'SYSTEM_RULE' && !r.revokedAt);
    const before = JSON.stringify(expired);
    const corrections = JSON.parse(window.localStorage.getItem(DB)!).restrictionCorrections.length;
    await as('e-buyer');
    const noticeAppeal = (await api.getMyGovernance()).notices.find((n) => n.actionCode === 'CONFIRM_NO_SHOW' && n.canAppeal);
    expect(noticeAppeal).toBeUndefined();   // 第一次确认已被推翻，不再可申诉
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(DB)!).userRestrictions.filter((r: { id: string }) => expired.some((x: { id: string }) => x.id === r.id)))).toBe(before);
    expect(JSON.parse(window.localStorage.getItem(DB)!).restrictionCorrections).toHaveLength(corrections);
  });
});

describe('7.1C 利益回避（Mock）', () => {
  it('C1～C5：以本人为目标 / 本人商品 / 本人举报的案件与本人做出的处理的申诉：403 CONFLICT_OF_INTEREST，且不出现在本人队列；他校 404', async () => {
    const a = await user('f-staffA');
    makeStaff(a);
    const b = await user('f-staffB');
    makeStaff(b);
    await as('f-staffA');
    const mine = (await api.createProduct(product('工作人员的商品'))).id;
    await user('f-other');
    await api.createModerationReport({ targetType: 'USER', targetId: a, reasonCode: 'HARASSMENT' });
    await api.createModerationReport({ targetType: 'PRODUCT', targetId: mine, reasonCode: 'MISLEADING' });
    await as('f-staffA');
    await api.createModerationReport({ targetType: 'USER', targetId: b, reasonCode: 'SPAM' });
    const all = JSON.parse(window.localStorage.getItem(DB)!).moderationCases as Array<{ id: string; targetId: string }>;
    const queue = (await api.listModerationCases({ size: 100 })).items.map((c) => c.id);
    for (const target of [a, mine, b]) {
      const c = all.find((x) => x.targetId === target)!;
      expect(queue).not.toContain(c.id);
      for (const call of [api.getModerationCase(c.id), api.claimModerationCase(c.id), api.decideModerationCase(c.id, { action: 'NO_ACTION', reasonCode: 'DUPLICATE' })]) {
        expect(await failure(call)).toMatchObject({ code: 403, details: { code: 'CONFLICT_OF_INTEREST' } });
      }
    }
    await as('f-staffB');
    expect((await api.listModerationCases({ size: 100 })).items.map((c) => c.id)).toContain(all.find((x) => x.targetId === a)!.id);
  });

  it('C6/C7：没有可回避的工作人员 → 举报保持待处理并标记 awaitingEligibleStaff；自动限制（无工作人员）可以由本校无冲突的工作人员决定', async () => {
    const only = await user('g-only');
    makeStaff(only);
    await user('g-reporter');
    const report = await api.createModerationReport({ targetType: 'USER', targetId: only, reasonCode: 'HARASSMENT' });
    expect(report).toMatchObject({ status: 'RECEIVED', awaitingEligibleStaff: true });
    const second = await user('g-second');
    makeStaff(second);
    await as('g-reporter');
    expect((await api.listMyModerationReports())[0].awaitingEligibleStaff).toBe(false);

    await user('g-buyer');
    const deals = [await accepted('g-buyer'), await accepted('g-buyer')];
    await acknowledged(deals[0], 'g-buyer');
    const r = restrictionOf(await acknowledged(deals[1], 'g-buyer'));
    expect(r.createdBy).toBeNull();
    await as('g-buyer');
    const appeal = await api.submitAppeal({ restrictionId: r.id, reason: '请复核' });
    await as('g-second');
    const listed = (await api.listModerationAppeals({ status: 'PENDING' })).items.find((x) => x.id === appeal.id)!;
    expect(listed).toMatchObject({ decidable: true, subject: { kind: 'RESTRICTION', sourceType: 'SYSTEM_RULE', ruleVersion: 'NO_SHOW_V1' } });
    await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' });
    expect(restrictionOf(r.noShowReportId).revokeReason).toBe('APPEAL_ACCEPTED');
  });

  it('C8：停用后下一请求立即失权', async () => {
    const s = await user('h-staff');
    makeStaff(s);
    await as('h-staff');
    expect((await api.getStaffStatus()).staff).toBe(true);
    mutate((raw) => { raw.staffMembers.find((m: { userId: string }) => m.userId === s).active = false });
    await as('h-staff');
    expect((await failure(api.listModerationCases({}))).code).toBe(403);
  });
});

describe('7.1D 邀请幂等边界（Mock）', () => {
  it('同圈有效邀请 200 不消耗；随机 / 过期 / 撤销 / 他校码 404；原兑换者重放 200、他人 404、退出后 404', async () => {
    await user('i-owner');
    const circle = await api.createCircle({ type: 'CLUB', name: '边界圈' });
    const first = await api.createCircleInvite(circle.id);
    const memberId = await user('i-member');
    await api.redeemCircleInvite(first.token);
    expect((await api.redeemCircleInvite(first.token)).id).toBe(circle.id);   // 原兑换者重放
    await as('i-owner');
    const valid = await api.createCircleInvite(circle.id);
    const expired = await api.createCircleInvite(circle.id);
    const revoked = await api.createCircleInvite(circle.id);
    await api.revokeCircleInvite(revoked.invite.id);
    mutate((raw) => { raw.circleInvites.find((i: { id: string }) => i.id === expired.invite.id).expiresAt = Date.now() - 1 });
    await as('i-member');
    expect((await api.redeemCircleInvite(valid.token)).id).toBe(circle.id);
    expect(JSON.parse(window.localStorage.getItem(DB)!).circleInvites.find((i: { id: string }) => i.id === valid.invite.id).status).toBe('PENDING');
    for (const t of [`random-${rnd()}`, expired.token, revoked.token]) expect((await failure(api.redeemCircleInvite(t))).code).toBe(404);
    await user('i-other');
    expect((await failure(api.redeemCircleInvite(first.token))).code).toBe(404);
    await as('i-member');
    await api.removeCircleMember(circle.id, memberId);
    expect((await failure(api.redeemCircleInvite(first.token))).code).toBe(404);
  });
});

describe('7.1E 内容处置（Mock）', () => {
  it('评论隐藏：任何人都看不到正文、作者有提示、原文保留；作者申诉由另一位工作人员恢复；私信只隔离一条、会话照常', async () => {
    const author = await user('j-author');
    await user('j-seller');
    const pid = (await api.createProduct(product('留言商品'))).id;
    await as('j-author');
    const comment = await api.addComment({ productId: pid, content: '需要隐藏的原文' });
    const conv = await api.getOrCreateConversation(pid);
    await api.sendMessage(conv.id, '正常的第一条');
    await as('j-seller');
    const bad = await api.sendMessage(conv.id, '被举报的那一条');
    await api.createModerationReport({ targetType: 'COMMENT', targetId: comment.id, reasonCode: 'HARASSMENT' });
    await as('j-author');
    await api.createModerationReport({ targetType: 'MESSAGE', targetId: bad.id, reasonCode: 'HARASSMENT' });
    const a = await user('j-staffA');
    makeStaff(a);
    const b = await user('j-staffB');
    makeStaff(b);
    await as('j-staffA');
    const cases = (await api.listModerationCases({ size: 100 })).items;
    const cc = cases.find((c) => c.targetId === comment.id)!;
    const mc = cases.find((c) => c.targetId === bad.id)!;
    expect((await api.getModerationCase(cc.id)).allowedActions).toContain('HIDE_COMMENT');
    await api.decideModerationCase(cc.id, { action: 'HIDE_COMMENT', reasonCode: 'HARASSMENT' });
    const mcDetail = await api.getModerationCase(mc.id);
    expect(JSON.stringify(mcDetail)).toContain('被举报的那一条');
    expect(JSON.stringify(mcDetail)).not.toContain('正常的第一条');
    await api.decideModerationCase(mc.id, { action: 'QUARANTINE_MESSAGE', reasonCode: 'HARASSMENT' });
    for (const who of ['j-seller', 'j-author']) {
      await as(who);
      const list = await api.listComments(pid);
      expect(list[0]).toMatchObject({ content: '', moderationHidden: true, hiddenForAuthor: who === 'j-author' });
      const msgs = await api.listMessages(conv.id);
      expect(msgs.map((m) => m.content)).toEqual(['正常的第一条', '']);
      expect(msgs[1].quarantined).toBe(true);
    }
    expect(JSON.parse(window.localStorage.getItem(DB)!).market.comments.find((c: { id: string }) => c.id === comment.id).content).toBe('需要隐藏的原文');
    await as('j-author');
    expect((await api.sendMessage(conv.id, '继续沟通')).content).toBe('继续沟通');
    const notice = (await api.getMyGovernance()).notices.find((n) => n.actionCode === 'HIDE_COMMENT')!;
    expect(notice).toMatchObject({ active: true, canAppeal: true });
    const appeal = await api.submitAppeal({ actionId: notice.actionId, reason: '不是骚扰' });
    await as('j-staffA');
    expect((await failure(api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' }))).code).toBe(403);
    await as('j-staffB');
    await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' });
    await as('j-seller');
    expect((await api.listComments(pid))[0].content).toBe('需要隐藏的原文');
    expect(author).toBeTruthy();
  });
});

describe('REST 适配层（7.1）', () => {
  it('下单时结束时间只在请求体里（与 Mock 同一字段）；新的内容处置动作沿用同一个结案接口', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    const input = orderInput('p1', hourStart(27).toISOString());
    await rest.createOrder(input);
    await rest.decideModerationCase('k1', { action: 'HIDE_COMMENT', reasonCode: 'HARASSMENT' });
    await rest.decideModerationCase('k2', { action: 'QUARANTINE_MESSAGE', reasonCode: 'HARASSMENT' });
    await rest.submitAppeal({ actionId: 'act-1', reason: '申诉' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/orders', 'POST /v1/moderation/cases/k1/decision', 'POST /v1/moderation/cases/k2/decision', 'POST /v1/me/appeals',
    ]);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ meetingAtIso: input.meetingAtIso, meetingEndsAtIso: input.meetingEndsAtIso });
    expect(calls[0].url).not.toMatch(/meetingEndsAt/);
  });
});
