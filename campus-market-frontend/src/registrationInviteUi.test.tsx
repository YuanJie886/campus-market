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
import { ApiError } from './api/errors';
import {
  INVITE_CODE_ALPHABET, INVITE_CODE_INVALID, INVITE_CODE_PATTERN, INVITE_CODE_REQUIRED,
  formatInviteCodeInput, looksLikeInviteCode, normalizeClientConfig, normalizeInviteCode, type RegisterInput,
} from './api/contracts';
import { MOCK_DEMO_INVITE_CODES, MOCK_INVITE_REQUIRED_KEY } from './api/mock/registrationInvites';
import { loadClientConfig } from './hooks/useClientConfig';
import { INVITE_FORMAT_HINT, INVITE_HELP } from './pages/RegisterPage';
import { LANDING_INVITE_NOTE } from './pages/HomePage';
import DemoInviteCodes from './components/demo/DemoInviteCodes';
import { inviteCodeFromFragment } from './utils/registrationInvite';
import { authTokenStore } from './utils/authTokenStore';
import { storageKey } from './utils/storage';
import { axeViolations } from './test-axe';

/**
 * 首个试点为邀请制：GET /v1/config 的 registration.inviteRequired=true 时注册页显示必填的「邀请码」，
 * POST /v1/auth/register 带 inviteCode；不需要时既不显示也不发送。服务端两条 400 提示原样显示。
 * 邀请链接 /register#invite=CODE（片段不会发给服务器），读到后立即从地址栏删掉。
 *
 * 本文件的用例不依赖本机 .env 的 VITE_API_MODE：每个用例都显式 setApiClient（Mock 或 REST + 假 fetch）。
 * 离线演示专用的「演示邀请码」面板只在 Mock 构建里出现在注册页上，这里直接渲染组件验证。
 */

const SINGLE = 'XYZW-2345-6789';
const MANY = 'CAMP-US23-4567';

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

async function choose(combobox: HTMLElement, option: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

/** 填好邀请码以外的全部必填项（演示学校只有一所：直接选校区） */
async function fillRest(account = 'invite2026') {
  await screen.findByRole('heading', { name: '注册新账号' }, { timeout: 5000 });
  fireEvent.change(screen.getByLabelText(/学号 \/ 手机号/), { target: { value: account } });
  fireEvent.change(screen.getByLabelText(/^昵称/), { target: { value: '邀请同学' } });
  fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: 'test-password' } });
  fireEvent.change(screen.getByLabelText(/^确认密码/), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /^已阅读并同意/ }));
  const campus = await screen.findByRole('combobox', { name: /^所在校区/ });
  await waitFor(() => expect(campus.getAttribute('aria-disabled')).not.toBe('true'));
  await choose(campus, '东校区');
}

const inviteBox = () => screen.queryByRole('textbox', { name: /^邀请码/ }) as HTMLInputElement | null;
const findInvite = async () => (await screen.findByRole('textbox', { name: /^邀请码/ }, { timeout: 5000 })) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
/** 注册页里邀请码输入框下方的提示（与右下角的全局提示区分开） */
const inviteAlert = () => {
  const box = inviteBox();
  const describedBy = box?.getAttribute('aria-describedby');
  const helper = describedBy ? document.getElementById(describedBy) : null;
  return helper ? within(helper).queryByRole('alert') : null;
};

function mockApi(opts: { inviteRequired?: boolean } = {}) {
  const api = new MockCampusMarketApi(opts);
  setApiClient(api);
  return api;
}

type Call = { method: string; path: string; body: unknown };
const SCHOOLS = [{ id: 'pilot', name: '演示学校', shortName: '演示', campuses: [{ id: '东校区', name: '东校区', hasBuildings: true }] }];

/** REST + 假 fetch：断言真实的 HTTP 请求体。config=undefined 表示旧后端（没有 registration 字段） */
function restBackend(opts: { config?: unknown; registerErrors?: Array<{ message: string; requestId: string }> } = {}) {
  const calls: Call[] = [];
  const errors = [...(opts.registerErrors ?? [])];
  const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  const ok = (data: unknown) => json(200, { code: 0, data, message: 'ok' });
  const user = { id: 'u_inv', account: 'invite2026', nickname: '邀请同学', avatar: '', campus: '东校区', contact: 'invite2026', createdAt: 1 };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === '/v1/auth/refresh') return json(401, { code: 401, data: null, message: '请先登录' });
    if (path === '/v1/config') return ok(opts.config ?? { images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: false }, messages: { freeTextEnabled: false } });
    if (path === '/v1/schools') return ok(SCHOOLS);
    if (path === '/v1/auth/register' && method === 'POST') {
      const next = errors.shift();
      if (next) return json(400, { code: 400, data: null, message: next.message, requestId: next.requestId });
      return ok({ accessToken: 'invite-token', expiresAtIso: new Date(Date.now() + 900_000).toISOString(), user });
    }
    if (path === '/v1/auth/me') return ok(user);
    if (path.startsWith('/v1/products')) return ok({ items: [], total: 0, page: 1, size: 100 });
    if (path === '/v1/messages/unread' || path === '/v1/demand-matches/unread-count') return ok({ count: 0 });
    if (path === '/v1/contact-requests/unread-count') return ok({ received: 0, updates: 0, total: 0 });
    return ok(path.startsWith('/v1/buildings') || path === '/v1/favorites' || path === '/v1/conversations' || path.startsWith('/v1/circles') ? [] : null);
  });
  const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
  setApiClient(rest);
  return { rest, calls, registers: () => calls.filter((c) => c.method === 'POST' && c.path === '/v1/auth/register').map((c) => c.body as Record<string, unknown>) };
}
const INVITE_CONFIG = { images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: false }, messages: { freeTextEnabled: false }, registration: { inviteRequired: true } };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); authTokenStore.clearAccessToken(); window.history.replaceState(null, '', '/') });

describe('契约：GET /v1/config 的 registration 与邀请码格式', () => {
  it('registration.inviteRequired：缺失（旧后端）/ null / 非布尔 → false；只有明确的 true 才要求邀请码', () => {
    expect(normalizeClientConfig(null).registration).toEqual({ inviteRequired: false });
    expect(normalizeClientConfig({ images: {} }).registration).toEqual({ inviteRequired: false });
    expect(normalizeClientConfig({ registration: null }).registration).toEqual({ inviteRequired: false });
    expect(normalizeClientConfig({ registration: { inviteRequired: 'true' } }).registration).toEqual({ inviteRequired: false });
    expect(normalizeClientConfig({ registration: { inviteRequired: false } }).registration).toEqual({ inviteRequired: false });
    expect(normalizeClientConfig({ registration: { inviteRequired: true } }).registration).toEqual({ inviteRequired: true });
  });

  it('REST getClientConfig：按 GET /v1/config 的 registration 返回；没有这个字段时为 false', async () => {
    expect((await restBackend({ config: INVITE_CONFIG }).rest.getClientConfig()).registration).toEqual({ inviteRequired: true });
    const legacy = restBackend();
    expect((await legacy.rest.getClientConfig()).registration).toEqual({ inviteRequired: false });
    expect(legacy.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/config']);
  });

  it('显示格式：转大写、去掉空白与短横线后每 4 位一个短横线；字母表以外的字符原样保留（不替用户删改，交给服务端判定）', () => {
    expect(formatInviteCodeInput('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(formatInviteCodeInput('  abcd efgh-jkmn ')).toBe('ABCD-EFGH-JKMN');
    expect(formatInviteCodeInput('ab-cd--ef gh\tjk mn')).toBe('ABCD-EFGH-JKMN');
    expect(formatInviteCodeInput('abcde')).toBe('ABCD-E');
    expect(formatInviteCodeInput('ABCD-')).toBe('ABCD');
    expect(formatInviteCodeInput('')).toBe('');
    expect(formatInviteCodeInput('abcd-efgh-jkm0')).toBe('ABCD-EFGH-JKM0');
    expect(normalizeInviteCode(' xyzw-2345 6789 ')).toBe('XYZW23456789');
    // 与服务端相同：全角空格与全角短横线同样去掉
    expect(formatInviteCodeInput('xyzw\u3000２345－6789'.replace('２', '2'))).toBe(SINGLE);
    expect(looksLikeInviteCode('xyzw 2345 6789')).toBe(true);
    expect(looksLikeInviteCode('ABCD-EFGH-JKM0')).toBe(false);
    expect(looksLikeInviteCode('ABCD-EFGH')).toBe(false);
    expect(INVITE_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  });

  it('邀请片段：#invite=CODE 取出并整理格式；其他片段、非法字符、超长内容一律忽略', () => {
    expect(inviteCodeFromFragment('#invite=abcd-efgh-jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromFragment('#invite=abcd%20efgh%20jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromFragment('#invite=abcd+efgh+jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromFragment('#code=abcd-efgh-jkmn')).toBeNull();
    expect(inviteCodeFromFragment('#invite=')).toBeNull();
    expect(inviteCodeFromFragment('#invite=%3Cscript%3E')).toBeNull();
    expect(inviteCodeFromFragment('#invite=%E0%A4%A')).toBeNull();
    expect(inviteCodeFromFragment(`#invite=${'A'.repeat(65)}`)).toBeNull();
    expect(inviteCodeFromFragment('')).toBeNull();
  });
});

describe('注册页：不需要邀请码（默认）', () => {
  it('Mock 默认 inviteRequired=false：不显示邀请码；注册调用里没有 inviteCode 字段；无 axe 严重问题', async () => {
    const api = mockApi();
    await loadClientConfig(api);
    const spy = vi.spyOn(api, 'register');
    const { container } = renderApp('/register');
    await fillRest();
    expect(inviteBox()).toBeNull();
    expect(screen.queryByText(INVITE_HELP)).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    submit();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const input = spy.mock.calls[0][0] as RegisterInput & Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['account', 'campus', 'contact', 'nickname', 'password']);
    expect(input).toEqual({ account: 'invite2026', password: 'test-password', nickname: '邀请同学', campus: '东校区', contact: '' });
  });

  it('REST（旧后端没有 registration）：POST /v1/auth/register 的请求体逐字段相同，不含 inviteCode——即使地址里带着邀请片段', async () => {
    const backend = restBackend();
    await loadClientConfig(backend.rest);
    window.history.replaceState(null, '', '/register#invite=abcd-efgh-jkmn');
    renderApp('/register');
    await fillRest();
    expect(inviteBox()).toBeNull();
    // 片段照样从地址栏删掉
    expect(window.location.hash).toBe('');
    submit();
    await waitFor(() => expect(backend.registers()).toHaveLength(1));
    expect(backend.registers()[0]).toStrictEqual({ account: 'invite2026', password: 'test-password', nickname: '邀请同学', campus: '东校区', contact: '' });
  });
});

describe('注册页：需要邀请码（registration.inviteRequired=true）', () => {
  it('显示必填的「邀请码」与说明；空着点注册：输入框下方提示「请输入邀请码」、焦点移到输入框、不发出注册请求；无 axe 严重问题', async () => {
    const api = mockApi({ inviteRequired: true });
    const spy = vi.spyOn(api, 'register');
    const { container } = renderApp('/register');
    // 配置异步到达后出现
    const box = await findInvite();
    expect(box.required).toBe(true);
    expect(box.getAttribute('placeholder')).toBe('XXXX-XXXX-XXXX');
    expect(screen.getByText(INVITE_HELP)).toBeTruthy();
    await fillRest();
    // 只有空白与短横线也算没填
    fireEvent.change(box, { target: { value: ' - - ' } });
    expect(box.value).toBe('');
    submit();
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_REQUIRED));
    expect(box.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(spy).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
    // 开始输入后提示消失
    fireEvent.change(box, { target: { value: 'c' } });
    expect(inviteAlert()).toBeNull();
  });

  it('REST：POST /v1/auth/register 的请求体逐字段相同，含规范格式的 inviteCode；注册成功', async () => {
    const backend = restBackend({ config: INVITE_CONFIG });
    renderApp('/register');
    const box = await findInvite();
    await fillRest();
    fireEvent.change(box, { target: { value: 'abcd efgh jkmn' } });
    expect(box.value).toBe('ABCD-EFGH-JKMN');
    submit();
    await waitFor(() => expect(backend.registers()).toHaveLength(1));
    expect(backend.registers()[0]).toStrictEqual({ account: 'invite2026', password: 'test-password', nickname: '邀请同学', campus: '东校区', contact: '', inviteCode: 'ABCD-EFGH-JKMN' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: '注册新账号' })).toBeNull());
  });

  it('REST：服务端 400「邀请码无效或已用完」与「请输入邀请码」都原样显示（输入框下方 + 带错误编号的全局提示），焦点回到输入框', async () => {
    const backend = restBackend({ config: INVITE_CONFIG, registerErrors: [
      { message: INVITE_CODE_INVALID, requestId: 'rid-inv-1' },
      { message: INVITE_CODE_REQUIRED, requestId: 'rid-inv-2' },
    ] });
    renderApp('/register');
    const box = await findInvite();
    await fillRest();
    fireEvent.change(box, { target: { value: 'ZZZZ-ZZZZ-ZZZZ' } });
    submit();
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_INVALID));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(`${INVITE_CODE_INVALID}（错误编号：rid-inv-1）`);
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.value).toBe('ZZZZ-ZZZZ-ZZZZ');

    // 第二次提交服务端回答「请输入邀请码」：同样原样显示
    fireEvent.change(box, { target: { value: 'ZZZZ-ZZZZ-ZZZY' } });
    submit();
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_REQUIRED));
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(`${INVITE_CODE_REQUIRED}（错误编号：rid-inv-2）`);
    expect(backend.registers().map((b) => b.inviteCode)).toEqual(['ZZZZ-ZZZZ-ZZZZ', 'ZZZZ-ZZZZ-ZZZY']);
  });

  it('配置没说要邀请码、服务端却回答 400「请输入邀请码」（例如配置请求失败）：补出邀请码输入框，下一次注册带上 inviteCode', async () => {
    const backend = restBackend({ registerErrors: [{ message: INVITE_CODE_REQUIRED, requestId: 'rid-inv-3' }] });
    await loadClientConfig(backend.rest);
    renderApp('/register');
    await fillRest();
    expect(inviteBox()).toBeNull();
    submit();
    const box = await findInvite();
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_REQUIRED));
    await waitFor(() => expect(document.activeElement).toBe(box));
    fireEvent.change(box, { target: { value: 'camp-us23-4567' } });
    submit();
    await waitFor(() => expect(backend.registers()).toHaveLength(2));
    expect('inviteCode' in backend.registers()[0]).toBe(false);
    expect(backend.registers()[1].inviteCode).toBe(MANY);
  });

  it('邀请链接 /register#invite=CODE：预填（整理为大写分组），读完后地址栏不再带片段，路径不变；非法片段同样删掉但不预填', async () => {
    const backend = restBackend({ config: INVITE_CONFIG });
    window.history.replaceState({ keep: 1 }, '', '/register#invite=xyzw2345%206789');
    renderApp('/register');
    const box = await findInvite();
    expect(box.value).toBe(SINGLE);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/register');
    expect(window.location.href).not.toContain('XYZW');
    expect(window.location.href.toLowerCase()).not.toContain('xyzw');
    // 片段从未进入任何请求
    expect(backend.calls.some((c) => c.path.toLowerCase().includes('xyzw') || JSON.stringify(c.body ?? '').toLowerCase().includes('xyzw'))).toBe(false);
    await fillRest();
    submit();
    await waitFor(() => expect(backend.registers()).toHaveLength(1));
    expect(backend.registers()[0].inviteCode).toBe(SINGLE);
    cleanup();

    restBackend({ config: INVITE_CONFIG });
    window.history.replaceState(null, '', '/register#invite=%3Cb%3Ehi%3C%2Fb%3E');
    renderApp('/register');
    const empty = await findInvite();
    expect(empty.value).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('输入整理：逐字输入与粘贴都显示为 XXXX-XXXX-XXXX；字母表以外的字符不被删除，只给出格式提示且不拦截提交（以服务端判定为准）', async () => {
    const api = mockApi({ inviteRequired: true });
    const spy = vi.spyOn(api, 'register');
    renderApp('/register');
    const box = await findInvite();
    fireEvent.change(box, { target: { value: 'c' } });
    expect(box.value).toBe('C');
    fireEvent.change(box, { target: { value: 'camp' } });
    expect(box.value).toBe('CAMP');
    fireEvent.change(box, { target: { value: 'CAMPu' } });
    expect(box.value).toBe('CAMP-U');
    // 退格删掉短横线后面的字符：不会卡在短横线上
    fireEvent.change(box, { target: { value: 'CAMP-' } });
    expect(box.value).toBe('CAMP');
    // 输入过程中（还不到 12 位、没有离开输入框）不提示格式
    expect(screen.queryByText(INVITE_FORMAT_HINT)).toBeNull();
    fireEvent.blur(box);
    expect(screen.getByText(INVITE_FORMAT_HINT)).toBeTruthy();
    // 粘贴带空格、小写的整段
    fireEvent.change(box, { target: { value: ' camp us23 4567 ' } });
    expect(box.value).toBe(MANY);
    fireEvent.blur(box);
    expect(screen.queryByText(INVITE_FORMAT_HINT)).toBeNull();
    // 字母表以外的字符（0）原样保留并提示格式，但仍然提交，由服务端判定
    fireEvent.change(box, { target: { value: 'camp-us23-4560' } });
    expect(box.value).toBe('CAMP-US23-4560');
    expect(screen.getByText(INVITE_FORMAT_HINT)).toBeTruthy();
    await fillRest();
    submit();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].inviteCode).toBe('CAMP-US23-4560');
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_INVALID));
  });

  it('Mock：同一页面里一次性的演示邀请码用完后，再次使用提示「邀请码无效或已用完」', async () => {
    const api = mockApi({ inviteRequired: true });
    await api.register({ account: 'first2026', password: 'test-password', nickname: '先到', campus: '东校区', inviteCode: SINGLE });
    await api.logout();
    renderApp('/register');
    const box = await findInvite();
    await fillRest('second2026');
    fireEvent.change(box, { target: { value: SINGLE } });
    submit();
    await waitFor(() => expect(inviteAlert()?.textContent).toBe(INVITE_CODE_INVALID));
    expect(screen.getAllByRole('alert').some((a) => (a.textContent ?? '').startsWith(`${INVITE_CODE_INVALID}（错误编号：mock-`))).toBe(true);
  });
});

describe('落地页（未登录）', () => {
  it('inviteRequired=true：注册入口旁写明目前需要邀请码；默认（false）不显示这一句', async () => {
    mockApi({ inviteRequired: true });
    const { container } = renderApp('/');
    expect(await screen.findByText(LANDING_INVITE_NOTE, {}, { timeout: 5000 })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    cleanup();

    const api = mockApi();
    await loadClientConfig(api);
    renderApp('/');
    await screen.findByText('登录后查看本校在售好物', {}, { timeout: 5000 });
    expect(screen.queryByText(LANDING_INVITE_NOTE)).toBeNull();
  });
});

describe('离线 Mock：与后端相同的校验、提示与使用次数', () => {
  const input = (account: string, inviteCode?: string, campus = '东校区'): RegisterInput => ({ account, password: 'test-password', nickname: '同学', campus, ...(inviteCode === undefined ? {} : { inviteCode }) });
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: ApiError) => `${e.code} ${e.message}`);

  it('默认不需要邀请码：config 为 false，inviteCode 被忽略（随便填也能注册，不消耗次数）', async () => {
    const api = new MockCampusMarketApi();
    expect((await api.getClientConfig()).registration).toEqual({ inviteRequired: false });
    expect(await outcome(api.register(input('plain2026')))).toBe('ok');
    expect(await outcome(api.register(input('junk2026', 'whatever')))).toBe('ok');
    expect(await outcome(api.register(input('single2026', SINGLE)))).toBe('ok');
    expect(api.demoInviteCodes().codes.find((c) => c.code === SINGLE)?.remaining).toBe(1);
  });

  it('inviteRequired=true：缺少 / 空白 / null → 400「请输入邀请码」；不存在 → 400「邀请码无效或已用完」；大小写、空格、短横线按服务端口径规范化', async () => {
    const api = new MockCampusMarketApi({ inviteRequired: true });
    expect((await api.getClientConfig()).registration).toEqual({ inviteRequired: true });
    expect(await outcome(api.register(input('none2026')))).toBe(`400 ${INVITE_CODE_REQUIRED}`);
    expect(await outcome(api.register({ ...input('null2026'), inviteCode: null as unknown as string }))).toBe(`400 ${INVITE_CODE_REQUIRED}`);
    expect(await outcome(api.register(input('blank2026', '   ')))).toBe(`400 ${INVITE_CODE_REQUIRED}`);
    // 与后端相同：只有短横线不算空白，规范化后不是 12 位 → 无效
    expect(await outcome(api.register(input('dash2026', ' - ')))).toBe(`400 ${INVITE_CODE_INVALID}`);
    expect(await outcome(api.register(input('wrong2026', 'ZZZZ-ZZZZ-ZZZZ')))).toBe(`400 ${INVITE_CODE_INVALID}`);
    expect(await outcome(api.register(input('typed2026', ' camp us23-4567 ')))).toBe('ok');
    expect(await outcome(api.register(input('wide2026', 'camp\u3000us23－4567')))).toBe('ok');
    // 不是字符串：与后端相同按无效处理
    expect(await outcome(api.register({ ...input('num2026'), inviteCode: 123 as unknown as string }))).toBe(`400 ${INVITE_CODE_INVALID}`);
    expect(api.demoInviteCodes().codes.find((c) => c.code === MANY)?.remaining).toBe(98);
  });

  it('使用次数：一次性邀请码只能用一次（第二次「邀请码无效或已用完」）；同时发起的两次注册只有一次成功', async () => {
    const api = new MockCampusMarketApi({ inviteRequired: true });
    expect(await outcome(api.register(input('once2026', SINGLE)))).toBe('ok');
    expect(await outcome(api.register(input('twice2026', SINGLE)))).toBe(`400 ${INVITE_CODE_INVALID}`);

    const race = new MockCampusMarketApi({ inviteRequired: true, inviteCodes: [{ code: 'RACE-2345-6789', maxUses: 1 }] });
    const results = await Promise.allSettled([race.register(input('racea2026', 'RACE-2345-6789')), race.register(input('raceb2026', 'race23456789'))]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toBe(INVITE_CODE_INVALID);
    expect(race.demoInviteCodes().codes).toEqual([{ code: 'RACE-2345-6789', maxUses: 1, remaining: 0 }]);
  });

  it('其他原因注册失败（账号已注册 409、校区无效 400）不消耗次数；校验顺序与后端相同（校区 → 缺少邀请码 → 邀请码无效 → 账号已注册）', async () => {
    const api = new MockCampusMarketApi({ inviteRequired: true });
    expect(await outcome(api.register(input('taken2026', MANY)))).toBe('ok');
    expect(await outcome(api.register(input('taken2026', SINGLE)))).toBe('409 该账号已注册，请直接登录');
    expect(await outcome(api.register(input('badcampus2026', SINGLE, 'aust-huainan')))).toBe('400 校区无效');
    // 与后端相同：校区先于邀请码校验；缺少邀请码先于账号是否存在
    expect(await outcome(api.register(input('badcampus2026', undefined, 'aust-huainan')))).toBe('400 校区无效');
    expect(await outcome(api.register(input('taken2026')))).toBe(`400 ${INVITE_CODE_REQUIRED}`);
    // 没有有效邀请码的人不能借注册接口探测账号是否存在
    expect(await outcome(api.register(input('taken2026', 'ZZZZ-ZZZZ-ZZZZ')))).toBe(`400 ${INVITE_CODE_INVALID}`);
    expect(api.demoInviteCodes().codes.find((c) => c.code === SINGLE)?.remaining).toBe(1);
    expect(await outcome(api.register(input('finally2026', SINGLE)))).toBe('ok');
  });

  it('演示邀请码清单：都符合 XXXX-XXXX-XXXX 与字母表；格式不对的种子在构造时就报错', () => {
    expect(MOCK_DEMO_INVITE_CODES.map((c) => c.code)).toEqual([MANY, SINGLE]);
    for (const c of MOCK_DEMO_INVITE_CODES) expect(c.code).toMatch(INVITE_CODE_PATTERN);
    expect(() => new MockCampusMarketApi({ inviteCodes: [{ code: 'DEMO-0000-1111', maxUses: 1 }] })).toThrow(/演示邀请码格式无效/);
  });

  it('离线演示的邀请制开关：保存在本机（campus_market_mock_invite_required_v1），新的 Mock 实例按它决定；构造参数优先', () => {
    expect(new MockCampusMarketApi().demoInviteCodes().inviteRequired).toBe(false);
    new MockCampusMarketApi().demoSetInviteRequired(true);
    expect(window.localStorage.getItem(storageKey(MOCK_INVITE_REQUIRED_KEY))).toBe('true');
    expect(new MockCampusMarketApi().demoInviteCodes().inviteRequired).toBe(true);
    expect(new MockCampusMarketApi({ inviteRequired: false }).demoInviteCodes().inviteRequired).toBe(false);
    new MockCampusMarketApi().demoSetInviteRequired(false);
    expect(new MockCampusMarketApi().demoInviteCodes().inviteRequired).toBe(false);
  });
});

describe('「演示邀请码」面板（只在 Mock 构建里出现）', () => {
  it('邀请制：列出演示邀请码与剩余次数，「填入」把邀请码交给注册页；用完的不能再填；无 axe 严重问题', async () => {
    const api = mockApi({ inviteRequired: true });
    await api.register({ account: 'used2026', password: 'test-password', nickname: '同学', campus: '东校区', inviteCode: SINGLE });
    const picked = vi.fn();
    const { container } = render(<DemoInviteCodes onPick={picked} />);
    const panel = screen.getByRole('region', { name: '演示邀请码' });
    expect(panel.getAttribute('data-marker')).toBe('demo-invite-code');
    expect(within(panel).getByText(MANY)).toBeTruthy();
    expect(within(panel).getByText('剩余 100 / 100 次')).toBeTruthy();
    expect(within(panel).getByText('剩余 0 / 1 次')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: `填入演示邀请码 ${MANY}` }));
    expect(picked).toHaveBeenCalledWith(MANY);
    expect((within(panel).getByRole('button', { name: `填入演示邀请码 ${SINGLE}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(within(panel).getByRole('button', { name: '关闭邀请制演示' }));
    expect(within(panel).getByRole('status').textContent).toContain('刷新页面后生效');
    expect(window.localStorage.getItem(storageKey(MOCK_INVITE_REQUIRED_KEY))).toBe('false');
  });

  it('不需要邀请码时只说明并提供开关；REST 客户端上（没有演示能力）什么都不渲染', () => {
    mockApi();
    render(<DemoInviteCodes />);
    expect(screen.getByText('离线演示目前不需要邀请码。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '以邀请制运行离线演示' }));
    expect(window.localStorage.getItem(storageKey(MOCK_INVITE_REQUIRED_KEY))).toBe('true');
    cleanup();

    restBackend();
    const { container } = render(<DemoInviteCodes />);
    expect(container.innerHTML).toBe('');
  });
});

describe('构建检查：演示邀请码只属于 Mock 产物', () => {
  const raw = (glob: Record<string, unknown>) => Object.values(glob)[0] as string;
  it('check-bundles 的 MOCK_ONLY 含面板标记、邀请制开关的存储键与演示邀请码；三者都真实存在于 Mock 代码里', () => {
    const script = raw(import.meta.glob(['../scripts/check-bundles.mjs'], { query: '?raw', import: 'default', eager: true }));
    const mockOnly = script.slice(script.indexOf('const MOCK_ONLY'), script.indexOf('const REST_ONLY'));
    for (const marker of ['demo-invite-code', 'mock_invite_required_v1', MANY]) expect(mockOnly).toContain(`'${marker}'`);
    expect(MOCK_INVITE_REQUIRED_KEY).toBe('mock_invite_required_v1');
    expect(MOCK_DEMO_INVITE_CODES[0].code).toBe(MANY);
    // 面板只在 Mock 构建里懒加载（构建期常量折叠；真正的产物检查由 npm run build 里的 check:bundles 完成）
    const page = raw(import.meta.glob(['./pages/RegisterPage.tsx'], { query: '?raw', import: 'default', eager: true }));
    expect(page).toMatch(/const DemoInviteCodes = import\.meta\.env\.VITE_API_MODE === 'mock' \? lazy\(\(\) => import\('\.\.\/components\/demo\/DemoInviteCodes'\)\) : null;/);
  });
});
