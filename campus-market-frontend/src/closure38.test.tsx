// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { RestCampusMarketApi } from './api/restCampusMarketApi';
import { HttpTransport } from './api/httpTransport';
import { ApiError } from './api/errors';
import type { Category } from './types';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';

/**
 * 3.8 收口：订单列表直接给出可操作性（不逐单请求流程）、正式档期只在面交阶段建立、
 * 验货不一致不暗示平台仲裁。Mock 行为与后端 TrustedMeetingFlowIT 的 3.8 组逐条对应。
 */

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });
async function code(p: Promise<unknown>) {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return (e as ApiError).code;
}
function slot(daysAhead: number, hour: number) {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysAhead, hour, 0, 0, 0);
  return { startsAtIso: start.toISOString(), endsAtIso: new Date(start.getTime() + 3_600_000).toISOString() };
}
async function deal(category: Category = '生活用品', declared = true) {
  const seller = await user('seller');
  const product = await api.createProduct({
    title: `收口 ${rnd()}`, description: 'd', price: 20, category, condition: '全新', campus: '东校区',
    images: [], contact: '13800000000', ...(declared ? { inspection: fullDisclosure(category) } : {}),
  });
  const buyer = await user('buyer');
  const order = await api.createOrder({ productId: product.id, meetingPointId: '东校区-library',
    meetingAtIso: new Date(Date.now() + 3 * 86_400_000).toISOString(), contact: '13800000001', idempotencyKey: rnd() });
  return { seller, buyer, orderId: order.id, order };
}
const listed = async (orderId: string) => (await api.listOrders('all')).find((o) => o.id === orderId)!;
const allMatch = async (orderId: string, mismatch?: string) =>
  (await api.getOrderFlow(orderId)).inspection.items.map((i) => ({ itemCode: i.code, result: i.code === mismatch ? 'MISMATCH' as const : 'MATCH' as const }));

describe('3.8A 订单列表流程摘要（Mock 与 REST 同一字段与语义）', () => {
  it('逐阶段变化；允许 ⇔ 真实迁移成功，禁止 ⇔ 409', async () => {
    const d = await deal();
    await as(d.buyer);
    expect(d.order.flow).toMatchObject({ buyerConfirmAllowed: false, buyerConfirmBlockReason: 'ORDER_NOT_IN_MEETING',
      currentMeetingStatus: 'AWAITING_SELLER', inspectionRequired: true, inspectionStatus: 'PENDING' });
    expect(Object.keys((await listed(d.orderId)).flow!).sort()).toEqual([
      'buyerConfirmAllowed', 'buyerConfirmBlockReason', 'counterpartyPresenceStatus', 'currentMeetingStatus',
      'inspectionRequired', 'inspectionStatus', 'myPresenceStatus']);
    expect(await code(api.transitionOrder(d.orderId, { to: 'BUYER_CONFIRMED' }))).toBe(409);

    await as(d.seller);
    const accepted = await api.transitionOrder(d.orderId, { to: 'PENDING_MEETING' });
    expect(accepted.flow?.currentMeetingStatus).toBe('CONFIRMED');
    await as(d.buyer);
    expect((await listed(d.orderId)).flow).toMatchObject({ buyerConfirmAllowed: false, buyerConfirmBlockReason: 'INSPECTION_REQUIRED' });
    expect(await code(api.transitionOrder(d.orderId, { to: 'BUYER_CONFIRMED' }))).toBe(409);

    await api.submitInspection(d.orderId, await allMatch(d.orderId));
    expect((await listed(d.orderId)).flow).toMatchObject({ buyerConfirmAllowed: true, buyerConfirmBlockReason: null, inspectionStatus: 'SUBMITTED' });
    const confirmed = await api.transitionOrder(d.orderId, { to: 'BUYER_CONFIRMED' });
    expect(confirmed.flow?.buyerConfirmBlockReason).toBe('ALREADY_CONFIRMED');

    await as(d.seller);
    await api.transitionOrder(d.orderId, { to: 'COMPLETED', confirmationCode: confirmed.confirmationCode! });
    expect((await listed(d.orderId)).flow).toMatchObject({ buyerConfirmBlockReason: 'ORDER_TERMINAL', currentMeetingStatus: 'CLOSED' });
  });

  it('不一致：双方都是 INSPECTION_MISMATCH；无清单订单 inspectionRequired=false 且接单后可确认', async () => {
    const d = await deal();
    await as(d.seller);
    await api.transitionOrder(d.orderId, { to: 'PENDING_MEETING' });
    await as(d.buyer);
    await api.submitInspection(d.orderId, await allMatch(d.orderId, 'CLEAN'));
    for (const who of [d.buyer, d.seller]) {
      await as(who);
      expect((await listed(d.orderId)).flow).toMatchObject({ buyerConfirmBlockReason: 'INSPECTION_MISMATCH', inspectionStatus: 'NEEDS_RESOLUTION' });
    }

    const plain = await deal('其他', false);
    await as(plain.seller);
    await api.transitionOrder(plain.orderId, { to: 'PENDING_MEETING' });
    await as(plain.buyer);
    expect((await listed(plain.orderId)).flow).toMatchObject({ inspectionRequired: false, inspectionStatus: 'NOT_PROVIDED', buyerConfirmAllowed: true });
  });

  it('到达与改约：本人 / 对方视角正确；改约待回应 → RESCHEDULE_PENDING；接受后到达按新版本重来', async () => {
    const d = await deal();
    await as(d.seller);
    await api.transitionOrder(d.orderId, { to: 'PENDING_MEETING' });
    await as(d.buyer);
    await api.updatePresence(d.orderId, 'DEPART');
    expect((await listed(d.orderId)).flow).toMatchObject({ myPresenceStatus: 'DEPARTED', counterpartyPresenceStatus: 'NOT_STARTED' });
    await as(d.seller);
    expect((await listed(d.orderId)).flow).toMatchObject({ myPresenceStatus: 'NOT_STARTED', counterpartyPresenceStatus: 'DEPARTED' });
    const proposed = await api.proposeMeeting(d.orderId, { meetingPointId: '东校区-canteen', ...slot(2, 14) });
    expect((await listed(d.orderId)).flow?.currentMeetingStatus).toBe('RESCHEDULE_PENDING');
    await as(d.buyer);
    await api.acceptMeeting(d.orderId, proposed.proposals[0].id);
    expect((await listed(d.orderId)).flow).toMatchObject({ currentMeetingStatus: 'CONFIRMED', myPresenceStatus: 'NOT_STARTED' });
  });

  it('REST 适配层：订单列表一次请求，流程摘要原样透传，不另外请求流程详情', async () => {
    const calls: string[] = [];
    const summary = { inspectionRequired: true, inspectionStatus: 'PENDING', buyerConfirmAllowed: false,
      buyerConfirmBlockReason: 'INSPECTION_REQUIRED', currentMeetingStatus: 'CONFIRMED', myPresenceStatus: 'NOT_STARTED',
      counterpartyPresenceStatus: 'DEPARTED' };
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: [{ id: 'o1', flow: summary }, { id: 'o2', flow: summary }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    const orders = await rest.listOrders('all');
    expect(calls).toHaveLength(1);
    expect(orders.map((o) => o.flow)).toEqual([summary, summary]);
  });
});

describe('3.8B 正式档期只在卖家接受之后建立', () => {
  it('Mock：卖家接受前双方提议都是 409（带原因）；接受后可以提议', async () => {
    const d = await deal();
    for (const who of [d.buyer, d.seller]) {
      await as(who);
      const e = await api.proposeMeeting(d.orderId, { meetingPointId: '东校区-canteen', ...slot(2, 14) }).catch((x) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(409);
      expect((e as ApiError).message).toContain('卖家接受预约后');
    }
    await as(d.seller);
    await api.transitionOrder(d.orderId, { to: 'PENDING_MEETING' });
    expect((await api.proposeMeeting(d.orderId, { meetingPointId: '东校区-canteen', ...slot(2, 14) })).proposals).toHaveLength(1);
  });

  it('页面：卖家接受之前不显示任何提议入口，只说明原因', async () => {
    const d = await deal();
    await as(d.buyer);
    renderApp(`/orders/${d.orderId}`);
    expect(await screen.findByText('卖家接受预约后，双方才能约定或调整正式面交档期。', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /提议/ })).toBeNull();
  });
});

describe('3.8A 我的订单页面', () => {
  it('验货未提交：确认按钮禁用并说明原因（aria-describedby）；提交后可用；整页不逐单请求流程详情', async () => {
    const d = await deal();
    const other = await deal();
    for (const x of [d, other]) {
      await as(x.seller);
      await api.transitionOrder(x.orderId, { to: 'PENDING_MEETING' });
    }
    // 第二笔订单由 d.buyer 购买，便于同页出现多笔
    await as(d.buyer);
    const flowSpy = vi.spyOn(api, 'getOrderFlow');
    const { container } = renderApp('/profile/orders');
    const buttons = await screen.findAllByRole('button', { name: '已验货付款，确认面交' }, { timeout: 5000 });
    const button = buttons[0];
    expect(button).toHaveProperty('disabled', true);
    const reason = document.getElementById(button.getAttribute('aria-describedby')!)!;
    expect(reason.getAttribute('data-block-reason')).toBe('INSPECTION_REQUIRED');
    expect(reason.textContent).toContain('逐项验货并提交');
    expect(flowSpy).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);

    cleanup();
    await api.submitInspection(d.orderId, await allMatch(d.orderId));
    flowSpy.mockClear();
    renderApp('/profile/orders');
    await waitFor(async () => {
      const enabled = (await screen.findAllByRole('button', { name: '已验货付款，确认面交' })).filter((b) => !(b as HTMLButtonElement).disabled);
      expect(enabled).toHaveLength(1);
    }, { timeout: 5000 });
    expect(flowSpy).not.toHaveBeenCalled();
  });

  it('验货不一致：显示「验货不一致」与可执行操作，不出现任何仲裁 / 判责 / 赔付说法', async () => {
    const d = await deal();
    await as(d.seller);
    await api.transitionOrder(d.orderId, { to: 'PENDING_MEETING' });
    await as(d.buyer);
    await api.submitInspection(d.orderId, await allMatch(d.orderId, 'CLEAN'));
    renderApp('/profile/orders');
    const note = await screen.findByText(/验货不一致：不能确认面交或核销/, undefined, { timeout: 5000 });
    expect(note.textContent).toContain('平台只记录双方当面验货的过程');
    const card = note.closest('article')!;
    expect(within(card).getByRole('button', { name: '取消交易' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: '已验货付款，确认面交' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/平台仲裁|等待平台仲裁|判定卖家责任|赔付处理中|保证退款/);
    fireEvent.click(within(card).getByRole('button', { name: '取消交易' }));
    // 模块 7：卖家确认之后的取消需要选择结构化原因
    const dialog = await screen.findByRole('dialog', { name: '取消这笔交易？' });
    expect(dialog.textContent).not.toMatch(/平台仲裁|判定卖家责任|赔付|保证退款/);
    fireEvent.click(within(dialog).getByRole('radio', { name: '物品情况与描述不符' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消订单' }));
    await waitFor(async () => expect((await listed(d.orderId)).canonicalStatus).toBe('CANCELLED'));
  });
});
