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
import type { ProductCreateInput } from './api/contracts';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';

/**
 * 模块 6 界面：懒加载的圈子各页、发布页的可见范围选择、退出确认、邀请码只显示一次、成员管理的焦点。
 * axe 只覆盖结构性规则，不等于 WCAG 合规；键盘测试在 jsdom 中用焦点与按键事件模拟。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
let lastPath = '';
function PathProbe() {
  const location = useLocation();
  lastPath = `${location.pathname}${location.search}${location.hash}`;
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
  const session = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return session.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
function product(title: string, extra: Partial<ProductCreateInput> = {}): ProductCreateInput {
  return {
    title, description: '圈子界面测试', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000', inspection: fullDisclosure('生活用品')!, ...extra,
  } as ProductCreateInput;
}
async function circleWith(owner: string, members: string[], name: string) {
  await as(owner);
  const circle = await api.createCircle({ type: 'CLUB', name });
  for (const m of members) {
    await as(owner);
    const { token } = await api.createCircleInvite(circle.id);
    await as(m);
    await api.redeemCircleInvite(token);
  }
  return circle.id;
}
function allStorage(): string {
  const dump: string[] = [];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) dump.push(store.getItem(store.key(i)!) ?? '');
  }
  return dump.join('\n');
}

describe('6 圈子页面', () => {
  it('我的圈子：已加入与可发现分开；可发现的圈子没有「申请加入」，只提示需要邀请码；axe 通过', async () => {
    await user('owner'); await user('viewer');
    await circleWith('owner', ['viewer'], '已加入的社团');
    await as('owner');
    await api.createCircle({ type: 'INTEREST', name: '可发现的兴趣组', visibility: 'DISCOVERABLE' });
    await as('viewer');
    const { container } = renderApp('/circles');
    const mine = await screen.findByRole('region', { name: '已加入' }, { timeout: 5000 });
    expect(await within(mine).findByRole('link', { name: '已加入的社团' })).toBeTruthy();
    const discover = await screen.findByRole('list', { name: '可发现的圈子' });
    expect(within(discover).getByText('可发现的兴趣组')).toBeTruthy();
    expect(within(discover).getByText(/需要邀请码加入/)).toBeTruthy();
    expect(within(discover).queryByRole('button', { name: /加入/ })).toBeNull();
    expect(container.textContent).not.toMatch(/官方认证的|已认证|学校认证/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('创建圈子：空提交时错误摘要获得焦点，点击条目把焦点带到字段；写明「用户创建的圈子，未经学校核实」；成功后进入详情；axe 通过', async () => {
    await user('owner');
    const { container } = renderApp('/circles/new');
    expect(await screen.findByText(/用户创建的圈子，未经学校核实/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/官方认证|学校认证|已认证/);
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    const summary = await screen.findByText(/创建前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '圈子名称需要 2～30 个字' }));
    expect(document.activeElement).toBe(screen.getByLabelText(/圈子名称/));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /圈子类型/ }));
    fireEvent.click(await screen.findByRole('option', { name: '班级' }));
    fireEvent.change(screen.getByLabelText(/圈子名称/), { target: { value: '软件工程二班' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('heading', { name: '软件工程二班' })).toBeTruthy();
    expect(lastPath).toMatch(/^\/circles\/circle_[^?#]+$/);
    expect(lastPath).not.toContain(encodeURIComponent('软件工程二班'));
  });

  it('圈子详情：退出确认写明三条后果；Esc 关闭后焦点回到「退出圈子」；确认后回到我的圈子，订阅停用；axe（含对话框）通过', async () => {
    await user('owner'); const memberId = await user('member');
    const id = await circleWith('owner', ['member'], '要退出的圈子');
    await as('member');
    const sub = (await api.createDemandSubscription({ keyword: '台灯', circleId: id })).subscription;
    const { container } = renderApp(`/circles/${id}`);
    const leave = await screen.findByRole('button', { name: '退出圈子' }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
    leave.focus();
    fireEvent.click(leave);
    const dialog = await screen.findByRole('dialog', { name: '退出「要退出的圈子」？' });
    expect(dialog.textContent).toContain('圈子订阅将停用');
    expect(dialog.textContent).toContain('私密商品将不可见');
    expect(dialog.textContent).toContain('已经成立的订单不受影响');
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '退出圈子' })));
    fireEvent.click(screen.getByRole('button', { name: '退出圈子' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认退出' }));
    await waitFor(() => expect(lastPath).toBe('/circles'));
    const stored = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    expect(stored.circleMemberships.find((m: { userId: string }) => m.userId === memberId).status).toBe('LEFT');
    expect(stored.demandSubscriptions.find((s: { id: string }) => s.id === sub.id).active).toBe(false);
  });

  it('圈子订阅：对话框写明圈子名称、不提供地理范围；提交后订阅绑定该圈子', async () => {
    await user('owner'); await user('member');
    const id = await circleWith('owner', ['member'], '数码交换群');
    await as('member');
    renderApp(`/circles/${id}`);
    fireEvent.click(await screen.findByRole('button', { name: '订阅圈子新商品' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '订阅圈子新商品' });
    expect(dialog.textContent).toContain('圈子「数码交换群」');
    expect(within(dialog).queryByRole('combobox', { name: '地理范围' })).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('关键词'), { target: { value: '耳机' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '订阅' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const subs = await api.listDemandSubscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ keyword: '耳机', geoScope: 'SCHOOL', circle: { id, name: '数码交换群' } });
  });

  it('非成员打开私密圈子：与不存在相同的提示，不显示圈子名', async () => {
    await user('owner'); await user('outsider');
    const id = await circleWith('owner', [], '外人看不到的名字');
    await as('outsider');
    const { container } = renderApp(`/circles/${id}`);
    expect(await screen.findByRole('heading', { name: '圈子不存在或你没有权限查看' }, { timeout: 5000 })).toBeTruthy();
    expect(container.textContent).not.toContain('外人看不到的名字');
    cleanup();
    renderApp('/circles/circle_missing');
    expect(await screen.findByRole('heading', { name: '圈子不存在或你没有权限查看' }, { timeout: 5000 })).toBeTruthy();
  });

  it('圈子商品流：只有成员能看到；卡片标出「圈子可见 · 圈子名」；非成员首页没有这件商品也没有圈子名；axe 通过', async () => {
    await user('seller'); await user('member'); await user('outsider');
    const id = await circleWith('seller', ['member'], '二手书小组');
    await as('seller');
    await api.createProduct(product('只给小组看的台灯', { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    await as('member');
    const { container } = renderApp(`/circles/${id}/products`);
    expect(await screen.findByText('只给小组看的台灯', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('圈子可见 · 二手书小组')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    cleanup();
    await as('outsider');
    const home = renderApp('/');
    await screen.findAllByRole('link', undefined, { timeout: 5000 });
    await waitFor(() => expect(home.container.textContent).not.toContain('只给小组看的台灯'));
    expect(home.container.textContent).not.toContain('二手书小组');
  });
});

describe('6 圈子管理', () => {
  it('邀请码只显示一次：生成后显示并获得焦点，链接放在 # 之后；离开再回来不再显示；存储里没有原文；axe 通过', async () => {
    await user('owner');
    const id = await circleWith('owner', [], '邀请测试圈');
    const first = renderApp(`/circles/${id}/manage`);
    fireEvent.click(await screen.findByRole('button', { name: '生成邀请码' }, { timeout: 5000 }));
    const token = (await screen.findByTestId('circle-invite-token')).textContent!;
    expect(token.length).toBeGreaterThanOrEqual(20);
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('created-token-title'));
    expect(first.container.textContent).toContain(`/circles/join#code=${token}`);
    expect(first.container.textContent).not.toContain(`?code=${token}`);
    expect(await axeViolations(first.container)).toEqual([]);
    expect(allStorage()).not.toContain(token);
    first.unmount();
    const second = renderApp(`/circles/${id}/manage`);
    await screen.findByRole('list', { name: '邀请码记录' }, { timeout: 5000 });
    expect(second.container.textContent).not.toContain(token);
    expect(screen.queryByTestId('circle-invite-token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /撤销 .* 生成的邀请码/ }));
    expect(await screen.findByText(/已撤销/)).toBeTruthy();
  });

  it('成员操作菜单可用键盘：打开后方向键移动、回车执行；焦点回到原来的「操作」按钮；移出后焦点到成员列表标题', async () => {
    await user('owner'); const aId = await user('alice'); await user('bob');
    const id = await circleWith('owner', ['alice', 'bob'], '键盘管理圈');
    await as('owner');
    const { container } = renderApp(`/circles/${id}/manage`);
    const trigger = await screen.findByRole('button', { name: '管理成员 alice' }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
    trigger.focus();
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['设为管理员', '转让所有者', '移出圈子']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'Enter' });
    await screen.findByText('已把 alice 设为管理员');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '管理成员 alice' })));
    expect((await api.listCircleMembers(id)).items.find((m) => m.userId === aId)?.role).toBe('MODERATOR');

    fireEvent.click(screen.getByRole('button', { name: '管理成员 bob' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '移出圈子' }));
    const dialog = await screen.findByRole('dialog', { name: '把 bob 移出圈子？' });
    expect(dialog.textContent).toContain('已经成立的订单不受影响');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }));
    await screen.findByText('已移除 bob');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '成员（2）' })));
  });

  it('普通成员打开管理页：与无权相同的提示，不渲染成员列表', async () => {
    await user('owner'); await user('member');
    const id = await circleWith('owner', ['member'], '只读成员圈');
    await as('member');
    renderApp(`/circles/${id}/manage`);
    expect(await screen.findByRole('heading', { name: '圈子不存在或你没有权限管理' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('list', { name: '成员列表' })).toBeNull();
  });
});

describe('6 邀请兑换', () => {
  it('链接 # 里的邀请码：读取后立刻从地址栏抹掉、只放进请求体；兑换后进入圈子详情；axe 通过', async () => {
    await user('owner'); await user('joiner');
    const id = await circleWith('owner', [], '链接加入的圈子');
    await as('owner');
    const { token } = await api.createCircleInvite(id);
    await as('joiner');
    window.history.replaceState(null, '', `/circles/join#code=${token}`);
    const redeem = vi.spyOn(api, 'redeemCircleInvite');
    const { container } = renderApp('/circles/join');
    const input = await screen.findByRole('textbox', { name: '邀请码' }, { timeout: 5000 }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(token));
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(token);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(await screen.findByRole('heading', { name: '链接加入的圈子' })).toBeTruthy();
    expect(redeem).toHaveBeenCalledWith(token);
    expect(lastPath).toBe(`/circles/${id}`);
    expect(allStorage()).not.toContain(token);
  });

  it('无效邀请码：统一提示，不透露圈子是否存在', async () => {
    await user('joiner');
    renderApp('/circles/join');
    fireEvent.change(await screen.findByRole('textbox', { name: '邀请码' }, { timeout: 5000 }), { target: { value: 'x'.repeat(43) } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(await screen.findByText(/邀请码无效或已失效/)).toBeTruthy();
  });
});

describe('6 发布时选择可见范围', () => {
  it('默认全校公开；键盘切到「圈子可见」后出现我的圈子多选，写明谁能看到；最多 5 个；未选圈子提交会进错误摘要；axe 通过', async () => {
    await user('seller');
    const ids: string[] = [];
    for (let i = 1; i <= 6; i += 1) ids.push(await circleWith('seller', [], `发布圈${i}`));
    const { container } = renderApp('/publish');
    const pub = await screen.findByRole('button', { name: '全校公开' }, { timeout: 5000 });
    const circleOnly = screen.getByRole('button', { name: '圈子可见' });
    expect(pub.getAttribute('aria-pressed')).toBe('true');
    expect(circleOnly.getAttribute('aria-pressed')).toBe('false');
    // 6.1A 起「公开」是本校公开：访客与他校同学看不到
    expect(screen.getByText(/本校登录的同学都能看到（未登录的访客与他校同学看不到）/)).toBeTruthy();
    circleOnly.focus();
    expect(document.activeElement).toBe(circleOnly);
    fireEvent.click(circleOnly);
    expect(circleOnly.getAttribute('aria-pressed')).toBe('true');
    const group = await screen.findByRole('group', { name: /选择圈子/ });
    const boxes = await within(group).findAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    expect(boxes.some((b) => (b as HTMLInputElement).checked)).toBe(false);
    for (const box of boxes.slice(0, 5)) { box.focus(); fireEvent.click(box) }
    expect((boxes[5] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/只有「发布圈1」「发布圈2」「发布圈3」「发布圈4」「发布圈5」的在籍成员和你自己能看到/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    for (const box of boxes.slice(0, 5)) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    const summaryEntry = await screen.findByRole('button', { name: '圈子可见需要至少选择一个圈子' });
    fireEvent.click(summaryEntry);
    expect(document.activeElement?.id).toBe('product-form-visibility');
  });

  it('选圈发布后：卖家看到圈子标签，商品只写入所选圈子；没有圈子时给出创建 / 加入的入口', async () => {
    await user('lonely');
    renderApp('/publish');
    fireEvent.click(await screen.findByRole('button', { name: '圈子可见' }, { timeout: 5000 }));
    expect(await screen.findByRole('link', { name: '创建或加入圈子' })).toBeTruthy();
    cleanup();

    await user('seller');
    const id = await circleWith('seller', [], '唯一的圈');
    const create = vi.spyOn(api, 'createProduct');
    renderApp('/publish');
    fireEvent.change(await screen.findByLabelText(/商品标题/, undefined, { timeout: 5000 }), { target: { value: '圈子里的键盘' } });
    fireEvent.change(screen.getByLabelText(/商品描述/), { target: { value: '机械键盘，九成新，送键帽' } });
    fireEvent.change(screen.getByLabelText(/出售价格/), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '选择图片 1' }));
    fireEvent.click(screen.getByRole('button', { name: '圈子可见' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /唯一的圈/ }));
    // 数码电子默认分类：逐项声明验货清单
    await screen.findByRole('heading', { name: /验货清单/ });
    for (const group of screen.getAllByRole('radiogroup')) {
      const first = within(group).getAllByRole('radio')[0];
      fireEvent.click(first);
    }
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ visibility: 'CIRCLE_ONLY', circleIds: [id] });
    const detail = await screen.findByRole('region', { name: '圈子可见' }, { timeout: 5000 });
    expect(within(detail).getByRole('link', { name: '唯一的圈' })).toBeTruthy();
    expect(lastPath).not.toContain(encodeURIComponent('唯一的圈'));
  });
});

describe('6 批量工作台与协助页的可见范围', () => {
  it('所有者在工作台逐件选择可见范围，保存进草稿；检查全部时逐项显示 INVALID_CIRCLE；协助人看不到可见范围选择', async () => {
    await user('owner');
    const id = await circleWith('owner', [], '工作台圈');
    const base = product('工作台的圈子商品') as unknown as Record<string, unknown>;
    const good = await api.createListingDraft({ payload: base });
    const bad = await api.createListingDraft({ payload: { ...base, title: '圈子已失效的一件', visibility: 'CIRCLE_ONLY', circleIds: ['circle_gone'] } });
    const batch = await api.createListingBatch({ draftIds: [good.id, bad.id] });
    const { container } = renderApp(`/publish/batch?batch=${batch.id}`);
    const first = await screen.findByRole('region', { name: /第 1 件/ }, { timeout: 5000 });
    const firstPicker = within(first).getByRole('region', { name: '谁能看到这件商品' });
    expect(within(firstPicker).getByRole('button', { name: '全校公开' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(firstPicker).getByRole('button', { name: '圈子可见' }));
    fireEvent.click(await within(firstPicker).findByRole('checkbox', { name: /工作台圈/ }));
    fireEvent.click(within(first).getByRole('button', { name: '保存这件' }));
    expect(await within(first).findByText('第 1 件已保存')).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!).listingDrafts.find((d: { id: string }) => d.id === good.id);
    expect(saved.payload).toMatchObject({ visibility: 'CIRCLE_ONLY', circleIds: [id] });
    fireEvent.click(screen.getByRole('button', { name: '检查全部' }));
    expect(await screen.findByRole('button', { name: /第 2 件：圈子可见范围有误/ })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    cleanup();

    const { token } = await api.createAssistInvite({ draftId: good.id });
    await user('helper');
    window.history.replaceState(null, '', `/assist#code=${token}`);
    renderApp('/assist');
    const input = await screen.findByRole('textbox', { name: '邀请码' }, { timeout: 5000 }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(token));
    fireEvent.click(screen.getByRole('button', { name: '兑换' }));
    fireEvent.click(await screen.findByRole('button', { name: /工作台的圈子商品/ }));
    const editor = await screen.findByRole('region', { name: '协助整理' });
    expect(within(editor).queryByRole('region', { name: '谁能看到这件商品' })).toBeNull();
    expect(within(editor).queryByRole('button', { name: '圈子可见' })).toBeNull();
    expect(editor.textContent).not.toContain('工作台圈');
  });
});
