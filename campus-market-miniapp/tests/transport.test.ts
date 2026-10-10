import { describe, expect, it, vi } from 'vitest';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { RestApi } from '../src/api/rest';
import type { Session } from '../src/model';

const session: Session = { accessToken: 'token-new', expiresAtIso: '2030-01-01T00:00:00Z', user: { id: 'me', nickname: '同学', campus: '东校区' } };
const ok = (data: unknown, cookies?: string[]): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' }, cookies });
const unauthorized: Response = { statusCode: 401, data: { code: 401, message: '请先登录' } };

describe('小程序 REST 请求适配', () => {
  it('迟到的旧令牌 401 复用新令牌，退出后未完成的刷新不能恢复会话', async () => {
    let refreshes = 0;
    const transport = new Transport(async (input) => {
      if (input.url.endsWith('/auth/refresh')) { refreshes++; return ok(session, ['cm_refresh=rotated']); }
      if (input.header.Authorization === 'Bearer expired') {
        if (input.url.endsWith('/slow')) await new Promise((r) => setTimeout(r, 20));
        return unauthorized;
      }
      return ok({});
    }, 'https://campus.example', true);
    transport.setSession({ ...session, accessToken: 'expired' });
    await Promise.all([transport.request('/v1/fast'), transport.request('/v1/slow')]);
    expect(refreshes).toBe(1);
    let resolve: (response: Response) => void = () => {};
    const delayed = new Transport(async (input) => input.url.endsWith('/auth/refresh')
      ? new Promise<Response>((r) => { resolve = r; }) : unauthorized, 'https://campus.example', true);
    delayed.setSession(session);
    const request = delayed.request('/v1/products');
    await new Promise((r) => setTimeout(r, 0));
    delayed.clear(); resolve(ok(session, ['cm_refresh=late']));
    await expect(request).rejects.toThrow('请先登录');
    expect(delayed.authorization).toBe(''); expect(delayed.canRestore).toBe(false);
  });
  it('并发 401 只刷新一次，轮换 Cookie 只发给同源认证路径，Token 不持久化', async () => {
    const seen: Parameters<RequestPort>[0][] = [];
    const handler = vi.fn<RequestPort>(async (input) => {
      seen.push(input);
      if (input.url.endsWith('/auth/login')) return ok(session, ['cm_refresh=first; HttpOnly; Path=/v1/auth']);
      if (input.url.endsWith('/auth/refresh')) { await new Promise((r) => setTimeout(r, 10)); return ok(session, ['cm_refresh=rotated; HttpOnly']); }
      if (input.url.endsWith('/auth/logout')) return ok({}, ['cm_refresh=; Max-Age=0']);
      return input.header.Authorization === 'Bearer expired' ? unauthorized : ok({ accepted: true });
    });
    const transport = new Transport(handler, 'https://campus.example', true);
    await transport.login({ account: 'a', password: 'b' }); transport.setSession({ ...session, accessToken: 'expired' });
    await Promise.all([transport.request('/v1/products'), transport.request('/v1/favorites')]);
    expect(seen.filter((r) => r.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(seen.find((r) => r.url.endsWith('/auth/refresh'))?.header.Cookie).toBe('cm_refresh=first');
    expect(seen.filter((r) => !r.url.includes('/auth/')).every((r) => !r.header.Cookie)).toBe(true);
    await transport.logout(); expect(seen[seen.length - 1]?.header.Cookie).toBe('cm_refresh=rotated');
    expect(transport.canRestore).toBe(false); expect(transport.authorization).toBe('');
  });
  it('429、网络失败和登录 401 不会自动重试，刷新失败结束会话', async () => {
    const limited = vi.fn<RequestPort>(async () => ({ statusCode: 429, data: { code: 429, message: 'limited' } }));
    await expect(new Transport(limited, 'https://campus.example', true).request('/v1/products', 'POST', {})).rejects.toThrow('频繁');
    expect(limited).toHaveBeenCalledTimes(1);
    const bad = vi.fn<RequestPort>(async () => unauthorized), transport = new Transport(bad, 'https://campus.example', true);
    await expect(transport.login({})).rejects.toThrow('请先登录'); expect(bad).toHaveBeenCalledTimes(1);
    transport.setSession(session);
    await expect(transport.request('/v1/products')).rejects.toThrow('请先登录');
    expect(transport.authorization).toBe('');
    const network = vi.fn<RequestPort>(async () => { throw new Error('offline'); });
    await expect(new Transport(network, '', true).request('/v1/products')).rejects.toThrow('网络'); expect(network).toHaveBeenCalledTimes(1);
  });
  it('H5 使用浏览器 Cookie，不伪造 Cookie 请求头；原生冷启动要求重新登录', async () => {
    const handler = vi.fn<RequestPort>(async () => ok(session, ['cm_refresh=value; HttpOnly']));
    const browser = new Transport(handler, 'https://campus.example', false);
    expect(await browser.restore()).toEqual(session); await browser.logout();
    expect(handler.mock.calls.every(([input]) => !input.header.Cookie)).toBe(true);
    const native = new Transport(handler, 'https://campus.example', true);
    expect(await native.restore()).toBeNull();
  });
  it('REST 联系与收藏沿用真实接口，不调用旧订单接口；查询正确编码并保留零价格', async () => {
    const handler = vi.fn<RequestPort>(async (input) => ok(input.url.includes('/auth/login') ? session : {}));
    const api = new RestApi(new Transport(handler, 'https://campus.example', true), async () => 'https://image.example/a.png');
    await api.login('myaccount', 'password'); await api.list({ keyword: '台灯 & 书', page: 1, pageSize: 12, sort: 'latest', minPrice: 0 });
    await api.requestContact('item'); await api.decide('request', 'APPROVED'); await api.favorite('item', true); await api.favorite('item', false);
    const calls = handler.mock.calls.map(([input]) => input);
    expect(calls[1].url).toContain('minPrice=0'); expect(calls[1].url).toContain(encodeURIComponent('台灯 & 书'));
    expect(calls[2]).toMatchObject({ url: 'https://campus.example/v1/products/item/contact-request', method: 'POST' });
    expect(calls[3]).toMatchObject({ data: { status: 'APPROVED' } });
    expect(calls[4].method).toBe('PUT'); expect(calls[5].method).toBe('DELETE');
    expect(calls.some((call) => call.url.includes('/orders'))).toBe(false);
  });
});
