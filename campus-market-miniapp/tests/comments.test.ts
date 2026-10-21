import { describe, expect, it } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { canReportComment, commentError, commentText, threadComments } from '../src/comments';
import type { Comment } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}
const c = (id: string, at: number, parentId: string | null = null, extra: Partial<Comment> = {}): Comment => ({ id, productId: 'p', userId: 'u', content: id, createdAt: at, parentId, moderationHidden: false, hiddenForAuthor: false, ...extra });

describe('留言板展示规则（与 Web 商品详情一致）', () => {
  it('顶层保持服务端顺序（最新在前），回复挂在所属留言下按时间先后', () => {
    const threads = threadComments([c('new', 30), c('r2', 25, 'old'), c('old', 10), c('r1', 20, 'old')]);
    expect(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([['new', []], ['old', ['r1', 'r2']]]);
  });
  it('被隐藏的留言 / 回复只显示占位；作者看到可申诉的提示', () => {
    expect(commentText(c('a', 1))).toEqual({ text: 'a', hidden: false });
    expect(commentText(c('a', 1, null, { moderationHidden: true, content: '' }))).toEqual({ text: '该留言已被平台隐藏。', hidden: true });
    expect(commentText(c('a', 1, null, { moderationHidden: true, hiddenForAuthor: true })).text).toContain('可以在「我的限制」里查看并申诉一次');
    expect(commentText(c('a', 1, 'p', { moderationHidden: true }), true).text).toBe('该回复已被平台隐藏。');
    expect(commentText(c('a', 1, 'p', { moderationHidden: true, hiddenForAuthor: true }), true).text).toContain('你的这条回复已被平台隐藏');
  });
  it('只能举报别人的、未被隐藏的留言；空留言不能提交', () => {
    expect(canReportComment(c('a', 1), 'me')).toBe(true);
    expect(canReportComment(c('a', 1, null, { userId: 'me' }), 'me')).toBe(false);
    expect(canReportComment(c('a', 1, null, { moderationHidden: true }), 'me')).toBe(false);
    expect(commentError('  ')).toBe('请输入留言内容');
    expect(commentError('还在吗')).toBeNull();
  });
});

describe('演示模式留言（与后端同语义）', () => {
  it('发表与回复；回复不存在的留言 404；内容安全拦截 400 原样文案', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const top = await api.addComment('demo-product-2', ' 台灯还在吗？ ', null);
    expect(top).toMatchObject({ content: '台灯还在吗？', parentId: null, userId: 'demo-buyer', moderationHidden: false });
    await api.login('seller001', 'demo12345');
    const reply = await api.addComment('demo-product-2', '在的', top.id);
    expect(reply.parentId).toBe(top.id);
    await expect(api.addComment('demo-product-2', '回复', 'missing')).rejects.toMatchObject({ code: 404 });
    await expect(api.addComment('demo-product-2', '  ', null)).rejects.toMatchObject({ code: 400, message: '留言内容不能为空' });
    await expect(api.addComment('demo-product-2', '可以代考', null)).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
    const threads = threadComments(await api.comments('demo-product-2'));
    expect(threads.map((t) => [t.comment.content, t.replies.map((r) => r.content)])).toEqual([['台灯还在吗？', ['在的']]]);
  });
  it('被平台隐藏的留言：其他人只拿到占位（正文为空），作者看到 hiddenForAuthor', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const seen = (await api.comments('demo-product-1')).find((x) => x.id === 'demo-comment-3');
    expect(seen).toMatchObject({ content: '', moderationHidden: true, hiddenForAuthor: false });
    await api.login('seller001', 'demo12345');
    expect((await api.comments('demo-product-1')).find((x) => x.id === 'demo-comment-3')).toMatchObject({ content: '', moderationHidden: true, hiddenForAuthor: true });
  });
  it('举报留言：「其他」必须写说明；同一对象重复举报返回原记录；出现在「我的举报」', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    await expect(api.report({ targetType: 'COMMENT', targetId: 'demo-comment-2', reasonCode: 'OTHER' })).rejects.toMatchObject({ code: 400, message: '选择「其他」时请写一句说明' });
    const first = await api.report({ targetType: 'COMMENT', targetId: 'demo-comment-2', reasonCode: 'HARASSMENT' });
    expect((await api.report({ targetType: 'COMMENT', targetId: 'demo-comment-2', reasonCode: 'SPAM' })).id).toBe(first.id);
    await expect(api.report({ targetType: 'COMMENT', targetId: 'missing', reasonCode: 'SPAM' })).rejects.toMatchObject({ code: 404 });
    expect(await api.myReports()).toEqual([expect.objectContaining({ targetType: 'COMMENT', targetId: 'demo-comment-2', reasonCode: 'HARASSMENT', status: 'RECEIVED', outcome: null })]);
    await api.login('seller001', 'demo12345');
    expect(await api.myReports()).toEqual([]);
  });
});
