import { describe, expect, it } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { LEAVE_CONSEQUENCES, circleFormProblems, circlePatch, isManager, memberActions, toggleCircle, visibilityHelp, visibilityProblem } from '../src/circles';
import type { CircleMember, ProductInput } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}
const product: ProductInput = { title: '班级共享的计算器', description: '考试周可借', price: 30, category: '数码电子', condition: '几乎全新', campus: '西校区', images: ['/assets/goods/keyboard.png'], contact: '13800000000', contactPublic: false };

/** 卖家建圈子并邀请买家加入；返回圈子 id。 */
async function circleWithBuyer(api: MockApi) {
  await api.login('seller001', 'demo12345');
  const circle = await api.createCircle({ type: 'CLASS', name: '演示二班', description: '班级互助', visibility: 'PRIVATE' });
  const { token } = await api.createCircleInvite(circle.id, 24);
  await api.login('buyer001', 'demo12345');
  await expect(api.circle(circle.id)).rejects.toMatchObject({ code: 404 });
  const joined = await api.redeemCircleInvite(token);
  expect(joined).toMatchObject({ id: circle.id, myRole: 'MEMBER', userCreated: true });
  // 同一个人重放邀请码：幂等返回，不消耗名额
  expect((await api.redeemCircleInvite(token)).myRole).toBe('MEMBER');
  return circle.id;
}

describe('圈子：创建、加入、可见范围与退出', () => {
  it('创建与加入：类型 / 名称校验与 Web 一致；邀请码无效统一 404；圈子可见商品只给在籍成员', async () => {
    const api = setup();
    expect(circleFormProblems({ type: '', name: '一', description: '' })).toEqual(['请选择圈子类型', '圈子名称需要 2～30 个字']);
    expect(circleFormProblems({ type: 'CLUB', name: '<社团>', description: 'x'.repeat(201) })).toEqual(['圈子名称不能包含尖括号', '简介最多 200 个字']);
    await api.login('seller001', 'demo12345');
    await expect(api.createCircle({ type: 'CLASS', name: '代考互助群' })).rejects.toMatchObject({ code: 400, message: '内容可能包含违规信息，请修改后再提交' });
    await expect(api.createCircle({ type: 'NOPE' as never, name: '演示二班' })).rejects.toMatchObject({ code: 400, message: '圈子类型无效' });
    const circleId = await circleWithBuyer(api);
    await expect(api.redeemCircleInvite('not-a-real-token')).rejects.toMatchObject({ code: 404, message: '邀请码无效或已失效' });

    await api.login('seller001', 'demo12345');
    await expect(api.publish({ ...product, visibility: 'CIRCLE_ONLY', circleIds: [] })).rejects.toMatchObject({ code: 400, message: '圈子可见需要选择 1～5 个圈子' });
    await expect(api.publish({ ...product, visibility: 'CIRCLE_ONLY', circleIds: ['nope'] })).rejects.toMatchObject({ code: 404, message: '圈子不存在或你不是这个圈子的成员' });
    const p = await api.publish({ ...product, visibility: 'CIRCLE_ONLY', circleIds: [circleId] });
    expect(p).toMatchObject({ visibility: 'CIRCLE_ONLY', circles: [{ id: circleId, name: '演示二班', type: 'CLASS' }] });
    expect((await api.circleProducts(circleId)).items.map((x) => x.id)).toEqual([p.id]);

    await api.login('buyer001', 'demo12345');
    expect((await api.detail(p.id)).visibility).toBe('CIRCLE_ONLY');
    expect((await api.list({ sort: 'latest', page: 1, pageSize: 50 })).items.some((x) => x.id === p.id)).toBe(true);
    // 他校同学与非成员都看不到
    await api.register({ account: 'westmate01', password: 'demo12345', nickname: '同校非成员', campus: '东校区', contact: '' });
    await expect(api.detail(p.id)).rejects.toThrow('不存在');
    expect((await api.list({ sort: 'latest', page: 1, pageSize: 50 })).items.some((x) => x.id === p.id)).toBe(false);
    await expect(api.circleProducts(circleId)).rejects.toMatchObject({ code: 404 });
  });

  it('退出：圈子订阅停用、私密商品立即看不到、其上的联系申请从列表消失；所有者不能直接退出', async () => {
    const api = setup();
    const circleId = await circleWithBuyer(api);
    await api.login('seller001', 'demo12345');
    const p = await api.publish({ ...product, visibility: 'CIRCLE_ONLY', circleIds: [circleId] });
    await expect(api.removeCircleMember(circleId, 'demo-seller')).rejects.toMatchObject({ code: 409, message: '所有者不能直接退出，请先把所有者转让给其他成员，或归档圈子' });

    await api.login('buyer001', 'demo12345');
    const sub = (await api.createSubscription({ keyword: '计算器', circleId })).subscription;
    expect(sub.circle).toEqual({ id: circleId, name: '演示二班' });
    await api.requestContact(p.id);
    expect((await api.contacts({ role: 'sent' })).items.map((r) => r.productId)).toEqual([p.id]);
    expect(LEAVE_CONSEQUENCES).toHaveLength(3);
    expect(await api.removeCircleMember(circleId, 'demo-buyer')).toEqual({ userId: 'demo-buyer', status: 'LEFT' });
    await expect(api.detail(p.id)).rejects.toThrow('不存在');
    expect((await api.contacts({ role: 'sent' })).items).toEqual([]);
    expect((await api.subscriptions())[0]).toMatchObject({ id: sub.id, active: false });
    expect(await api.myCircles()).toEqual([]);
  });

  it('管理：管理员只能移出普通成员、不能改可见范围；转让所有者；归档后邀请作废、订阅停用', async () => {
    const api = setup();
    const circleId = await circleWithBuyer(api);
    await api.login('seller001', 'demo12345');
    const third = await api.createCircleInvite(circleId);
    await api.register({ account: 'westmate02', password: 'demo12345', nickname: '第三位', campus: '西校区', contact: '' });
    await api.redeemCircleInvite(third.token);
    await api.login('seller001', 'demo12345');
    await api.changeCircleMemberRole(circleId, 'demo-buyer', 'MODERATOR');
    const members = await api.circleMembers(circleId, 1, 20);
    expect(members.items.map((m) => [m.nickname, m.role])).toEqual([['小林同学', 'OWNER'], ['小鹿同学', 'MODERATOR'], ['第三位', 'MEMBER']]);
    expect(members.items[0]).not.toHaveProperty('contact');

    await api.login('buyer001', 'demo12345');
    const circle = await api.circle(circleId);
    expect(isManager(circle)).toBe(true);
    await expect(api.updateCircle(circleId, { visibility: 'DISCOVERABLE' })).rejects.toMatchObject({ code: 403, message: '只有所有者可以修改圈子的类型与可见范围' });
    await expect(api.removeCircleMember(circleId, 'demo-seller')).rejects.toMatchObject({ code: 403, message: '不能移除圈子所有者' });
    const thirdId = members.items[2].userId;
    expect(await api.removeCircleMember(circleId, thirdId)).toEqual({ userId: thirdId, status: 'REMOVED' });

    await api.login('seller001', 'demo12345');
    await api.changeCircleMemberRole(circleId, 'demo-buyer', 'OWNER');
    expect((await api.circle(circleId))).toMatchObject({ myRole: 'MODERATOR' });
    await api.login('buyer001', 'demo12345');
    const pending = await api.createCircleInvite(circleId);
    const sub = (await api.createSubscription({ category: '数码电子', circleId })).subscription;
    await api.archiveCircle(circleId);
    expect((await api.circleInvites(circleId)).find((i) => i.id === pending.invite.id)?.status).toBe('REVOKED');
    expect((await api.subscriptions()).find((x) => x.id === sub.id)?.active).toBe(false);
    await expect(api.createCircleInvite(circleId)).rejects.toMatchObject({ code: 409, message: '圈子已归档' });
    await api.login('seller001', 'demo12345');
    await expect(api.redeemCircleInvite(pending.token)).rejects.toMatchObject({ code: 404 });
  });

  it('成员菜单、可见范围文案与勾选规则（与 Web 管理页 / VisibilityPicker 一致）', () => {
    const m = (userId: string, role: CircleMember['role']): CircleMember => ({ userId, nickname: userId, avatar: '', role, joinedAt: 0 });
    expect(memberActions('OWNER', 'me', m('a', 'MEMBER'))).toEqual(['promote', 'transfer', 'remove']);
    expect(memberActions('OWNER', 'me', m('b', 'MODERATOR'))).toEqual(['demote', 'transfer', 'remove']);
    expect(memberActions('MODERATOR', 'me', m('a', 'MEMBER'))).toEqual(['remove']);
    expect(memberActions('MODERATOR', 'me', m('b', 'MODERATOR'))).toEqual([]);
    expect(memberActions('OWNER', 'me', m('me', 'OWNER'))).toEqual([]);
    expect(visibilityHelp('PUBLIC', [])).toBe('本校登录的同学都能看到（未登录的访客与他校同学看不到）。');
    expect(visibilityHelp('CIRCLE_ONLY', [])).toBe('请选择 1～5 个圈子；只有所选圈子的在籍成员和你自己能看到。');
    expect(visibilityHelp('CIRCLE_ONLY', ['A', 'B'])).toContain('只有「A」「B」的在籍成员和你自己能看到');
    expect(toggleCircle(['1', '2', '3', '4', '5'], '6', true)).toEqual(['1', '2', '3', '4', '5']);
    expect(toggleCircle(['1', '2'], '1', false)).toEqual(['2']);
    expect(visibilityProblem('CIRCLE_ONLY', [])).toBe('圈子可见需要至少选择一个圈子');
    expect(visibilityProblem('PUBLIC', [])).toBeNull();
    const circle = { id: 'c', type: 'CLASS' as const, name: '甲', description: '', visibility: 'PRIVATE' as const, status: 'ACTIVE' as const, userCreated: true as const, joined: true as const, myRole: 'MODERATOR' as const, createdAt: 0 };
    expect(circlePatch(circle, { name: '甲', description: '新简介', visibility: 'DISCOVERABLE' })).toEqual({ description: '新简介' });
  });

  it('注销：仍是在用圈子的所有者时 409；成员注销时退出圈子并计入 membershipsEnded', async () => {
    const api = setup();
    const circleId = await circleWithBuyer(api);
    expect((await api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' })).membershipsEnded).toBe(1);
    await api.login('seller001', 'demo12345');
    await expect(api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' })).rejects.toMatchObject({ code: 409, message: '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销' });
    await api.archiveCircle(circleId);
    expect((await api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' })).membershipsEnded).toBe(1);
  });
});
