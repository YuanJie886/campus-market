// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import type { CampusMarketApi } from './api/contracts';

/**
 * 错误提示的 UI 接入（0.9C）。
 *
 * <p>改造前每个页面都写 `(e as Error).message`，于是后端已经给出的 requestId 和
 * Retry-After 在界面上全部丢失：用户截图报障时只有一句「请求失败」，
 * 运维无从在日志里定位那一条请求。现在统一走 `toUserMessage()`。
 */

/** 在指定接口上注入错误，其余行为仍走真实 Mock。 */
function apiThatFails(method: keyof CampusMarketApi, error: ApiError): CampusMarketApi {
  const api = new MockCampusMarketApi();
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (prop === method) return async () => { throw error };
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as CampusMarketApi;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <App />
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

/**
 * 点击页面主体里文案匹配的按钮。
 * 导航栏也有一个「登录」按钮，取最后一个匹配项即页面内容区里的那个。
 */
function clickByText(text: string) {
  const matches = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.textContent?.trim() === text);
  const button = matches[matches.length - 1];
  if (!button) throw new Error(`未找到按钮：${text}`);
  fireEvent.click(button);
}

async function submitLogin() {
  renderAt('/login');
  await waitFor(() => expect(document.querySelectorAll('input').length).toBeGreaterThanOrEqual(2));
  const inputs = document.querySelectorAll('input');
  fireEvent.change(inputs[0], { target: { value: 'someone' } });
  fireEvent.change(inputs[1], { target: { value: 'test-password' } });
  clickByText('登录');
}

beforeEach(() => {
  window.localStorage.clear();
  setApiClient(new MockCampusMarketApi());
});

describe('0.9C 错误提示接入各业务入口', () => {
  it('1. 登录失败：提示带服务端错误编号', async () => {
    setApiClient(apiThatFails('login', new ApiError({
      code: 401, message: '账号或密码错误', requestId: 'rid-login-001', httpStatus: 401,
    })));

    await submitLogin();

    await waitFor(() => {
      expect(document.body.textContent).toContain('账号或密码错误');
      expect(document.body.textContent).toContain('rid-login-001');
    });
  });

  it('2. 注册失败：提示带服务端错误编号', async () => {
    setApiClient(apiThatFails('register', new ApiError({
      code: 409, message: '该账号已注册', requestId: 'rid-reg-002', httpStatus: 409,
    })));

    renderAt('/register');
    await waitFor(() => expect(document.querySelectorAll('input').length).toBeGreaterThan(0));
    document.querySelectorAll('input').forEach((input) => {
      fireEvent.change(input, { target: { value: 'test-password-2026' } });
    });
    clickByText('注册并登录');

    await waitFor(() => expect(document.body.textContent).toContain('rid-reg-002'));
  });

  it('3. 429 提示给出等待秒数，而不是错误编号', async () => {
    setApiClient(apiThatFails('login', new ApiError({
      code: 429, message: '操作过于频繁', retryAfterSeconds: 45, requestId: 'rid-429-003',
    })));

    await submitLogin();

    await waitFor(() => expect(document.body.textContent).toContain('操作过于频繁（约 45 秒后可重试）'));
    expect(screen.queryByText(/rid-429-003/)).toBeNull();
  });

  it('4. 提示中不出现 Token、Cookie 或 stack', async () => {
    const leaky = new ApiError({
      code: 500, message: '服务器开小差了', requestId: 'rid-500-004',
    });
    setApiClient(apiThatFails('login', leaky));

    await submitLogin();

    await waitFor(() => expect(document.body.textContent).toContain('rid-500-004'));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('cm_refresh');
    expect(text).not.toContain('at Object.');
  });
});

describe('0.9C Mock 模式的错误同样可追溯', () => {
  it('5. Mock 抛出的错误带本地 requestId，且能明确区分于服务端 id', async () => {
    const api = new MockCampusMarketApi();
    const error = await api.login({ account: 'nobody', password: 'x' })
      .then(() => null).catch((e: unknown) => e as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    if (!error) throw new Error('预期登录失败');
    expect(error.requestId).toMatch(/^mock-/);
    expect(error.userMessage()).toContain(error.requestId as string);
  });

  it('6. 下单失败与收藏失败同样带编号', async () => {
    const api = new MockCampusMarketApi();
    await api.register({
      account: 'err-user', password: 'test-password', nickname: '同学',
      campus: '东校区', contact: '13800000000',
    });

    const orderError = await api
      .createOrder({
        productId: 'missing', meetingPointId: '东校区-library',
        meetingAtIso: new Date(Date.now() + 86_400_000).toISOString(),
        contact: '13800000000', idempotencyKey: 'k',
      })
      .then(() => null).catch((e: unknown) => e as ApiError);
    expect(orderError?.requestId).toMatch(/^mock-/);

    const favoriteError = await api.setFavorite('missing', true)
      .then(() => null).catch((e: unknown) => e as ApiError);
    expect(favoriteError?.requestId).toMatch(/^mock-/);
  });
});

describe('0.9C 没有页面再自行解析错误', () => {
  it('7. 所有 catch 分支都走统一的 toUserMessage，不再有裸 .message', () => {
    // Vite 的 glob 导入：不需要 node 类型，也能在 vitest 里读到源码文本
    const sources = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      // errors.ts 的文档注释里引用了这个旧写法，用来说明为什么要换掉它
      .filter(([path]) => !path.endsWith('api/errors.ts'))
      .filter(([, text]) => /\((?:e|err) as Error\)\.message/.test(text))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
