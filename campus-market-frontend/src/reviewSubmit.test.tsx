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
import type { ProductCreateInput } from './api/contracts';

/**
 * 8.1 真实浏览器 E2E 发现的缺陷回归：评价对话框曾把 createdAt 一并提交，后端（只接受 rating / comment）返回 400，
 * REST 模式下评价永远提交不上。Mock 现在与后端一样拒绝未知字段，这条用例在修复前会失败。
 */
let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => { window.localStorage.clear(); api = new MockCampusMarketApi(); setApiClient(api) });
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('评价提交（8.1 回归）', () => {
  it('完成交易后在界面上评价：只提交 rating / comment，提交成功并显示评价', async () => {
    await user('seller');
    const p = await api.createProduct({ title: '评价台灯', description: 'd', price: 20, category: '其他', condition: '几乎全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '13800000000' } as ProductCreateInput);
    await user('buyer');
    const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0);
    const o = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: at.toISOString(), contact: '1', idempotencyKey: rnd() });
    const code = o.confirmationCode!;
    await as('seller');
    await api.transitionOrder(o.id, { to: 'PENDING_MEETING' });
    await as('buyer');
    await api.transitionOrder(o.id, { to: 'BUYER_CONFIRMED' });
    await as('seller');
    await api.transitionOrder(o.id, { to: 'COMPLETED', confirmationCode: code });
    await as('buyer');
    const spy = vi.spyOn(api, 'addReview');
    renderApp('/profile/orders');
    fireEvent.click(await screen.findByRole('button', { name: '评价卖家' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('评价内容'), { target: { value: '准时见面' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交评价' }));
    expect(await screen.findByText(/买家评价 · 5 星 · 准时见面/, undefined, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(spy).toHaveBeenCalledWith(o.id, { rating: 5, comment: '准时见面' }));
  });

  it('REST 适配层的请求体只有 rating / comment', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { rating: 5, comment: 'x', createdAt: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.addReview('o1', { rating: 4, comment: '好', createdAt: 123 } as never);
    expect(JSON.parse(bodies[0])).toEqual({ rating: 4, comment: '好' });
  });
});
