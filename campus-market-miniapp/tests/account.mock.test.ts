import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_RESET_UNSUPPORTED, MockApi, type StoragePort } from '../src/api/mock';

function setup() {
  let value: unknown;
  const writes: string[] = [];
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); writes.push(JSON.stringify(db)); } };
  return { api: new MockApi(storage), storage, writes };
}
afterEach(() => { vi.useRealTimers(); });

describe('演示模式：微信登录与绑定（与后端同语义）', () => {
  it('已开通；凭证格式不对 400；未绑定返回一次性票据且不登录', async () => {
    const { api } = setup();
    expect(await api.wechatStatus()).toEqual({ enabled: true, bound: false });
    await expect(api.wechatLogin('bad code!')).rejects.toMatchObject({ code: 400, message: '微信登录凭证无效或已过期，请重试' });
    await expect(api.wechatLogin('')).rejects.toMatchObject({ code: 400 });
    const result = await api.wechatLogin('device_a');
    expect(result.bound).toBe(false);
    if (result.bound) throw new Error('unreachable');
    expect(result.bindTicket).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(await api.restore()).toBeNull();
  });

  it('登录后绑定；票据只能用一次；同一凭证再次微信登录直接进入绑定的账号', async () => {
    const { api } = setup();
    const first = await api.wechatLogin('device_a'); if (first.bound) throw new Error('unreachable');
    await expect(api.wechatBind(first.bindTicket)).rejects.toThrow('请先登录');
    await api.login('buyer001', 'demo12345');
    await api.wechatBind(first.bindTicket);
    expect(await api.wechatStatus()).toEqual({ enabled: true, bound: true });
    await expect(api.wechatBind(first.bindTicket)).rejects.toMatchObject({ code: 400, message: '绑定已过期，请重新用微信登录' });
    await api.logout();
    expect(await api.wechatLogin('device_a')).toEqual({ bound: true, user: expect.objectContaining({ id: 'demo-buyer' }) });
    expect((await api.restore())?.id).toBe('demo-buyer');
  });

  it('一个微信一个账号、一个账号一个微信；冲突时票据也作废', async () => {
    const { api } = setup();
    const a = await api.wechatLogin('device_a'); if (a.bound) throw new Error('unreachable');
    await api.login('buyer001', 'demo12345'); await api.wechatBind(a.bindTicket); await api.logout();
    // 已绑定微信的账号不能再绑第二个微信
    const b = await api.wechatLogin('device_b'); if (b.bound) throw new Error('unreachable');
    await api.login('buyer001', 'demo12345');
    await expect(api.wechatBind(b.bindTicket)).rejects.toMatchObject({ code: 409, message: '这个账号已经绑定了微信，请先解除绑定' });
    await expect(api.wechatBind(b.bindTicket)).rejects.toMatchObject({ code: 400 });
    // 买家解绑后 device_a 重新签发两张票据：买家用一张重新绑定，卖家拿另一张也不能把同一个微信绑到自己名下
    await api.wechatUnbind();
    const again = await api.wechatLogin('device_a'); if (again.bound) throw new Error('解绑后应重新走绑定');
    const stale = await api.wechatLogin('device_a'); if (stale.bound) throw new Error('unreachable');
    await api.wechatBind(again.bindTicket);
    await api.logout(); await api.login('seller001', 'demo12345');
    await expect(api.wechatBind(stale.bindTicket)).rejects.toMatchObject({ code: 409, message: '这个微信已经绑定了其他账号' });
  });

  it('解绑后不能再一键登录；解绑需要登录', async () => {
    const { api } = setup();
    await expect(api.wechatUnbind()).rejects.toThrow('请先登录');
    const t = await api.wechatLogin('device_a'); if (t.bound) throw new Error('unreachable');
    await api.login('seller001', 'demo12345'); await api.wechatBind(t.bindTicket);
    await api.wechatUnbind();
    expect(await api.wechatStatus()).toEqual({ enabled: true, bound: false });
    await api.logout();
    expect((await api.wechatLogin('device_a')).bound).toBe(false);
  });

  it('票据 10 分钟后过期', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T08:00:00Z'));
    const { api } = setup();
    const t = await api.wechatLogin('device_a'); if (t.bound) throw new Error('unreachable');
    await api.login('buyer001', 'demo12345');
    vi.setSystemTime(new Date('2026-10-19T08:10:00Z'));
    await expect(api.wechatBind(t.bindTicket)).rejects.toMatchObject({ code: 400, message: '绑定已过期，请重新用微信登录' });
  });

  it('绑定票据从不写入本地存储（只有绑定关系本身持久化）', async () => {
    const { api, storage, writes } = setup();
    const t = await api.wechatLogin('device_a'); if (t.bound) throw new Error('unreachable');
    await api.login('buyer001', 'demo12345'); await api.wechatBind(t.bindTicket);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((json) => json.includes(t.bindTicket))).toBe(false);
    // 重新打开（新实例）后绑定关系仍在，票据不在
    const restored = new MockApi(storage);
    expect(await restored.wechatStatus()).toEqual({ enabled: true, bound: true });
    await expect(restored.wechatBind(t.bindTicket)).rejects.toMatchObject({ code: 400 });
  });
});

describe('演示模式：修改密码与找回', () => {
  it('核对当前密码与长度；新旧不能相同；改后旧密码不能登录，当前会话保留（演示只有一台设备）', async () => {
    const { api } = setup();
    await expect(api.changePassword('demo12345', 'new-pass-1')).rejects.toThrow('请先登录');
    await api.login('buyer001', 'demo12345');
    await expect(api.changePassword('wrong-pass', 'new-pass-1')).rejects.toMatchObject({ code: 400, message: '当前密码不正确' });
    await expect(api.changePassword('demo12345', 'short')).rejects.toMatchObject({ code: 400 });
    await expect(api.changePassword('demo12345', 'x'.repeat(73))).rejects.toMatchObject({ code: 400 });
    await expect(api.changePassword('demo12345', 'demo12345')).rejects.toMatchObject({ code: 400, message: '新密码不能与当前密码相同' });
    expect(await api.changePassword('demo12345', 'new-pass-1')).toEqual({ otherSessionsEnded: 0 });
    expect((await api.restore())?.id).toBe('demo-buyer');
    await api.logout();
    await expect(api.login('buyer001', 'demo12345')).rejects.toThrow('账号或密码错误');
    expect((await api.login('buyer001', 'new-pass-1')).id).toBe('demo-buyer');
  });

  it('重置码找回：演示没有学校管理员，明确返回「演示模式不支持」且不改密码', async () => {
    const { api } = setup();
    await expect(api.resetPassword({ account: 'buyer001', code: 'ABCD-EFGH-JKMN', newPassword: 'new-pass-1' })).rejects.toMatchObject({ code: 400, message: DEMO_RESET_UNSUPPORTED });
    expect(DEMO_RESET_UNSUPPORTED).toContain('演示模式不支持');
    expect((await api.login('buyer001', 'demo12345')).id).toBe('demo-buyer');
  });
});

describe('演示模式：注销账号', () => {
  it('确认语与密码错误时拒绝且不产生任何变化', async () => {
    const { api } = setup();
    await api.login('seller001', 'demo12345');
    await expect(api.deleteAccount({ password: 'demo12345', confirmation: '注销' })).rejects.toMatchObject({ code: 400, message: '请输入「确认注销」确认注销' });
    await expect(api.deleteAccount({ password: 'wrong-pass', confirmation: '确认注销' })).rejects.toMatchObject({ code: 400, message: '密码不正确' });
    expect((await api.restore())?.nickname).toBe('小林同学');
    expect((await api.myListings()).every((p) => p.status === '在售')).toBe(true);
  });

  it('下架、清除联系方式、关闭申请、解绑微信、匿名化并退出；原账号名可重新注册为新账号', async () => {
    const { api, storage } = setup();
    // 买家：一条待处理、一条已同意；卖家绑定微信
    await api.login('buyer001', 'demo12345');
    const pending = await api.requestContact('demo-product-0');
    const approved = await api.requestContact('demo-product-1');
    await api.logout();
    const t = await api.wechatLogin('seller_phone'); if (t.bound) throw new Error('unreachable');
    await api.login('seller001', 'demo12345'); await api.wechatBind(t.bindTicket);
    await api.decide(approved.id, 'APPROVED');
    const result = await api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' });
    expect(result).toEqual({ productsTakenDown: 8, requestsClosed: 2, membershipsEnded: 0 });
    expect(await api.restore()).toBeNull();
    await expect(api.login('seller001', 'demo12345')).rejects.toThrow('账号或密码错误');
    // 微信绑定已解除：同一个微信再登录拿到的是新票据
    expect((await api.wechatLogin('seller_phone')).bound).toBe(false);
    // 买家视角：申请已关闭、商品看不到、卖家显示为「已注销用户」
    await api.login('buyer001', 'demo12345');
    const sent = (await api.contacts({ role: 'sent' })).items;
    expect(sent).toEqual([]);
    expect((await api.publicUser('demo-seller')).nickname).toBe('已注销用户');
    await expect(api.detail('demo-product-0')).rejects.toThrow('已下架');
    const db = JSON.stringify((storage.get() as object));
    expect(db).not.toContain('wechat:campus-demo-seller');
    const seller = (storage.get() as { users: { id: string; account: string; contact: string }[] }).users.find((u) => u.id === 'demo-seller');
    expect(seller).toMatchObject({ account: 'deleted-demo-seller', contact: '' });
    const contacts = (storage.get() as { contacts: { id: string; status: string }[] }).contacts;
    expect(contacts.find((c) => c.id === pending.id)?.status).toBe('REJECTED');
    expect(contacts.find((c) => c.id === approved.id)?.status).toBe('REVOKED');
    await api.logout();
    const fresh = await api.register({ account: 'seller001', password: 'another-pass', nickname: '新同学', campus: '西校区', contact: '' });
    expect(fresh.id).not.toBe('demo-seller');
  });

  it('买家注销时撤回自己发出的待处理申请', async () => {
    const { api, storage } = setup();
    await api.login('buyer001', 'demo12345');
    const r = await api.requestContact('demo-product-0');
    expect((await api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' })).requestsClosed).toBe(1);
    expect((storage.get() as { contacts: { id: string; status: string }[] }).contacts.find((c) => c.id === r.id)?.status).toBe('WITHDRAWN');
  });
});
