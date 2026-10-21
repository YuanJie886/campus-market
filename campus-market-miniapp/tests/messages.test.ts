import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import {
  canReportMessage, composerMode, conversationRole, FREE_TEXT_DISABLED, mergeMessages, MESSAGE_TEMPLATES, messageText, QUICK_ONLY_NOTE,
  TEMPLATE_NOT_FOUND, TEMPLATE_WRONG_ROLE, templatesFor,
} from '../src/messages';
import type { ChatMessage } from '../src/model';
import { Poller } from '../src/polling';
import { CountStore } from '../src/unread';

function setup(prepare?: (db: Record<string, unknown>) => void) {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  const api = new MockApi(storage);
  if (prepare) { prepare(value as Record<string, unknown>); return { api: new MockApi(storage), storage }; }
  return { api, storage };
}
const msg = (id: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, conversationId: 'c', senderId: 's', content: id, createdAt: at, quarantined: false, templateCode: null, ...extra });
afterEach(() => { vi.useRealTimers(); });

describe('快捷消息规则', () => {
  it('与后端一致的 13 条快捷消息（顺序、文字、身份）', () => {
    expect(MESSAGE_TEMPLATES.map((t) => [t.code, t.role])).toEqual([
      ['BUYER_STILL_AVAILABLE', 'BUYER'], ['BUYER_ASK_CONDITION', 'BUYER'], ['BUYER_ASK_PRICE', 'BUYER'], ['BUYER_ASK_PHOTOS', 'BUYER'], ['BUYER_ASK_CONTACT', 'BUYER'],
      ['SELLER_AVAILABLE', 'SELLER'], ['SELLER_SOLD', 'SELLER'], ['SELLER_PRICE_FIRM', 'SELLER'], ['SELLER_PRICE_NEGOTIABLE', 'SELLER'], ['SELLER_CONTACT_VIA_REQUEST', 'SELLER'], ['SELLER_PHOTOS_ADDED', 'SELLER'],
      ['ANY_THANKS', 'ANY'], ['ANY_LATER', 'ANY'],
    ]);
    expect(MESSAGE_TEMPLATES[0].text).toBe('你好，这件还在吗？');
    expect(MESSAGE_TEMPLATES.find((t) => t.code === 'SELLER_CONTACT_VIA_REQUEST')?.text).toBe('请在商品页点「申请联系方式」，我同意后你就能看到。');
  });
  it('按会话身份过滤：买家只看到 BUYER_* 与 ANY_*，卖家只看到 SELLER_* 与 ANY_*，非成员没有', () => {
    const c = { buyerId: 'b', sellerId: 's' };
    const buyer = templatesFor(MESSAGE_TEMPLATES, conversationRole(c, 'b')).map((t) => t.code);
    const seller = templatesFor(MESSAGE_TEMPLATES, conversationRole(c, 's')).map((t) => t.code);
    expect(buyer).toHaveLength(7); expect(buyer.every((code) => code.startsWith('BUYER_') || code.startsWith('ANY_'))).toBe(true);
    expect(seller).toHaveLength(8); expect(seller.every((code) => code.startsWith('SELLER_') || code.startsWith('ANY_'))).toBe(true);
    expect(buyer.slice(-2)).toEqual(['ANY_THANKS', 'ANY_LATER']);
    expect(templatesFor(MESSAGE_TEMPLATES, conversationRole(c, 'x'))).toEqual([]);
  });
  it('自由文字输入框只在开通时显示；未开通时显示安全说明', () => {
    expect(composerMode(false)).toEqual({ quick: true, freeText: false, note: QUICK_ONLY_NOTE });
    expect(composerMode(true)).toEqual({ quick: true, freeText: true, note: '' });
    expect(QUICK_ONLY_NOTE).toBe('为保护双方安全，私信目前只能发送快捷消息；交换联系方式请使用「申请联系方式」');
  });
  it('显示文字：旧版自由文字原样显示；快捷消息正文缺失时用模板文字；隔离的显示占位；只能举报对方未隔离的消息', () => {
    expect(messageText({ content: '周末看车吗', templateCode: null, quarantined: false }, false)).toBe('周末看车吗');
    expect(messageText({ content: '', templateCode: 'ANY_LATER', quarantined: false }, true)).toBe('稍等，我晚点回复你。');
    expect(messageText({ content: '', templateCode: null, quarantined: true }, false)).toBe('该消息已被平台隔离。');
    expect(messageText({ content: '', templateCode: null, quarantined: true }, true)).toContain('「我的限制」里申诉');
    expect(canReportMessage({ senderId: 'other', quarantined: false }, 'me')).toBe(true);
    expect(canReportMessage({ senderId: 'me', quarantined: false }, 'me')).toBe(false);
    expect(canReportMessage({ senderId: 'other', quarantined: true }, 'me')).toBe(false);
  });
  it('轮询结果与发送结果合并：按 id 去重、按时间排序', () => {
    expect(mergeMessages([msg('a', 1), msg('c', 3)], [msg('b', 2), msg('c', 3, { content: 'new' })]).map((m) => [m.id, m.content])).toEqual([['a', 'a'], ['b', 'b'], ['c', 'new']]);
  });
});

describe('只在页面显示时轮询', () => {
  it('start 立即执行一次再按间隔执行；stop 后不再执行；上一次没结束时跳过', async () => {
    vi.useFakeTimers();
    let resolve: () => void = () => {};
    const task = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const poller = new Poller(task, 5000);
    poller.start(); poller.start();
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1); // 第一次还没结束
    resolve(); await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(2);
    resolve(); poller.stop(); expect(poller.active).toBe(false);
    await vi.advanceTimersByTimeAsync(20000);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('私信未读数：初始为 0，退出登录清零', async () => {
    const store = new CountStore(async () => 3);
    expect(store.current).toBe(0);
    expect(await store.refresh()).toBe(3);
    store.clear(); expect(store.current).toBe(0);
  });
});

describe('演示模式私信（与后端同语义）', () => {
  it('买家打开会话（重复打开复用同一会话），卖家不能对自己的商品开会话', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const c = await api.openConversation('demo-product-0');
    expect((await api.openConversation('demo-product-0')).id).toBe(c.id);
    expect(c).toMatchObject({ productId: 'demo-product-0', buyerId: 'demo-buyer', sellerId: 'demo-seller' });
    await api.login('seller001', 'demo12345');
    await expect(api.openConversation('demo-product-0')).rejects.toMatchObject({ code: 400 });
  });
  it('只能发送本身份的快捷消息；未知快捷消息与自由文字被拒绝，文案与后端一致', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const c = await api.openConversation('demo-product-0');
    const sent = await api.sendMessage(c.id, { templateCode: 'BUYER_STILL_AVAILABLE' });
    expect(sent).toMatchObject({ content: '你好，这件还在吗？', templateCode: 'BUYER_STILL_AVAILABLE', senderId: 'demo-buyer' });
    await api.sendMessage(c.id, { templateCode: 'ANY_THANKS' });
    await expect(api.sendMessage(c.id, { templateCode: 'SELLER_SOLD' })).rejects.toMatchObject({ code: 400, message: TEMPLATE_WRONG_ROLE });
    await expect(api.sendMessage(c.id, { templateCode: 'NOPE' })).rejects.toMatchObject({ code: 400, message: TEMPLATE_NOT_FOUND });
    await expect(api.sendMessage(c.id, { content: '加我微信' })).rejects.toMatchObject({ code: 400, message: FREE_TEXT_DISABLED });
    expect(await api.messageTemplates()).toMatchObject({ freeTextEnabled: false });
    await api.login('seller001', 'demo12345');
    await expect(api.sendMessage(c.id, { templateCode: 'BUYER_ASK_PRICE' })).rejects.toMatchObject({ message: TEMPLATE_WRONG_ROLE });
    expect((await api.sendMessage(c.id, { templateCode: 'SELLER_SOLD' })).content).toBe('不好意思，已经出了。');
  });
  it('未读：对方的新消息计入，打开会话标记已读后清零；自己发的不计入', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const c = await api.openConversation('demo-product-0');
    await api.sendMessage(c.id, { templateCode: 'BUYER_ASK_PRICE' });
    expect(await api.messageUnread()).toBe(0);
    await api.login('seller001', 'demo12345');
    expect(await api.messageUnread()).toBe(1);
    expect((await api.conversations()).map((x) => x.id)).toContain(c.id);
    await api.markConversationRead(c.id);
    expect(await api.messageUnread()).toBe(0);
  });
  it('旧版自由文字消息照常返回（templateCode 为 null）；别校用户看不到会话', async () => {
    const { api } = setup();
    await api.login('buyer001', 'demo12345');
    const legacy = (await api.messages('demo-conversation-1')).find((m) => m.templateCode === null);
    expect(legacy?.content).toContain('旧版自由文字消息');
    expect(messageText(legacy!, true)).toBe(legacy!.content);
    await api.login('school002', 'demo12345');
    expect(await api.conversations()).toEqual([]);
    await expect(api.messages('demo-conversation-1')).rejects.toMatchObject({ code: 404 });
    await expect(api.sendMessage('demo-conversation-1', { templateCode: 'ANY_THANKS' })).rejects.toMatchObject({ code: 404 });
  });
  it('服务端开通自由文字后可以发送文字，仍经过内容安全检查', async () => {
    const { api } = setup((db) => { db.messaging = { freeTextEnabled: true }; });
    await api.login('buyer001', 'demo12345');
    expect((await api.messageTemplates()).freeTextEnabled).toBe(true);
    const c = await api.openConversation('demo-product-1');
    expect(await api.sendMessage(c.id, { content: ' 周末可以看吗 ' })).toMatchObject({ content: '周末可以看吗', templateCode: null });
    await expect(api.sendMessage(c.id, { content: '代 - 考' })).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
  });
});
