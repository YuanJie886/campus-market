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
import { axeViolations } from './test-axe';
import { clearPendingInvite, holdPendingInvite, peekPendingInvite } from './utils/pendingInvite';

/**
 * 模块 6.1B：未登录打开 /circles/join#code=… → 登录 → 回到邀请页并自动填入 → 用户确认后才加入。
 * 邀请码只在页面内存里：地址栏立即清除，不写 Web Storage / Cookie / 日志；刷新后不恢复；两个标签页不互相传播；
 * 登录失败、离开登录流程、退出登录都清除；错误邀请码仍是统一 404，且照常限流。
 */

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
const rnd = () => Math.random().toString(36).slice(2, 10);
let owner = '';
let joiner = '';
let token = '';
let circleId = '';

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearPendingInvite();
  api = new MockCampusMarketApi();
  owner = `owner-${rnd()}`;
  joiner = `joiner-${rnd()}`;
  await api.register({ account: owner, password: 'test-password', nickname: '圈主', campus: '东校区', contact: '1' });
  const circle = await api.createCircle({ type: 'CLUB', name: '登录后加入的圈子' });
  circleId = circle.id;
  token = (await api.createCircleInvite(circle.id)).token;
  await api.register({ account: joiner, password: 'test-password', nickname: '新同学', campus: '东校区', contact: '1' });
  await api.logout();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') });

function everything(): string {
  const parts: string[] = [document.cookie, window.location.href];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) parts.push(store.key(i) ?? '', store.getItem(store.key(i)!) ?? '');
  }
  return parts.join('\n');
}

async function login(account: string, password = 'test-password') {
  fireEvent.change(await screen.findByLabelText(/学号 \/ 手机号/, undefined, { timeout: 5000 }), { target: { value: account } });
  fireEvent.change(screen.getByLabelText(/密码/), { target: { value: password } });
  const form = screen.getByLabelText(/密码/).closest('div.flex')!;
  fireEvent.click(within(form.parentElement!).getAllByRole('button', { name: '登录' })[0]);
}

describe('6.1B 邀请登录连续性', () => {
  it('未登录邀请 → 地址栏立即清除 → 去登录 → 回到邀请页自动填入 → 点击确认后才加入；全程不进存储、Cookie 或地址栏；axe 通过', async () => {
    const log = vi.spyOn(console, 'log');
    const info = vi.spyOn(console, 'info');
    window.history.replaceState(null, '', `/circles/join#code=${token}`);
    const { container } = renderApp('/circles/join');
    expect(await screen.findByText(/已收到邀请码/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(everything()).not.toContain(token);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: '去登录' }));
    await waitFor(() => expect(lastPath).toBe('/login'));
    expect(screen.getByText(/登录后会回到圈子邀请页，由你确认是否加入/)).toBeTruthy();
    await login(joiner);
    await waitFor(() => expect(lastPath).toBe('/circles/join'));
    const input = await screen.findByRole('textbox', { name: '邀请码' }) as HTMLInputElement;
    expect(input.value).toBe(token);
    // 登录本身不会加入圈子：只有圈主一名成员
    const memberships = () => JSON.parse(window.localStorage.getItem('campus_market_mock_database_v1')!).circleMemberships.filter((m: { circleId: string }) => m.circleId === circleId);
    expect(memberships()).toHaveLength(1);
    expect(everything()).not.toContain(token);

    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(await screen.findByRole('heading', { name: '登录后加入的圈子' }, { timeout: 5000 })).toBeTruthy();
    expect(memberships()).toHaveLength(2);
    expect(peekPendingInvite()).toBeNull();
    expect(everything()).not.toContain(token);
    for (const spy of [log, info]) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(token);
  });

  it('登录失败时清除内存里的邀请码并如实提示；离开登录流程也会清除', async () => {
    window.history.replaceState(null, '', `/circles/join#code=${token}`);
    renderApp('/circles/join');
    fireEvent.click(await screen.findByRole('button', { name: '去登录' }, { timeout: 5000 }));
    await login(joiner, 'wrong-password');
    expect(await screen.findByText(/刚才的圈子邀请码已清除/)).toBeTruthy();
    expect(peekPendingInvite()).toBeNull();
    cleanup();

    holdPendingInvite(token);
    renderApp('/');
    await waitFor(() => expect(peekPendingInvite()).toBeNull());
  });

  it('退出登录时清除；刷新（模块重新装载）后不恢复；另一个标签页（独立的页面进程）拿不到', async () => {
    await api.login({ account: joiner, password: 'test-password' });
    holdPendingInvite(token);
    renderApp('/circles/join');
    const input = await screen.findByRole('textbox', { name: '邀请码' }, { timeout: 5000 }) as HTMLInputElement;
    expect(input.value).toBe(token);
    cleanup();
    renderApp('/profile');
    // 进入资料页本身就已离开登录流程
    await waitFor(() => expect(peekPendingInvite()).toBeNull());
    holdPendingInvite(token);
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }, { timeout: 5000 }));
    await waitFor(() => expect(peekPendingInvite()).toBeNull());

    holdPendingInvite(token);
    vi.resetModules();
    const fresh = await import('./utils/pendingInvite');
    expect(fresh.peekPendingInvite()).toBeNull();
    expect(everything()).not.toContain(token);
  });

  it('错误的邀请码仍是统一的 404 提示；多次尝试照常限流（429 给出等待时间）', async () => {
    await api.login({ account: joiner, password: 'test-password' });
    renderApp('/circles/join');
    const input = await screen.findByRole('textbox', { name: '邀请码' }, { timeout: 5000 });
    fireEvent.change(input, { target: { value: 'x'.repeat(43) } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(await screen.findByText(/邀请码无效或已失效/)).toBeTruthy();
    for (let i = 0; i < 10; i += 1) await api.redeemCircleInvite(`guess-${i}-${'y'.repeat(30)}`).catch(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    expect(await screen.findByText(/秒/)).toBeTruthy();
  });
});
