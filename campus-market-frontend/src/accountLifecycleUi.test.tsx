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
import { PASSWORD_RESET_FAILURE } from './api/contracts';
import DemoResetCodeIssuer from './components/demo/DemoResetCodeIssuer';
import { DELETION_CONSEQUENCES } from './pages/profile/AccountSecurityPage';
import { axeViolations } from './test-axe';

/**
 * 阶段 3 账号生命周期界面（docs/account-lifecycle.md）：登录页「忘记密码？」、凭重置码找回、个人中心「账号与安全」里的
 * 修改密码与注销。全部基于 Mock 适配层的真实行为（与后端 AccountService 同样的规则与原话），断言用户能看到、能操作的结果。
 */

const DB = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
let lastPath = '';
function PathProbe() { lastPath = useLocation().pathname; return null }
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App /><PathProbe />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
const ids = new Map<string, string>();
const PASSWORD = 'test-password';
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: PASSWORD, nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  ids.set(label, s.user.id);
  return s.user.id;
}
const as = (label: string, password = PASSWORD) => api.login({ account: accounts.get(label)!, password });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
/** 页面内联的错误：服务端原话原样出现（REST / Mock 的错误会在后面附上可复制的错误编号） */
const alertWith = (text: string) => waitFor(() => {
  const found = screen.getAllByRole('alert').find((el) => el.textContent?.includes(text));
  expect(found, text).toBeTruthy();
  return found!;
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('找回密码（公开页）', () => {
  it('登录页有「忘记密码？」入口；找回页说明重置码由学校工作人员线下签发、格式与有效期；axe 通过', async () => {
    renderApp('/login');
    fireEvent.click(await screen.findByRole('link', { name: '忘记密码？' }));
    expect(await screen.findByRole('heading', { name: '找回密码' })).toBeTruthy();
    expect(lastPath).toBe('/password-reset');
    expect(screen.getByText(/请带上学生证等身份证明联系本校平台工作人员（学校管理员），核对身份后会给你一个一次性重置码/)).toBeTruthy();
    expect(screen.getByText(/重置码格式为 XXXX-XXXX-XXXX，30 分钟内有效，输错 5 次作废/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^重置码/ })).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('错误的重置码与不存在的账号：原样显示统一的「账号或重置码无效或已过期」', async () => {
    await user('forgetful');
    await api.logout();
    renderApp('/password-reset');
    type(await screen.findByLabelText(/学号 \/ 手机号/), accounts.get('forgetful')!);
    type(screen.getByRole('textbox', { name: /^重置码/ }), 'AAAA-BBBB-CCCC');
    type(screen.getByLabelText(/^新密码/), 'brand-new-pass');
    type(screen.getByLabelText(/确认新密码/), 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    expect((await alertWith(PASSWORD_RESET_FAILURE)).textContent).toContain(PASSWORD_RESET_FAILURE);
    type(screen.getByLabelText(/学号 \/ 手机号/), 'nobody-at-all');
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes(PASSWORD_RESET_FAILURE))).toBe(true));
  });

  it('新密码太短或两次不一致：本地先提示，不发请求', async () => {
    const spy = vi.spyOn(api, 'resetPasswordWithCode');
    renderApp('/password-reset');
    type(await screen.findByLabelText(/学号 \/ 手机号/), 'someone');
    type(screen.getByRole('textbox', { name: /^重置码/ }), 'AAAA-BBBB-CCCC');
    type(screen.getByLabelText(/^新密码/), 'short');
    type(screen.getByLabelText(/确认新密码/), 'short');
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    expect(await alertWith('新密码需要 8～72 位')).toBeTruthy();
    type(screen.getByLabelText(/^新密码/), 'long-enough-1');
    type(screen.getByLabelText(/确认新密码/), 'long-enough-2');
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    expect(await alertWith('两次输入的新密码不一致')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('凭（演示签发的）重置码重置：小写、不带短横线也可以；成功后说明所有设备已退出，新密码可以登录', async () => {
    await user('resetter');
    await api.logout();
    const issued = (await api.demoIssueResetCode(accounts.get('resetter')!))!;
    renderApp('/password-reset');
    type(await screen.findByLabelText(/学号 \/ 手机号/), accounts.get('resetter')!);
    type(screen.getByRole('textbox', { name: /^重置码/ }), issued.code.toLowerCase().replace(/-/g, ''));
    type(screen.getByLabelText(/^新密码/), 'brand-new-pass');
    type(screen.getByLabelText(/确认新密码/), 'brand-new-pass');
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    expect(await screen.findByText('密码已重置，所有设备上的登录都已退出。请用新密码登录。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '去登录' }).getAttribute('href')).toBe('/login');
    expect((await as('resetter', 'brand-new-pass')).user.id).toBe(ids.get('resetter'));
  });

  it('离线演示的签发面板：给出 XXXX-XXXX-XXXX 的演示重置码并回填到找回表单（只在 Mock 构建里懒加载）', async () => {
    await user('demo');
    const filled = vi.fn();
    render(<NotificationProvider><DemoResetCodeIssuer onIssued={filled} /></NotificationProvider>);
    type(screen.getByLabelText('演示账号'), accounts.get('demo')!);
    fireEvent.click(screen.getByRole('button', { name: '签发演示重置码' }));
    const status = await screen.findByText(/演示重置码：[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/);
    expect(status.getAttribute('role')).toBe('status');
    expect(filled).toHaveBeenCalledWith(accounts.get('demo'), expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/));
    expect(document.querySelector('[data-marker="demo-reset-code"]')).toBeTruthy();
  });
});

describe('个人中心 → 账号与安全：修改密码', () => {
  it('个人中心有「账号与安全」标签；当前密码错误时原样显示「当前密码不正确」；axe 通过', async () => {
    await user('changer');
    const { container } = renderApp('/profile');
    fireEvent.click(await screen.findByRole('tab', { name: '账号与安全' }, { timeout: 5000 }));
    const section = await screen.findByRole('region', { name: '修改密码' });
    type(within(section).getByLabelText(/当前密码/), 'not-my-password');
    type(within(section).getByLabelText(/^新密码/), 'brand-new-pass');
    type(within(section).getByLabelText(/确认新密码/), 'brand-new-pass');
    fireEvent.click(within(section).getByRole('button', { name: '修改密码' }));
    expect((await within(section).findByRole('alert')).textContent).toContain('当前密码不正确');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('成功后说明其他设备已退出、当前设备保持登录；旧密码不能再登录', async () => {
    await user('changer');
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '修改密码' }, { timeout: 5000 });
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    type(within(section).getByLabelText(/^新密码/), 'brand-new-pass');
    type(within(section).getByLabelText(/确认新密码/), 'brand-new-pass');
    fireEvent.click(within(section).getByRole('button', { name: '修改密码' }));
    const done = await within(section).findByText(/密码已修改。其他设备上的登录（如果有）已全部退出，需要用新密码重新登录；这台设备保持登录。/);
    expect(done.getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: '用户菜单' })).toBeTruthy();
    expect((await api.getCurrentUser())?.id).toBe(ids.get('changer'));
    await expect(as('changer')).rejects.toMatchObject({ code: 401 });
  });

  it('服务端的 429 原样显示（含等待时间）；其他设备退出的数量来自服务端响应', async () => {
    await user('changer');
    const change = vi.spyOn(api, 'changePassword')
      .mockRejectedValueOnce(new ApiError({ code: 429, message: '请求过于频繁，请稍后再试', retryAfterSeconds: 90 }))
      .mockResolvedValueOnce({ changed: true, otherSessionsEnded: 2 });
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '修改密码' }, { timeout: 5000 });
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    type(within(section).getByLabelText(/^新密码/), 'brand-new-pass');
    type(within(section).getByLabelText(/确认新密码/), 'brand-new-pass');
    fireEvent.click(within(section).getByRole('button', { name: '修改密码' }));
    expect((await within(section).findByRole('alert')).textContent).toBe('请求过于频繁，请稍后再试（约 90 秒后可重试）');
    fireEvent.click(within(section).getByRole('button', { name: '修改密码' }));
    expect(await within(section).findByText(/你在其他设备上的 2 个登录已全部退出/)).toBeTruthy();
    expect(change).toHaveBeenLastCalledWith({ currentPassword: PASSWORD, newPassword: 'brand-new-pass' });
  });
});

describe('个人中心 → 账号与安全：注销', () => {
  it('写明全部后果与保留的记录；没输入「确认注销」与密码前不能提交', async () => {
    await user('leaver');
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '注销账号' }, { timeout: 5000 });
    for (const line of DELETION_CONSEQUENCES) expect(section.textContent).toContain(line);
    for (const phrase of ['在售的商品全部下架', '联系方式被清除', '联系申请自动撤回', '退出加入的所有圈子', '上传的图片全部删除', '治理案件、举报、处理与限制记录', '已注销用户', '注销不能撤销']) {
      expect(section.textContent).toContain(phrase);
    }
    const submit = within(section).getByRole('button', { name: '注销账号' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    type(within(section).getByLabelText(/请输入「确认注销」/), '确认');
    expect(submit.disabled).toBe(true);
    type(within(section).getByLabelText(/请输入「确认注销」/), '确认注销');
    expect(submit.disabled).toBe(false);
  });

  it('仍是在用圈子的所有者：原样显示 409 的原话，账号保持登录', async () => {
    await user('owner');
    await api.createCircle({ type: 'CLUB', name: '还没移交的社团' });
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '注销账号' }, { timeout: 5000 });
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    type(within(section).getByLabelText(/请输入「确认注销」/), '确认注销');
    fireEvent.click(within(section).getByRole('button', { name: '注销账号' }));
    expect((await within(section).findByRole('alert')).textContent).toContain('你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销');
    expect((await api.getCurrentUser())?.id).toBe(ids.get('owner'));
  });

  it('仍是工作人员：原样显示 409；密码不正确：原样显示 400', async () => {
    const id = await user('staffer');
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    raw.staffMembers.push({ userId: id, schoolId: 'pilot', role: 'MODERATOR', active: true, createdAt: Date.now() });
    window.localStorage.setItem(DB, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    setApiClient(api);
    await as('staffer');
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '注销账号' }, { timeout: 5000 });
    type(within(section).getByLabelText(/当前密码/), 'wrong-password');
    type(within(section).getByLabelText(/请输入「确认注销」/), '确认注销');
    fireEvent.click(within(section).getByRole('button', { name: '注销账号' }));
    expect((await within(section).findByRole('alert')).textContent).toContain('密码不正确');
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    fireEvent.click(within(section).getByRole('button', { name: '注销账号' }));
    await waitFor(() => expect(within(section).getByRole('alert').textContent).toContain('你仍有后台工作人员权限，请先请学校管理员停用后再注销'));
  });

  it('成功：清除本页登录态并回到首页；商品下架、资料匿名化；原账号与密码不能再登录', async () => {
    await user('leaver');
    const product = await api.createProduct({ title: '注销前在售的商品', description: '注销后应当自动下架', price: 9, category: '其他', condition: '全新', campus: '东校区', images: ['https://example.invalid/a.png'], contact: '13800000000' });
    renderApp('/profile/security');
    const section = await screen.findByRole('region', { name: '注销账号' }, { timeout: 5000 });
    type(within(section).getByLabelText(/当前密码/), PASSWORD);
    type(within(section).getByLabelText(/请输入「确认注销」/), '确认注销');
    fireEvent.click(within(section).getByRole('button', { name: '注销账号' }));
    await waitFor(() => expect(lastPath).toBe('/'));
    await waitFor(() => expect(screen.queryByRole('button', { name: '用户菜单' })).toBeNull());
    expect(await screen.findByText('账号已注销，所有设备上的登录都已退出')).toBeTruthy();
    expect(await api.getCurrentUser()).toBeNull();
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    expect(raw.market.products.find((p: { id: string }) => p.id === product.id).status).toBe('已下架');
    expect(raw.users.find((u: { id: string }) => u.id === ids.get('leaver')).nickname).toBe('已注销用户');
    await expect(as('leaver')).rejects.toMatchObject({ code: 404 });
  });
});
