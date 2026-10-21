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
import { PRIVACY_POLICY, USER_AGREEMENT, LEGAL_DRAFT_NOTICE, type LegalDocument } from './legal/legalText';
import { CONSENT_REQUIRED } from './pages/RegisterPage';
import { axeViolations } from './test-axe';

/**
 * 用户协议与隐私政策（网页端）：公开页 /terms、/privacy，注册必须勾选同意，登录页与个人中心有入口。全部基于 Mock 适配层。
 */
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
const CONSENT = /^已阅读并同意\s*《用户协议》\s*《隐私政策》$/;
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
/** REWRITTEN：新用户没有默认校区，必须从 /v1/schools 的校区里选择（离线演示只有一所学校，不显示学校选择） */
async function fillRegister(account: string) {
  await screen.findByRole('heading', { name: '注册新账号' }, { timeout: 5000 });
  type(/学号 \/ 手机号/, account);
  type(/^昵称/, '新同学');
  type(/^密码/, 'test-password');
  type(/^确认密码/, 'test-password');
  const campus = await screen.findByRole('combobox', { name: /所在校区/ });
  await waitFor(() => expect(campus.getAttribute('aria-disabled')).not.toBe('true'));
  fireEvent.mouseDown(campus);
  fireEvent.click(await screen.findByRole('option', { name: '东校区' }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
/** 页面正文包含文档的每一节标题与每一段（逐字） */
function expectWholeDocument(scope: HTMLElement, doc: LegalDocument) {
  for (const line of doc.meta) expect(within(scope).getByText(line)).toBeTruthy();
  for (const section of doc.sections) {
    expect(within(scope).getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
    for (const p of section.paragraphs) expect(within(scope).getByText(p)).toBeTruthy();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('公开页 /terms、/privacy', () => {
  it.each([
    ['/terms', USER_AGREEMENT],
    ['/privacy', PRIVACY_POLICY],
  ] as const)('%s 未登录可访问：标题、草案横幅、【…】占位与全部章节逐字显示；axe 通过', async (path, doc) => {
    const { container } = renderApp(path);
    const title = await screen.findByRole('heading', { level: 1, name: doc.title }, { timeout: 5000 });
    const article = title.closest('article')!;
    expect(within(article).getByRole('note').textContent).toBe(LEGAL_DRAFT_NOTICE);
    expect(article.textContent).toContain('【运营主体名称】');
    expectWholeDocument(article, doc);
    expect(lastPath).toBe(path);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('两页互相链接', async () => {
    renderApp('/terms');
    const link = await screen.findByRole('link', { name: '《隐私政策》' }, { timeout: 5000 });
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: PRIVACY_POLICY.title })).toBeTruthy();
    expect(lastPath).toBe('/privacy');
  });
});

describe('注册：必须勾选同意《用户协议》《隐私政策》', () => {
  it('未勾选：不发出注册请求，勾选框旁出现可访问的错误（role=alert、aria-invalid、aria-describedby）并获得焦点；axe 通过（REWRITTEN：先选择校区）', async () => {
    const register = vi.spyOn(api, 'register');
    const { container } = renderApp('/register');
    await fillRegister(`newbie${Date.now().toString(36)}`);
    const consent = screen.getByRole('checkbox', { name: CONSENT }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(consent.getAttribute('aria-required')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(CONSENT_REQUIRED);
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(consent.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(consent);
    expect(register).not.toHaveBeenCalled();
    expect(lastPath).toBe('/register');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('勾选后错误消失，注册成功并登录（请求体不变；REWRITTEN：校区由用户选择，提交的是校区 id）', async () => {
    const register = vi.spyOn(api, 'register');
    renderApp('/register');
    const account = `newbie${Date.now().toString(36)}`;
    await fillRegister(account);
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    await screen.findByText(CONSENT_REQUIRED);
    fireEvent.click(screen.getByRole('checkbox', { name: CONSENT }));
    await waitFor(() => expect(screen.queryByText(CONSENT_REQUIRED)).toBeNull());
    expect(screen.getByRole('checkbox', { name: CONSENT }).getAttribute('aria-invalid')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toEqual({ account, password: 'test-password', nickname: '新同学', campus: '东校区', contact: '' });
    await waitFor(() => expect(lastPath).toBe('/'));
    expect((await api.getCurrentUser())?.account).toBe(account);
  });

  it('协议链接在本页弹窗里打开（不离开注册页，已填写的内容保留）；链接地址仍是 /terms、/privacy', async () => {
    renderApp('/register');
    await fillRegister('keepme123');
    const label = screen.getByText(/^已阅读并同意/);
    const terms = within(label).getByRole('link', { name: '《用户协议》' });
    const privacy = within(label).getByRole('link', { name: '《隐私政策》' });
    expect([terms.getAttribute('href'), privacy.getAttribute('href')]).toEqual(['/terms', '/privacy']);
    fireEvent.click(terms);
    const dialog = await screen.findByRole('dialog', { name: USER_AGREEMENT.title });
    expect(within(dialog).getByRole('note').textContent).toBe(LEGAL_DRAFT_NOTICE);
    expectWholeDocument(dialog, USER_AGREEMENT);
    expect(lastPath).toBe('/register');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(privacy);
    expect(await screen.findByRole('dialog', { name: PRIVACY_POLICY.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText(/学号 \/ 手机号/) as HTMLInputElement).value).toBe('keepme123');
    // 打开协议不等于同意：勾选框仍需用户自己勾
    expect((screen.getByRole('checkbox', { name: CONSENT }) as HTMLInputElement).checked).toBe(false);
  });
});

describe('入口：登录页与个人中心都能打开两份文件', () => {
  it('登录页底部有《用户协议》《隐私政策》，点击进入对应公开页', async () => {
    renderApp('/login');
    const nav = await screen.findByRole('navigation', { name: '协议与政策' }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: '《用户协议》' }).getAttribute('href')).toBe('/terms');
    fireEvent.click(within(nav).getByRole('link', { name: '《隐私政策》' }));
    expect(await screen.findByRole('heading', { level: 1, name: PRIVACY_POLICY.title })).toBeTruthy();
    expect(lastPath).toBe('/privacy');
  });

  it('个人中心有《用户协议》《隐私政策》链接', async () => {
    await api.register({ account: `me${Date.now().toString(36)}`, password: 'test-password', nickname: '我', campus: '东校区', contact: '' });
    renderApp('/profile');
    const nav = await screen.findByRole('navigation', { name: '协议与政策' }, { timeout: 5000 });
    expect(within(nav).getByRole('link', { name: '《用户协议》' }).getAttribute('href')).toBe('/terms');
    expect(within(nav).getByRole('link', { name: '《隐私政策》' }).getAttribute('href')).toBe('/privacy');
    expect(await axeViolations(nav)).toEqual([]);
    fireEvent.click(within(nav).getByRole('link', { name: '《用户协议》' }));
    expect(await screen.findByRole('heading', { level: 1, name: USER_AGREEMENT.title })).toBeTruthy();
    expect(lastPath).toBe('/terms');
  });
});
