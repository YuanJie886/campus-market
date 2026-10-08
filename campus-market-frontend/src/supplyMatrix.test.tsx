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
import { ApiError } from './api/errors';
import type { BundleItemInput, ListingPayload } from './api/contracts';
import { fullDisclosure } from './test/inspectionFixtures';
import PriceGuidanceCard from './components/supply/PriceGuidanceCard';
import type { Category } from './types';

/**
 * 5.7C 前端 20 项追踪矩阵的补测：模块 5 报告里没有一一对应的要求，在这里用行为测试补齐
 * （界面交互或 API 调用的结果，不是源码扫描）。编号与报告中的矩阵一致。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') });

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label = 'u') {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });
function single(category: Category, title: string, price: number): ListingPayload {
  return {
    title, description: '追踪矩阵补测', price, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}),
  };
}
function bundleItems(n: number): BundleItemInput[] {
  return Array.from({ length: n }, (_, i) => ({ name: `明细${i + 1}`, category: (i % 2 ? '教材书籍' : '生活用品') as Category, condition: '全新', quantity: 1 }));
}
const meetingAt = () => { const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0); return at.toISOString() };

describe('5.7C 追踪矩阵补测', () => {
  it('#1 草稿创建与恢复：在工作台保存后离开，重新进入批次时内容从服务端草稿恢复', async () => {
    await user('owner');
    const draft = await api.createListingDraft({ payload: { title: '初稿' } });
    const batch = await api.createListingBatch({ draftIds: [draft.id] });
    const first = renderApp(`/publish/batch?batch=${batch.id}`);
    const title = await screen.findByLabelText('标题', undefined, { timeout: 5000 });
    fireEvent.change(title, { target: { value: '保存后能找回的标题' } });
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '离开页面前写的描述' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这件' }));
    expect(await screen.findByText('第 1 件已保存')).toBeTruthy();
    first.unmount();

    renderApp('/publish/batch');
    fireEvent.click(await screen.findByRole('link', { name: /创建的批次（1 件）/ }, { timeout: 5000 }));
    await waitFor(() => expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('保存后能找回的标题'));
    expect((screen.getByLabelText('描述') as HTMLTextAreaElement).value).toBe('离开页面前写的描述');
  });

  it('#6 打包明细上限：界面最多 30 行，第 30 行后「添加一行」不可用；服务端同样拒绝 31 行', async () => {
    await user('seller');
    renderApp('/publish');
    fireEvent.click(await screen.findByRole('button', { name: '整套打包' }, { timeout: 5000 }));
    const add = screen.getByRole('button', { name: '添加一行' });
    for (let i = 0; i < 28; i += 1) fireEvent.click(add);
    expect(screen.getByLabelText('第 30 行名称')).toBeTruthy();
    expect((add as HTMLButtonElement).disabled).toBe(true);
    const e = await api.createProduct({ title: 't', description: 'd', price: 1, category: '其他', condition: '全新', campus: '东校区',
      images: [], contact: '1', listingKind: 'BUNDLE', bundleItems: bundleItems(31) }).catch((x) => x);
    expect((e as ApiError).code).toBe(400);
  }, 30_000);   // jsdom 里渲染 30 行 MUI 选择框较慢

  it('#7 明细不能单独购买：详情里明细行没有任何操作按钮；用明细编号下单 404，只有整套能下单', async () => {
    await user('seller');
    const p = await api.createProduct({ title: '整套不拆卖', description: 'd', price: 60, category: '其他', condition: '全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '1', listingKind: 'BUNDLE', bundleItems: bundleItems(3) });
    await user('buyer');
    renderApp(`/product/${p.id}`);
    const section = await screen.findByRole('region', { name: '整套转让明细' }, { timeout: 5000 });
    expect(within(section).queryAllByRole('button')).toEqual([]);
    expect(within(section).queryAllByRole('link')).toEqual([]);
    expect(screen.getAllByRole('button', { name: '我想要' })).toHaveLength(1);
    for (const code of ['I01', 'B01_I01', `${p.id}:I01`]) {
      const e = await api.createOrder({ productId: code, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() }).catch((x) => x);
      expect((e as ApiError).code, code).toBe(404);
    }
    const order = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() });
    expect(order.productId).toBe(p.id);
  });

  it('#10 撤销后不能继续编辑：协助人页面打开着，所有者在另一页撤销；协助人保存被拒，草稿内容不变', async () => {
    const owner = await user('owner');
    const draft = await api.createListingDraft({ payload: single('生活用品', '撤销前的标题', 20) });
    const { invite, token } = await api.createAssistInvite({ draftId: draft.id });
    await user('helper');
    await api.redeemAssistInvite(token);
    renderApp('/assist');
    fireEvent.click(await screen.findByRole('button', { name: /撤销前的标题/ }, { timeout: 5000 }));
    const editor = await screen.findByRole('region', { name: '协助整理' });
    const ownerTab = new MockCampusMarketApi();
    await ownerTab.login({ account: owner, password: 'test-password' });
    await ownerTab.revokeAssistInvite(invite.id);
    fireEvent.change(within(editor).getByLabelText('标题'), { target: { value: '撤销后想写入的标题' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存这件' }));
    expect(await within(editor).findByText(/草稿不存在/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts[0].payload.title).toBe('撤销前的标题');
  });

  it('#11 所有者最终确认：点「发布」只打开确认框，不调用接口；「再检查一下」取消后也不调用；确认后才发布一次', async () => {
    await user('owner');
    const d = await api.createListingDraft({ payload: single('生活用品', '等所有者确认', 20) });
    const batch = await api.createListingBatch({ draftIds: [d.id] });
    const spy = vi.spyOn(api, 'publishListingBatch');
    renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 1 件' }, { timeout: 5000 }));
    let dialog = await screen.findByRole('dialog', { name: '确认一次发布 1 件？' });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '再检查一下' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(spy).not.toHaveBeenCalled();
    expect((await api.getListingBatch(batch.id)).status).toBe('OPEN');
    fireEvent.click(screen.getByRole('button', { name: '发布这 1 件' }));
    dialog = await screen.findByRole('dialog', { name: '确认一次发布 1 件？' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }));
    await screen.findByRole('heading', { name: '已发布 1 件' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('#14 教材与普通分类都能使用价格参考：教材按订单上的版本快照统计，普通分类按分类统计', async () => {
    await user('viewer');
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    const push = (i: number, category: Category, edition: string | null, price: number) => raw.market.orders.push({
      id: `m14-${category}-${i}`, productId: `gone-${category}-${i}`, buyerId: 'b', sellerId: 's', price, status: '已完成', canonicalStatus: 'COMPLETED',
      createdAt: 1, updatedAt: Date.now(), priceSnapshot: price, currency: 'CNY', schoolIdSnapshot: 'pilot', categorySnapshot: category,
      conditionSnapshot: '全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: edition });
    for (let i = 1; i <= 8; i += 1) push(i, '教材书籍', 'demo-calculus-8', 20 + i);
    for (let i = 1; i <= 8; i += 1) push(i, '运动户外', null, 100 + i);
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    setApiClient(api);
    const spy = vi.spyOn(api, 'getPriceGuidance');
    const textbook = render(<PriceGuidanceCard category="教材书籍" textbookEditionId="demo-calculus-8" />);
    await waitFor(() => expect(textbook.container.textContent).toContain('中位数约 ¥25'));
    expect(spy).toHaveBeenLastCalledWith({ category: '教材书籍', textbookEditionId: 'demo-calculus-8' });
    textbook.unmount();
    const outdoor = render(<PriceGuidanceCard category="运动户外" />);
    await waitFor(() => expect(outdoor.container.textContent).toContain('中位数约 ¥105'));
  });

  it('#17 错误带 requestId：批量发布失败时提示写出错误编号，且写明没有任何商品被发布', async () => {
    await user('owner');
    const d = await api.createListingDraft({ payload: single('生活用品', '会失败', 20) });
    const batch = await api.createListingBatch({ draftIds: [d.id] });
    vi.spyOn(api, 'publishListingBatch').mockRejectedValueOnce(new ApiError({ code: 500, message: '服务暂时不可用', requestId: 'req-7c3e9a01', httpStatus: 500 }));
    renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 1 件' }, { timeout: 5000 }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发布' }));
    const alert = await screen.findByText(/发布没有完成，没有任何商品被发布/);
    expect(alert.textContent).toContain('错误编号：req-7c3e9a01');
    expect(screen.queryByRole('heading', { name: /已发布/ })).toBeNull();
  });

  it('8.1 回归：确认后服务端返回问题清单（400）→ 批次刷新完成后「整个批次都没有发布」与问题清单仍然显示，不残留「全部可以发布」', async () => {
    await user('owner2');
    const d = await api.createListingDraft({ payload: single('生活用品', '服务端拒绝', 20) });
    const batch = await api.createListingBatch({ draftIds: [d.id] });
    vi.spyOn(api, 'publishListingBatch').mockRejectedValueOnce(new ApiError({ code: 400, message: '批次里有不能发布的商品', httpStatus: 400,
      details: { items: [{ position: 1, draftId: d.id, code: 'MISSING_FIELD', field: 'price' }] } }));
    const reload = vi.spyOn(api, 'getListingBatch');
    renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 1 件' }, { timeout: 5000 }));
    const before = reload.mock.calls.length;
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(reload.mock.calls.length).toBeGreaterThan(before));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('整个批次都没有发布。请按下面的清单逐件修改，其他已填写的内容都还在。')).toBeTruthy();
    expect(screen.getAllByText(/第 1 件/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/件全部可以发布/)).toBeNull();
  });

  it('#18 429 与 Retry-After：兑换邀请码超过限流（真实 Mock 计数），提示给出等待秒数而不是错误编号', async () => {
    await user('guesser');
    for (let i = 0; i < 10; i += 1) await api.redeemAssistInvite(`guess-${i}-${'x'.repeat(30)}`).catch(() => null);
    renderApp('/assist');
    fireEvent.change(await screen.findByLabelText('邀请码', undefined, { timeout: 5000 }), { target: { value: `guess-final-${'y'.repeat(30)}` } });
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    const message = await screen.findByText(/操作过于频繁/);
    expect(message.textContent).toMatch(/约 \d+ 秒后可重试/);
    expect(message.textContent).not.toContain('错误编号');
  });

  it('#19 原订单流程不退化：整套打包订单照常走接单 → 逐条验货 → 买家确认 → 卖家核销，商品变为已售出', async () => {
    const seller = await user('seller');
    const p = await api.createProduct({ title: '走完整流程的整套', description: 'd', price: 80, category: '其他', condition: '全新', campus: '东校区',
      images: [], contact: '1', listingKind: 'BUNDLE', bundleItems: bundleItems(2) });
    const buyer = await user('buyer');
    const order = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() });
    await as(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
    await as(buyer);
    const flow = await api.getOrderFlow(order.id);
    await api.submitInspection(order.id, flow.inspection.items.map((i) => ({ itemCode: i.code, result: 'MATCH' as const })));
    await api.transitionOrder(order.id, { to: 'BUYER_CONFIRMED' });
    await as(seller);
    const code = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).market.orders.find((o: { id: string }) => o.id === order.id).confirmationCode;
    const done = await api.transitionOrder(order.id, { to: 'COMPLETED', confirmationCode: code });
    expect(done.canonicalStatus).toBe('COMPLETED');
    expect((await api.getProduct(p.id)).status).toBe('已售出');
  });

  it('#20 需求雷达同步匹配不退化：批量发布返回时，订阅者的匹配与未读数已经可见', async () => {
    const watcher = await user('watcher');
    await api.createDemandSubscription({ keyword: '同步匹配台灯', geoScope: 'SCHOOL' });
    const owner = await user('owner');
    const ids: string[] = [];
    for (let i = 1; i <= 3; i += 1) ids.push((await api.createListingDraft({ payload: single('生活用品', `同步匹配台灯-${i}`, 10 + i) })).id);
    const batch = await api.createListingBatch({ draftIds: ids });
    const result = await api.publishListingBatch(batch.id, 'sync-match-key-1');
    await as(watcher);
    const matches = await api.listDemandMatches();
    expect(matches.items.map((m) => m.product.id).sort()).toEqual([...result.productIds].sort());
    expect(await api.getDemandUnreadCount()).toBe(3);
    void owner;
  });
});
