// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { NotificationProvider } from './context/NotificationContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import ProductForm from './components/ProductForm';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { setApiClient } from './api/client';
import { CONTACT_PAGE_SIZE } from './pages/profile/ContactRequestsPage';
import { axeViolations } from './test-axe';

/**
 * 阶段 1 联系申请界面：商品详情的「我想要 / 撤回申请 / 重新申请」、个人中心「联系申请」页（收到 / 发出、分页、
 * 状态筛选、未读标记、撤回同意的二次确认）、导航栏未读角标，以及发布表单里「公开展示联系方式」的后果说明。
 * 全部基于 Mock 适配层的真实行为，断言的是用户能看到、能操作的结果。
 */

let api: MockCampusMarketApi;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api = new MockCampusMarketApi(); setApiClient(api); });
afterEach(() => { cleanup(); vi.restoreAllMocks() });
async function user(account: string) { await api.register({ account, nickname: account, password: 'test-pass', campus: '东校区' }); }
const login = (account: string) => api.login({ account, password: 'test-pass' });
async function listing(contactPublic = false, title = '联系权限商品') {
  if (!(await api.getCurrentUser())) await user('seller');
  return api.createProduct({ title, description: '只展示商品和联系方式', price: 20, category: '其他', condition: '全新', campus: '东校区', images: ['https://example.invalid/a.png'], contact: 'wechat:private-seller', contactPublic });
}
function renderApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider><App /></DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider></MemoryRouter>);
}
const focusWindow = () => act(() => { window.dispatchEvent(new Event('focus')) });
/** 页面内联的错误说明（商品页联系区块 / 联系申请页），与全局提示条分开核对 */
const inlineAlert = async (text: string) => waitFor(() => {
  const found = [...document.querySelectorAll('p[role="alert"]')].find((el) => el.textContent?.includes(text));
  expect(found, text).toBeTruthy();
  return found!;
});

describe('商品详情：申请、撤回与重新申请', () => {
  it('买家点击我想要只发起联系申请，不出现预约地点或交易履历，也不调用任何交易接口', async () => {
    const product = await listing(); await user('buyer');
    renderApp(`/product/${product.id}`);
    const want = await screen.findByRole('button', { name: '我想要' });
    await waitFor(() => expect((want as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/wechat:private-seller/)).toBeNull();
    fireEvent.click(want);
    expect(await screen.findByRole('button', { name: '等待卖家同意' })).toBeTruthy();
    expect(screen.queryByText('交易履历')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('面交地点')).toBeNull();
    for (const retired of ['listOrders', 'listMeetingPoints', 'createOrder']) expect(retired in api).toBe(false);
    expect((await api.getContactRequest(product.id))?.status).toBe('PENDING');
  });

  it('等待中的申请可以在详情页撤回；撤回后按钮变为「重新申请」，再次点击回到等待（同一条申请）', async () => {
    const product = await listing(); await user('buyer');
    const original = await api.requestContact(product.id);
    renderApp(`/product/${product.id}`);
    expect(await screen.findByRole('button', { name: '等待卖家同意' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '撤回申请' }));
    const again = await screen.findByRole('button', { name: '重新申请' });
    expect((again as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('你已撤回这次联系申请。需要时可以点击“重新申请”，卖家会重新收到申请。')).toBeTruthy();
    expect((await api.getContactRequest(product.id))?.status).toBe('WITHDRAWN');
    fireEvent.click(again);
    expect(await screen.findByRole('button', { name: '等待卖家同意' })).toBeTruthy();
    const after = await api.getContactRequest(product.id);
    expect([after?.id, after?.status]).toEqual([original.id, 'PENDING']);
  });

  it('卖家撤回同意后（另一处操作），买家回到页面时联系方式立即消失，按钮为不可点击的「卖家已撤回同意」并说明原因', async () => {
    const product = await listing(); await user('buyer');
    const request = await api.requestContact(product.id);
    await login('seller'); await api.decideContactRequest(request.id, 'APPROVED');
    await login('buyer');
    renderApp(`/product/${product.id}`);
    expect(await screen.findByText('卖家联系方式：wechat:private-seller')).toBeTruthy();
    // 模拟卖家在另一个标签页撤回同意（同一份 Mock 存储），买家回到这个标签页
    await login('seller'); await api.revokeContactRequest(request.id); await login('buyer');
    await focusWindow();
    const revoked = await screen.findByRole('button', { name: '卖家已撤回同意' });
    expect((revoked as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.queryByText(/wechat:private-seller/)).toBeNull());
    expect(screen.getByText(/卖家已撤回对你这次申请的同意，联系方式已不再向你展示；这件商品不能再次申请/)).toBeTruthy();
  });

  it('页面过期时再次申请被拒（409）：原样显示「卖家已拒绝 / 已撤回同意，不能再次申请」，按钮随即更新为不可点击', async () => {
    const rejectedProduct = await listing(false, '会被拒绝的商品');
    const revokedProduct = await listing(false, '会被撤回同意的商品');
    await user('buyer');
    const view = renderApp(`/product/${rejectedProduct.id}`);
    const want = await screen.findByRole('button', { name: '我想要' });
    await waitFor(() => expect((want as HTMLButtonElement).disabled).toBe(false));
    // 另一个标签页里：申请后被卖家拒绝；这个页面仍显示「我想要」
    const r1 = await api.requestContact(rejectedProduct.id);
    await login('seller'); await api.decideContactRequest(r1.id, 'REJECTED'); await login('buyer');
    fireEvent.click(want);
    await inlineAlert('卖家已拒绝这次申请，不能再次申请');
    expect(await screen.findByRole('button', { name: '卖家已拒绝' })).toHaveProperty('disabled', true);
    view.unmount();

    renderApp(`/product/${revokedProduct.id}`);
    const want2 = await screen.findByRole('button', { name: '我想要' });
    await waitFor(() => expect((want2 as HTMLButtonElement).disabled).toBe(false));
    const r2 = await api.requestContact(revokedProduct.id);
    await login('seller'); await api.decideContactRequest(r2.id, 'APPROVED'); await api.revokeContactRequest(r2.id); await login('buyer');
    fireEvent.click(want2);
    await inlineAlert('卖家已撤回同意，不能再次申请');
    expect(await screen.findByRole('button', { name: '卖家已撤回同意' })).toHaveProperty('disabled', true);
    expect(screen.queryByText(/wechat:private-seller/)).toBeNull();
  });

  it('「申请联系方式」受限时，原样显示服务端的限制说明（含解除时间），不发出申请', async () => {
    const product = await listing(); await user('buyer');
    const buyerId = (await api.getCurrentUser())!.id;
    const raw = JSON.parse(localStorage.getItem('campus_market_mock_database_v1')!);
    const now = Date.now();
    raw.userRestrictions.push({ id: 'r-contact', userId: buyerId, schoolId: 'pilot', scope: 'CONTACT', source: 'CASE', caseId: 'k1', noShowReportId: null,
      createdBy: 'staff', reasonCode: 'HARASSMENT', startsAt: now - 1000, endsAt: now + 48 * 3_600_000, createdAt: now - 1000, revokedAt: null,
      revokedBy: null, revokeReason: null, ruleVersion: null, decidedAt: now - 1000, basis: [], lastCorrectionId: null });
    localStorage.setItem('campus_market_mock_database_v1', JSON.stringify(raw));
    api = new MockCampusMarketApi(); setApiClient(api);
    renderApp(`/product/${product.id}`);
    const want = await screen.findByRole('button', { name: '我想要' });
    await waitFor(() => expect((want as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(want);
    const alert = await inlineAlert('你的「申请联系方式」功能暂时受限');
    expect(alert.textContent).toMatch(/^你的「申请联系方式」功能暂时受限，至 \d{1,2} 月 \d{1,2} 日 \d{2}:\d{2} 自动恢复。可以在「我的限制」里查看原因或提交申诉。（错误编号：mock-/);
    expect(await api.getContactRequest(product.id)).toBeNull();
    expect(screen.getByRole('button', { name: '我想要' })).toBeTruthy();
  });

  it('卖家勾选公开时，买家直接看到联系方式', async () => {
    const product = await listing(true); await user('buyer'); renderApp(`/product/${product.id}`);
    expect(await screen.findByText('卖家联系方式：wechat:private-seller')).toBeTruthy();
  });

  it('卖家查看自己的商品：没有「我想要」，按钮为「这是我发布的」且不可点击，不会发起联系申请', async () => {
    const product = await listing();
    const requestSpy = vi.spyOn(api, 'requestContact');
    renderApp(`/product/${product.id}`);
    const own = await screen.findByRole('button', { name: '这是我发布的' });
    expect((own as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '我想要' })).toBeNull();
    fireEvent.click(own);
    expect(requestSpy).not.toHaveBeenCalled();
    expect(screen.getByText('本人联系方式：wechat:private-seller')).toBeTruthy();
    expect(screen.getByRole('link', { name: '管理联系申请' }).getAttribute('href')).toBe('/profile/contact-requests');
    await expect(api.requestContact(product.id)).rejects.toMatchObject({ code: 400 });
  });
});

describe('个人中心「联系申请」', () => {
  it('卖家在联系申请页同意后，买家能查看联系方式', async () => {
    const product = await listing(); await user('buyer'); const request = await api.requestContact(product.id);
    await login('seller');
    const view = renderApp('/profile/contact-requests');
    fireEvent.click(await screen.findByRole('button', { name: '同意展示联系方式' }));
    await waitFor(async () => expect((await api.listContactRequests()).items.find((r) => r.id === request.id)?.status).toBe('APPROVED'));
    view.unmount(); await login('buyer');
    renderApp(`/product/${product.id}`);
    expect(await screen.findByText('卖家联系方式：wechat:private-seller')).toBeTruthy();
    expect(screen.queryByText('交易履历')).toBeNull();
  });

  it('卖家在联系申请页拒绝后，买家看到「卖家已拒绝」且不能再次申请，联系方式不展示', async () => {
    const product = await listing(); await user('buyer'); const request = await api.requestContact(product.id);
    await login('seller');
    const view = renderApp('/profile/contact-requests');
    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }));
    await waitFor(async () => expect((await api.listContactRequests()).items.find((r) => r.id === request.id)?.status).toBe('REJECTED'));
    expect(await screen.findByText('已拒绝')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '同意展示联系方式' })).toBeNull();
    view.unmount(); await login('buyer');
    const requestSpy = vi.spyOn(api, 'requestContact');
    renderApp(`/product/${product.id}`);
    const rejected = await screen.findByRole('button', { name: '卖家已拒绝' });
    expect((rejected as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('卖家未同意展示联系方式。')).toBeTruthy();
    fireEvent.click(rejected);
    expect(requestSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/wechat:private-seller/)).toBeNull();
  });

  it('撤回同意需要二次确认：对话框有标题，写明买家会立即看不到联系方式；取消不改变任何东西，确认后状态为「卖家已撤回同意」；axe 通过', async () => {
    const product = await listing(); await user('buyer'); const request = await api.requestContact(product.id);
    await login('seller'); await api.decideContactRequest(request.id, 'APPROVED');
    const { container } = renderApp('/profile/contact-requests');
    const revoke = await screen.findByRole('button', { name: '撤回同意' });
    expect(revoke.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(revoke.getAttribute('aria-describedby')!)?.textContent).toBe('联系权限商品');
    fireEvent.click(revoke);
    let dialog = await screen.findByRole('dialog', { name: '撤回对这次申请的同意？' });
    expect(dialog.textContent).toContain('buyer将立即看不到「联系权限商品」的联系方式');
    expect(dialog.textContent).toContain('不能再次申请');
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await api.listContactRequests()).items[0].status).toBe('APPROVED');
    fireEvent.click(screen.getByRole('button', { name: '撤回同意' }));
    dialog = await screen.findByRole('dialog', { name: '撤回对这次申请的同意？' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认撤回同意' }));
    expect(await screen.findByText('卖家已撤回同意')).toBeTruthy();
    expect((await api.listContactRequests()).items[0].status).toBe('REVOKED');
    expect(screen.queryByRole('button', { name: '撤回同意' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await login('buyer');
    expect((await api.getProduct(product.id)).contact).toBe('');
  });

  it('「我发出的申请」：等待中的可以撤回，撤回后显示「已撤回」并可重新申请；被拒绝 / 撤回同意的写明不能再次申请', async () => {
    const pendingProduct = await listing(false, '等待中的商品');
    const rejectedProduct = await listing(false, '被拒绝的商品');
    const revokedProduct = await listing(false, '被撤回同意的商品');
    await user('buyer');
    await api.requestContact(pendingProduct.id);
    const rejected = await api.requestContact(rejectedProduct.id);
    const revoked = await api.requestContact(revokedProduct.id);
    await login('seller');
    await api.decideContactRequest(rejected.id, 'REJECTED');
    await api.decideContactRequest(revoked.id, 'APPROVED'); await api.revokeContactRequest(revoked.id);
    await login('buyer');
    renderApp('/profile/contact-requests');
    fireEvent.click(await screen.findByRole('tab', { name: /我发出的申请/ }));
    const list = await screen.findByRole('list', { name: '我发出的申请' });
    const pendingItem = within(list).getByRole('link', { name: '等待中的商品' }).closest('li')!;
    fireEvent.click(within(pendingItem).getByRole('button', { name: '撤回申请' }));
    await waitFor(() => expect(within(screen.getByRole('list', { name: '我发出的申请' })).getByText('已撤回')).toBeTruthy());
    const withdrawnItem = within(screen.getByRole('list', { name: '我发出的申请' })).getByRole('link', { name: '等待中的商品' }).closest('li')!;
    expect(within(withdrawnItem).getByRole('button', { name: '重新申请' })).toBeTruthy();
    const rejectedItem = within(screen.getByRole('list', { name: '我发出的申请' })).getByRole('link', { name: '被拒绝的商品' }).closest('li')!;
    expect(rejectedItem.textContent).toContain('卖家没有同意展示联系方式，这件商品不能再次申请');
    expect(within(rejectedItem).queryByRole('button')).toBeNull();
    const revokedItem = within(screen.getByRole('list', { name: '我发出的申请' })).getByRole('link', { name: '被撤回同意的商品' }).closest('li')!;
    expect(revokedItem.textContent).toContain('卖家已撤回同意');
    expect(revokedItem.textContent).toContain('卖家已撤回同意，你已看不到这件商品的联系方式，这件商品不能再次申请');
    expect(within(revokedItem).queryByRole('button')).toBeNull();
    fireEvent.click(within(withdrawnItem).getByRole('button', { name: '重新申请' }));
    await waitFor(async () => expect((await api.getContactRequest(pendingProduct.id))?.status).toBe('PENDING'));
  });

  it('五种状态都有文案；服务端分页（上一页 / 下一页）与状态筛选；切换到「我发出的申请」按 role=sent 读取', async () => {
    await user('seller');
    const products = [];
    for (let i = 0; i < CONTACT_PAGE_SIZE + 2; i += 1) products.push(await listing(false, `分页商品 ${String(i).padStart(2, '0')}`));
    await user('buyer');
    // 只在准备数据时伪造 Date：每一步的 updatedAt 严格递增，第 1 页的内容是确定的
    vi.useFakeTimers({ toFake: ['Date'] });
    let clock = Date.UTC(2026, 9, 19, 8, 0, 0);
    const tick = () => vi.setSystemTime((clock += 60_000));
    const requests = [];
    for (const p of products) { tick(); requests.push(await api.requestContact(p.id)); }
    tick(); await api.withdrawContactRequest(requests[0].id);
    await login('seller');
    tick(); await api.decideContactRequest(requests[1].id, 'APPROVED');
    tick(); await api.decideContactRequest(requests[2].id, 'REJECTED');
    tick(); await api.decideContactRequest(requests[3].id, 'APPROVED');
    tick(); await api.revokeContactRequest(requests[3].id);
    vi.useRealTimers();
    const listSpy = vi.spyOn(api, 'listContactRequests');
    renderApp('/profile/contact-requests');
    const nav = await screen.findByRole('navigation', { name: '联系申请分页' });
    expect(nav.textContent).toContain(`第 1 / 2 页（共 ${CONTACT_PAGE_SIZE + 2} 条）`);
    expect(screen.getByRole('list', { name: '收到的申请' }).querySelectorAll('li')).toHaveLength(CONTACT_PAGE_SIZE);
    expect(listSpy).toHaveBeenLastCalledWith({ role: 'received', page: 1, size: CONTACT_PAGE_SIZE });
    for (const label of ['等待卖家同意', '已同意展示', '已拒绝', '已撤回', '卖家已撤回同意']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
    expect(within(nav).getByRole('button', { name: '上一页' })).toHaveProperty('disabled', true);
    fireEvent.click(within(nav).getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByRole('list', { name: '收到的申请' }).querySelectorAll('li')).toHaveLength(2));
    expect(listSpy).toHaveBeenLastCalledWith({ role: 'received', page: 2, size: CONTACT_PAGE_SIZE });
    expect(screen.getByRole('navigation', { name: '联系申请分页' }).textContent).toContain('第 2 / 2 页');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '按状态筛选' }));
    fireEvent.click(await screen.findByRole('option', { name: '已撤回' }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ role: 'received', status: 'WITHDRAWN', page: 1, size: CONTACT_PAGE_SIZE }));
    await waitFor(() => expect(screen.getByRole('list', { name: '收到的申请' }).querySelectorAll('li')).toHaveLength(1));
    expect(screen.getByRole('link', { name: '分页商品 00' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '联系申请分页' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /我发出的申请/ }));
    await waitFor(() => expect(listSpy).toHaveBeenLastCalledWith({ role: 'sent', page: 1, size: CONTACT_PAGE_SIZE }));
    expect(await screen.findByText('暂无联系申请')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /我发出的申请/ }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('未读角标与标记已读', () => {
  it('导航栏与个人中心标签的未读数（可访问名称带数字）；打开标签后逐条显示「未读」并标记已读，角标随即清零；买家的结果未读在「我发出的申请」里清零', async () => {
    const first = await listing(false, '未读商品一');
    const second = await listing(false, '未读商品二');
    await user('buyer');
    const r1 = await api.requestContact(first.id);
    await api.requestContact(second.id);
    await login('seller');
    const readSpy = vi.spyOn(api, 'markContactRequestsRead');
    const view = renderApp('/profile');
    const badge = await screen.findByRole('button', { name: '联系申请，2 条未读' }, { timeout: 5000 });
    expect(badge.textContent).toContain('2');
    const profileTab = await screen.findByRole('tab', { name: '联系申请，2 条未读' });
    expect(readSpy).not.toHaveBeenCalled();
    fireEvent.click(profileTab);
    const list = await screen.findByRole('list', { name: '收到的申请' });
    expect(within(list).getAllByText('未读')).toHaveLength(2);
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith('received'));
    expect(await screen.findByRole('button', { name: '联系申请' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '联系申请' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /联系申请，\d+ 条未读/ })).toBeNull();
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 0, updates: 0, total: 0 });
    // 已经读过的申请在下一次刷新时不再标记「未读」
    await focusWindow();
    await waitFor(() => expect(within(screen.getByRole('list', { name: '收到的申请' })).queryByText('未读')).toBeNull());
    await api.decideContactRequest(r1.id, 'APPROVED');
    view.unmount();

    await login('buyer');
    readSpy.mockClear();
    renderApp('/profile/contact-requests');
    expect(await screen.findByRole('button', { name: '联系申请，1 条未读' }, { timeout: 5000 })).toBeTruthy();
    const sentTab = await screen.findByRole('tab', { name: '我发出的申请（1 条未读）' });
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith('received'));
    expect(readSpy).not.toHaveBeenCalledWith('sent');
    fireEvent.click(sentTab);
    const sent = await screen.findByRole('list', { name: '我发出的申请' });
    const approvedItem = within(sent).getByRole('link', { name: '未读商品一' }).closest('li')!;
    expect(within(approvedItem).getByText('未读')).toBeTruthy();
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith('sent'));
    await waitFor(() => expect(screen.getByRole('button', { name: '联系申请' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: '我发出的申请' })).toBeTruthy();
  });
});

describe('发布表单：「公开展示联系方式」的后果说明', () => {
  const CONSEQUENCE = /勾选后，你填写的联系方式会随商品一起出现在商品详情、商品列表与搜索结果、楼栋动态和需求匹配收件箱里，所有能看到这件商品的本校登录同学都能直接看到，不需要申请；商品原有的学校、圈子与可见范围不变。可以随时取消勾选，取消后只有你本人和已获你同意（且未被撤回）的买家能看到。/;
  const describedText = (checkbox: HTMLElement) => document.getElementById(checkbox.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

  it('单件发布：默认不勾选，说明通过 aria-describedby 关联到复选框；勾选后明确提交', async () => {
    await user('seller'); const submit = vi.fn();
    render(<NotificationProvider><ProductForm initial={{ title: '一个闲置商品', description: '这里是完整的商品情况描述', price: '20', category: '其他', contact: 'wechat:seller', images: ['https://example.invalid/a.png'] }} onSubmit={submit} /></NotificationProvider>);
    const checkbox = screen.getByRole('checkbox', { name: '公开展示联系方式' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(describedText(checkbox)).toMatch(CONSEQUENCE);
    expect(describedText(checkbox)).toContain('不勾选时，买家需要点击“我想要”提交申请，经你同意后才能看到联系方式。');
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.queryByText(/正在读取验货/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ contactPublic: true, contact: 'wechat:seller' })));
  });

  it('整套打包与批量发布的同一开关写着同样的后果说明，默认不勾选', async () => {
    await user('seller');
    const view = renderApp('/publish');
    fireEvent.click(await screen.findByRole('button', { name: '整套打包' }, { timeout: 5000 }));
    const bundle = await screen.findByRole('checkbox', { name: '公开展示联系方式' }) as HTMLInputElement;
    expect(bundle.checked).toBe(false);
    expect(describedText(bundle)).toMatch(CONSEQUENCE);
    view.unmount();

    renderApp('/publish/batch');
    fireEvent.click(await screen.findByRole('button', { name: '新建批次' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: '添加单件' }));
    const batch = await screen.findByRole('checkbox', { name: '公开展示联系方式' }) as HTMLInputElement;
    expect(batch.checked).toBe(false);
    expect(describedText(batch)).toMatch(CONSEQUENCE);
  });
});
