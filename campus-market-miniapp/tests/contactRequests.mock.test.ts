import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockApi, seedDatabase, type StoragePort } from '../src/api/mock';

function setup(initial?: unknown) {
  let value: unknown = initial;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return { api: new MockApi(storage), storage, saved: () => value as ReturnType<typeof seedDatabase> };
}
let clock = Date.UTC(2026, 9, 1);
/** 每次操作推进 1 秒，保证「最近变化倒序」可确定。 */
const tick = () => { clock += 1000; vi.setSystemTime(clock); };
const as = async (api: MockApi, account: 'buyer001' | 'seller001') => { await api.login(account, 'demo12345'); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(clock); });
afterEach(() => { vi.useRealTimers(); });

describe('演示模式联系申请：与后端状态机一致', () => {
  it('买家撤回待处理申请后可以重新申请：同一条记录回到 PENDING，卖家重新看到未读', async () => {
    const { api } = setup();
    await as(api, 'buyer001');
    const request = await api.requestContact('demo-product-0');
    expect(request).toMatchObject({ status: 'PENDING', decidedAt: null, unread: false, buyerNickname: '小鹿同学', sellerNickname: '小林同学' });
    expect(request).not.toHaveProperty('contact');
    tick();
    const withdrawn = await api.withdraw(request.id);
    expect(withdrawn.status).toBe('WITHDRAWN');
    expect((await api.withdraw(request.id)).status).toBe('WITHDRAWN'); // 重复撤回幂等
    await as(api, 'seller001');
    expect(await api.unreadCount()).toEqual({ received: 0, updates: 0, total: 0 });
    await expect(api.decide(request.id, 'APPROVED')).rejects.toMatchObject({ code: 409, message: '买家已撤回这次申请' });
    await api.markRead('received');
    await as(api, 'buyer001'); tick();
    const again = await api.requestContact('demo-product-0');
    expect(again).toMatchObject({ id: request.id, status: 'PENDING' });
    expect(again.updatedAt).toBeGreaterThan(request.updatedAt);
    await as(api, 'seller001');
    expect(await api.unreadCount()).toEqual({ received: 1, updates: 0, total: 1 });
    expect((await api.contacts({ role: 'received' })).items).toEqual([expect.objectContaining({ id: request.id, status: 'PENDING', unread: true })]);
  });

  it('只能撤回自己仍在待处理的申请：卖家撤不了、别人的申请 404、已同意的申请 409', async () => {
    const { api } = setup();
    await as(api, 'buyer001');
    const request = await api.requestContact('demo-product-0');
    await as(api, 'seller001');
    await expect(api.withdraw(request.id)).rejects.toMatchObject({ code: 404, message: '联系申请不存在' });
    await expect(api.revoke('missing')).rejects.toMatchObject({ code: 404 });
    await expect(api.revoke(request.id)).rejects.toMatchObject({ code: 409, message: '只能撤回已经同意的申请' });
    await api.decide(request.id, 'APPROVED');
    await as(api, 'buyer001');
    await expect(api.withdraw(request.id)).rejects.toMatchObject({ code: 409, message: '该申请已处理' });
    await expect(api.revoke(request.id)).rejects.toMatchObject({ code: 404 });
  });

  it('卖家撤回同意后买家立即看不到联系方式，再次申请 409，记录保持 REVOKED', async () => {
    const { api, storage } = setup();
    await as(api, 'buyer001');
    const request = await api.requestContact('demo-product-0');
    await as(api, 'seller001'); tick();
    await api.decide(request.id, 'APPROVED');
    await as(api, 'buyer001');
    expect((await api.detail('demo-product-0')).contact).toBe('wechat:campus-demo-seller');
    expect((await api.list({ page: 1, pageSize: 20, sort: 'latest' })).items.find((p) => p.id === 'demo-product-0')?.contact).toBe('wechat:campus-demo-seller');
    await as(api, 'seller001'); tick();
    const revoked = await api.revoke(request.id);
    expect(revoked).toMatchObject({ status: 'REVOKED' });
    expect(revoked.decidedAt).toBe(clock);
    expect((await api.revoke(request.id)).status).toBe('REVOKED'); // 重复撤回幂等
    await as(api, 'buyer001');
    expect((await api.detail('demo-product-0')).contact).toBe('');
    expect((await api.list({ page: 1, pageSize: 20, sort: 'latest' })).items.find((p) => p.id === 'demo-product-0')?.contact).toBe('');
    await expect(api.requestContact('demo-product-0')).rejects.toMatchObject({ code: 409, message: '卖家已撤回同意，不能再次申请' });
    expect((await api.contactState('demo-product-0'))?.status).toBe('REVOKED');
    // 持久化后重新打开仍然看不到
    const restored = new MockApi(storage);
    expect((await restored.detail('demo-product-0')).contact).toBe('');
  });

  it('PENDING / APPROVED 时重复申请幂等返回原申请，不新建记录', async () => {
    const { api, saved } = setup();
    await as(api, 'buyer001');
    const first = await api.requestContact('demo-product-0');
    expect((await api.requestContact('demo-product-0')).id).toBe(first.id);
    await as(api, 'seller001'); await api.decide(first.id, 'APPROVED');
    await as(api, 'buyer001');
    expect(await api.requestContact('demo-product-0')).toMatchObject({ id: first.id, status: 'APPROVED' });
    expect(saved().contacts).toHaveLength(1);
  });

  it('未读：卖家看到新的待处理申请，买家看到同意 / 拒绝 / 撤回同意；markRead 只清对应角色', async () => {
    const { api } = setup();
    await as(api, 'buyer001');
    const a = await api.requestContact('demo-product-0'); tick();
    const b = await api.requestContact('demo-product-1'); tick();
    const c = await api.requestContact('demo-product-3'); tick();
    expect(await api.unreadCount()).toEqual({ received: 0, updates: 0, total: 0 });
    await as(api, 'seller001');
    expect(await api.unreadCount()).toEqual({ received: 3, updates: 0, total: 3 });
    expect(await api.markRead('sent')).toEqual({ received: 3, updates: 0, total: 3 });
    expect(await api.markRead('received')).toEqual({ received: 0, updates: 0, total: 0 });
    expect((await api.contacts({ role: 'received' })).items.every((r) => !r.unread)).toBe(true);
    await api.decide(a.id, 'APPROVED'); tick();
    await api.decide(b.id, 'REJECTED'); tick();
    expect(await api.unreadCount()).toEqual({ received: 0, updates: 0, total: 0 });
    await as(api, 'buyer001');
    expect(await api.unreadCount()).toEqual({ received: 0, updates: 2, total: 2 });
    const sent = await api.contacts({ role: 'sent' });
    expect(sent.items.map((r) => [r.id, r.unread])).toEqual([[b.id, true], [a.id, true], [c.id, false]]);
    expect(await api.markRead('received')).toEqual({ received: 0, updates: 2, total: 2 });
    expect(await api.markRead('sent')).toEqual({ received: 0, updates: 0, total: 0 });
    await as(api, 'seller001'); await api.revoke(a.id);
    await as(api, 'buyer001');
    expect(await api.unreadCount()).toEqual({ received: 0, updates: 1, total: 1 });
    expect((await api.contacts({ role: 'sent', status: 'REVOKED' })).items).toEqual([expect.objectContaining({ id: a.id, unread: true })]);
    await expect(api.markRead('both' as never)).rejects.toMatchObject({ code: 400 });
  });

  it('列表按角色分开、按最近变化倒序分页，并支持状态筛选；参数越界 400', async () => {
    const { api } = setup();
    await as(api, 'buyer001');
    const ids: string[] = [];
    for (const product of ['demo-product-0', 'demo-product-1', 'demo-product-3', 'demo-product-4', 'demo-product-5']) { ids.push((await api.requestContact(product)).id); tick(); }
    expect(await api.contacts({ role: 'received' })).toEqual({ items: [], total: 0, page: 1, size: 20 });
    const first = await api.contacts({ role: 'sent', page: 1, size: 2 });
    expect(first).toMatchObject({ total: 5, page: 1, size: 2 });
    expect(first.items.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    expect((await api.contacts({ role: 'sent', page: 3, size: 2 })).items.map((r) => r.id)).toEqual([ids[0]]);
    await api.withdraw(ids[0]); tick();
    expect((await api.contacts({ role: 'sent', size: 2 })).items[0].id).toBe(ids[0]);
    expect(await api.contacts({ role: 'sent', status: 'WITHDRAWN' })).toMatchObject({ total: 1, items: [expect.objectContaining({ id: ids[0] })] });
    await as(api, 'seller001');
    expect((await api.contacts({ role: 'received', status: 'PENDING' })).total).toBe(4);
    expect((await api.contacts({ role: 'sent' })).total).toBe(0);
    await expect(api.contacts({ role: 'received', size: 51 })).rejects.toMatchObject({ code: 400 });
    await expect(api.contacts({ role: 'received', page: 0 })).rejects.toMatchObject({ code: 400 });
    await expect(api.contacts({ role: 'mine' as never })).rejects.toMatchObject({ code: 400 });
    await expect(api.contacts({ role: 'received', status: 'CANCELLED' as never })).rejects.toMatchObject({ code: 400 });
  });

  it('旧版演示缓存中的申请升级后补齐决定时间，未读按 V16 迁移视为未读', async () => {
    const legacy = seedDatabase();
    legacy.contacts = [{ id: 'old', productId: 'demo-product-0', productTitle: '索尼无线降噪耳机', buyerId: 'demo-buyer', sellerId: 'demo-seller', status: 'APPROVED', createdAt: 1, updatedAt: 5 } as never];
    const { api } = setup(legacy);
    await as(api, 'buyer001');
    expect((await api.contacts({ role: 'sent' })).items[0]).toMatchObject({ id: 'old', status: 'APPROVED', decidedAt: 5, unread: true, sellerNickname: '小林同学' });
    expect((await api.detail('demo-product-0')).contact).toBe('wechat:campus-demo-seller');
  });
});
