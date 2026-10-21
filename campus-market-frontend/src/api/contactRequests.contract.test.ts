// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { CONTACT_REQUEST_HOURLY_LIMIT, type ContactRequest, type ProductCreateInput } from './contracts';

/**
 * 阶段 1 联系申请的契约（docs/contact-display-model.md「联系申请状态」与「API」两节，
 * 后端 ContactRequestsIT / ModerationIT 5）。Mock 部分是 API 调用的行为断言；
 * REST 部分用假的 fetch 核对请求路径、方法与请求体逐字一致，并核对后端错误（409 / 403 / 429）原样传到调用方。
 */

const DB = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
const ids = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const session = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  ids.set(label, session.user.id);
  return session.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const listing = (title: string, extra: Partial<ProductCreateInput> = {}): ProductCreateInput => ({
  title, description: '联系申请契约测试', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: 'wechat:seller-contract', ...extra,
});
async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
/** 卖家发布一件商品，买家申请；返回商品 id 与申请 */
async function requested(title = '契约商品'): Promise<{ productId: string; request: ContactRequest }> {
  await as('seller');
  const productId = (await api.createProduct(listing(title))).id;
  await as('buyer');
  return { productId, request: await api.requestContact(productId) };
}
function makeStaff(userId: string) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.staffMembers.push({ userId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}

beforeEach(async () => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
  await user('seller');
  await user('buyer');
});
afterEach(() => { vi.useRealTimers() });

describe('撤回与重新申请（买家）', () => {
  it('PENDING → WITHDRAWN；重复撤回幂等；卖家不能撤回买家的申请（404）；卖家对已撤回的申请作决定 409「买家已撤回这次申请」', async () => {
    const { request } = await requested();
    const withdrawn = await api.withdrawContactRequest(request.id);
    expect(withdrawn).toMatchObject({ id: request.id, status: 'WITHDRAWN', decidedAt: null });
    expect((await api.withdrawContactRequest(request.id)).status).toBe('WITHDRAWN');
    await as('seller');
    expect((await failure(api.withdrawContactRequest(request.id))).code).toBe(404);
    const conflict = await failure(api.decideContactRequest(request.id, 'APPROVED'));
    expect([conflict.code, conflict.message]).toEqual([409, '买家已撤回这次申请']);
  });

  it('撤回后重新申请回到 PENDING（同一条记录），卖家重新看到一条未读；已同意的申请不能撤回（409）', async () => {
    const { productId, request } = await requested();
    await api.withdrawContactRequest(request.id);
    await as('seller');
    await api.markContactRequestsRead('received');
    expect((await api.getContactRequestUnreadCount()).received).toBe(0);
    await as('buyer');
    const again = await api.requestContact(productId);
    expect([again.id, again.status]).toEqual([request.id, 'PENDING']);
    await as('seller');
    expect((await api.getContactRequestUnreadCount()).received).toBe(1);
    const [item] = (await api.listContactRequests({ role: 'received' })).items;
    expect([item.id, item.status, item.unread]).toEqual([request.id, 'PENDING', true]);
    await api.decideContactRequest(request.id, 'APPROVED');
    await as('buyer');
    const conflict = await failure(api.withdrawContactRequest(request.id));
    expect([conflict.code, conflict.message]).toEqual([409, '该申请已处理']);
  });
});

describe('撤回同意（卖家）', () => {
  it('APPROVED → REVOKED：买家立即看不到联系方式（详情 / 列表 / feed），再次申请 409「卖家已撤回同意，不能再次申请」；重复撤回幂等；买家不能撤回同意（404）', async () => {
    const { productId, request } = await requested();
    await as('seller');
    const approved = await api.decideContactRequest(request.id, 'APPROVED');
    expect(approved.decidedAt).toEqual(expect.any(Number));
    await as('buyer');
    expect((await api.getProduct(productId)).contact).toBe('wechat:seller-contract');
    expect((await failure(api.revokeContactRequest(request.id))).code).toBe(404);
    await as('seller');
    const revoked = await api.revokeContactRequest(request.id);
    expect(revoked).toMatchObject({ id: request.id, status: 'REVOKED' });
    expect(revoked.decidedAt).toBeGreaterThanOrEqual(approved.decidedAt!);
    expect((await api.revokeContactRequest(request.id)).status).toBe('REVOKED');
    await as('buyer');
    expect((await api.getProduct(productId)).contact).toBe('');
    expect((await api.listProducts({ sort: 'latest', page: 1, pageSize: 100 })).items.find((p) => p.id === productId)?.contact).toBe('');
    expect((await api.feedProducts({ sort: 'latest', page: 1, pageSize: 100, scope: 'SCHOOL' })).items.find((p) => p.id === productId)?.contact).toBe('');
    const conflict = await failure(api.requestContact(productId));
    expect([conflict.code, conflict.message]).toEqual([409, '卖家已撤回同意，不能再次申请']);
    expect((await api.getContactRequest(productId))?.status).toBe('REVOKED');
  });

  it('只能撤回已经同意的申请：待处理的申请撤回同意 409；对已撤回同意的申请再作决定 409「卖家已撤回同意」', async () => {
    const { request } = await requested();
    await as('seller');
    const pending = await failure(api.revokeContactRequest(request.id));
    expect([pending.code, pending.message]).toEqual([409, '只能撤回已经同意的申请']);
    await api.decideContactRequest(request.id, 'APPROVED');
    expect((await api.decideContactRequest(request.id, 'APPROVED')).status).toBe('APPROVED');
    await api.revokeContactRequest(request.id);
    const decide = await failure(api.decideContactRequest(request.id, 'APPROVED'));
    expect([decide.code, decide.message]).toEqual([409, '卖家已撤回同意']);
  });
});

describe('分页、角色与状态筛选', () => {
  it('role 默认 received；sent 只列本人发出的；status 筛选；total / page / size；按最近变化倒序', async () => {
    await as('seller');
    const products: string[] = [];
    for (let i = 0; i < 5; i += 1) products.push((await api.createProduct(listing(`分页商品 ${i}`))).id);
    await as('buyer');
    // 只伪造 Date：每一步的 updatedAt 严格递增，排序断言不依赖同一毫秒内的先后
    vi.useFakeTimers({ toFake: ['Date'] });
    let clock = Date.UTC(2026, 9, 19, 8, 0, 0);
    const tick = () => vi.setSystemTime((clock += 60_000));
    const requests: ContactRequest[] = [];
    for (const id of products) { tick(); requests.push(await api.requestContact(id)); }
    tick(); await api.withdrawContactRequest(requests[1].id);
    await as('seller');
    tick(); await api.decideContactRequest(requests[3].id, 'REJECTED');
    vi.useRealTimers();

    const all = await api.listContactRequests();
    expect([all.total, all.page, all.size, all.items.length]).toEqual([5, 1, 20, 5]);
    // 最近变化的在前：被拒绝的、被撤回的，然后按申请时间倒序
    expect(all.items.map((r) => r.id)).toEqual([requests[3].id, requests[1].id, requests[4].id, requests[2].id, requests[0].id]);
    const page = await api.listContactRequests({ role: 'received', page: 2, size: 2 });
    expect([page.total, page.page, page.size, page.items.length]).toEqual([5, 2, 2, 2]);
    expect(page.items.map((r) => r.id)).toEqual(all.items.slice(2, 4).map((r) => r.id));
    expect((await api.listContactRequests({ role: 'received', page: 3, size: 2 })).items).toHaveLength(1);
    const withdrawn = await api.listContactRequests({ role: 'received', status: 'WITHDRAWN' });
    expect([withdrawn.total, withdrawn.items.map((r) => r.id)]).toEqual([1, [requests[1].id]]);
    expect((await api.listContactRequests({ role: 'sent' })).total).toBe(0);
    await as('buyer');
    const sent = await api.listContactRequests({ role: 'sent', status: 'PENDING' });
    expect(sent.items.map((r) => r.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(sent.items.every((r) => r.buyerId === ids.get('buyer') && r.sellerNickname === 'seller')).toBe(true);
    expect((await api.listContactRequests()).total).toBe(0);
  });

  it('参数校验与后端一致：size 1～50、page ≥ 1、role 只能 received / sent、未知状态与未知参数 400', async () => {
    for (const bad of [{ size: 51 }, { size: 0 }, { page: 0 }, { role: 'buyer' }, { status: 'CANCELLED' }, { mine: true }]) {
      expect((await failure(api.listContactRequests(bad as never))).code, JSON.stringify(bad)).toBe(400);
    }
    expect((await api.listContactRequests({ size: 50 })).size).toBe(50);
  });
});

describe('站内未读', () => {
  it('卖家：新申请未读，标记 received 已读后清零；买家：同意 / 拒绝 / 撤回同意各算一条，标记 sent 已读后清零；撤回申请让卖家的未读减少', async () => {
    const first = await requested('未读一');
    const second = await requested('未读二');
    await as('seller');
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 2, updates: 0, total: 2 });
    expect((await api.listContactRequests()).items.every((r) => r.unread)).toBe(true);
    await as('buyer');
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 0, updates: 0, total: 0 });
    await api.withdrawContactRequest(second.request.id);
    await as('seller');
    expect((await api.getContactRequestUnreadCount()).received).toBe(1);
    expect(await api.markContactRequestsRead('received')).toEqual({ received: 0, updates: 0, total: 0 });
    expect((await api.listContactRequests()).items.some((r) => r.unread)).toBe(false);
    await api.decideContactRequest(first.request.id, 'APPROVED');
    await as('buyer');
    expect(await api.getContactRequestUnreadCount()).toEqual({ received: 0, updates: 1, total: 1 });
    expect((await api.listContactRequests({ role: 'sent', status: 'APPROVED' })).items[0].unread).toBe(true);
    // 标记另一个角色不影响这一边
    expect((await api.markContactRequestsRead('received')).updates).toBe(1);
    expect(await api.markContactRequestsRead('sent')).toEqual({ received: 0, updates: 0, total: 0 });
    await as('seller');
    await api.revokeContactRequest(first.request.id);
    await as('buyer');
    expect((await api.getContactRequestUnreadCount()).updates).toBe(1);
    expect((await failure(api.markContactRequestsRead('all' as never))).code).toBe(400);
  });
});

describe('「申请联系方式」限制与限流', () => {
  it('CONTACT 限制：新申请 403 + details { code: RESTRICTED, scope: CONTACT, endsAt }，消息写明解除时间；已有申请照常查看与撤回，私信不受影响', async () => {
    const { productId, request } = await requested('受限前的申请');
    await as('seller');
    const other = (await api.createProduct(listing('受限后想申请的商品'))).id;
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId: ids.get('buyer')!, reasonCode: 'HARASSMENT' });
    makeStaff(await user('staff'));
    await as('staff');
    const caseId = (await api.listModerationCases({ status: 'OPEN' })).items[0].id;
    expect((await api.getModerationCase(caseId)).allowedActions).toContain('RESTRICT_CONTACT');
    await api.decideModerationCase(caseId, { action: 'RESTRICT_CONTACT', reasonCode: 'HARASSMENT', durationHours: 24 });
    await as('buyer');
    const blocked = await failure(api.requestContact(other));
    expect(blocked.code).toBe(403);
    expect(blocked.details).toEqual({ code: 'RESTRICTED', scope: 'CONTACT', endsAt: expect.any(Number) });
    expect(blocked.message).toMatch(/^你的「申请联系方式」功能暂时受限，至 \d{1,2} 月 \d{1,2} 日 \d{2}:\d{2} 自动恢复。可以在「我的限制」里查看原因或提交申诉。$/);
    expect((await api.getContactRequest(productId))?.status).toBe('PENDING');
    expect((await api.withdrawContactRequest(request.id)).status).toBe('WITHDRAWN');
    // 重新申请同样是「新申请」，受限期间被拦下
    expect((await failure(api.requestContact(productId))).code).toBe(403);
    const conversation = await api.getOrCreateConversation(other);
    // REWRITTEN（私信只能发送快捷消息）：联系受限不影响发送快捷消息
    expect((await api.sendMessage(conversation.id, { templateCode: 'BUYER_STILL_AVAILABLE' })).content).toBe('你好，这件还在吗？');
    expect((await api.getMyGovernance()).restrictions[0]).toMatchObject({ scope: 'CONTACT', source: 'CASE', active: true, canAppeal: true });
  });

  it('历史上的 BOOKING（预约新订单）限制在到期前同样拦截联系申请，详情里的范围是 CONTACT', async () => {
    await as('seller');
    const productId = (await api.createProduct(listing('历史限制'))).id;
    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    const now = Date.now();
    raw.userRestrictions.push({ id: 'legacy-booking', userId: ids.get('buyer'), schoolId: 'pilot', scope: 'BOOKING', source: 'CASE', caseId: null,
      noShowReportId: null, createdBy: null, reasonCode: 'OTHER', startsAt: now - 1000, endsAt: now + 3_600_000, createdAt: now - 1000,
      revokedAt: null, revokedBy: null, revokeReason: null, ruleVersion: null, decidedAt: now - 1000, basis: [], lastCorrectionId: null });
    window.localStorage.setItem(DB, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    await as('buyer');
    const blocked = await failure(api.requestContact(productId));
    expect([blocked.code, (blocked.details as { scope: string }).scope]).toEqual([403, 'CONTACT']);
    expect(blocked.message).toContain('「申请联系方式」');
  });

  it(`同一用户每小时最多 ${CONTACT_REQUEST_HOURLY_LIMIT} 次新申请：超限 429 带 Retry-After；对同一件商品的重复请求不计数`, async () => {
    await as('seller');
    const products: string[] = [];
    for (let i = 0; i <= CONTACT_REQUEST_HOURLY_LIMIT; i += 1) products.push((await api.createProduct(listing(`限流 ${i}`))).id);
    await as('buyer');
    for (let i = 0; i < CONTACT_REQUEST_HOURLY_LIMIT; i += 1) {
      await api.requestContact(products[i]);
      await api.requestContact(products[i]);   // 幂等重复，不计数
    }
    const limited = await failure(api.requestContact(products[CONTACT_REQUEST_HOURLY_LIMIT]));
    expect([limited.code, limited.message]).toEqual([429, '请求过于频繁，请稍后再试']);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(await api.getContactRequest(products[CONTACT_REQUEST_HOURLY_LIMIT])).toBeNull();
  });
});

describe('REST 适配层（联系申请）', () => {
  function stub(respond: (url: string, init?: RequestInit) => Response = () => new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })) {
    const calls: Array<{ method: string; url: string; body: string | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return respond(String(url), init);
    }) as unknown as typeof fetch;
    return { calls, rest: new RestCampusMarketApi(new HttpTransport({ fetchImpl })) };
  }

  it('逐字核对路径、方法与请求体：申请 / 撤回 / 撤回同意不带请求体，决定只带 status，已读只带 role，列表只下发给出的参数', async () => {
    const { calls, rest } = stub();
    await rest.getContactRequest('p 1');
    await rest.requestContact('p1');
    await rest.listContactRequests();
    await rest.listContactRequests({ role: 'sent' });
    await rest.listContactRequests({ role: 'received', status: 'WITHDRAWN', page: 2, size: 50 });
    await rest.getContactRequestUnreadCount();
    await rest.markContactRequestsRead('sent');
    await rest.decideContactRequest('c1', 'APPROVED');
    await rest.withdrawContactRequest('c1');
    await rest.revokeContactRequest('c/2');
    expect(calls.map((c) => [c.method, c.url, c.body ?? null])).toEqual([
      ['GET', '/v1/products/p%201/contact-request', null],
      ['POST', '/v1/products/p1/contact-request', null],
      ['GET', '/v1/contact-requests', null],
      ['GET', '/v1/contact-requests?role=sent', null],
      ['GET', '/v1/contact-requests?role=received&status=WITHDRAWN&page=2&size=50', null],
      ['GET', '/v1/contact-requests/unread-count', null],
      ['POST', '/v1/contact-requests/read', '{"role":"sent"}'],
      ['POST', '/v1/contact-requests/c1/decision', '{"status":"APPROVED"}'],
      ['POST', '/v1/contact-requests/c1/withdraw', null],
      ['POST', '/v1/contact-requests/c%2F2/revoke', null],
    ]);
  });

  it('响应原样交给调用方：分页结构、未读数；409 / 403（RESTRICTED 详情）/ 429（Retry-After）的消息与结构不被改写', async () => {
    const page = { items: [{ id: 'c1', status: 'REVOKED', unread: true }], total: 1, page: 1, size: 20 };
    const errors: Record<string, Response> = {
      '/v1/products/rejected/contact-request': new Response(JSON.stringify({ code: 409, message: '卖家已拒绝这次申请，不能再次申请', data: null }), { status: 409 }),
      '/v1/products/revoked/contact-request': new Response(JSON.stringify({ code: 409, message: '卖家已撤回同意，不能再次申请', data: null }), { status: 409 }),
      '/v1/products/restricted/contact-request': new Response(JSON.stringify({ code: 403, message: '你的「申请联系方式」功能暂时受限，至 10 月 20 日 18:00 自动恢复。可以在「我的限制」里查看原因或提交申诉。',
        data: { code: 'RESTRICTED', scope: 'CONTACT', endsAt: 1_800_000_000_000 } }), { status: 403 }),
      '/v1/products/busy/contact-request': new Response(JSON.stringify({ code: 429, message: '请求过于频繁，请稍后再试', data: null }), { status: 429, headers: { 'Retry-After': '120' } }),
    };
    const { rest } = stub((url) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (errors[path]) return errors[path];
      const data = path.startsWith('/v1/contact-requests/unread-count') ? { received: 2, updates: 1, total: 3 } : page;
      return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
    });
    expect(await rest.listContactRequests({ role: 'sent' })).toEqual(page);
    expect(await rest.getContactRequestUnreadCount()).toEqual({ received: 2, updates: 1, total: 3 });
    const rejected = await failure(rest.requestContact('rejected'));
    expect([rejected.code, rejected.message]).toEqual([409, '卖家已拒绝这次申请，不能再次申请']);
    expect((await failure(rest.requestContact('revoked'))).message).toBe('卖家已撤回同意，不能再次申请');
    const restricted = await failure(rest.requestContact('restricted'));
    expect([restricted.code, restricted.details]).toEqual([403, { code: 'RESTRICTED', scope: 'CONTACT', endsAt: 1_800_000_000_000 }]);
    expect(restricted.message).toContain('「申请联系方式」功能暂时受限');
    const busy = await failure(rest.requestContact('busy'));
    expect([busy.code, busy.retryAfterSeconds]).toEqual([429, 120]);
  });
});
