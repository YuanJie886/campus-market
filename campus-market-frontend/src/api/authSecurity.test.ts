import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, parseRetryAfterSeconds } from './errors';
import { HttpTransport } from './httpTransport';
import {
  LEGACY_AUTH_STORAGE_KEYS,
  authTokenStore,
  purgeLegacyAuthTokens,
} from '../utils/authTokenStore';
import {
  cancelScheduledRefresh,
  recoverSession,
  scheduleProactiveRefresh,
} from '../utils/sessionRecovery';

/**
 * 前端认证安全（0.9A / 0.9B）与错误可追溯性（0.9C）。
 *
 * <p>改造前 Access Token 存在 localStorage：任何 XSS 都能直接读走一枚有效令牌，
 * 而后端 README 却声称它「保存在前端内存中」。现在它只存在于模块闭包里。
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

let storage: MemoryStorage;

function installBrowser(): void {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage, sessionStorage: new MemoryStorage() },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const OK_SESSION = { code: 0, message: 'ok', data: { accessToken: 'fresh-token', expiresAtIso: new Date(Date.now() + 900_000).toISOString(), user: { id: 'u1' } } };

beforeEach(() => {
  installBrowser();
  authTokenStore.clearAccessToken();
  cancelScheduledRefresh();
});

afterEach(() => {
  cancelScheduledRefresh();
  vi.useRealTimers();
});

describe('0.9A Access Token 仅存在于内存', () => {
  it('1. setAccessToken 不向任何 Web Storage 写入', () => {
    authTokenStore.setAccessToken('secret-token', new Date(Date.now() + 60_000).toISOString());
    expect(authTokenStore.getAccessToken()).toBe('secret-token');

    const dump = JSON.stringify(
      Array.from({ length: storage.length }, (_, i) => {
        const key = storage.key(i) as string;
        return [key, storage.getItem(key)];
      }),
    );
    expect(dump).not.toContain('secret-token');
    expect(storage.length).toBe(0);
  });

  it('2. clearAccessToken 同时清掉过期时刻，不留残值', () => {
    authTokenStore.setAccessToken('t', new Date(Date.now() + 60_000).toISOString());
    authTokenStore.clearAccessToken();
    expect(authTokenStore.getAccessToken()).toBeNull();
    expect(authTokenStore.getExpiresAt()).toBeNull();
  });

  it('3. 无效或缺失的 expiresAtIso 不会写出 NaN 时间', () => {
    authTokenStore.setAccessToken('t', 'not-a-date');
    expect(authTokenStore.getExpiresAt()).toBeNull();
    authTokenStore.setAccessToken('t');
    expect(authTokenStore.getExpiresAt()).toBeNull();
  });

  it('4. 清理遗留 key 时逐个删除，绝不使用 localStorage.clear()', () => {
    const clearSpy = vi.spyOn(storage, 'clear');
    storage.setItem(LEGACY_AUTH_STORAGE_KEYS[0], 'leaked-old-token');
    storage.setItem('campus_market_mock_database_v1', '{"demo":true}');
    storage.setItem('campus_market_market_v1', '{"filters":1}');

    purgeLegacyAuthTokens();

    expect(storage.getItem(LEGACY_AUTH_STORAGE_KEYS[0])).toBeNull();
    expect(storage.getItem('campus_market_mock_database_v1')).toBe('{"demo":true}');
    expect(storage.getItem('campus_market_market_v1')).toBe('{"filters":1}');
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('5. 清理是幂等的，且不读取旧 Token 的值再利用', () => {
    storage.setItem(LEGACY_AUTH_STORAGE_KEYS[0], 'leaked-old-token');
    purgeLegacyAuthTokens();
    purgeLegacyAuthTokens();
    expect(authTokenStore.getAccessToken()).toBeNull();
  });

  it('6. storage 不可用（隐私模式）时静默跳过，不抛异常', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { get localStorage(): Storage { throw new Error('denied') } },
      configurable: true,
    });
    expect(() => purgeLegacyAuthTokens()).not.toThrow();
  });

  it('7. 请求头使用内存中的 Token，登出后不再附带', async () => {
    const seen: Array<string | null> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('Authorization'));
      return jsonResponse(200, { code: 0, message: 'ok', data: { ok: true } });
    }) as unknown as typeof fetch;
    const transport = new HttpTransport({ fetchImpl });

    authTokenStore.setAccessToken('in-memory-token');
    await transport.get('/v1/products');
    authTokenStore.clearAccessToken();
    await transport.get('/v1/products');

    expect(seen[0]).toBe('Bearer in-memory-token');
    expect(seen[1]).toBeNull();
  });
});

describe('0.9B 刷新：单飞、最多重试一次、不自我加剧', () => {
  it('8. 并发 401 只触发一次 refresh（单飞）', async () => {
    let refreshCalls = 0;
    let refreshed = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v1/auth/refresh')) {
        refreshCalls += 1;
        refreshed = true;
        return jsonResponse(200, OK_SESSION);
      }
      if (!refreshed) return jsonResponse(401, { code: 401, message: '登录已失效' });
      return jsonResponse(200, { code: 0, message: 'ok', data: { ok: true } });
    }) as unknown as typeof fetch;
    const transport = new HttpTransport({ fetchImpl });
    authTokenStore.setAccessToken('stale');

    await Promise.all([
      transport.get('/v1/orders'),
      transport.get('/v1/favorites'),
      transport.get('/v1/products'),
    ]);

    expect(refreshCalls).toBe(1);
    expect(authTokenStore.getAccessToken()).toBe('fresh-token');
  });

  it('9. 刷新后仍 401 时不再重试，避免无限循环', async () => {
    let businessCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v1/auth/refresh')) return jsonResponse(200, OK_SESSION);
      businessCalls += 1;
      return jsonResponse(401, { code: 401, message: '登录已失效' });
    }) as unknown as typeof fetch;
    const transport = new HttpTransport({ fetchImpl });

    await expect(transport.get('/v1/orders')).rejects.toBeInstanceOf(ApiError);
    expect(businessCalls).toBe(2); // 原始一次 + 刷新后一次，不再有第三次
  });

  it('10. 认证端点自身的 401 不触发刷新（否则 refresh 会递归）', async () => {
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/v1/auth/refresh')) refreshCalls += 1;
      return jsonResponse(401, { code: 401, message: '账号或密码错误' });
    }) as unknown as typeof fetch;
    const transport = new HttpTransport({ fetchImpl });

    await expect(transport.post('/v1/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
  });

  it('11. 429 从不自动重试，限流不得被客户端放大', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return jsonResponse(429, { code: 429, message: '操作过于频繁' }, { 'Retry-After': '42' });
    }) as unknown as typeof fetch;

    const error = await new HttpTransport({ fetchImpl }).get<never>('/v1/orders').catch((e) => e as ApiError);
    expect(calls).toBe(1);
    expect(error.code).toBe(429);
    expect(error.retryAfterSeconds).toBe(42);
  });

  it('12. 刷新收到 401 会清空内存 Token，不留下已失效凭据', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).endsWith('/v1/auth/refresh')
        ? jsonResponse(401, { code: 401, message: '会话已过期' })
        : jsonResponse(401, { code: 401, message: '登录已失效' }),
    ) as unknown as typeof fetch;
    authTokenStore.setAccessToken('stale');

    await expect(new HttpTransport({ fetchImpl }).get('/v1/orders')).rejects.toBeInstanceOf(ApiError);
    expect(authTokenStore.getAccessToken()).toBeNull();
  });

  it('13. 主动刷新在过期前约 60 秒触发，且全局只有一个定时器', () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);

    authTokenStore.setAccessToken('t', new Date(Date.now() + 15 * 60_000).toISOString());
    scheduleProactiveRefresh(refresh);
    // 重复排程不得叠加定时器
    scheduleProactiveRefresh(refresh);

    vi.advanceTimersByTime(14 * 60_000 - 1_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('14. 主动刷新失败不重排，不形成定时器风暴', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => { throw new ApiError({ code: 503, message: '服务不可用' }) });

    authTokenStore.setAccessToken('t', new Date(Date.now() + 90_000).toISOString());
    scheduleProactiveRefresh(refresh);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('15. 无过期时刻时不排程，避免无依据的空转刷新', () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    authTokenStore.setAccessToken('t');
    scheduleProactiveRefresh(refresh);
    vi.advanceTimersByTime(60 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('16. 启动恢复严格区分「未登录」与「服务不可用」', async () => {
    expect(await recoverSession(async () => undefined)).toEqual({ kind: 'authenticated' });

    expect(await recoverSession(async () => { throw new ApiError({ code: 401, message: 'x' }) }))
      .toEqual({ kind: 'anonymous' });

    expect(await recoverSession(async () => {
      throw new ApiError({ code: 429, message: 'x', retryAfterSeconds: 30 });
    })).toEqual({ kind: 'rate-limited', retryAfterSeconds: 30 });

    const unavailable = await recoverSession(async () => {
      throw new ApiError({ code: 503, message: '认证服务暂时不可用' });
    });
    expect(unavailable.kind).toBe('unavailable');
  });
});

describe('0.9C 错误可追溯：requestId 与 Retry-After', () => {
  it('17. requestId 优先取响应头 X-Request-ID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      500, { code: 500, message: '服务器开小差了', requestId: 'from-envelope' },
      { 'X-Request-ID': 'from-header' },
    )) as unknown as typeof fetch;

    const error = await new HttpTransport({ fetchImpl }).get<never>('/v1/products').catch((e) => e as ApiError);
    expect(error.requestId).toBe('from-header');
    expect(error.httpStatus).toBe(500);
  });

  it('18. 响应头缺失时回落到 envelope 的 requestId', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { code: 409, message: '状态冲突', requestId: 'from-envelope' })) as unknown as typeof fetch;

    const error = await new HttpTransport({ fetchImpl }).get<never>('/v1/orders').catch((e) => e as ApiError);
    expect(error.requestId).toBe('from-envelope');
  });

  it('19. Retry-After 非数字 / 负数 / 缺失一律安全忽略', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30);
    expect(parseRetryAfterSeconds(' 30.2 ')).toBe(31);
    expect(parseRetryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfterSeconds('-5')).toBeUndefined();
    expect(parseRetryAfterSeconds('')).toBeUndefined();
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  it('20. userMessage 携带错误编号但绝不泄漏 Token、Cookie 或 stack', async () => {
    authTokenStore.setAccessToken('super-secret-token');
    const fetchImpl = vi.fn(async () => jsonResponse(
      403, { code: 403, message: '无权操作该订单' }, { 'X-Request-ID': 'rid-abc-123' },
    )) as unknown as typeof fetch;

    const error = await new HttpTransport({ fetchImpl }).get<never>('/v1/orders/1').catch((e) => e as ApiError);
    const text = error.userMessage();

    expect(text).toContain('无权操作该订单');
    expect(text).toContain('rid-abc-123');
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('cm_refresh');
    expect(text).not.toContain('at ');
  });

  it('21. 429 的提示给出等待秒数，而不是错误编号', () => {
    const error = new ApiError({ code: 429, message: '操作过于频繁', retryAfterSeconds: 42, requestId: 'rid-x' });
    expect(error.userMessage()).toContain('42');
    expect(error.userMessage()).not.toContain('rid-x');
  });
});
