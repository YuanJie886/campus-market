// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import type { ListingPayload, ProductCreateInput } from './contracts';
import { fullDisclosure } from '../test/inspectionFixtures';
import type { Category } from '../types';

/**
 * 模块 6 的 Mock 契约：与后端 CircleMarketIT 的 18 组断言逐条对应（编号一致），
 * 保证离线演示与真实服务端的权限结论相同。全部是 API 调用的行为断言。
 */

const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
});

async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
const code = async (p: Promise<unknown>) => (await failure(p)).code;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const session = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return session.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });

function product(title: string, extra: Partial<ProductCreateInput> = {}, category: Category = '生活用品'): ProductCreateInput {
  return {
    title, description: '圈子集市契约测试', price: 30, category, condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(fullDisclosure(category) ? { inspection: fullDisclosure(category)! } : {}),
    ...extra,
  } as ProductCreateInput;
}
function payload(title: string, extra: Partial<ListingPayload> = {}): ListingPayload {
  return { ...(product(title) as unknown as ListingPayload), ...extra };
}
const meetingAt = () => { const at = new Date(Date.now() + 86_400_000); at.setMinutes(0, 0, 0); return at.toISOString() };

/** owner 建圈并用邀请码拉 members 进圈；返回圈子 id */
async function circleWith(owner: string, members: string[], name = `圈子${rnd()}`, visibility: 'PRIVATE' | 'DISCOVERABLE' = 'PRIVATE') {
  await as(owner);
  const circle = await api.createCircle({ type: 'CLUB', name, visibility });
  for (const m of members) {
    await as(owner);
    const { token } = await api.createCircleInvite(circle.id);
    await as(m);
    await api.redeemCircleInvite(token);
  }
  return circle.id;
}

describe('6.4 圈子与权限', () => {
  it('1. 创建：固定「用户创建」；服务端字段一律 400；名称长度与尖括号 400', async () => {
    await user('owner');
    const c = await api.createCircle({ type: 'CLASS', name: '  高数 互助  ', description: '一起卖书' });
    expect(c).toMatchObject({ type: 'CLASS', name: '高数 互助', visibility: 'PRIVATE', status: 'ACTIVE', userCreated: true, joined: true, myRole: 'OWNER' });
    expect(Object.keys(c).sort()).toEqual(['createdAt', 'description', 'id', 'joined', 'myRole', 'name', 'status', 'type', 'userCreated', 'visibility']);
    for (const field of ['official', 'ownerId', 'schoolId', 'status', 'role', 'verified']) {
      expect(await code(api.createCircle({ type: 'CLUB', name: '字段测试', [field]: 'x' } as never)), field).toBe(400);
    }
    expect(await code(api.createCircle({ type: 'CLUB', name: '字' }))).toBe(400);
    expect(await code(api.createCircle({ type: 'CLUB', name: 'x'.repeat(31) }))).toBe(400);
    expect(await code(api.createCircle({ type: 'CLUB', name: '<b>坏名字</b>' }))).toBe(400);
    expect(await code(api.createCircle({ type: 'DORM' as never, name: '宿舍圈' }))).toBe(400);
  });

  it('2. PRIVATE 圈子对非成员不可枚举：详情 / 成员 / 邀请 / 商品流一律 404，也不在发现列表', async () => {
    await user('owner'); await user('outsider');
    const id = await circleWith('owner', [], '私密小组');
    await as('outsider');
    const errors = await Promise.all([api.getCircle(id), api.listCircleMembers(id), api.listCircleInvites(id), api.listCircleProducts(id)].map(failure));
    expect(errors.map((e) => e.code)).toEqual([404, 404, 404, 404]);
    const missing = await failure(api.getCircle('circle-does-not-exist'));
    expect(errors[0].message).toBe(missing.message);
    expect((await api.discoverCircles()).map((c) => c.id)).not.toContain(id);
  });

  it('3. DISCOVERABLE：非成员只看到名称 / 简介 / 类型 / 用户创建标识，没有所有者、人数或成员', async () => {
    await user('owner'); await user('outsider');
    const id = await circleWith('owner', [], '公开发现的社团', 'DISCOVERABLE');
    await as('outsider');
    const found = (await api.discoverCircles('发现')).find((c) => c.id === id)!;
    expect(Object.keys(found).sort()).toEqual(['description', 'id', 'joined', 'name', 'type', 'userCreated']);
    expect(found.joined).toBe(false);
    const view = await api.getCircle(id);
    expect(Object.keys(view).sort()).toEqual(['description', 'id', 'joined', 'name', 'type', 'userCreated']);
    expect(await code(api.listCircleMembers(id))).toBe(404);
    expect(await code(api.listCircleProducts(id))).toBe(404);
  });

  it('4. 成员名单：普通成员 403；管理者只拿到昵称 / 头像 / 角色 / 加入时间', async () => {
    await user('owner'); await user('member');
    const id = await circleWith('owner', ['member']);
    expect(await code(api.listCircleMembers(id))).toBe(403);
    await as('owner');
    const page = await api.listCircleMembers(id);
    expect(Object.keys(page).sort()).toEqual(['items', 'page', 'size', 'total']);
    const members = page.items;
    expect(members).toHaveLength(2);
    for (const m of members) expect(Object.keys(m).sort()).toEqual(['avatar', 'joinedAt', 'nickname', 'role', 'userId']);
    expect(JSON.stringify(members)).not.toMatch(/13800000000|account|contact|dorm/);
  });

  it('5. 角色规则：OWNER 不能直接退出；MODERATOR 不能移除 OWNER / MODERATOR；MEMBER 不能管理；转让后恰好一个 OWNER', async () => {
    const ownerId = await user('owner'); const modId = await user('mod'); const memberId = await user('member'); const otherId = await user('other');
    const id = await circleWith('owner', ['mod', 'member', 'other']);
    await as('owner');
    expect(await code(api.removeCircleMember(id, ownerId))).toBe(409);
    await api.changeCircleMemberRole(id, modId, 'MODERATOR');
    await as('mod');
    expect(await code(api.removeCircleMember(id, ownerId))).toBe(403);
    expect(await code(api.changeCircleMemberRole(id, memberId, 'MODERATOR'))).toBe(403);
    await as('member');
    expect(await code(api.removeCircleMember(id, otherId))).toBe(403);
    expect(await code(api.createCircleInvite(id))).toBe(403);
    await as('mod');
    expect(await api.removeCircleMember(id, otherId)).toEqual({ userId: otherId, status: 'REMOVED' });
    await as('owner');
    const after = (await api.changeCircleMemberRole(id, memberId, 'OWNER')).items;
    expect(after.filter((m) => m.role === 'OWNER').map((m) => m.userId)).toEqual([memberId]);
    expect(after.find((m) => m.userId === ownerId)?.role).toBe('MODERATOR');
    expect(await api.removeCircleMember(id, ownerId)).toEqual({ userId: ownerId, status: 'LEFT' });
  });

  it('6. 邀请：原始邀请码只返回一次、只存哈希、一次性；已使用 / 撤销 / 不存在统一 404；兑换限流 429', async () => {
    await user('owner'); await user('a'); await user('b');
    const id = await circleWith('owner', []);
    const created = await api.createCircleInvite(id, 48);
    expect(created.invite.status).toBe('PENDING');
    expect(created.invite.expiresAt - created.invite.createdAt).toBe(48 * 3_600_000);
    expect(await code(api.createCircleInvite(id, 169))).toBe(400);
    const stored = window.localStorage.getItem(DB_STORAGE_KEY)!;
    expect(stored).not.toContain(created.token);
    expect(JSON.stringify(await api.listCircleInvites(id))).not.toContain(created.token);
    const revoked = await api.createCircleInvite(id);
    await api.revokeCircleInvite(revoked.invite.id);
    await as('a');
    expect((await api.redeemCircleInvite(created.token)).myRole).toBe('MEMBER');
    await as('b');
    const reused = await failure(api.redeemCircleInvite(created.token));
    const cancelled = await failure(api.redeemCircleInvite(revoked.token));
    const unknown = await failure(api.redeemCircleInvite('x'.repeat(43)));
    expect([reused.code, cancelled.code, unknown.code]).toEqual([404, 404, 404]);
    expect(new Set([reused.message, cancelled.message, unknown.message]).size).toBe(1);
    let limited: ApiError | null = null;
    for (let i = 0; i < 12 && !limited; i += 1) {
      const e = await failure(api.redeemCircleInvite(`guess-${i}-${'y'.repeat(30)}`));
      if (e.code === 429) limited = e;
    }
    expect(limited?.code).toBe(429);
  });

  it('7. 归档：只有所有者；归档后不能再发布或邀请；圈子商品对成员不再可见', async () => {
    await user('owner'); await user('member');
    const id = await circleWith('owner', ['member']);
    await as('owner');
    const p = await api.createProduct(product('归档前的圈子商品', { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    await as('member');
    expect(await code(api.archiveCircle(id))).toBe(403);
    expect((await api.getProduct(p.id)).id).toBe(p.id);
    await as('owner');
    expect((await api.archiveCircle(id)).status).toBe('ARCHIVED');
    expect((await api.getProduct(p.id)).id).toBe(p.id);
    expect(await code(api.createCircleInvite(id))).toBe(409);
    expect(await code(api.createProduct(product('归档后', { visibility: 'CIRCLE_ONLY', circleIds: [id] })))).toBe(404);
    await as('member');
    expect((await api.getCircle(id) as { status: string }).status).toBe('ARCHIVED');
    expect(await code(api.getProduct(p.id))).toBe(404);
  });
});

describe('6.5 / 6.6 圈子商品的可见性', () => {
  it('8. 发布：默认 PUBLIC；圈子可见需 1～5 个圈子且卖家在籍；PUBLIC 不接受圈子；打包商品同样支持', async () => {
    await user('seller'); await user('other');
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) ids.push(await circleWith('seller', []));
    const foreign = await circleWith('other', []);
    await as('seller');
    const plain = await api.createProduct(product('默认公开'));
    expect(plain.visibility).toBe('PUBLIC');
    expect(plain.circles ?? []).toEqual([]);
    expect(await code(api.createProduct(product('零个圈子', { visibility: 'CIRCLE_ONLY', circleIds: [] })))).toBe(400);
    expect(await code(api.createProduct(product('六个圈子', { visibility: 'CIRCLE_ONLY', circleIds: ids })))).toBe(400);
    expect(await code(api.createProduct(product('重复圈子', { visibility: 'CIRCLE_ONLY', circleIds: [ids[0], ids[0]] })))).toBe(400);
    expect(await code(api.createProduct(product('公开带圈子', { visibility: 'PUBLIC', circleIds: [ids[0]] })))).toBe(400);
    expect(await code(api.createProduct(product('别人的圈子', { visibility: 'CIRCLE_ONLY', circleIds: [foreign] })))).toBe(404);
    const five = await api.createProduct(product('五个圈子', { visibility: 'CIRCLE_ONLY', circleIds: ids.slice(0, 5) }));
    expect(five.circles?.map((c) => c.id).sort()).toEqual(ids.slice(0, 5).sort());
    const bundle = await api.createProduct(product('整套圈子', {
      visibility: 'CIRCLE_ONLY', circleIds: [ids[0]], listingKind: 'BUNDLE',
      bundleItems: [{ name: '台灯', category: '生活用品', condition: '全新', quantity: 1 }, { name: '书', category: '教材书籍', condition: '全新', quantity: 2 }],
    }, '其他'));
    expect(bundle).toMatchObject({ visibility: 'CIRCLE_ONLY', listingKind: 'BUNDLE' });
    await as('other');
    expect(await code(api.getProduct(bundle.id))).toBe(404);
  });

  it('9. 非成员在每个入口都看不到私密商品；成员与卖家看得到；PUBLIC 行为不变', async () => {
    await user('seller'); await user('member'); await user('outsider');
    const id = await circleWith('seller', ['member']);
    await as('seller');
    const secret = await api.createProduct(product(`私密台灯${rnd()}`, { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    const open = await api.createProduct(product(`公开台灯${rnd()}`));
    const textbook = await api.createProduct(product(`私密教材${rnd()}`, { visibility: 'CIRCLE_ONLY', circleIds: [id], textbookEditionId: 'demo-calculus-8' }, '教材书籍'));
    const sees = async (): Promise<Record<string, boolean>> => {
      const list = await api.listProducts({ keyword: secret.title, sort: 'latest', page: 1, pageSize: 50 });
      const feed = await api.feedProducts({ keyword: secret.title, scope: 'SCHOOL', sort: 'latest', page: 1, pageSize: 50 });
      const detail = await api.getProduct(secret.id).then(() => true, () => false);
      const comments = await api.listComments(secret.id).then(() => true, () => false);
      const favorite = await api.setFavorite(secret.id, true).then(() => true, () => false);
      const conversation = await api.getOrCreateConversation(secret.id).then(() => true, () => false);
      const book = await api.getTextbook('demo-calculus-8');
      return {
        list: list.items.some((p) => p.id === secret.id), count: list.total === 1, feed: feed.items.some((p) => p.id === secret.id),
        detail, comments, favorite, conversation,
        textbook: JSON.stringify(book).includes(textbook.id),
      };
    };
    const all = { list: true, count: true, feed: true, detail: true, comments: true, favorite: true, conversation: true, textbook: true };
    await as('member');
    expect(await sees()).toEqual(all);
    await as('outsider');
    expect(await sees()).toEqual({ list: false, count: false, feed: false, detail: false, comments: false, favorite: false, conversation: false, textbook: false });
    expect((await failure(api.getProduct(secret.id))).message).toBe((await failure(api.getProduct('no-such-product'))).message);
    expect(await code(api.createOrder({ productId: secret.id, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() }))).toBe(404);
    expect((await api.getProduct(open.id)).id).toBe(open.id);
    expect((await api.listProducts({ keyword: open.title, sort: 'latest', page: 1, pageSize: 50 })).total).toBe(1);
  });

  it('10. 圈子标签只对有权查看者显示，且只列出查看者自己也在籍的圈子', async () => {
    await user('seller'); await user('a'); await user('b');
    const ca = await circleWith('seller', ['a'], '甲圈');
    const cb = await circleWith('seller', ['b'], '乙圈');
    await as('seller');
    const p = await api.createProduct(product('两个圈子都能看', { visibility: 'CIRCLE_ONLY', circleIds: [ca, cb] }));
    expect(p.circles?.map((c) => c.name).sort()).toEqual(['乙圈', '甲圈']);
    await as('a');
    expect((await api.getProduct(p.id)).circles?.map((c) => c.name)).toEqual(['甲圈']);
    const page = await api.listCircleProducts(ca);
    expect(page.items.map((i) => i.id)).toEqual([p.id]);
    expect(JSON.stringify(page)).not.toContain('乙圈');
    await as('b');
    expect((await api.getProduct(p.id)).circles?.map((c) => c.name)).toEqual(['乙圈']);
  });

  it('11. PUBLIC → CIRCLE_ONLY：非成员的收藏从列表消失、再收藏 404；未成交会话与消息都不再可见', async () => {
    await user('seller'); await user('member'); await user('fan');
    const id = await circleWith('seller', ['member']);
    await as('seller');
    const p = await api.createProduct(product('先公开后收回'));
    await as('fan');
    await api.setFavorite(p.id, true);
    const conversation = await api.getOrCreateConversation(p.id);
    await api.sendMessage(conversation.id, '还在吗');
    await as('seller');
    expect((await api.updateProduct(p.id, { visibility: 'CIRCLE_ONLY', circleIds: [id] })).visibility).toBe('CIRCLE_ONLY');
    await as('fan');
    expect((await api.listFavorites()).map((f) => f.productId)).not.toContain(p.id);
    expect(await code(api.setFavorite(p.id, true))).toBe(404);
    expect((await api.listConversations()).map((c) => c.id)).not.toContain(conversation.id);
    expect(await code(api.listMessages(conversation.id))).toBe(404);
    expect(await api.getUnreadCount()).toBe(0);
    await as('member');
    expect((await api.getProduct(p.id)).visibility).toBe('CIRCLE_ONLY');
  });

  it('12. 订单参与者例外：成员下单后被移出，仍能查看这件商品；但看不到卖家的其他圈子商品；非成员不能下单', async () => {
    await user('seller'); const buyerId = await user('buyer'); await user('outsider');
    const id = await circleWith('seller', ['buyer']);
    await as('seller');
    const p = await api.createProduct(product('下单后仍可见', { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    const other = await api.createProduct(product('卖家的另一件圈子商品', { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    await as('buyer');
    const order = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() });
    expect(order.productId).toBe(p.id);
    await as('seller');
    await api.removeCircleMember(id, buyerId);
    await as('buyer');
    expect((await api.getProduct(p.id)).id).toBe(p.id);
    expect((await api.getOrderFlow(order.id)).orderId).toBe(order.id);
    expect(await code(api.getProduct(other.id))).toBe(404);
    expect((await api.listProducts({ sort: 'latest', page: 1, pageSize: 50 })).items.map((i) => i.id)).not.toContain(p.id);
    await as('outsider');
    expect(await code(api.createOrder({ productId: other.id, meetingPointId: '东校区-library', meetingAtIso: meetingAt(), contact: '1', idempotencyKey: rnd() }))).toBe(404);
  });
});

describe('6.3 圈子订阅', () => {
  it('13. 全校订阅收不到私密商品；只有绑定同一圈子的在籍成员订阅会匹配；非成员不能创建圈子订阅', async () => {
    await user('seller'); await user('member'); await user('outsider');
    const id = await circleWith('seller', ['member']);
    const keyword = `雷达${rnd()}`;
    await as('member');
    const circleSub = await api.createDemandSubscription({ keyword, circleId: id });
    expect(circleSub.subscription.circle).toEqual({ id, name: expect.any(String) });
    await as('outsider');
    await api.createDemandSubscription({ keyword });
    expect(await code(api.createDemandSubscription({ keyword, circleId: id }))).toBe(404);
    await as('seller');
    const secret = await api.createProduct(product(`${keyword} 私密`, { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    await as('outsider');
    expect((await api.listDemandMatches()).items.map((m) => m.product?.id)).not.toContain(secret.id);
    expect(await api.getDemandUnreadCount()).toBe(0);
    await as('member');
    expect((await api.listDemandMatches()).items.map((m) => m.product?.id)).toContain(secret.id);
    expect(await api.getDemandUnreadCount()).toBe(1);
  });

  it('14. 退出后：圈子订阅停用、未读清零、收件箱不再出现私密商品；非成员不能重新启用', async () => {
    await user('seller'); const memberId = await user('member');
    const id = await circleWith('seller', ['member']);
    const keyword = `退出${rnd()}`;
    await as('member');
    const sub = (await api.createDemandSubscription({ keyword, circleId: id })).subscription;
    await as('seller');
    await api.createProduct(product(`${keyword} 私密`, { visibility: 'CIRCLE_ONLY', circleIds: [id] }));
    await as('member');
    expect(await api.getDemandUnreadCount()).toBe(1);
    await api.removeCircleMember(id, memberId);
    expect(await api.getDemandUnreadCount()).toBe(0);
    expect((await api.listDemandMatches()).items).toHaveLength(0);
    expect((await api.listDemandSubscriptions()).find((s) => s.id === sub.id)?.active).toBe(false);
    expect(await code(api.updateDemandSubscription(sub.id, { active: true }))).toBe(404);
  });

  it('15. 公开价格参考排除圈子商品的成交（按订单的可见性快照）', async () => {
    await user('viewer');
    const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    for (let i = 0; i < 10; i += 1) {
      const pid = `pg-${rnd()}`;
      const visibilitySnapshot = i < 3 ? 'CIRCLE_ONLY' : 'PUBLIC';
      raw.market.products.push({ id: pid, title: '样本', description: 'd', price: 10, category: '生活用品', condition: '全新', campus: '东校区', images: [], contact: '', sellerId: 'seed', status: '已售出', views: 0, createdAt: Date.now(), listingKind: 'SINGLE' });
      raw.market.orders.push({ id: `o-${pid}`, productId: pid, buyerId: 'b', sellerId: 'seed', price: 10 + i, status: '已完成', canonicalStatus: 'COMPLETED', createdAt: Date.now(), updatedAt: Date.now(),
        priceSnapshot: 10 + i, currency: 'CNY', schoolIdSnapshot: 'pilot', categorySnapshot: '生活用品', conditionSnapshot: '全新', listingKindSnapshot: 'SINGLE', textbookEditionIdSnapshot: null, visibilitySnapshot });
    }
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
    api = new MockCampusMarketApi();
    expect((await api.getPriceGuidance({ category: '生活用品' })).sufficient).toBe(false);
    const again = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
    for (const o of again.market.orders) if (o.visibilitySnapshot === 'CIRCLE_ONLY') o.visibilitySnapshot = 'PUBLIC';
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(again));
    api = new MockCampusMarketApi();
    expect(await api.getPriceGuidance({ category: '生活用品' })).toMatchObject({ sufficient: true });
  });
});

describe('6.5 批量发布与协助', () => {
  it('16. 批量发布逐项校验圈子（INVALID_CIRCLE）；圈子失效整批回滚；协助人不能替所有者选圈子', async () => {
    const ownerId = await user('owner'); await user('helper'); await user('mod');
    const id = await circleWith('mod', ['owner']);
    await as('owner');
    const good = await api.createListingDraft({ payload: payload('批量圈子一', { visibility: 'CIRCLE_ONLY', circleIds: [id] }) });
    const bad = await api.createListingDraft({ payload: payload('批量圈子二', { visibility: 'CIRCLE_ONLY', circleIds: ['circle-unknown'] }) });
    const batch = await api.createListingBatch({ draftIds: [good.id, bad.id] });
    const failed = await failure(api.publishListingBatch(batch.id, `idem-${rnd()}-circle-batch`));
    expect(failed.code).toBe(400);
    expect(JSON.stringify(failed.details)).toContain('INVALID_CIRCLE');
    expect((await api.listProducts({ keyword: '批量圈子', sort: 'latest', page: 1, pageSize: 50 })).total).toBe(0);
    // 协助人不能写 visibility / circleIds
    const draft = await api.createListingDraft({ payload: payload('协助的草稿') });
    const invite = await api.createAssistInvite({ draftId: draft.id });
    await as('helper');
    await api.redeemAssistInvite(invite.token);
    expect(await code(api.updateListingDraft(draft.id, { expectedVersion: draft.version, payload: { ...draft.payload, visibility: 'CIRCLE_ONLY', circleIds: [id] } }))).toBe(403);
    // 权限在发布前失效：整批不发布
    await as('owner');
    const ok = await api.createListingDraft({ payload: payload('失效前一', { visibility: 'CIRCLE_ONLY', circleIds: [id] }) });
    const ok2 = await api.createListingDraft({ payload: payload('失效前二') });
    const batch2 = await api.createListingBatch({ draftIds: [ok.id, ok2.id] });
    await as('mod');
    await api.removeCircleMember(id, ownerId);
    await as('owner');
    expect(await code(api.publishListingBatch(batch2.id, `idem-${rnd()}-circle-batch2`))).toBe(400);
    expect((await api.listProducts({ keyword: '失效前', sort: 'latest', page: 1, pageSize: 50 })).total).toBe(0);
  });
});

describe('十 隐私', () => {
  it('17. 公共资料与履历不展示圈子；我的圈子只含圈子资料与我的角色', async () => {
    const ownerId = await user('owner'); await user('member'); await user('viewer');
    await circleWith('owner', ['member'], '不外泄的圈子名');
    await as('viewer');
    expect(JSON.stringify(await api.getUser(ownerId))).not.toMatch(/circle|不外泄/i);
    expect(JSON.stringify(await api.getPublicTradeSummary(ownerId))).not.toMatch(/circle|不外泄/i);
    await as('member');
    const mine = await api.listMyCircles();
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toMatch(/ownerId|members|userId|nickname/);
  });

  it('18. 一致性：每个查看者 × 每件商品，列表 / 计数 / 详情 / 收藏的结论相同', async () => {
    await user('seller'); await user('a'); await user('b'); await user('c');
    const ca = await circleWith('seller', ['a'], '一致性甲');
    const cb = await circleWith('seller', ['a', 'b'], '一致性乙');
    const tag = `一致${rnd()}`;
    await as('seller');
    const products = [
      await api.createProduct(product(`${tag} 公开`)),
      await api.createProduct(product(`${tag} 甲`, { visibility: 'CIRCLE_ONLY', circleIds: [ca] })),
      await api.createProduct(product(`${tag} 乙`, { visibility: 'CIRCLE_ONLY', circleIds: [cb] })),
      await api.createProduct(product(`${tag} 甲乙`, { visibility: 'CIRCLE_ONLY', circleIds: [ca, cb] })),
    ];
    const expected: Record<string, boolean[]> = {
      seller: [true, true, true, true], a: [true, true, true, true], b: [true, false, true, true], c: [true, false, false, false],
    };
    for (const [viewer, visible] of Object.entries(expected)) {
      await as(viewer);
      const list = await api.listProducts({ keyword: tag, sort: 'latest', page: 1, pageSize: 50 });
      for (const [i, p] of products.entries()) {
        const inList = list.items.some((x) => x.id === p.id);
        const detail = await api.getProduct(p.id).then(() => true, () => false);
        const fav = await api.setFavorite(p.id, true).then(() => true, () => false);
        expect([inList, detail, fav], `${viewer} × ${p.title}`).toEqual([visible[i], visible[i], visible[i]]);
      }
      expect(list.total, viewer).toBe(visible.filter(Boolean).length);
    }
  });
});

describe('REST 适配层', () => {
  it('圈子路径与方法；邀请码只在请求体；成员操作不带身份字段', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url).replace(/^https?:\/\/[^/]+/, ''), body: init?.body as string | undefined });
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    await rest.createCircle({ type: 'CLUB', name: '社团' });
    await rest.listMyCircles();
    await rest.discoverCircles();
    await rest.getCircle('c1');
    await rest.updateCircle('c1', { name: '新名' });
    await rest.archiveCircle('c1');
    await rest.listCircleProducts('c1', 2);
    await rest.createCircleInvite('c1', 24);
    await rest.listCircleInvites('c1');
    await rest.redeemCircleInvite('CIRCLE-SECRET-abcdefghijklmnopqrstuvwxyz');
    await rest.revokeCircleInvite('i1');
    await rest.listCircleMembers('c1');
    await rest.changeCircleMemberRole('c1', 'u2', 'MODERATOR');
    await rest.removeCircleMember('c1', 'u2');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/circles', 'GET /v1/circles/mine', 'GET /v1/circles/discover', 'GET /v1/circles/c1', 'PATCH /v1/circles/c1',
      'POST /v1/circles/c1/archive', 'GET /v1/circles/c1/products?page=2', 'POST /v1/circles/c1/invites', 'GET /v1/circles/c1/invites',
      'POST /v1/circle-invites/redeem', 'POST /v1/circle-invites/i1/revoke', 'GET /v1/circles/c1/members?page=1&size=20',
      'PATCH /v1/circles/c1/members/u2', 'DELETE /v1/circles/c1/members/u2',
    ]);
    expect(calls[9].url).not.toContain('SECRET');
    expect(calls[9].body).toBe(JSON.stringify({ token: 'CIRCLE-SECRET-abcdefghijklmnopqrstuvwxyz' }));
    for (const c of calls) expect(c.body ?? '').not.toMatch(/ownerId|schoolId|userId|official/);
  });
});
