import { describe, expect, it, vi } from 'vitest';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { RestApi } from '../src/api/rest';
import type { Session } from '../src/model';

const BASE = 'https://campus.example';
const TICKET = 'a'.repeat(64);
const session: Session = { accessToken: 'token-wechat', expiresAtIso: '2030-01-01T00:00:00Z', user: { id: 'me', nickname: '同学', campus: '东校区' } };
const ok = (data: unknown, cookies?: string[]): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' }, cookies });
const fail = (status: number, message: string): Response => ({ statusCode: status, data: { code: status, message } });

function setup(reply: (input: Parameters<RequestPort>[0]) => Response | Promise<Response>) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  const transport = new Transport(handler, BASE, true);
  const api = new RestApi(transport);
  return { api, transport, calls: () => handler.mock.calls.map(([input]) => input) };
}
const wire = (calls: Parameters<RequestPort>[0][]) => calls.map((c) => [c.method, c.url.replace(BASE, ''), c.data]);

describe('REST 账号生命周期：路径与请求体（与后端白名单逐字段一致）', () => {
  it('修改密码、凭重置码找回、注销各自只发送白名单字段', async () => {
    const { api, calls } = setup((input) => ok(input.url.endsWith('/password') ? { changed: true, otherSessionsEnded: 2 }
      : input.url.endsWith('/me/deletion') ? { deleted: true, productsTakenDown: 1, requestsClosed: 3, membershipsEnded: 0 } : { reset: true }));
    expect(await api.changePassword('old-pass', 'new-pass-123')).toEqual({ otherSessionsEnded: 2 });
    await api.resetPassword({ account: ' student01 ', code: ' abcd-efgh-jkmn ', newPassword: 'new-pass-123' });
    expect(await api.deleteAccount({ password: 'pw-123456', confirmation: '确认注销' })).toEqual({ productsTakenDown: 1, requestsClosed: 3, membershipsEnded: 0 });
    expect(wire(calls())).toEqual([
      ['POST', '/v1/auth/password', { currentPassword: 'old-pass', newPassword: 'new-pass-123' }],
      ['POST', '/v1/auth/password-reset', { account: 'student01', code: 'abcd-efgh-jkmn', newPassword: 'new-pass-123' }],
      ['POST', '/v1/auth/me/deletion', { password: 'pw-123456', confirmation: '确认注销' }],
    ]);
  });

  it('微信状态、绑定、解绑：GET /v1/auth/wechat、POST {bindTicket}、POST 无请求体', async () => {
    const { api, calls } = setup((input) => ok(input.url.endsWith('/v1/auth/wechat') ? { enabled: true, bound: false } : { bound: !input.url.endsWith('/unbind') }));
    expect(await api.wechatStatus()).toEqual({ enabled: true, bound: false });
    await api.wechatBind(TICKET);
    await api.wechatUnbind();
    expect(wire(calls())).toEqual([
      ['GET', '/v1/auth/wechat', undefined],
      ['POST', '/v1/auth/wechat/bind', { bindTicket: TICKET }],
      ['POST', '/v1/auth/wechat/unbind', undefined],
    ]);
  });

  it('微信状态缺字段或非布尔时按未开通处理', async () => {
    const { api } = setup(() => ok({ enabled: 'yes' }));
    expect(await api.wechatStatus()).toEqual({ enabled: false, bound: false });
  });
});

describe('REST 微信登录', () => {
  it('已绑定：与密码登录一样建立会话，并捕获 Set-Cookie 里的刷新 Cookie 供之后的 /v1/auth/ 请求使用', async () => {
    const { api, transport, calls } = setup((input) => input.url.endsWith('/wechat/login')
      ? ok({ ...session, bound: true }, ['cm_refresh=wx-refresh; HttpOnly; Path=/v1/auth'])
      : ok(session, ['cm_refresh=rotated; HttpOnly']));
    const result = await api.wechatLogin('wx_code-1');
    expect(result).toEqual({ bound: true, user: session.user });
    expect(transport.authorization).toBe('Bearer token-wechat');
    expect(transport.canRestore).toBe(true);
    await api.restore();
    const [login, refresh] = calls();
    expect([login.method, login.url, login.data]).toEqual(['POST', `${BASE}/v1/auth/wechat/login`, { code: 'wx_code-1' }]);
    expect(login.header.Authorization).toBeUndefined();
    expect(refresh.url).toBe(`${BASE}/v1/auth/refresh`);
    expect(refresh.header.Cookie).toBe('cm_refresh=wx-refresh');
  });

  it('未绑定：只返回绑定票据，不建立会话、不改 Cookie', async () => {
    const { api, transport } = setup(() => ok({ bound: false, bindTicket: TICKET, expiresAt: 1_900_000_000_000 }));
    expect(await api.wechatLogin('wx_code')).toEqual({ bound: false, bindTicket: TICKET, expiresAt: 1_900_000_000_000 });
    expect(transport.authorization).toBe('');
    expect(transport.canRestore).toBe(false);
  });

  it('503「微信登录尚未开通」与 400 凭证无效原样抛出，且不重试、不刷新', async () => {
    const disabled = setup(() => fail(503, '微信登录尚未开通'));
    await expect(disabled.api.wechatLogin('wx_code')).rejects.toMatchObject({ code: 503, message: '微信登录尚未开通' });
    expect(disabled.calls()).toHaveLength(1);
    const invalid = setup(() => fail(400, '微信登录凭证无效或已过期，请重试'));
    await expect(invalid.api.wechatLogin('bad')).rejects.toMatchObject({ code: 400, message: '微信登录凭证无效或已过期，请重试' });
    expect(invalid.calls()).toHaveLength(1);
  });

  it('响应既不是会话也不是票据时视为响应异常', async () => {
    const { api, transport } = setup(() => ok({ bound: true }));
    await expect(api.wechatLogin('wx_code')).rejects.toMatchObject({ code: -1 });
    expect(transport.authorization).toBe('');
  });
});

describe('REST 账号接口的会话处理', () => {
  it('注销成功后本机立即丢弃访问令牌与刷新 Cookie', async () => {
    const { api, transport } = setup((input) => input.url.endsWith('/auth/login')
      ? ok(session, ['cm_refresh=first; HttpOnly'])
      : ok({ deleted: true, productsTakenDown: 0, requestsClosed: 0, membershipsEnded: 0 }, ['cm_refresh=; Max-Age=0']));
    await api.login('student01', 'pw-123456');
    expect(transport.canRestore).toBe(true);
    await api.deleteAccount({ password: 'pw-123456', confirmation: '确认注销' });
    expect(transport.authorization).toBe('');
    expect(transport.canRestore).toBe(false);
    expect(await api.restore()).toBeNull();
  });

  it('注销被 409 拒绝时保留会话，并原样给出后端原因', async () => {
    const message = '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销';
    const { api, transport } = setup((input) => input.url.endsWith('/auth/login') ? ok(session, ['cm_refresh=first']) : fail(409, message));
    await api.login('student01', 'pw-123456');
    await expect(api.deleteAccount({ password: 'pw-123456', confirmation: '确认注销' })).rejects.toMatchObject({ code: 409, message });
    expect(transport.authorization).toBe('Bearer token-wechat');
  });

  it('访问令牌过期时，修改密码等带令牌的 /v1/auth/ 接口刷新一次后重试；登录类接口的 401 不刷新', async () => {
    let token = 'expired';
    const { api, transport, calls } = setup((input) => {
      if (input.url.endsWith('/auth/refresh')) { token = 'fresh'; return ok({ ...session, accessToken: 'fresh' }, ['cm_refresh=rotated']); }
      if (input.url.endsWith('/auth/password-reset')) return fail(401, '请先登录');
      return input.header.Authorization === `Bearer ${token}` && token === 'fresh' ? ok({ changed: true, otherSessionsEnded: 0 }) : fail(401, '登录已失效，请重新登录');
    });
    transport.setSession({ ...session, accessToken: 'expired' });
    await api.changePassword('old-pass', 'new-pass-123');
    expect(calls().map((c) => c.url.replace(BASE, ''))).toEqual(['/v1/auth/password', '/v1/auth/refresh', '/v1/auth/password']);
    await expect(api.resetPassword({ account: 'a', code: 'c', newPassword: 'new-pass-123' })).rejects.toThrow('请先登录');
    expect(calls().filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(transport.authorization).toBe('Bearer fresh');
  });
});
