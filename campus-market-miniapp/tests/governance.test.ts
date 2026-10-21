import { describe, expect, it } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import {
  APPEAL_DONE, NOTICE_SECTION_LABEL, REPORT_REASON_LABEL, RESTRICTION_SOURCE_LABEL, SCOPE_LABEL, SCOPE_STILL_ALLOWED, TARGET_LABEL,
  appealError, appealInput, appealStatusText, formatUntil, groupGovernance, otherNoticeTitle, pastRestrictionText, productNoticeTitle, reportError, reportInput, reportStatusText,
} from '../src/governance';
import type { MyGovernance, MyRestriction } from '../src/model';

function setup(prepare?: (db: Record<string, unknown>) => void) {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  const api = new MockApi(storage);
  if (!prepare) return api;
  prepare(value as Record<string, unknown>);
  return new MockApi(storage);
}
const HOUR = 3600000;
const restriction = (extra: Partial<MyRestriction>): MyRestriction => ({ id: 'r', scope: 'CONTACT', source: 'CASE', reasonCode: 'POLICY_VIOLATION', startsAt: 0, endsAt: 0, active: false, revokedAt: null, revokeReason: null, appeal: null, canAppeal: false, ...extra });

describe('治理文案（与 Web utils/governance.ts 一致）', () => {
  it('历史机器码一律标明「历史」；BOOKING 写成原「预约新订单」限制', () => {
    expect(TARGET_LABEL.ORDER).toBe('订单（历史）');
    expect(TARGET_LABEL.NO_SHOW).toBe('爽约复核（历史）');
    expect(REPORT_REASON_LABEL.NO_SHOW_REVIEW).toBe('请求复核爽约（历史）');
    expect(NOTICE_SECTION_LABEL.CONFIRM_NO_SHOW).toBe('爽约确认（历史）');
    expect(RESTRICTION_SOURCE_LABEL.SYSTEM_RULE).toBe('已停用的爽约自动规则（历史）');
    expect(SCOPE_LABEL.BOOKING).toBe('申请联系方式（原「预约新订单」限制）');
    expect(SCOPE_STILL_ALLOWED.CONTACT).toBe('仍然可以浏览、私信，查看与撤回已经发出的联系申请。');
    expect(SCOPE_STILL_ALLOWED.BOOKING).toBe(SCOPE_STILL_ALLOWED.CONTACT);
    expect(Object.values({ ...TARGET_LABEL, ...SCOPE_LABEL, ...REPORT_REASON_LABEL }).join()).not.toMatch(/赔付|担保|鉴定真伪/);
  });
  it('到期时间同时写出具体时间与还剩多久', () => {
    const now = new Date(2026, 9, 21, 10, 0).getTime();
    expect(formatUntil(now + 5 * HOUR, now)).toBe('10月21日 15:00（约 5 小时后）');
    expect(formatUntil(now + 72 * HOUR, now)).toBe('10月24日 10:00（约 3 天后）');
    expect(formatUntil(now - HOUR, now)).toBe('10月21日 09:00（已结束）');
  });
  it('举报与申诉状态', () => {
    expect(reportStatusText({ status: 'CLOSED', outcome: 'NO_ACTION' })).toBe('已结束（未采取措施）');
    expect(reportStatusText({ status: 'RECEIVED', outcome: null })).toBe('已收到');
    expect(appealStatusText({ id: 'a', status: 'PENDING', createdAt: 0, decidedAt: null, awaitingEligibleStaff: true })).toContain('不会被自动驳回');
    expect(appealStatusText({ id: 'a', status: 'ACCEPTED', createdAt: 0, decidedAt: 1 })).toBe('已接受');
    expect(appealStatusText({ id: 'a', status: 'REJECTED', createdAt: 0, decidedAt: 1 })).toBe('已驳回');
  });
  it('举报表单：原因必选，「其他」要说明，说明不能超长或带尖括号；请求体不带空说明', () => {
    expect(reportError('', '')).toBe('请选择举报原因');
    expect(reportError('OTHER', ' ')).toBe('选择「其他」时请写一句说明');
    expect(reportError('SPAM', '<b>')).toContain('不能包含尖括号');
    expect(reportError('SPAM', 'x'.repeat(501))).toContain('500');
    expect(reportError('SPAM', '')).toBeNull();
    expect(reportInput('MESSAGE', 'm1', 'SPAM', '  ')).toEqual({ targetType: 'MESSAGE', targetId: 'm1', reasonCode: 'SPAM' });
    expect(reportInput('COMMENT', 'k1', 'OTHER', ' 刷屏 ')).toEqual({ targetType: 'COMMENT', targetId: 'k1', reasonCode: 'OTHER', note: '刷屏' });
  });
  it('申诉表单与请求体：restrictionId 与 actionId 二选一', () => {
    expect(appealError(' ')).toBe('请写明申诉理由');
    expect(appealError('<script>')).toContain('尖括号');
    expect(appealInput({ kind: 'restriction', id: 'r1', label: '' }, ' 理由 ')).toEqual({ restrictionId: 'r1', reason: '理由' });
    expect(appealInput({ kind: 'action', id: 'a1', label: '' }, '理由')).toEqual({ actionId: 'a1', reason: '理由' });
  });
  it('「我的限制」分组与已结束限制的说明（撤销原因 / 到期）', () => {
    const data: MyGovernance = {
      restrictions: [restriction({ id: 'on', active: true }), restriction({ id: 'off', scope: 'BOOKING', source: 'SYSTEM_RULE', revokedAt: new Date(2026, 8, 1, 8, 5).getTime(), revokeReason: 'RULE_RETIRED' })],
      notices: [
        { actionId: 'p', actionCode: 'HIDE_PRODUCT', targetId: 'x', targetLabel: '台灯', reasonCode: '', createdAt: 0, active: false, appeal: null, canAppeal: false },
        { actionId: 'n', actionCode: 'CONFIRM_NO_SHOW', targetId: 'y', targetLabel: '一次爽约确认（历史，已不再生效）', reasonCode: '', createdAt: 0, active: false, appeal: null, canAppeal: false },
      ],
    };
    const g = groupGovernance(data);
    expect(g.active.map((r) => r.id)).toEqual(['on']);
    expect(g.past.map((r) => r.id)).toEqual(['off']);
    expect(productNoticeTitle(g.productNotices[0])).toBe('「台灯」已恢复');
    expect(otherNoticeTitle(g.otherNotices[0])).toBe('爽约确认（历史）：一次爽约确认（历史，已不再生效）（已不再生效）');
    expect(pastRestrictionText(g.past[0])).toBe('申请联系方式（原「预约新订单」限制） · 来源：已停用的爽约自动规则（历史） · 规则已停用，自动撤销（2026/9/1 08:05）');
    expect(pastRestrictionText(restriction({ endsAt: new Date(2026, 0, 2, 3, 4).getTime() }))).toBe('申请联系方式 · 来源：平台工作人员的处理 · 已于 2026/1/2 03:04 到期');
  });
});

describe('演示模式治理（与后端同语义）', () => {
  it('卖家看到被隐藏留言的处理记录，可以申诉一次；再次申诉 409', async () => {
    const api = setup();
    await api.login('seller001', 'demo12345');
    const before = await api.myGovernance();
    expect(before.notices).toEqual([expect.objectContaining({ actionId: 'demo-action-1', actionCode: 'HIDE_COMMENT', active: true, canAppeal: true, appeal: null })]);
    await expect(api.appeal({ actionId: 'demo-action-1', reason: '  ' })).rejects.toMatchObject({ code: 400, message: '请写明申诉理由' });
    const appeal = await api.appeal({ actionId: 'demo-action-1', reason: '这条留言没有违规' });
    expect(appeal).toMatchObject({ status: 'PENDING', awaitingEligibleStaff: true });
    expect((await api.myGovernance()).notices[0]).toMatchObject({ canAppeal: false, appeal: { status: 'PENDING' } });
    await expect(api.appeal({ actionId: 'demo-action-1', reason: '再申诉' })).rejects.toMatchObject({ code: 409, message: '每条限制或处理只能申诉一次' });
    expect(APPEAL_DONE).toContain('另一位平台工作人员');
  });
  it('买家的历史限制（已停用的爽约规则、已撤销）只作记录，不能申诉；别人的记录 404', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const { restrictions, notices } = await api.myGovernance();
    expect(notices).toEqual([]);
    expect(restrictions).toEqual([expect.objectContaining({ scope: 'BOOKING', source: 'SYSTEM_RULE', active: false, revokeReason: 'RULE_RETIRED', canAppeal: false })]);
    await expect(api.appeal({ restrictionId: 'demo-restriction-1', reason: '理由' })).rejects.toMatchObject({ code: 409, message: '这条限制已经结束，不需要申诉' });
    await expect(api.appeal({ actionId: 'demo-action-1', reason: '理由' })).rejects.toMatchObject({ code: 404 });
  });
  it('生效中的「申请联系方式」限制：申请被 403 拦下并提示去「我的限制」；浏览、私信不受影响；可以申诉', async () => {
    const now = Date.now();
    const api = setup((db) => { (db.restrictions as unknown[]).push({ id: 'live', userId: 'demo-buyer', scope: 'CONTACT', source: 'CASE', reasonCode: 'POLICY_VIOLATION', startsAt: now - HOUR, endsAt: now + 48 * HOUR, revokedAt: null, revokeReason: null, createdAt: now - HOUR }); });
    await api.login('buyer001', 'demo12345');
    await expect(api.requestContact('demo-product-0')).rejects.toMatchObject({ code: 403, message: expect.stringMatching(/^你的「申请联系方式」功能暂时受限，至 .+ 自动恢复。可以在「我的限制」里查看原因或提交申诉。$/) });
    expect((await api.detail('demo-product-0')).id).toBe('demo-product-0');
    const c = await api.openConversation('demo-product-0');
    expect((await api.sendMessage(c.id, { templateCode: 'BUYER_STILL_AVAILABLE' })).templateCode).toBe('BUYER_STILL_AVAILABLE');
    const live = (await api.myGovernance()).restrictions.find((r) => r.id === 'live');
    expect(live).toMatchObject({ active: true, canAppeal: true });
    await api.appeal({ restrictionId: 'live', reason: '误判' });
    expect((await api.myGovernance()).restrictions.find((r) => r.id === 'live')).toMatchObject({ canAppeal: false, appeal: { status: 'PENDING' } });
  });
  it('生效中的「发布商品」限制只挡新发布', async () => {
    const now = Date.now();
    const api = setup((db) => { (db.restrictions as unknown[]).push({ id: 'pub', userId: 'demo-seller', scope: 'PUBLISHING', source: 'CASE', reasonCode: 'POLICY_VIOLATION', startsAt: now - HOUR, endsAt: now + HOUR, revokedAt: null, revokeReason: null, createdAt: now }); });
    await api.login('seller001', 'demo12345');
    const input = { title: '台灯', description: '自用', price: 10, category: '生活用品' as const, condition: '全新' as const, campus: '西校区' as const, images: ['/assets/goods/lamp.png'], contact: 'wx', contactPublic: false };
    await expect(api.publish(input)).rejects.toMatchObject({ code: 403, message: expect.stringContaining('「发布商品」功能暂时受限') });
    await api.status('demo-product-0', '已下架');
  });
  it('举报商品、私信与用户都进入「我的举报」；看不到的对象 404', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    await api.report({ targetType: 'PRODUCT', targetId: 'demo-product-0', reasonCode: 'MISLEADING' });
    await api.report({ targetType: 'MESSAGE', targetId: 'demo-message-2', reasonCode: 'HARASSMENT', note: '演示' });
    await api.report({ targetType: 'USER', targetId: 'demo-seller', reasonCode: 'IMPERSONATION' });
    await expect(api.report({ targetType: 'PRODUCT', targetId: 'other-school-product', reasonCode: 'SPAM' })).rejects.toThrow('不存在');
    await expect(api.report({ targetType: 'CIRCLE', targetId: 'x', reasonCode: 'SPAM' })).rejects.toMatchObject({ code: 404 });
    await expect(api.report({ targetType: 'ORDER' as never, targetId: 'x', reasonCode: 'SPAM' })).rejects.toMatchObject({ code: 400 });
    expect((await api.myReports()).map((r) => r.targetType).sort()).toEqual(['MESSAGE', 'PRODUCT', 'USER']);
  });
});

describe('旧版演示缓存', () => {
  it('旧的商品举报（只有一句说明）并入「我的举报」，原因记为「其他」', async () => {
    const api = setup((db) => { delete db.moderationReports; db.reports = [{ productId: 'demo-product-0', reporterId: 'demo-buyer', reason: '图片不符', createdAt: 1 }]; });
    await api.login('buyer001', 'demo12345');
    expect(await api.myReports()).toEqual([expect.objectContaining({ targetType: 'PRODUCT', targetId: 'demo-product-0', reasonCode: 'OTHER', status: 'RECEIVED' })]);
  });
});
