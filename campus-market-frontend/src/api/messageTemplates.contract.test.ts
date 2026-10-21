// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { CONTENT_BLOCKED_MESSAGE, normalizeClientConfig, templatesForRole, type MessageTemplate, type ProductCreateInput } from './contracts';
import { authTokenStore } from '../utils/authTokenStore';
import { DEMO_ACCOUNT, DEMO_PASSWORD } from '../data/seed';

/**
 * 私信快捷消息的契约（NEW）：GET /v1/message-templates、POST /v1/conversations/{id}/messages 的 { templateCode }、
 * GET /v1/config 的 messages.freeTextEnabled。Mock 部分是 API 调用的行为断言（与后端 MessagingPolicy 同一套规则与原话）；
 * REST 部分用假的 fetch 核对路径、方法与请求体逐字一致，旧后端缺字段时按「只能发快捷消息」处理。
 */

const EXPECTED: MessageTemplate[] = [
  { code: 'BUYER_STILL_AVAILABLE', text: '你好，这件还在吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_CONDITION', text: '可以再介绍一下成色和使用情况吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_PRICE', text: '价格还有商量的空间吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_PHOTOS', text: '方便在商品里补充几张实物照片吗？', role: 'BUYER' },
  { code: 'BUYER_ASK_CONTACT', text: '我想要这件，已在商品页申请联系方式，麻烦同意一下。', role: 'BUYER' },
  { code: 'SELLER_AVAILABLE', text: '还在的，可以在商品页申请联系方式。', role: 'SELLER' },
  { code: 'SELLER_SOLD', text: '不好意思，已经出了。', role: 'SELLER' },
  { code: 'SELLER_PRICE_FIRM', text: '价格不议，谢谢理解。', role: 'SELLER' },
  { code: 'SELLER_PRICE_NEGOTIABLE', text: '价格可以商量，交换联系方式后细聊。', role: 'SELLER' },
  { code: 'SELLER_CONTACT_VIA_REQUEST', text: '请在商品页点「申请联系方式」，我同意后你就能看到。', role: 'SELLER' },
  { code: 'SELLER_PHOTOS_ADDED', text: '照片已补充，刷新商品页就能看到。', role: 'SELLER' },
  { code: 'ANY_THANKS', text: '好的，谢谢！', role: 'ANY' },
  { code: 'ANY_LATER', text: '稍等，我晚点回复你。', role: 'ANY' },
];

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return s.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const listing = (title: string): ProductCreateInput => ({
  title, description: '快捷消息契约测试', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});
async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
/** 卖家发布、买家打开会话；返回会话 id（当前登录身份为买家） */
async function conversation(): Promise<string> {
  await user('seller');
  const product = await api.createProduct(listing('快捷消息商品'));
  await user('buyer');
  return (await api.getOrCreateConversation(product.id)).id;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
});
afterEach(() => { vi.restoreAllMocks(); authTokenStore.clearAccessToken() });

describe('Mock：GET /v1/message-templates 与 /v1/config', () => {
  it('需要登录；13 条模板逐字、按固定顺序返回；默认不开放文字（模板接口与 /v1/config 一致）', async () => {
    expect((await failure(api.listMessageTemplates())).code).toBe(401);
    await user('reader');
    expect(await api.listMessageTemplates()).toEqual({ freeTextEnabled: false, templates: EXPECTED });
    expect((await api.getClientConfig()).messages).toEqual({ freeTextEnabled: false });
  });

  it('部署开关打开时（Mock 构造参数）：模板接口与 /v1/config 都报告 freeTextEnabled=true', async () => {
    api = new MockCampusMarketApi({ messageFreeTextEnabled: true });
    await user('reader');
    expect((await api.listMessageTemplates()).freeTextEnabled).toBe(true);
    expect((await api.getClientConfig()).messages).toEqual({ freeTextEnabled: true });
  });

  it('templatesForRole：买家只看到 BUYER + ANY，卖家只看到 SELLER + ANY，顺序不变', () => {
    expect(templatesForRole(EXPECTED, 'BUYER').map((t) => t.code)).toEqual([
      'BUYER_STILL_AVAILABLE', 'BUYER_ASK_CONDITION', 'BUYER_ASK_PRICE', 'BUYER_ASK_PHOTOS', 'BUYER_ASK_CONTACT', 'ANY_THANKS', 'ANY_LATER']);
    expect(templatesForRole(EXPECTED, 'SELLER').map((t) => t.code)).toEqual([
      'SELLER_AVAILABLE', 'SELLER_SOLD', 'SELLER_PRICE_FIRM', 'SELLER_PRICE_NEGOTIABLE', 'SELLER_CONTACT_VIA_REQUEST', 'SELLER_PHOTOS_ADDED', 'ANY_THANKS', 'ANY_LATER']);
  });
});

describe('Mock：POST /v1/conversations/{id}/messages { templateCode }', () => {
  it('买家发 BUYER_* 与 ANY_*，卖家发 SELLER_* 与 ANY_*：正文是模板原文，响应与列表都带 templateCode', async () => {
    const id = await conversation();
    expect(await api.sendMessage(id, { templateCode: 'BUYER_STILL_AVAILABLE' })).toMatchObject({ content: '你好，这件还在吗？', templateCode: 'BUYER_STILL_AVAILABLE', quarantined: false });
    expect((await api.sendMessage(id, { templateCode: 'ANY_LATER' })).content).toBe('稍等，我晚点回复你。');
    await as('seller');
    expect((await api.sendMessage(id, { templateCode: 'SELLER_AVAILABLE' })).templateCode).toBe('SELLER_AVAILABLE');
    expect((await api.sendMessage(id, { templateCode: 'ANY_THANKS' })).content).toBe('好的，谢谢！');
    expect((await api.listMessages(id)).map((m) => [m.templateCode, m.content])).toEqual([
      ['BUYER_STILL_AVAILABLE', '你好，这件还在吗？'], ['ANY_LATER', '稍等，我晚点回复你。'],
      ['SELLER_AVAILABLE', '还在的，可以在商品页申请联系方式。'], ['ANY_THANKS', '好的，谢谢！'],
    ]);
  });

  it('身份不符 400「这条快捷消息不能由你发送」；不存在的代码 400「快捷消息不存在」；被拒的请求不写入任何消息', async () => {
    const id = await conversation();
    expect(await failure(api.sendMessage(id, { templateCode: 'SELLER_SOLD' }))).toMatchObject({ code: 400, message: '这条快捷消息不能由你发送' });
    expect(await failure(api.sendMessage(id, { templateCode: 'NO_SUCH_TEMPLATE' }))).toMatchObject({ code: 400, message: '快捷消息不存在' });
    await as('seller');
    expect(await failure(api.sendMessage(id, { templateCode: 'BUYER_ASK_PRICE' }))).toMatchObject({ code: 400, message: '这条快捷消息不能由你发送' });
    expect(await api.listMessages(id)).toEqual([]);
  });

  it('文字关闭（默认）：{ content } 400「私信目前只能发送预设的快捷消息」，两个字段都带也一样；空请求体 400「请选择一条快捷消息」', async () => {
    const id = await conversation();
    expect(await failure(api.sendMessage(id, { content: '还在吗' }))).toMatchObject({ code: 400, message: '私信目前只能发送预设的快捷消息' });
    const both = { templateCode: 'BUYER_STILL_AVAILABLE', content: '还在吗' } as unknown as { content: string };
    expect(await failure(api.sendMessage(id, both))).toMatchObject({ code: 400, message: '私信目前只能发送预设的快捷消息' });
    expect(await failure(api.sendMessage(id, {} as { content: string }))).toMatchObject({ code: 400, message: '请选择一条快捷消息' });
    expect(await api.listMessages(id)).toEqual([]);
  });

  it('文字开放：{ content } 照旧可发（templateCode=null，内容安全照旧）；两个字段都带 400「只能二选一：快捷消息或文字」', async () => {
    api = new MockCampusMarketApi({ messageFreeTextEnabled: true });
    const id = await conversation();
    expect(await api.sendMessage(id, { content: '  周六下午方便吗？ ' })).toMatchObject({ content: '周六下午方便吗？', templateCode: null });
    expect(await failure(api.sendMessage(id, { content: '要不要冰毒' }))).toMatchObject({ code: 400, message: CONTENT_BLOCKED_MESSAGE });
    const both = { templateCode: 'BUYER_STILL_AVAILABLE', content: '还在吗' } as unknown as { content: string };
    expect(await failure(api.sendMessage(id, both))).toMatchObject({ code: 400, message: '只能二选一：快捷消息或文字' });
    expect((await api.sendMessage(id, { templateCode: 'BUYER_ASK_PRICE' })).templateCode).toBe('BUYER_ASK_PRICE');
    expect((await api.listMessages(id)).map((m) => m.templateCode)).toEqual([null, 'BUYER_ASK_PRICE']);
  });

  it('历史的文字私信（演示种子，没有 templateCode）照常返回原文，templateCode 为 null', async () => {
    await api.login({ account: DEMO_ACCOUNT, password: DEMO_PASSWORD });
    const legacy = await api.listMessages('conv01');
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy[0]).toMatchObject({ content: '你好，iPhone 13 还在吗？', templateCode: null });
    expect(legacy.every((m) => m.templateCode === null && m.content !== '')).toBe(true);
  });
});

/** 假的后端：按路径返回 envelope；记录每一次请求 */
type Route = (method: string, path: string, body: unknown) => { status?: number; data?: unknown; message?: string } | undefined;
function restApi(route: Route) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const hit = route(method, path, body) ?? {};
    const status = hit.status ?? 200;
    return new Response(JSON.stringify({ code: status === 200 ? 0 : status, data: hit.data ?? null, message: hit.message ?? (status === 200 ? 'ok' : '服务拒绝') }),
      { status, headers: { 'Content-Type': 'application/json' } });
  });
  authTokenStore.setAccessToken('test-access-token', new Date(Date.now() + 900_000).toISOString());
  return { rest: new RestCampusMarketApi(new HttpTransport({ fetchImpl })), calls };
}

describe('REST：快捷消息适配层', () => {
  it('GET /v1/message-templates 原样返回；旧后端没有 freeTextEnabled 时按 false 处理', async () => {
    const ok = restApi(() => ({ data: { freeTextEnabled: true, templates: EXPECTED } }));
    expect(await ok.rest.listMessageTemplates()).toEqual({ freeTextEnabled: true, templates: EXPECTED });
    expect(ok.calls).toEqual([{ method: 'GET', path: '/v1/message-templates', body: undefined }]);
    const old = restApi(() => ({ data: { templates: EXPECTED.slice(0, 2) } }));
    expect(await old.rest.listMessageTemplates()).toEqual({ freeTextEnabled: false, templates: EXPECTED.slice(0, 2) });
  });

  it('发送快捷消息的请求体只有 { templateCode }；文字消息只有 { content }；后端 400 原话原样传到调用方', async () => {
    const message = { id: 'm1', conversationId: 'c1', senderId: 'u1', content: '你好，这件还在吗？', templateCode: 'BUYER_STILL_AVAILABLE', createdAt: 1 };
    const { rest, calls } = restApi((m, p, body) => {
      if ((body as { templateCode?: string })?.templateCode === 'SELLER_SOLD') return { status: 400, message: '这条快捷消息不能由你发送' };
      if ((body as { content?: string })?.content !== undefined) return { status: 400, message: '私信目前只能发送预设的快捷消息' };
      return { data: message };
    });
    expect(await rest.sendMessage('c 1', { templateCode: 'BUYER_STILL_AVAILABLE' })).toEqual(message);
    expect(calls[0]).toEqual({ method: 'POST', path: '/v1/conversations/c%201/messages', body: { templateCode: 'BUYER_STILL_AVAILABLE' } });
    expect(await failure(rest.sendMessage('c1', { templateCode: 'SELLER_SOLD' }))).toMatchObject({ code: 400, message: '这条快捷消息不能由你发送' });
    expect(await failure(rest.sendMessage('c1', { content: '还在吗' }))).toMatchObject({ code: 400, message: '私信目前只能发送预设的快捷消息' });
    expect(calls[2].body).toEqual({ content: '还在吗' });
  });

  it('GET /v1/config 的 messages.freeTextEnabled：只有明确的 true 才开放；缺失、null、字符串一律 false', () => {
    expect(normalizeClientConfig({ messages: { freeTextEnabled: true } }).messages).toEqual({ freeTextEnabled: true });
    expect(normalizeClientConfig({ messages: { freeTextEnabled: false } }).messages).toEqual({ freeTextEnabled: false });
    expect(normalizeClientConfig({ images: {} }).messages).toEqual({ freeTextEnabled: false });
    expect(normalizeClientConfig({ messages: null }).messages).toEqual({ freeTextEnabled: false });
    expect(normalizeClientConfig({ messages: { freeTextEnabled: 'true' } }).messages).toEqual({ freeTextEnabled: false });
    expect(normalizeClientConfig(null).messages).toEqual({ freeTextEnabled: false });
  });
});
