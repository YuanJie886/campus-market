// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { NotificationProvider } from './context/NotificationContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import ProductForm from './components/ProductForm';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { setApiClient } from './api/client';

let api: MockCampusMarketApi;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api = new MockCampusMarketApi(); setApiClient(api); });
async function user(account: string) { await api.register({ account, nickname: account, password: 'test-pass', campus: '东校区' }); }
async function listing(contactPublic = false) {
  await user('seller');
  return api.createProduct({ title: '联系权限商品', description: '只展示商品和联系方式', price: 20, category: '其他', condition: '全新', campus: '东校区', images: ['https://example.invalid/a.png'], contact: 'wechat:private-seller', contactPublic });
}
function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider></MemoryRouter>);
}
it('买家点击我想要只发起联系申请，不出现预约地点或交易履历', async () => {
  const product = await listing(); await user('buyer');
  const oldOrders = vi.spyOn(api, 'listOrders'); const oldPoints = vi.spyOn(api, 'listMeetingPoints'); const oldCreate = vi.spyOn(api, 'createOrder');
  renderApp(`/product/${product.id}`);
  const want = await screen.findByRole('button', { name: '我想要' });
  await waitFor(() => expect((want as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText(/wechat:private-seller/)).toBeNull();
  fireEvent.click(want);
  expect(await screen.findByRole('button', { name: '等待卖家同意' })).toBeTruthy();
  expect(screen.queryByText('交易履历')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByLabelText('面交地点')).toBeNull();
  expect(oldOrders).not.toHaveBeenCalled(); expect(oldPoints).not.toHaveBeenCalled(); expect(oldCreate).not.toHaveBeenCalled();
});
it('卖家在联系申请页同意后，买家能查看联系方式', async () => {
  const product = await listing(); await user('buyer'); const request = await api.requestContact(product.id);
  await api.login({ account: 'seller', password: 'test-pass' });
  const view = renderApp('/profile/contact-requests');
  fireEvent.click(await screen.findByRole('button', { name: '同意展示联系方式' }));
  await waitFor(async () => expect((await api.listContactRequests()).find((r) => r.id === request.id)?.status).toBe('APPROVED'));
  view.unmount(); await api.login({ account: 'buyer', password: 'test-pass' });
  renderApp(`/product/${product.id}`);
  expect(await screen.findByText('卖家联系方式：wechat:private-seller')).toBeTruthy();
  expect(screen.queryByText('交易履历')).toBeNull();
});
it('卖家勾选公开时，买家直接看到联系方式', async () => {
  const product = await listing(true); await user('buyer'); renderApp(`/product/${product.id}`);
  expect(await screen.findByText('卖家联系方式：wechat:private-seller')).toBeTruthy();
});
it('发布表单默认不公开联系方式，勾选后明确提交', async () => {
  await user('seller'); const submit = vi.fn();
  render(<NotificationProvider><ProductForm initial={{ title: '一个闲置商品', description: '这里是完整的商品情况描述', price: '20', category: '其他', contact: 'wechat:seller', images: ['https://example.invalid/a.png'] }} onSubmit={submit} /></NotificationProvider>);
  const checkbox = screen.getByRole('checkbox', { name: '公开展示联系方式' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false); fireEvent.click(checkbox);
  await waitFor(() => expect(screen.queryByText(/正在读取验货/)).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ contactPublic: true, contact: 'wechat:seller' })));
});
