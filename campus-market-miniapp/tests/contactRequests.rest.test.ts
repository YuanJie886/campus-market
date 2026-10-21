import { describe, expect, it, vi } from 'vitest';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { RestApi, parseContactPage } from '../src/api/rest';

const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' } });
const wire = { id: 'r1', productId: 'p1', buyerId: 'b', sellerId: 's', status: 'APPROVED', createdAt: 10, updatedAt: 20, decidedAt: 20, productTitle: '台灯', buyerNickname: '买家', sellerNickname: '卖家', unread: true };

function setup(reply: (input: Parameters<RequestPort>[0]) => Response) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  const api = new RestApi(new Transport(handler, 'https://campus.example', true));
  return { api, calls: () => handler.mock.calls.map(([input]) => input) };
}

describe('小程序 REST 联系申请接口', () => {
  it('列表按角色分页：只发送 role / status / page / size，并解析 { items, total, page, size }', async () => {
    const { api, calls } = setup(() => ok({ items: [wire], total: 41, page: 2, size: 20 }));
    const page = await api.contacts({ role: 'sent', status: 'REVOKED', page: 2, size: 20 });
    expect(page).toEqual({ items: [{ ...wire }], total: 41, page: 2, size: 20 });
    await api.contacts({ role: 'received' });
    expect(calls().map((c) => [c.method, c.url, c.data])).toEqual([
      ['GET', 'https://campus.example/v1/contact-requests?role=sent&status=REVOKED&page=2&size=20', undefined],
      ['GET', 'https://campus.example/v1/contact-requests?role=received', undefined],
    ]);
  });

  it('撤回申请、撤回同意、处理申请使用各自的路径，请求体不带多余字段', async () => {
    const { api, calls } = setup((input) => ok({ ...wire, status: input.url.endsWith('/withdraw') ? 'WITHDRAWN' : 'REVOKED' }));
    expect((await api.withdraw('id/1')).status).toBe('WITHDRAWN');
    expect((await api.revoke('r1')).status).toBe('REVOKED');
    await api.decide('r1', 'REJECTED');
    expect(calls().map((c) => [c.method, c.url, c.data])).toEqual([
      ['POST', 'https://campus.example/v1/contact-requests/id%2F1/withdraw', undefined],
      ['POST', 'https://campus.example/v1/contact-requests/r1/revoke', undefined],
      ['POST', 'https://campus.example/v1/contact-requests/r1/decision', { status: 'REJECTED' }],
    ]);
  });

  it('未读数与标记已读：GET unread-count，POST read 只带 role', async () => {
    const { api, calls } = setup((input) => ok(input.url.endsWith('/read') ? { received: 0, updates: 2, total: 2 } : { received: 3, updates: 2, total: 5 }));
    expect(await api.unreadCount()).toEqual({ received: 3, updates: 2, total: 5 });
    expect(await api.markRead('received')).toEqual({ received: 0, updates: 2, total: 2 });
    expect(calls().map((c) => [c.method, c.url, c.data])).toEqual([
      ['GET', 'https://campus.example/v1/contact-requests/unread-count', undefined],
      ['POST', 'https://campus.example/v1/contact-requests/read', { role: 'received' }],
    ]);
  });

  it('申请与查询本人申请：POST 不带请求体，尚未申请返回 null；409 文案原样传给页面', async () => {
    let state: unknown = null;
    const { api, calls } = setup((input) => input.method === 'POST'
      ? { statusCode: 409, data: { code: 409, message: '卖家已撤回同意，不能再次申请' } }
      : ok(state));
    expect(await api.contactState('p1')).toBeNull();
    state = { ...wire, status: 'REVOKED' };
    expect(await api.contactState('p1')).toMatchObject({ id: 'r1', status: 'REVOKED' });
    await expect(api.requestContact('p1')).rejects.toMatchObject({ code: 409, message: '卖家已撤回同意，不能再次申请' });
    expect(calls().map((c) => [c.method, c.url, c.data])).toEqual([
      ['GET', 'https://campus.example/v1/products/p1/contact-request', undefined],
      ['GET', 'https://campus.example/v1/products/p1/contact-request', undefined],
      ['POST', 'https://campus.example/v1/products/p1/contact-request', undefined],
    ]);
  });

  it('页面解析：旧的数组响应与未知状态视为响应异常，缺省的新字段给出安全默认值', () => {
    expect(() => parseContactPage([wire])).toThrow('服务响应异常');
    expect(() => parseContactPage({ items: [{ ...wire, status: 'CANCELLED' }], total: 1, page: 1, size: 20 })).toThrow('服务响应异常');
    const legacy = { id: 'r2', productId: 'p', buyerId: 'b', sellerId: 's', status: 'PENDING', createdAt: 1, updatedAt: 1 };
    expect(parseContactPage({ items: [legacy], total: 1, page: 1, size: 20 }).items[0]).toMatchObject({ sellerNickname: '', decidedAt: null, unread: false });
  });
});
