// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { seedInspectionTemplates } from '../data/inspectionTemplates';
import { fullDisclosure } from '../test/inspectionFixtures';
import type { Category } from '../types';

/**
 * 模块 3 的 Mock 契约：与后端 TrustedMeetingFlowIT / ProductInspectionIT 的关键断言逐条对应，
 * 保证「Mock 能做、REST 不能做」的关键路径不存在，反之亦然。
 */

// 直接读后端 V5 迁移源码做一致性比对：Mock 模板是从这份 SQL 生成的，任何一边漂移都会失败
const V5_SQL = Object.values(import.meta.glob('../../../campus-market-backend/src/main/resources/db/migration/V5__trusted_meeting_flow.sql', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)[0] ?? '';
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function code(p: Promise<unknown>): Promise<number> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });

/** 本地时间 N 天后 hh:mm 的对齐时段 */
function slot(daysAhead: number, hour: number, minutes = 60) {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysAhead, hour, 0, 0, 0);
  return { startsAtIso: start.toISOString(), endsAtIso: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

async function setup(category: Category = '生活用品', declared = true) {
  const seller = await user('seller');
  const product = await api.createProduct({
    title: `契约 ${rnd()}`, description: 'Mock 契约测试', price: 20, category, condition: '全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(declared ? { inspection: fullDisclosure(category) } : {}),
  });
  const buyer = await user('buyer');
  const order = await api.createOrder({
    productId: product.id, meetingPointId: '东校区-library',
    meetingAtIso: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    contact: '13800000001', idempotencyKey: rnd(),
  });
  return { seller, buyer, product, order };
}
async function accepted(category: Category = '生活用品') {
  const ctx = await setup(category);
  await as(ctx.seller);
  await api.transitionOrder(ctx.order.id, { to: 'PENDING_MEETING' });
  return ctx;
}
async function allResults(orderId: string, result: 'MATCH' | 'MISMATCH' | 'NOT_CHECKABLE' = 'MATCH', mismatchCode?: string) {
  const flow = await api.getOrderFlow(orderId);
  return flow.inspection.items.map((i) => ({ itemCode: i.code, result: i.code === mismatchCode ? 'MISMATCH' as const : result }));
}

describe('3.2 模板与商品声明', () => {
  it('Mock 模板与 V5 种子逐项一致（分类、版本、条目码、必填）', () => {
    expect(V5_SQL).toContain('inspection_template_items');
    // 解析 SQL 种子：('模板:码', '模板', '码', '标签', '说明', 必填, 顺序)
    const rows = [...V5_SQL.matchAll(/\('([\w-]+):(\w+)',\s*'([\w-]+)',\s*'(\w+)',\s*'([^']*)',\s*'([^']*)',\s*(true|false),\s*(\d+)\)/g)]
      .map((m) => ({ template: m[3], code: m[4], label: m[5], description: m[6], required: m[7] === 'true', order: Number(m[8]) }));
    for (const t of seedInspectionTemplates) {
      expect(V5_SQL).toMatch(new RegExp(`\\('${t.id}',\\s*'${t.category}',\\s*${t.version},\\s*'${t.title}'\\)`));
      const sqlItems = rows.filter((r) => r.template === t.id).sort((a, b) => a.order - b.order);
      expect(t.items.map((i) => [i.code, i.label, i.description, i.required]))
        .toEqual(sqlItems.map((r) => [r.code, r.label, r.description, r.required]));
    }
    expect(rows).toHaveLength(28);
    expect(seedInspectionTemplates.map((t) => t.category).sort())
      .toEqual(['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外'].sort());
    expect(seedInspectionTemplates.reduce((n, t) => n + t.items.length, 0)).toBe(28);
  });

  it('模板查询：受支持分类返回当前版本，「其他」为 null，非法分类 400', async () => {
    const t = await api.getInspectionTemplate('数码电子');
    expect(t?.version).toBe(1);
    expect(Object.keys(t!).sort()).toEqual(['category', 'items', 'title', 'version']);
    expect(Object.keys(t!.items[0]).sort()).toEqual(['code', 'description', 'label', 'required']);
    expect(await api.getInspectionTemplate('其他')).toBeNull();
    expect(await code(api.getInspectionTemplate('不存在的分类' as Category))).toBe(400);
  });

  it('受支持分类：缺必填 / 未知条目 / 重复条目 / 非法状态 / 未知字段 → 400，且商品不落库', async () => {
    await user('seller');
    const base = { title: `声明 ${rnd()}`, description: 'd', price: 10, category: '生活用品' as const, condition: '全新' as const,
      campus: '东校区' as const, images: ['https://example.invalid/a.png'], contact: '1' };
    const full = fullDisclosure('生活用品')!;
    const before = (await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total;
    const bad: unknown[] = [
      undefined,
      full.slice(1),
      [...full, { itemCode: 'NOPE', condition: 'NORMAL' }],
      [...full, full[0]],
      full.map((d, i) => (i === 0 ? { ...d, condition: 'GOOD' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, sellerId: 'x' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, templateVersion: 1 } : d)),
      full.map((d, i) => (i === 0 ? { ...d, note: '<b>x</b>' } : d)),
      full.map((d, i) => (i === 0 ? { ...d, note: 'x'.repeat(201) } : d)),
    ];
    for (const inspection of bad) {
      expect(await code(api.createProduct({ ...base, inspection: inspection as never }))).toBe(400);
    }
    expect((await api.listProducts({ page: 1, pageSize: 500, sort: 'latest' })).total).toBe(before);
  });

  it('不默认 NORMAL：声明原样保存；「其他」分类提交清单被拒，不提交则可发布', async () => {
    await user('seller');
    const declared = fullDisclosure('生活用品', 'NOT_TESTED')!;
    const p = await api.createProduct({ title: `原样 ${rnd()}`, description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: [], contact: '1', inspection: declared });
    const detail = await api.getProduct(p.id);
    expect(detail.inspection!.items.every((i) => i.condition === 'NOT_TESTED')).toBe(true);

    const other = { title: `其他 ${rnd()}`, description: 'd', price: 10, category: '其他' as const, condition: '全新' as const,
      campus: '东校区' as const, images: [], contact: '1' };
    expect(await code(api.createProduct({ ...other, inspection: declared }))).toBe(400);
    const plain = await api.createProduct(other);
    expect((await api.getProduct(plain.id)).inspection).toBeNull();
  });

  it('切换分类必须提供新分类的声明；不带 inspection 只改其他字段时声明不变', async () => {
    await user('seller');
    const p = await api.createProduct({ title: `切换 ${rnd()}`, description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: [], contact: '1', inspection: fullDisclosure('生活用品') });
    expect(await code(api.updateProduct(p.id, { category: '数码电子' }))).toBe(400);
    // 旧分类的声明不能被复用到新分类
    expect(await code(api.updateProduct(p.id, { category: '数码电子', inspection: fullDisclosure('生活用品') }))).toBe(400);
    await api.updateProduct(p.id, { title: `切换后 ${rnd()}` });
    expect((await api.getProduct(p.id)).inspection?.category).toBe('生活用品');
    await api.updateProduct(p.id, { category: '数码电子', inspection: fullDisclosure('数码电子') });
    expect((await api.getProduct(p.id)).inspection?.category).toBe('数码电子');
  });
});

describe('3.3 订单快照与验货', () => {
  it('快照：下单时复制；之后卖家改声明，订单快照不变', async () => {
    const { seller, buyer, product, order } = await setup();
    await as(seller);
    await api.updateProduct(product.id, { inspection: fullDisclosure('生活用品', 'DEFECT') });
    await as(buyer);
    const flow = await api.getOrderFlow(order.id);
    expect(flow.inspection.status).toBe('PENDING');
    expect(flow.inspection.items.every((i) => i.sellerCondition === 'NORMAL')).toBe(true);
  });

  it('幂等下单不重复生成快照；并发抢单失败方不留快照；无声明商品为 NOT_PROVIDED，不伪造结果', async () => {
    const seller = await user('seller');
    const product = await api.createProduct({ title: `幂等 ${rnd()}`, description: 'd', price: 10, category: '生活用品',
      condition: '全新', campus: '东校区', images: [], contact: '1', inspection: fullDisclosure('生活用品') });
    void seller;
    await user('buyer');
    const input = { productId: product.id, meetingPointId: '东校区-library',
      meetingAtIso: new Date(Date.now() + 86_400_000).toISOString(), idempotencyKey: rnd() };
    const first = await api.createOrder(input);
    const second = await api.createOrder(input);
    expect(second.id).toBe(first.id);
    await user('other-buyer');
    expect(await code(api.createOrder({ ...input, idempotencyKey: rnd() }))).toBe(409);
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    expect(Object.keys(raw.orderInspections)).toEqual([first.id]);
    expect(raw.orderInspections[first.id].items.every((i: { buyerResult: unknown }) => i.buyerResult === null)).toBe(true);

    const legacy = await setup('其他', false);
    await as(legacy.buyer);
    const flow = await api.getOrderFlow(legacy.order.id);
    expect(flow.inspection).toEqual({ status: 'NOT_PROVIDED', templateTitle: null, templateVersion: null,
      hasMismatch: false, submittedAtIso: null, items: [] });
    // 3.8A：卖家接单之前，原因是「未进入面交」，而不是验货
    expect(flow.buyerConfirmBlockReason).toBe('ORDER_NOT_IN_MEETING');
  });

  it('旧订单（v5 之前、没有验货记录）为 LEGACY_NONE，确认与核销流程保持原样', async () => {
    const { seller, buyer, order } = await setup();
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    delete raw.orderInspections[order.id];
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    await as(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await as(buyer);
    expect((await api.getOrderFlow(order.id)).inspection).toEqual({ status: 'LEGACY_NONE', items: [] });
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await as(seller);
    expect((await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! })).canonicalStatus)
      .toBe('COMPLETED');
  });

  it('权限：他人 404；卖家不能替买家填写（403）；买家草稿对卖家不可见', async () => {
    const { seller, buyer, order } = await accepted();
    const stranger = await user('stranger');
    await as(stranger);
    expect(await code(api.getOrderFlow(order.id))).toBe(404);
    expect(await code(api.saveInspectionDraft(order.id, []))).toBe(404);
    expect(await code(api.updatePresence(order.id, 'DEPART'))).toBe(404);

    await as(seller);
    expect(await code(api.saveInspectionDraft(order.id, await allResults(order.id)))).toBe(403);
    expect(await code(api.submitInspection(order.id, await allResults(order.id)))).toBe(403);

    await as(buyer);
    await api.saveInspectionDraft(order.id, await allResults(order.id, 'MATCH'));
    await as(seller);
    const sellerView = await api.getOrderFlow(order.id);
    expect(sellerView.inspection.items.every((i) => i.buyerResult === null && i.checkedAtIso === null)).toBe(true);
  });

  it('草稿可重复保存且可恢复；最终提交幂等，改内容 409；服务端生成时间', async () => {
    const { buyer, order } = await accepted();
    await as(buyer);
    const items = await allResults(order.id, 'NOT_CHECKABLE');
    await api.saveInspectionDraft(order.id, items.slice(0, 2));
    await api.saveInspectionDraft(order.id, items.slice(0, 2));
    const restored = await api.getOrderFlow(order.id);
    expect(restored.inspection.items.slice(0, 2).map((i) => i.buyerResult)).toEqual(['NOT_CHECKABLE', 'NOT_CHECKABLE']);
    expect(restored.inspection.items.every((i) => i.checkedAtIso === null)).toBe(true);

    // 未逐项给出结果不能最终提交
    expect(await code(api.submitInspection(order.id, items.slice(0, 2)))).toBe(400);
    // 客户端传时间或身份字段被拒
    expect(await code(api.submitInspection(order.id, items.map((i) => ({ ...i, checkedAt: 1 }) as never)))).toBe(400);
    expect(await code(api.submitInspection(order.id, items.map((i) => ({ ...i, buyerId: 'x' }) as never)))).toBe(400);

    const done = await api.submitInspection(order.id, items);
    expect(done.inspection.status).toBe('SUBMITTED');
    expect(done.inspection.submittedAtIso).toBeTruthy();
    const again = await api.submitInspection(order.id, items);
    expect(again.inspection.submittedAtIso).toBe(done.inspection.submittedAtIso);
    expect(await code(api.submitInspection(order.id, items.map((i) => ({ ...i, result: 'MATCH' as const }))))).toBe(409);
    expect(await code(api.saveInspectionDraft(order.id, items))).toBe(409);
  });

  it('只有面交阶段能提交；未提交前买家确认被拒且不消耗确认码次数', async () => {
    const { seller, buyer, order } = await setup();
    await as(buyer);
    expect(await code(api.submitInspection(order.id, await allResults(order.id)))).toBe(409);
    await as(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await as(buyer);
    expect(await code(api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' }))).toBe(409);
    expect((await api.getOrderFlow(order.id)).buyerConfirmBlockReason).toBe('INSPECTION_REQUIRED');
  });

  it('MISMATCH：订单转 DISPUTED，确认与核销都被拒；双方可取消，商品恢复在售', async () => {
    const { seller, buyer, product, order } = await accepted();
    await as(buyer);
    const flow = await api.submitInspection(order.id, await allResults(order.id, 'MATCH', 'FUNCTION'));
    expect(flow.status).toBe('DISPUTED');
    expect(flow.inspection.status).toBe('NEEDS_RESOLUTION');
    expect(flow.buyerConfirmBlockReason).toBe('INSPECTION_MISMATCH');
    expect(flow.timeline.map((e) => e.code).slice(-3)).toEqual(['INSPECTION_SUBMITTED', 'INSPECTION_MISMATCH', 'ORDER_DISPUTED']);
    expect(await code(api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' }))).toBe(409);
    await as(seller);
    expect(await code(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: order.confirmationCode }))).toBe(409);
    const cancelled = await api.transitionOrder(order.id, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND' });
    expect(cancelled.canonicalStatus).toBe('CANCELLED');
    expect((await api.getProduct(product.id)).status).toBe('在售');
  });

  it('全部 MATCH 后照常确认与核销；确认码 5 次错误锁死，第 6 次正确码也 409', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    await api.submitInspection(order.id, await allResults(order.id));
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await as(seller);
    const wrong = confirmed.confirmationCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(await code(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: wrong }))).toBe(400);
    }
    expect(await code(api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! }))).toBe(409);
    expect((await api.listOrders('all')).find((o) => o.id === order.id)).not.toHaveProperty('codeAttempts');
  });
});

describe('3.4 档期握手与改约', () => {
  it('提议 → 自己不能接受（403）→ 对方接受；同时只能一个待回应（409）', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    const proposed = await api.proposeMeeting(order.id, { meetingPointId: '东校区-canteen', ...slot(2, 14) });
    const pid = proposed.proposals[0].id;
    expect(proposed.proposals[0]).toMatchObject({ status: 'PENDING', mine: true, proposedBy: 'BUYER' });
    expect(await code(api.acceptMeeting(order.id, pid))).toBe(403);
    await as(seller);
    expect(await code(api.proposeMeeting(order.id, { meetingPointId: '东校区-library', ...slot(3, 10) }))).toBe(409);
    const flow = await api.acceptMeeting(order.id, pid);
    expect(flow.agreement).toMatchObject({ revision: 1, meetingPointId: '东校区-canteen', startsAtIso: slot(2, 14).startsAtIso });
    // 重复接受幂等
    expect((await api.acceptMeeting(order.id, pid)).agreement.revision).toBe(1);
    expect(await code(api.rejectMeeting(order.id, pid))).toBe(409);
  });

  it('改约：新提议未接受前旧档期保持；拒绝/撤回后仍是旧档期；接受后旧档期 SUPERSEDED、到达状态换新 revision', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    const first = await api.proposeMeeting(order.id, { meetingPointId: '东校区-canteen', ...slot(2, 14) });
    await as(seller);
    await api.acceptMeeting(order.id, first.proposals[0].id);
    await api.updatePresence(order.id, 'DEPART');

    await as(buyer);
    const second = await api.proposeMeeting(order.id, { meetingPointId: '东校区-express', ...slot(4, 9) });
    expect(second.agreement.revision).toBe(1);
    expect(second.agreement.meetingPointId).toBe('东校区-canteen');
    await api.withdrawMeeting(order.id, second.proposals.find((x) => x.status === 'PENDING')!.id);
    expect((await api.getOrderFlow(order.id)).agreement.meetingPointId).toBe('东校区-canteen');

    const third = await api.proposeMeeting(order.id, { meetingPointId: '东校区-express', ...slot(4, 9) });
    await as(seller);
    await api.rejectMeeting(order.id, third.proposals.find((x) => x.status === 'PENDING')!.id);
    expect((await api.getOrderFlow(order.id)).agreement.revision).toBe(1);
    expect((await api.getOrderFlow(order.id)).presence.me.status).toBe('DEPARTED');

    const fourth = await api.proposeMeeting(order.id, { meetingPointId: '东校区-express', ...slot(5, 16, 120) });
    await as(buyer);
    const after = await api.acceptMeeting(order.id, fourth.proposals.find((x) => x.status === 'PENDING')!.id);
    expect(after.agreement).toMatchObject({ revision: 2, meetingPointId: '东校区-express' });
    expect(after.proposals.map((p) => p.status)).toEqual(['SUPERSEDED', 'WITHDRAWN', 'REJECTED', 'ACCEPTED']);
    await as(seller);
    expect((await api.getOrderFlow(order.id)).presence).toMatchObject({ revision: 2, me: { status: 'NOT_STARTED' } });
  });

  it('非法提议：跨校区 / 停用点 / 非对齐时间 / 超 2 小时 / 过去 / 超 30 天 / 未知字段 → 400；终态 409', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    const ok = slot(2, 14);
    const cases: unknown[] = [
      { meetingPointId: '西校区-library', ...ok },
      { meetingPointId: 'nope', ...ok },
      { meetingPointId: '东校区-library', startsAtIso: new Date(Date.parse(ok.startsAtIso) + 60_000).toISOString(), endsAtIso: ok.endsAtIso },
      { meetingPointId: '东校区-library', ...slot(2, 14, 150) },
      { meetingPointId: '东校区-library', ...slot(-1, 14) },
      { meetingPointId: '东校区-library', ...slot(40, 14) },
      { meetingPointId: '东校区-library', ...ok, proposerId: 'x' },
      { meetingPointId: '东校区-library', ...ok, note: 'x'.repeat(101) },
    ];
    for (const input of cases) expect(await code(api.proposeMeeting(order.id, input as never))).toBe(400);
    await as(seller);
    await api.transitionOrder(order.id, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND' });
    expect(await code(api.proposeMeeting(order.id, { meetingPointId: '东校区-library', ...ok }))).toBe(409);
  });
});

describe('3.5 出发与到达', () => {
  it('幂等、不倒退、允许直接已到；到达不完成订单也不提交验货；终态 409', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    const a = await api.updatePresence(order.id, 'DEPART');
    const b = await api.updatePresence(order.id, 'DEPART');
    expect(b.presence.me.departedAtIso).toBe(a.presence.me.departedAtIso);
    const arrived = await api.updatePresence(order.id, 'ARRIVE');
    expect(arrived.presence.me.status).toBe('ARRIVED');
    expect(await code(api.updatePresence(order.id, 'DEPART'))).toBe(409);
    expect((await api.updatePresence(order.id, 'ARRIVE')).presence.me.arrivedAtIso).toBe(arrived.presence.me.arrivedAtIso);
    expect(arrived.status).toBe('PENDING_MEETING');
    expect(arrived.inspection.status).toBe('PENDING');
    expect(await code(api.updatePresence(order.id, 'TELEPORT' as never))).toBe(400);

    await as(seller);
    const direct = await api.updatePresence(order.id, 'ARRIVE');
    expect(direct.presence.me).toMatchObject({ status: 'ARRIVED', departedAtIso: null });
    expect(direct.presence.counterpart.status).toBe('ARRIVED');
    const events = direct.timeline.map((e) => e.code).filter((c) => c.startsWith('PRESENCE'));
    expect(events).toEqual(['PRESENCE_DEPARTED', 'PRESENCE_ARRIVED', 'PRESENCE_ARRIVED']);

    await api.transitionOrder(order.id, { to: 'CANCELLED', reasonCode: 'CHANGED_MIND' });
    expect(await code(api.updatePresence(order.id, 'ARRIVE'))).toBe(409);
  });

  it('双标签页：过期标签页不能把另一个标签页的「已到达」写回「已出发」', async () => {
    const { buyer, order } = await accepted();
    await as(buyer);
    const staleTab = new MockCampusMarketApi();   // 此刻装载，之后不再自动刷新内存
    await api.updatePresence(order.id, 'DEPART');
    await api.updatePresence(order.id, 'ARRIVE');
    expect(await code(staleTab.updatePresence(order.id, 'DEPART'))).toBe(409);
    const both = [await api.getOrderFlow(order.id), await staleTab.getOrderFlow(order.id)];
    for (const view of both) expect(view.presence.me.status).toBe('ARRIVED');
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    expect(raw.presence.filter((p: { orderId: string }) => p.orderId === order.id)).toHaveLength(1);
    expect(raw.flowEvents.filter((e: { orderId: string; code: string }) => e.orderId === order.id && e.code.startsWith('PRESENCE')))
      .toHaveLength(2);
  });

  it('待卖家确认阶段不能同步到达；返回结构里没有任何坐标字段', async () => {
    const { buyer, order } = await setup();
    await as(buyer);
    expect(await code(api.updatePresence(order.id, 'DEPART'))).toBe(409);
    const json = JSON.stringify(await api.getOrderFlow(order.id));
    expect(json).not.toMatch(/latitude|longitude|accuracy|coords|geolocation/i);
    expect(json).not.toMatch(/confirmationCode|contact|13800000001/);
  });
});

describe('3.6 履历', () => {
  it('完整链路时间线：机器码与后端 IT 同一顺序', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    const proposed = await api.proposeMeeting(order.id, { meetingPointId: '东校区-canteen', ...slot(2, 14) });
    await as(seller);
    await api.acceptMeeting(order.id, proposed.proposals[0].id);
    await as(buyer);
    await api.updatePresence(order.id, 'DEPART');
    await api.updatePresence(order.id, 'ARRIVE');
    await api.submitInspection(order.id, await allResults(order.id));
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await as(seller);
    await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! });
    expect((await api.getOrderFlow(order.id)).timeline.map((e) => e.code)).toEqual([
      'ORDER_CREATED', 'SELLER_ACCEPTED', 'MEETING_PROPOSED', 'MEETING_ACCEPTED', 'PRESENCE_DEPARTED',
      'PRESENCE_ARRIVED', 'INSPECTION_SUBMITTED', 'BUYER_CONFIRMED', 'SELLER_VERIFIED', 'ORDER_COMPLETED',
    ]);
    const own = await api.getOwnTradeHistory();
    expect(own).toMatchObject({ completed: 1, completedAsSeller: 1, completedAsBuyer: 0 });
  });

  it('公共履历只有四个聚合字段；评价不足 3 条不给平均分', async () => {
    const { seller, buyer, order } = await accepted();
    await as(buyer);
    await api.submitInspection(order.id, await allResults(order.id));
    const confirmed = await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await as(seller);
    const sellerId = (await api.listOrders('all')).find((o) => o.id === order.id)!.sellerId;
    await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! });
    await as(buyer);
    await api.addReview(order.id, { rating: 5, comment: '顺利' });
    const summary = await api.getPublicTradeSummary(sellerId);
    expect(Object.keys(summary).sort()).toEqual(['averageRating', 'completedCount', 'joinedAt', 'reviewCount']);
    expect(summary).toMatchObject({ completedCount: 1, reviewCount: 1, averageRating: null });
    expect(JSON.stringify(summary)).not.toMatch(/dormBuildingId|contact|account|productId|orderId|title/);
    expect(await code(api.getPublicTradeSummary('no-such-user'))).toBe(404);
  });
});

describe('REST 适配层', () => {
  it('11 个接口走约定路径；请求体从不携带身份、订单或时间字段', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([init?.method ?? 'GET', String(url), init?.body as string | undefined]);
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.getInspectionTemplate('数码电子');
    await rest.getOrderFlow('o1');
    await rest.saveInspectionDraft('o1', [{ itemCode: 'A', result: null }]);
    await rest.submitInspection('o1', [{ itemCode: 'A', result: 'MATCH' }]);
    await rest.proposeMeeting('o1', { meetingPointId: 'm', ...slot(1, 10) });
    await rest.acceptMeeting('o1', 'p1');
    await rest.rejectMeeting('o1', 'p1');
    await rest.withdrawMeeting('o1', 'p1');
    await rest.updatePresence('o1', 'ARRIVE');
    await rest.getOwnTradeHistory();
    await rest.getPublicTradeSummary('u1');
    expect(calls.map(([m, u]) => `${m} ${u.replace(/^https?:\/\/[^/]+/, '')}`)).toEqual([
      `GET /v1/inspection-templates?category=${encodeURIComponent('数码电子')}`,
      'GET /v1/orders/o1/flow',
      'PUT /v1/orders/o1/inspection',
      'POST /v1/orders/o1/inspection/submit',
      'POST /v1/orders/o1/meeting-proposals',
      'POST /v1/orders/o1/meeting-proposals/p1/accept',
      'POST /v1/orders/o1/meeting-proposals/p1/reject',
      'POST /v1/orders/o1/meeting-proposals/p1/withdraw',
      'PUT /v1/orders/o1/presence',
      'GET /v1/me/trade-history',
      'GET /v1/users/u1/trade-summary',
    ]);
    for (const [, , body] of calls) {
      if (body) expect(body).not.toMatch(/sellerId|buyerId|orderId|submittedAt|checkedAt|arrivedAt|departedAt|proposerId/);
    }
  });
});
