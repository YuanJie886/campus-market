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
import type { ProductCreateInput } from './api/contracts';
import { DEMO_ACCOUNT, DEMO_PASSWORD } from './data/seed';
import { QUICK_MESSAGE_NOTICE } from './pages/MessagesPage';
import { axeViolations } from './test-axe';

/**
 * 私信快捷消息界面（NEW）：私信默认只能发送服务端给出的快捷消息；文字输入框只在服务端开放时出现。
 * 全部基于 Mock 适配层的真实行为（与后端同一套模板、身份规则与 400 原话）。商品留言保持自由文字，不受影响。
 */

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return s.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const listing = (title: string): ProductCreateInput => ({
  title, description: '快捷消息界面测试', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}
/** 卖家发布、买家打开会话；返回会话 id 与商品 id（当前登录身份为买家） */
async function conversation() {
  await user('seller');
  const product = await api.createProduct(listing('快捷消息界面商品'));
  await user('buyer');
  return { id: (await api.getOrCreateConversation(product.id)).id, productId: product.id };
}
const picker = () => screen.findByRole('list', { name: '可发送的快捷消息' }, { timeout: 5000 });
const chips = (list: HTMLElement) => within(list).getAllByRole('button').map((b) => b.textContent);
const BUYER_TEXTS = ['你好，这件还在吗？', '可以再介绍一下成色和使用情况吗？', '价格还有商量的空间吗？', '方便在商品里补充几张实物照片吗？',
  '我想要这件，已在商品页申请联系方式，麻烦同意一下。', '好的，谢谢！', '稍等，我晚点回复你。'];
const SELLER_TEXTS = ['还在的，可以在商品页申请联系方式。', '不好意思，已经出了。', '价格不议，谢谢理解。', '价格可以商量，交换联系方式后细聊。',
  '请在商品页点「申请联系方式」，我同意后你就能看到。', '照片已补充，刷新商品页就能看到。', '好的，谢谢！', '稍等，我晚点回复你。'];

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('私信快捷消息', () => {
  it('按会话里的身份过滤：买家只看到 BUYER + ANY，卖家只看到 SELLER + ANY，顺序与服务端一致', async () => {
    const { id } = await conversation();
    let view = renderApp(`/messages/${id}`);
    expect(chips(await picker())).toEqual(BUYER_TEXTS);
    view.unmount();
    await as('seller');
    view = renderApp(`/messages/${id}`);
    expect(chips(await picker())).toEqual(SELLER_TEXTS);
    expect(view.container.textContent).not.toContain('你好，这件还在吗？');
  });

  it('点一下快捷消息：只提交 { templateCode }，消息出现在聊天记录里', async () => {
    const { id } = await conversation();
    const send = vi.spyOn(api, 'sendMessage');
    renderApp(`/messages/${id}`);
    fireEvent.click(within(await picker()).getByRole('button', { name: '方便在商品里补充几张实物照片吗？' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]).toEqual([id, { templateCode: 'BUYER_ASK_PHOTOS' }]);
    expect(Object.keys(send.mock.calls[0][1])).toEqual(['templateCode']);
    const log = screen.getByRole('log', { name: '聊天记录' });
    expect(await within(log).findByText('方便在商品里补充几张实物照片吗？')).toBeTruthy();
    expect((await api.listMessages(id)).map((m) => m.templateCode)).toEqual(['BUYER_ASK_PHOTOS']);
  });

  it('默认不开放文字：没有输入框与发送按钮，显示「只能发送快捷消息」的说明', async () => {
    const { id } = await conversation();
    const view = renderApp(`/messages/${id}`);
    await picker();
    expect(screen.getByText(QUICK_MESSAGE_NOTICE)).toBeTruthy();
    expect(QUICK_MESSAGE_NOTICE).toBe('为保护双方安全，私信目前只能发送快捷消息；交换联系方式请使用「申请联系方式」');
    expect(screen.queryByRole('textbox', { name: '输入消息' })).toBeNull();
    expect(view.container.querySelector('textarea')).toBeNull();
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull();
  });

  it('服务端开放文字时：输入框出现、说明不再显示；文字消息只提交 { content }', async () => {
    api = new MockCampusMarketApi({ messageFreeTextEnabled: true });
    setApiClient(api);
    const { id } = await conversation();
    const send = vi.spyOn(api, 'sendMessage');
    renderApp(`/messages/${id}`);
    await picker();
    const box = await screen.findByRole('textbox', { name: '输入消息' }, { timeout: 5000 });
    expect(screen.queryByText(QUICK_MESSAGE_NOTICE)).toBeNull();
    fireEvent.change(box, { target: { value: '周六下午方便吗？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]).toEqual([id, { content: '周六下午方便吗？' }]);
    expect(await within(screen.getByRole('log', { name: '聊天记录' })).findByText('周六下午方便吗？')).toBeTruthy();
  });

  it('服务端拒绝时原话显示在快捷消息上方（role=alert），消息没有发出', async () => {
    const { id } = await conversation();
    // 模拟模板列表与身份不一致（例如服务端模板更新）：买家点到一条卖家模板，由服务端拒绝
    vi.spyOn(api, 'listMessageTemplates').mockResolvedValue({
      freeTextEnabled: false, templates: [{ code: 'SELLER_SOLD', text: '不好意思，已经出了。', role: 'ANY' }],
    });
    renderApp(`/messages/${id}`);
    fireEvent.click(within(await picker()).getByRole('button', { name: '不好意思，已经出了。' }));
    const alert = await screen.findByText(/^这条快捷消息不能由你发送/, { selector: '[role="alert"]' }, { timeout: 5000 });
    expect(alert.textContent).toMatch(/^这条快捷消息不能由你发送(（错误编号：[^）]+）)?$/);
    expect(await api.listMessages(id)).toEqual([]);
  });

  it('历史的文字私信（没有 templateCode）照常显示原文', async () => {
    await api.login({ account: DEMO_ACCOUNT, password: DEMO_PASSWORD });
    renderApp('/messages/conv01');
    const log = await screen.findByRole('log', { name: '聊天记录' }, { timeout: 5000 });
    expect(await within(log).findByText('你好，iPhone 13 还在吗？', undefined, { timeout: 5000 })).toBeTruthy();
    // 演示账号在这个会话里是买家：只给买家的快捷消息
    expect(chips(await picker())).toEqual(BUYER_TEXTS);
  });

  it('快捷消息加载失败：显示原因与重试，重试成功后出现快捷消息', async () => {
    const { id } = await conversation();
    const real = api.listMessageTemplates.bind(api);
    const load = vi.spyOn(api, 'listMessageTemplates').mockRejectedValueOnce(new Error('网络请求失败')).mockImplementation(real);
    renderApp(`/messages/${id}`);
    expect(await screen.findByText(/快捷消息加载失败：网络请求失败/, undefined, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(chips(await picker())).toEqual(BUYER_TEXTS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('axe：默认（只有快捷消息）与开放文字两种状态都没有严重违规', async () => {
    const { id } = await conversation();
    let view = renderApp(`/messages/${id}`);
    await picker();
    expect(await axeViolations(view.container)).toEqual([]);
    view.unmount();
    api = new MockCampusMarketApi({ messageFreeTextEnabled: true });
    setApiClient(api);
    await as('buyer');
    view = renderApp(`/messages/${id}`);
    await screen.findByRole('textbox', { name: '输入消息' }, { timeout: 5000 });
    expect(await axeViolations(view.container)).toEqual([]);
  });
});

describe('商品留言不受影响（回归）', () => {
  it('私信只能发快捷消息时，商品留言仍是自由文字，照常发出', async () => {
    const { productId } = await conversation();
    renderApp(`/product/${productId}`);
    const box = await screen.findByPlaceholderText('想问点什么？例如：还在吗？能小刀吗？', undefined, { timeout: 5000 });
    fireEvent.change(box, { target: { value: '周末可以看看实物吗？' } });
    fireEvent.click(screen.getByRole('button', { name: '留言' }));
    await waitFor(async () => expect((await api.listComments(productId)).map((c) => c.content)).toEqual(['周末可以看看实物吗？']));
  });
});
