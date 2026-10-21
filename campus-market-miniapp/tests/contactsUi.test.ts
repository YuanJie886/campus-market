import { describe, expect, it, vi } from 'vitest';
import { availableActions, badgeText, CONFIRM, CONTACT_PUBLIC_HELP, contactCta, hasMoreContacts, mergeContactPage, STATUS_LABEL, statusNote } from '../src/contacts';
import { CONTACT_STATUSES, type ContactRequest } from '../src/model';
import { UnreadStore } from '../src/unread';

const request = (id: string, status: ContactRequest['status'] = 'PENDING'): ContactRequest => ({ id, productId: 'p', productTitle: 't', buyerId: 'b', sellerId: 's', buyerNickname: '', sellerNickname: '', status, createdAt: 1, updatedAt: 1, decidedAt: null, unread: false });
const onSale = { contact: '', contactPublic: false, status: '在售' as const };

describe('商品详情页的联系按钮', () => {
  it('撤回后可以重新申请；商品不在售时不能重新申请', () => {
    expect(contactCta(onSale, request('r', 'WITHDRAWN'))).toMatchObject({ kind: 'request', label: '重新申请', disabled: false, canWithdraw: false });
    expect(contactCta({ ...onSale, status: '已售出' }, request('r', 'WITHDRAWN'))).toMatchObject({ kind: 'none', disabled: true, hint: '商品已售出，暂时无法申请' });
  });
  it('卖家撤回同意后按钮禁用并说明「卖家已撤回同意」；拒绝同样禁用', () => {
    expect(contactCta(onSale, request('r', 'REVOKED'))).toMatchObject({ kind: 'none', label: '卖家已撤回同意', disabled: true, canWithdraw: false });
    expect(contactCta(onSale, request('r', 'REJECTED'))).toMatchObject({ kind: 'none', label: '卖家已拒绝', disabled: true });
  });
  it('待处理的申请可以撤回，主按钮禁用', () => {
    expect(contactCta(onSale, request('r', 'PENDING'))).toMatchObject({ kind: 'none', disabled: true, canWithdraw: true });
  });
  it('有联系方式时复制（公开或已同意）；没有申请时「我想要」', () => {
    expect(contactCta({ ...onSale, contact: 'wx', contactPublic: true }, null)).toMatchObject({ kind: 'copy', label: '复制联系方式', panel: '卖家已选择公开联系方式。' });
    expect(contactCta({ ...onSale, contact: 'wx' }, request('r', 'APPROVED'))).toMatchObject({ kind: 'copy', panel: '卖家已同意你的联系申请。' });
    expect(contactCta(onSale, null)).toMatchObject({ kind: 'request', label: '我想要', disabled: false });
    expect(contactCta({ ...onSale, status: '已下架' }, null)).toMatchObject({ kind: 'none', disabled: true });
  });
});

describe('联系申请列表', () => {
  it('五种状态都有标签和双方视角的说明', () => {
    for (const status of CONTACT_STATUSES) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(statusNote('received', status)).toBeTruthy();
      expect(statusNote('sent', status)).toBeTruthy();
    }
    expect(STATUS_LABEL).toMatchObject({ WITHDRAWN: '已撤回申请', REVOKED: '已撤回同意' });
  });
  it('卖家处理待处理、撤回已同意；买家只能撤回待处理；终态没有操作', () => {
    expect(availableActions('received', 'PENDING')).toEqual(['approve', 'reject']);
    expect(availableActions('received', 'APPROVED')).toEqual(['revoke']);
    expect(availableActions('sent', 'PENDING')).toEqual(['withdraw']);
    for (const status of ['REJECTED', 'WITHDRAWN', 'REVOKED'] as const) {
      expect(availableActions('received', status)).toEqual([]);
      expect(availableActions('sent', status)).toEqual([]);
    }
    expect(availableActions('sent', 'APPROVED')).toEqual([]);
  });
  it('撤回同意的确认框说明买家会立即失去联系方式', () => {
    expect(CONFIRM.revoke.content).toContain('立即看不到');
    expect(CONFIRM.revoke.content).toContain('不能再次申请');
    expect(CONFIRM.withdraw.content).toContain('重新申请');
  });
  it('加载更多按 id 去重追加，刷新时替换；是否还有更多由 total 决定', () => {
    const first = [request('a'), request('b')];
    expect(mergeContactPage(first, { items: [request('b'), request('c')], total: 3, page: 2, size: 2 }, false).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(mergeContactPage(first, { items: [request('z')], total: 1, page: 1, size: 20 }, true).map((r) => r.id)).toEqual(['z']);
    expect(hasMoreContacts(2, 3)).toBe(true);
    expect(hasMoreContacts(3, 3)).toBe(false);
  });
  it('未读角标：0 不显示，超过 99 显示 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
  });
});

describe('未读数共享状态', () => {
  it('订阅者收到刷新结果；先发后到的旧响应不覆盖新结果；失败保留原值', async () => {
    const replies: ((value: { received: number; updates: number; total: number }) => void)[] = [];
    let fail = false;
    const store = new UnreadStore(() => fail ? Promise.reject(new Error('offline')) : new Promise((resolve) => { replies.push(resolve); }));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(listener).toHaveBeenLastCalledWith({ received: 0, updates: 0, total: 0 });
    const slow = store.refresh(), fast = store.refresh();
    replies[1]({ received: 2, updates: 1, total: 3 }); await fast;
    replies[0]({ received: 9, updates: 9, total: 18 }); await slow;
    expect(store.current.total).toBe(3);
    fail = true; await store.refresh();
    expect(store.current.total).toBe(3);
    store.set({ received: 0, updates: 1, total: 1 });
    expect(listener).toHaveBeenLastCalledWith({ received: 0, updates: 1, total: 1 });
    unsubscribe(); store.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.current.total).toBe(0);
  });
});

describe('发布表单「公开展示联系方式」说明', () => {
  it('如实说明打开后的展示位置、可见对象，并说明可以随时关闭', () => {
    for (const surface of ['商品详情', '商品列表与搜索结果', '楼栋动态', '需求匹配', '本校登录同学', '随时关闭']) expect(CONTACT_PUBLIC_HELP).toContain(surface);
  });
});
