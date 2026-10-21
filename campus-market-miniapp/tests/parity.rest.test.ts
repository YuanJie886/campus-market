import { describe, expect, it, vi } from 'vitest';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { RestApi, parseComment, parseGovernance, parseMessage, parseTemplates } from '../src/api/rest';
import { FREE_TEXT_DISABLED, TEMPLATE_NOT_FOUND, TEMPLATE_WRONG_ROLE } from '../src/messages';

const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' } });
const bad = (message: string, statusCode = 400): Response => ({ statusCode, data: { code: statusCode, message } });
const conversation = { id: 'c1', productId: 'p1', buyerId: 'b', sellerId: 's', createdAt: 1, updatedAt: 2 };
const message = { id: 'm1', conversationId: 'c1', senderId: 'b', content: '你好，这件还在吗？', createdAt: 3, templateCode: 'BUYER_STILL_AVAILABLE' };

function setup(reply: (input: Parameters<RequestPort>[0]) => Response) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  return { api: new RestApi(new Transport(handler, 'https://campus.example', true)), calls: () => handler.mock.calls.map(([input]) => [input.method, input.url.replace('https://campus.example', ''), input.data]) };
}

describe('REST 私信（快捷消息）', () => {
  it('会话：列表 GET、按商品打开 POST { productId }、消息 GET、标记已读 POST 不带请求体、未读数 GET', async () => {
    const { api, calls } = setup((input) => {
      if (input.url.endsWith('/v1/conversations') && input.method === 'GET') return ok([conversation]);
      if (input.url.endsWith('/v1/conversations')) return ok(conversation);
      if (input.url.endsWith('/messages')) return ok([message]);
      if (input.url.endsWith('/v1/messages/unread')) return ok({ count: 4 });
      return ok(null);
    });
    expect(await api.conversations()).toEqual([conversation]);
    expect(await api.openConversation('p/1')).toEqual(conversation);
    expect(await api.messages('c 1')).toEqual([{ ...message, quarantined: false }]);
    await api.markConversationRead('c1');
    expect(await api.messageUnread()).toBe(4);
    expect(calls()).toEqual([
      ['GET', '/v1/conversations', undefined],
      ['POST', '/v1/conversations', { productId: 'p/1' }],
      ['GET', '/v1/conversations/c%201/messages', undefined],
      ['POST', '/v1/conversations/c1/read', undefined],
      ['GET', '/v1/messages/unread', undefined],
    ]);
  });

  it('发送快捷消息只带 { templateCode }；自由文字只带 { content }', async () => {
    const { api, calls } = setup(() => ok(message));
    await api.sendMessage('c1', { templateCode: 'BUYER_STILL_AVAILABLE' });
    await api.sendMessage('c1', { content: '周末可以看吗' });
    expect(calls()).toEqual([
      ['POST', '/v1/conversations/c1/messages', { templateCode: 'BUYER_STILL_AVAILABLE' }],
      ['POST', '/v1/conversations/c1/messages', { content: '周末可以看吗' }],
    ]);
    // 即使调用方多塞了字段，请求体也只有一个键
    await api.sendMessage('c1', { templateCode: 'ANY_THANKS', content: 'x' } as never);
    expect(calls()[2][2]).toEqual({ templateCode: 'ANY_THANKS' });
  });

  it('三条 400 文案原样传给页面', async () => {
    for (const text of [TEMPLATE_NOT_FOUND, TEMPLATE_WRONG_ROLE, FREE_TEXT_DISABLED]) {
      const { api } = setup(() => bad(text));
      await expect(api.sendMessage('c1', { templateCode: 'X' })).rejects.toMatchObject({ code: 400, message: text });
    }
    expect([TEMPLATE_NOT_FOUND, TEMPLATE_WRONG_ROLE, FREE_TEXT_DISABLED]).toEqual(['快捷消息不存在', '这条快捷消息不能由你发送', '私信目前只能发送预设的快捷消息']);
  });

  it('快捷消息列表：GET /v1/message-templates；freeTextEnabled 缺省为 false，格式不对的模板丢弃', async () => {
    const { api, calls } = setup(() => ok({ templates: [{ code: 'ANY_THANKS', text: '好的，谢谢！', role: 'ANY' }, { code: 'X', text: 'x', role: 'STAFF' }, { text: '无 code', role: 'BUYER' }] }));
    expect(await api.messageTemplates()).toEqual({ freeTextEnabled: false, templates: [{ code: 'ANY_THANKS', text: '好的，谢谢！', role: 'ANY' }] });
    expect(calls()).toEqual([['GET', '/v1/message-templates', undefined]]);
    expect(parseTemplates({ freeTextEnabled: true, templates: [] }).freeTextEnabled).toBe(true);
    expect(parseTemplates({ freeTextEnabled: 'yes' }).freeTextEnabled).toBe(false);
    expect(parseTemplates(null)).toEqual({ freeTextEnabled: false, templates: [] });
  });

  it('旧版自由文字消息（templateCode 缺省或 null）照常解析；隔离的消息带 quarantined', () => {
    expect(parseMessage({ id: 'm', senderId: 's', content: '旧消息', createdAt: 1 })).toMatchObject({ content: '旧消息', templateCode: null, quarantined: false });
    expect(parseMessage({ id: 'm', senderId: 's', content: '', templateCode: null, quarantined: true })).toMatchObject({ templateCode: null, quarantined: true });
    expect(() => parseMessage({ content: 'no id' })).toThrow('服务响应异常');
  });
});

describe('REST 留言', () => {
  it('列表 GET；发表 POST { content, parentId }（顶层为 null）；隐藏字段缺省为 false', async () => {
    const wire = { id: 'k1', productId: 'p1', userId: 'u', content: '还在吗', createdAt: 5, parentId: null };
    const { api, calls } = setup((input) => ok(input.method === 'GET' ? [wire, { ...wire, id: 'k2', content: '', parentId: 'k1', moderationHidden: true, hiddenForAuthor: true }] : wire));
    const list = await api.comments('p1');
    expect(list[0]).toEqual({ ...wire, moderationHidden: false, hiddenForAuthor: false });
    expect(list[1]).toMatchObject({ parentId: 'k1', moderationHidden: true, hiddenForAuthor: true, content: '' });
    await api.addComment('p1', '还在吗', null);
    await api.addComment('p1', '在的', 'k1');
    expect(calls()).toEqual([
      ['GET', '/v1/products/p1/comments', undefined],
      ['POST', '/v1/products/p1/comments', { content: '还在吗', parentId: null }],
      ['POST', '/v1/products/p1/comments', { content: '在的', parentId: 'k1' }],
    ]);
    expect(parseComment({ id: 'x', parentId: '' }).parentId).toBeNull();
  });
  it('内容安全拦截的 400 原样显示', async () => {
    const { api } = setup(() => bad('内容可能包含违规信息，请修改后再提交'));
    await expect(api.addComment('p1', '代考', null)).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
  });
});

describe('REST 治理（用户侧）与资料', () => {
  it('举报：POST /v1/moderation-reports，只带 targetType / targetId / reasonCode，说明为空时不带 note', async () => {
    const { api, calls } = setup(() => ok({ id: 'r', status: 'RECEIVED', outcome: null }));
    await api.report({ targetType: 'COMMENT', targetId: 'k1', reasonCode: 'HARASSMENT' });
    await api.report({ targetType: 'MESSAGE', targetId: 'm1', reasonCode: 'OTHER', note: '骚扰' });
    await api.report({ targetType: 'PRODUCT', targetId: 'p1', reasonCode: 'SPAM', note: '' });
    expect(calls()).toEqual([
      ['POST', '/v1/moderation-reports', { targetType: 'COMMENT', targetId: 'k1', reasonCode: 'HARASSMENT' }],
      ['POST', '/v1/moderation-reports', { targetType: 'MESSAGE', targetId: 'm1', reasonCode: 'OTHER', note: '骚扰' }],
      ['POST', '/v1/moderation-reports', { targetType: 'PRODUCT', targetId: 'p1', reasonCode: 'SPAM' }],
    ]);
  });
  it('我的举报 GET mine；我的限制 GET /v1/me/governance（缺省列表为空）；申诉 POST /v1/me/appeals 二选一', async () => {
    const { api, calls } = setup((input) => ok(input.url.endsWith('/mine') ? [] : input.url.endsWith('/governance') ? { restrictions: [{ id: 'x' }] } : { id: 'a', status: 'PENDING' }));
    expect(await api.myReports()).toEqual([]);
    expect(await api.myGovernance()).toEqual({ restrictions: [{ id: 'x' }], notices: [] });
    await api.appeal({ restrictionId: 'r1', reason: '理由' });
    await api.appeal({ actionId: 'a1', reason: '理由' });
    expect(calls()).toEqual([
      ['GET', '/v1/moderation-reports/mine', undefined],
      ['GET', '/v1/me/governance', undefined],
      ['POST', '/v1/me/appeals', { restrictionId: 'r1', reason: '理由' }],
      ['POST', '/v1/me/appeals', { actionId: 'a1', reason: '理由' }],
    ]);
    expect(parseGovernance(null)).toEqual({ restrictions: [], notices: [] });
  });
  it('资料：GET /v1/auth/me；PATCH 只带 Web ProfilePatch 字段，宿舍楼 null 表示清空；楼栋按校区查询', async () => {
    const { api, calls } = setup((input) => ok(input.url.includes('/buildings') ? [{ id: 'b1', campusId: '东校区', zone: '沁园', name: '1号楼' }] : { id: 'u', nickname: 'n', campus: '东校区' }));
    await api.me();
    await api.updateProfile({ nickname: '小明', campus: '东校区', contact: '13800000000', avatar: 'https://picsum.photos/seed/cm-face-1/200/200', dormBuildingId: null });
    await api.updateProfile({ nickname: '小明', campus: '东校区', contact: 'student01' });
    expect(await api.buildings('东校区')).toHaveLength(1);
    expect(calls()).toEqual([
      ['GET', '/v1/auth/me', undefined],
      ['PATCH', '/v1/auth/me', { nickname: '小明', campus: '东校区', contact: '13800000000', avatar: 'https://picsum.photos/seed/cm-face-1/200/200', dormBuildingId: null }],
      ['PATCH', '/v1/auth/me', { nickname: '小明', campus: '东校区', contact: 'student01' }],
      ['GET', `/v1/buildings?campus=${encodeURIComponent('东校区')}`, undefined],
    ]);
  });
  it('昵称被内容安全拦截、受限 403 的文案原样传给页面', async () => {
    const { api } = setup((input) => input.method === 'PATCH' ? bad('内容可能包含违规信息，请修改后再提交') : bad('你的「申请联系方式」功能暂时受限，至 10 月 30 日 12:00 自动恢复。可以在「我的限制」里查看原因或提交申诉。', 403));
    await expect(api.updateProfile({ nickname: '代考', campus: '东校区', contact: '' })).rejects.toThrow('内容可能包含违规信息，请修改后再提交');
    await expect(api.requestContact('p1')).rejects.toMatchObject({ code: 403, message: expect.stringContaining('「我的限制」') });
  });
});
