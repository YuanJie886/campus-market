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
 *
 * <p>平台已改为只展示商品与联系方式：A 明确档期、B 爽约自动限制重算，以及 C7（爽约自动限制的申诉）
 * 随交易 / 预约 / 爽约功能移除（Mock 返回 410），对应用例已删除。
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
function mutate(fn: (raw: Record<string, any>) => void) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  fn(raw);
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
function makeStaff(userId: string, school = 'pilot') {
  mutate((raw) => raw.staffMembers.push({ userId, schoolId: school, role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() }));
}

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

  it('C6：没有可回避的工作人员 → 举报保持待处理并标记 awaitingEligibleStaff；本校出现无冲突的工作人员后标记解除并进入其队列', async () => {
    const only = await user('g-only');
    makeStaff(only);
    await user('g-reporter');
    const report = await api.createModerationReport({ targetType: 'USER', targetId: only, reasonCode: 'HARASSMENT' });
    expect(report).toMatchObject({ status: 'RECEIVED', awaitingEligibleStaff: true });
    await as('g-only');
    expect((await api.listModerationCases({ size: 100 })).items).toEqual([]);
    const second = await user('g-second');
    makeStaff(second);
    await as('g-reporter');
    expect((await api.listMyModerationReports())[0]).toMatchObject({ status: 'RECEIVED', awaitingEligibleStaff: false });
    await as('g-second');
    expect((await api.listModerationCases({ size: 100 })).items.map((c) => c.targetId)).toContain(only);
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
  it('新的内容处置动作（隐藏评论 / 隔离私信）沿用同一个结案接口；申诉只走 /v1/me/appeals，处置参数只在请求体', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.decideModerationCase('k1', { action: 'HIDE_COMMENT', reasonCode: 'HARASSMENT' });
    await rest.decideModerationCase('k2', { action: 'QUARANTINE_MESSAGE', reasonCode: 'HARASSMENT' });
    await rest.submitAppeal({ actionId: 'act-1', reason: '申诉' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/moderation/cases/k1/decision', 'POST /v1/moderation/cases/k2/decision', 'POST /v1/me/appeals',
    ]);
    expect(JSON.parse(calls[0].body!)).toMatchObject({ action: 'HIDE_COMMENT', reasonCode: 'HARASSMENT' });
    expect(JSON.parse(calls[1].body!)).toMatchObject({ action: 'QUARANTINE_MESSAGE', reasonCode: 'HARASSMENT' });
    expect(JSON.parse(calls[2].body!)).toMatchObject({ actionId: 'act-1', reason: '申诉' });
    expect(calls.every((c) => !/[?&](action|reasonCode|actionId)=/.test(c.url))).toBe(true);
  });
});
