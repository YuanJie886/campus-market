// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import type { ListingPayload, ProductCreateInput } from './api/contracts';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';
import { subscribeResultText } from './utils/demand';
import type { Category } from './types';

/**
 * Web 与小程序对齐（小程序是主产品，文案、规则与错误原话以小程序 / 后端为准）：
 *   a. 批量发布草稿「标记为可以发布」（updateDraft status=READY，校验失败原样显示「草稿还不能发布：…」）；
 *   b. 需求匹配「新建订阅」（与小程序相同的表单、校验与 EXISTING / REACTIVATED 结果文案）；
 *   c. 商品留言：回复也可以举报；回复时提交按钮写「回复」；
 *   d. 商品详情「私信卖家」进入只有快捷消息的会话。
 * axe 严重 / 致命为 0（jsdom 不检查颜色对比度）。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
let lastPath = '';
function PathProbe() {
  lastPath = useLocation().pathname;
  return null;
}
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
        <PathProbe />
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
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return s.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
function single(category: Category, title: string, price: number): ListingPayload {
  return {
    title, description: '对齐小程序的界面测试', price, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}),
  };
}
const listing = (title: string): ProductCreateInput => ({
  title, description: '对齐小程序的界面测试', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000', inspection: fullDisclosure('生活用品')!,
} as ProductCreateInput);
const storedDraft = (id: string) => JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts.find((d: { id: string }) => d.id === id);

describe('a. 草稿「标记为可以发布」（与小程序 DraftEditor 相同）', () => {
  it('不完整的草稿：服务端 400「草稿还不能发布：…」原样显示，状态仍是 DRAFT；完整的草稿标记后为 READY 并提示「第 N 件已标记为可以发布」；axe 通过', async () => {
    await user('owner');
    const partial = await api.createListingDraft({ payload: { title: '只有标题' } });
    const complete = await api.createListingDraft({ payload: single('生活用品', '完整的台灯', 25) });
    const batch = await api.createListingBatch({ draftIds: [partial.id, complete.id] });
    const update = vi.spyOn(api, 'updateListingDraft');
    const { container } = renderApp(`/publish/batch?batch=${batch.id}`);
    const first = await screen.findByRole('region', { name: /第 1 件/ }, { timeout: 5000 });
    fireEvent.click(within(first).getByRole('button', { name: '标记为可以发布' }));
    const alert = await within(first).findByRole('alert');
    expect(alert.textContent).toMatch(/^草稿还不能发布：/);
    expect(update).toHaveBeenLastCalledWith(partial.id, expect.objectContaining({ status: 'READY', expectedVersion: partial.version }));
    expect(storedDraft(partial.id).status).toBe('DRAFT');
    expect(within(first).queryByText('第 1 件已标记为可以发布')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /第 2 件 · 完整的台灯/ }));
    const second = await screen.findByRole('region', { name: /第 2 件/ });
    fireEvent.click(within(second).getByRole('button', { name: '标记为可以发布' }));
    expect(await within(second).findByText('第 2 件已标记为可以发布')).toBeTruthy();
    expect(storedDraft(complete.id).status).toBe('READY');
    // 服务端规则：之后普通保存回到 DRAFT，需要时重新标记
    fireEvent.click(within(second).getByRole('button', { name: '保存这件' }));
    expect(await within(second).findByText('第 2 件已保存')).toBeTruthy();
    expect(storedDraft(complete.id).status).toBe('DRAFT');
  });

  it('标记为可以发布后一次发布整个批次；协助人页面没有「标记为可以发布」，接口同样拒绝（403 原话）', async () => {
    await user('owner');
    const draft = await api.createListingDraft({ payload: single('生活用品', '标记后发布的书架', 40) });
    const batch = await api.createListingBatch({ draftIds: [draft.id] });
    const { token } = await api.createAssistInvite({ batchId: batch.id });
    renderApp(`/publish/batch?batch=${batch.id}`);
    const editor = await screen.findByRole('region', { name: /第 1 件/ }, { timeout: 5000 });
    fireEvent.click(within(editor).getByRole('button', { name: '标记为可以发布' }));
    expect(await within(editor).findByText('第 1 件已标记为可以发布')).toBeTruthy();
    expect(storedDraft(draft.id).status).toBe('READY');
    cleanup();

    await user('helper');
    await api.redeemAssistInvite(token);
    renderApp('/assist');
    fireEvent.click(await screen.findByRole('button', { name: /标记后发布的书架 · 所有者已标记可发布/ }, { timeout: 5000 }));
    const assisting = await screen.findByRole('region', { name: '协助整理' });
    expect(within(assisting).getByRole('button', { name: '保存这件' })).toBeTruthy();
    expect(within(assisting).queryByRole('button', { name: '标记为可以发布' })).toBeNull();
    const current = await api.getListingDraft(draft.id);
    await expect(api.updateListingDraft(draft.id, { expectedVersion: current.version, status: 'READY' }))
      .rejects.toMatchObject({ code: 403, message: '只有商品所有者可以把草稿标记为可发布' });
    cleanup();

    await as('owner');
    renderApp(`/publish/batch?batch=${batch.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '发布这 1 件' }, { timeout: 5000 }));
    const confirm = await screen.findByRole('dialog', { name: '确认一次发布 1 件？' });
    fireEvent.click(within(confirm).getByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('已发布 1 件')).toBeTruthy();
    expect(storedDraft(draft.id).status).toBe('PUBLISHED');
  });
});

describe('b. 需求匹配「新建订阅」（与小程序 DemandForm 相同）', () => {
  it('没有订阅时也能新建：表单校验原话；创建成功 / 已有相同条件（EXISTING）/ 重新启用（REACTIVATED）三种结果的文案；axe 通过', async () => {
    await user('buyer');
    const create = vi.spyOn(api, 'createDemandSubscription');
    const { baseElement } = renderApp('/demands?tab=subscriptions');
    expect(await screen.findByText('还没有订阅。', undefined, { timeout: 5000 })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: '新建订阅' });
    fireEvent.click(trigger);
    let dialog = await screen.findByRole('dialog', { name: '订阅一个需求' });
    expect(dialog.textContent).toContain('有新商品符合条件时，会出现在「需求匹配」里。不会发短信、微信或系统通知。');
    expect(within(dialog).getByRole('list', { name: '订阅说明' }).textContent).toContain('只匹配之后新发布或新编辑的商品，不回查已有商品。');
    expect((within(dialog).getByLabelText('关键词') as HTMLInputElement).value).toBe('');
    expect(within(dialog).getByRole('combobox', { name: '地理范围' }).textContent).toContain('全校');
    expect(await axeViolations(baseElement)).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('请至少填写关键词或选择分类');
    fireEvent.change(within(dialog).getByLabelText('关键词'), { target: { value: '护眼台灯' } });
    fireEvent.change(within(dialog).getByLabelText('最低价（选填）'), { target: { value: '80' } });
    fireEvent.change(within(dialog).getByLabelText('最高价（选填）'), { target: { value: '20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('最低价不能高于最高价'));
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('最高价（选填）'), { target: { value: '120' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    expect(await screen.findByText('订阅成功，有匹配的新商品时会出现在「需求匹配」里')).toBeTruthy();
    expect(create).toHaveBeenLastCalledWith({ keyword: '护眼台灯', category: null, minPrice: 80, maxPrice: 120, geoScope: 'SCHOOL', campusId: null, buildingId: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const list = await screen.findByRole('list', { name: '我的订阅' });
    expect(list.textContent).toContain('关键词「护眼台灯」');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    // 相同条件再订阅一次：EXISTING，不重复创建
    fireEvent.click(trigger);
    dialog = await screen.findByRole('dialog', { name: '订阅一个需求' });
    fireEvent.change(within(dialog).getByLabelText('关键词'), { target: { value: '护眼台灯' } });
    fireEvent.change(within(dialog).getByLabelText('最低价（选填）'), { target: { value: '80' } });
    fireEvent.change(within(dialog).getByLabelText('最高价（选填）'), { target: { value: '120' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    expect(await screen.findByText('你已经订阅过相同条件，没有重复创建')).toBeTruthy();
    expect(await create.mock.results[1].value).toMatchObject({ outcome: 'EXISTING' });
    expect((await api.listDemandSubscriptions())).toHaveLength(1);

    // 停用后再订阅相同条件：REACTIVATED，重新启用原来那条
    fireEvent.click(await screen.findByRole('checkbox', { name: /^停用订阅：/ }));
    expect(await screen.findByText(/已停用/)).toBeTruthy();
    fireEvent.click(trigger);
    dialog = await screen.findByRole('dialog', { name: '订阅一个需求' });
    fireEvent.change(within(dialog).getByLabelText('关键词'), { target: { value: '护眼台灯' } });
    fireEvent.change(within(dialog).getByLabelText('最低价（选填）'), { target: { value: '80' } });
    fireEvent.change(within(dialog).getByLabelText('最高价（选填）'), { target: { value: '120' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    await waitFor(async () => expect(await create.mock.results[2]?.value).toMatchObject({ outcome: 'REACTIVATED' }));
    expect(await screen.findAllByText('订阅成功，有匹配的新商品时会出现在「需求匹配」里')).not.toHaveLength(0);
    const subs = await api.listDemandSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].active).toBe(true);
    await waitFor(() => expect(screen.getByRole('list', { name: '我的订阅' }).textContent).not.toContain('已停用'));
  });

  it('服务端拒绝（例如启用订阅已达上限）：原话显示在表单里并与提交按钮关联，表单内容保留；结果文案与小程序逐字一致', async () => {
    await user('buyer');
    vi.spyOn(api, 'createDemandSubscription').mockRejectedValueOnce(new ApiError({ code: 400, message: '最多同时启用 50 条订阅，请先停用不需要的订阅' }));
    renderApp('/demands?tab=subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: '新建订阅' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '订阅一个需求' });
    fireEvent.change(within(dialog).getByLabelText('关键词'), { target: { value: '自行车' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认订阅' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe('最多同时启用 50 条订阅，请先停用不需要的订阅');
    expect(within(dialog).getByRole('button', { name: '确认订阅' }).getAttribute('aria-describedby')).toBe(alert.id);
    expect((within(dialog).getByLabelText('关键词') as HTMLInputElement).value).toBe('自行车');
    expect(await api.listDemandSubscriptions()).toEqual([]);
    expect(subscribeResultText('CREATED')).toBe('订阅成功，有匹配的新商品时会出现在「需求匹配」里');
    expect(subscribeResultText('REACTIVATED')).toBe('订阅成功，有匹配的新商品时会出现在「需求匹配」里');
    expect(subscribeResultText('EXISTING')).toBe('你已经订阅过相同条件，没有重复创建');
  });
});

describe('c. 商品留言：回复也可以举报（与小程序 CommentBoard 相同）', () => {
  it('别人的回复显示「举报回复」，举报对象是这条回复；自己的回复没有举报入口；回复时提交按钮写「回复」；axe 通过', async () => {
    await user('seller');
    const product = await api.createProduct(listing('留言举报台灯'));
    await user('asker');
    const top = await api.addComment({ productId: product.id, content: '还在吗？' });
    await as('seller');
    const reply = await api.addComment({ productId: product.id, content: '还在的，欢迎来看', parentId: top.id });
    await user('viewer');
    const report = vi.spyOn(api, 'createModerationReport');
    const view = renderApp(`/product/${product.id}`);
    expect(await screen.findByText('还在的，欢迎来看', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '举报留言' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '举报回复' }));
    const dialog = await screen.findByRole('dialog', { name: '举报留言' });
    expect(dialog.textContent).toContain('举报对象：seller的回复');
    fireEvent.click(within(dialog).getByLabelText('骚扰或辱骂'));
    fireEvent.click(within(dialog).getByRole('button', { name: '提交举报' }));
    expect(await within(dialog).findByText(/已收到举报/)).toBeTruthy();
    expect(report).toHaveBeenCalledWith({ targetType: 'COMMENT', targetId: reply.id, reasonCode: 'HARASSMENT' });
    expect((await api.listMyModerationReports()).map((r) => [r.targetType, r.targetId])).toEqual([['COMMENT', reply.id]]);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // 回复：提交按钮随之写「回复」，发出的是这条留言下的回复
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    const box = await screen.findByPlaceholderText('回复 @asker');
    const buttons = screen.getAllByRole('button', { name: '回复' });
    expect(buttons.length).toBe(2);
    fireEvent.change(box, { target: { value: '周末方便看实物吗' } });
    fireEvent.click(buttons[0]);
    await waitFor(async () => expect((await api.listComments(product.id)).find((c) => c.content === '周末方便看实物吗')?.parentId).toBe(top.id));
    expect(await screen.findByText('周末方便看实物吗')).toBeTruthy();
    expect(screen.getByRole('button', { name: '留言' })).toBeTruthy();
    expect(await axeViolations(view.container)).toEqual([]);
    view.unmount();

    // 回复的作者看不到自己回复上的举报入口
    await as('seller');
    renderApp(`/product/${product.id}`);
    expect(await screen.findByText('还在的，欢迎来看', undefined, { timeout: 5000 })).toBeTruthy();
    // 只剩 viewer 的那条回复可以举报
    expect(screen.getAllByRole('button', { name: '举报回复' })).toHaveLength(1);
  });

  it('被隐藏的回复不显示举报入口', async () => {
    await user('seller');
    const product = await api.createProduct(listing('隐藏回复台灯'));
    await user('asker');
    const top = await api.addComment({ productId: product.id, content: '能便宜点吗' });
    await as('seller');
    await api.addComment({ productId: product.id, content: '不议价', parentId: top.id });
    vi.spyOn(api, 'listComments').mockImplementation(async () => [
      { id: 'c-reply', productId: product.id, userId: 'someone', content: '', parentId: top.id, createdAt: Date.now(), moderationHidden: true, hiddenForAuthor: false },
      { ...top },
    ]);
    await user('viewer');
    renderApp(`/product/${product.id}`);
    expect(await screen.findByText('该回复已被平台隐藏。', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '举报回复' })).toBeNull();
  });
});

describe('d. 商品详情「私信卖家」（与小程序相同的入口）', () => {
  it('买家点「私信卖家」进入这件商品的会话：只有买家快捷消息，没有文字输入框', async () => {
    await user('seller');
    const product = await api.createProduct(listing('私信入口台灯'));
    await user('buyer');
    renderApp(`/product/${product.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '私信卖家' }, { timeout: 5000 }));
    const quick = await screen.findByRole('list', { name: '可发送的快捷消息' }, { timeout: 5000 });
    expect(lastPath).toMatch(/^\/messages\/.+/);
    expect(quick.textContent).toContain('你好，这件还在吗？');
    expect(quick.textContent).not.toContain('不好意思，已经出了。');
    expect(screen.queryByRole('textbox', { name: '输入消息' })).toBeNull();
    expect(screen.queryByRole('button', { name: '站内留言' })).toBeNull();
  });
});
