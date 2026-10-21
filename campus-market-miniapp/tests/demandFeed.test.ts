import { describe, expect, it } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { ApiError } from '../src/api/transport';
import { demandFormFrom, demandPrefill, demandSubmit, describeConditions, reasonLabel, subscribeResultText, tierLabel } from '../src/demand';
import { DORM_NEEDED, LOGIN_NEEDED, NOTHING_ANYWHERE, distanceText, feedAction, feedNotice, feedQueryFrom, usesFeed } from '../src/feed';
import { notificationTotal } from '../src/unread';
import type { ProductInput } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}
const lamp: ProductInput = { title: '护眼台灯', description: '宿舍自用', price: 40, category: '生活用品', condition: '几乎全新', campus: '东校区', images: ['/assets/goods/lamp.png'], contact: '13800000000', contactPublic: false };

describe('需求订阅：表单校验与 Web 一致', () => {
  it('至少关键词或分类；价格非负；最低价不高于最高价；只提交当前范围需要的锚点', () => {
    const blank = demandFormFrom({}, '东校区');
    expect(demandSubmit(blank)).toEqual({ error: '请至少填写关键词或选择分类' });
    expect(demandSubmit({ ...blank, keyword: '耳机', minPrice: '-1' })).toEqual({ error: '价格需为非负数' });
    expect(demandSubmit({ ...blank, keyword: '耳机', minPrice: '9', maxPrice: '3' })).toEqual({ error: '最低价不能高于最高价' });
    expect(demandSubmit({ ...blank, keyword: ' 耳机 ', minPrice: '0', geoScope: 'CAMPUS', buildingId: 'b1' })).toEqual({ conditions: { keyword: '耳机', category: null, minPrice: 0, maxPrice: null, geoScope: 'CAMPUS', campusId: '东校区', buildingId: null } });
    expect(demandSubmit({ ...blank, category: '数码电子', geoScope: 'ZONE', buildingId: 'b1' })).toMatchObject({ conditions: { geoScope: 'ZONE', campusId: null, buildingId: 'b1' } });
    // 圈子订阅：范围固定
    expect(demandSubmit({ ...blank, keyword: '计算器', geoScope: 'BUILDING' }, true)).toMatchObject({ conditions: { geoScope: 'SCHOOL', campusId: null, buildingId: null } });
  });
  it('条件描述、理由码与档位安全降级；搜索空态预填范围取自状态', () => {
    expect(describeConditions({ keyword: '耳机', category: '数码电子', minPrice: 50, maxPrice: 200, geoScope: 'BUILDING', zone: '沁园', buildingName: '1号楼' })).toBe('关键词「耳机」 · 数码电子 · ¥50–¥200 · 本楼：沁园1号楼');
    expect(describeConditions({ category: '教材书籍', textbook: { title: '高数', editionLabel: '第 8 版', isbn: null }, circle: { id: 'c', name: null } })).toBe('教材《高数》第 8 版 · 教材书籍 · 圈子：已不可见的圈子');
    expect([reasonLabel('KEYWORD_TITLE'), reasonLabel('NEW_CODE'), tierLabel('HIGH'), tierLabel('X')]).toEqual(['标题包含关键词', '其他匹配理由', '高匹配', '匹配']);
    expect(demandPrefill({ keyword: '台灯' }, 'CAMPUS', '西校区')).toMatchObject({ keyword: '台灯', geoScope: 'CAMPUS', campusId: '西校区', buildingId: null });
    expect(demandPrefill({ keyword: '台灯', campus: '南校区' }, 'BUILDING', '西校区')).toMatchObject({ geoScope: 'BUILDING', campusId: null });
    expect(demandPrefill({ category: '其他' }, 'SCHOOL', '西校区')).toMatchObject({ geoScope: 'SCHOOL', campusId: null });
  });
});

describe('需求订阅：演示与后端同语义', () => {
  it('创建幂等（EXISTING）、停用后重新创建是 REACTIVATED；修改与停用；新商品命中后未读数计入「通知」角标，已读 / 忽略后减少', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const created = await api.createSubscription({ keyword: '台灯', category: null, geoScope: 'SCHOOL' });
    expect(created.outcome).toBe('CREATED');
    expect(subscribeResultText(created)).toBe('订阅成功，有匹配的新商品时会出现在「需求匹配」里');
    const again = await api.createSubscription({ keyword: ' 台灯 ', geoScope: 'SCHOOL' });
    expect(again).toMatchObject({ outcome: 'EXISTING', subscription: { id: created.subscription.id } });
    expect(subscribeResultText(again)).toBe('你已经订阅过相同条件，没有重复创建');
    await expect(api.createSubscription({ keyword: '台灯', geoScope: 'BUILDING' })).rejects.toMatchObject({ code: 409, message: '请先在个人资料中设置宿舍楼，或选择一栋楼' });
    await expect(api.createSubscription({ keyword: '台灯', minPrice: 9, maxPrice: 1 })).rejects.toMatchObject({ code: 400, message: '最低价不能高于最高价' });
    await expect(api.createSubscription({ keyword: 'x'.repeat(41) })).rejects.toMatchObject({ code: 400, message: '关键词最多 40 个字' });

    await api.login('seller001', 'demo12345');
    const p = await api.publish({ ...lamp, campus: '西校区', price: 35 });
    await api.login('buyer001', 'demo12345');
    expect(await api.demandUnread()).toBe(1);
    expect(notificationTotal({ received: 1, updates: 2, total: 3 }, 4, await api.demandUnread())).toBe(8);
    const [match] = (await api.demandMatches()).items;
    expect(match).toMatchObject({ read: false, valid: true, product: { id: p.id }, reasonCodes: ['KEYWORD_TITLE'], tier: 'NORMAL' });
    expect(match.product.contact).toBe('');
    expect(await api.markDemandRead(match.id)).toBe(0);
    // 卖家下架 → 匹配失效
    await api.login('seller001', 'demo12345');
    await api.status(p.id, '已售出');
    await api.login('buyer001', 'demo12345');
    expect((await api.demandMatches()).items[0]).toMatchObject({ valid: false, invalidReason: 'NO_LONGER_MATCHES' });
    expect(await api.dismissDemandMatch(match.id)).toBe(0);
    expect((await api.demandMatches()).items).toEqual([]);

    const edited = await api.updateSubscription(created.subscription.id, { keyword: '台灯', geoScope: 'CAMPUS' });
    expect(edited).toMatchObject({ geoScope: 'CAMPUS', campusId: '东校区' });
    expect((await api.updateSubscription(created.subscription.id, { active: false })).active).toBe(false);
    await expect(api.updateSubscription(created.subscription.id, { textbookEditionId: 'x' } as never)).rejects.toMatchObject({ code: 400, message: '请求包含不支持的字段' });
    const reactivated = await api.createSubscription({ keyword: '台灯', geoScope: 'CAMPUS', campusId: '东校区' });
    expect(reactivated.outcome).toBe('REACTIVATED');
    expect((await api.deleteSubscription(created.subscription.id)).active).toBe(false);
    await expect(api.markDemandRead('nope')).rejects.toMatchObject({ code: 404, message: '匹配不存在' });
  });
});

describe('集市范围切换（楼栋集市）', () => {
  it('本楼：没有宿舍楼时 409 → 引导去资料里设置；本楼没有时按 本楼 → 本园区 → 本校区 → 全校 放宽，筛选条件不变', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const noDorm = await api.feed({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 12 }).catch((e) => e);
    expect(noDorm).toBeInstanceOf(ApiError);
    expect(noDorm).toMatchObject({ code: 409, message: '请先在个人资料中选择宿舍楼' });
    expect(feedAction(noDorm)).toBe('set-dorm-building');
    expect(feedAction(new ApiError('请先登录后再使用本楼范围', 401))).toBe('login');
    expect(feedAction(new ApiError('服务异常', 500))).toBeNull();
    expect([LOGIN_NEEDED, DORM_NEEDED]).toEqual(['登录后才能知道你住哪栋楼。我们不会自动定位，也不会替你猜。', '还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。']);

    // 住在沁园 1 号楼：本楼就有演示商品
    await api.updateProfile({ nickname: '小鹿同学', campus: '东校区', contact: '', dormBuildingId: 'demo-building-0-1' });
    const own = await api.feed({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 12 });
    expect(own).toMatchObject({ requestedScope: 'BUILDING', effectiveScope: 'BUILDING', fallbackApplied: false });
    expect(own.items.every((p) => p.sameBuilding && p.buildingId === 'demo-building-0-1')).toBe(true);
    expect(distanceText(own.items[0])).toBe('同楼栋');
    expect(feedNotice(own)).toBe('');
    // 本楼没有这个分类 → 放宽到本园区（同园区的 2 号楼）
    const zone = await api.feed({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 12, category: '生活用品' });
    expect(zone).toMatchObject({ effectiveScope: 'ZONE', effectiveScopeLabel: '本园区', fallbackApplied: true, fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE' });
    expect(zone.items.every((p) => p.category === '生活用品' && p.buildingId === 'demo-building-0-2')).toBe(true);
    expect(feedNotice(zone)).toBe('本楼暂无匹配，已为你展示本园区的商品（筛选条件保持不变）。');
    // 哪里都没有 → 真正的空
    const none = await api.feed({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 12, keyword: '不存在的东西' });
    expect(none).toMatchObject({ total: 0, effectiveScope: 'SCHOOL', fallbackReason: 'NO_RESULTS_IN_ANY_SCOPE' });
    expect(feedNotice(none)).toBe(NOTHING_ANYWHERE);
  });
  it('本校区为空就是空，不自动放宽；全校走普通列表；集市查询原样带到 feed（校区筛选由范围决定）', async () => {
    const api = setup();
    await api.login('buyer001', 'demo12345');
    const campus = await api.feed({ scope: 'CAMPUS', sort: 'latest', page: 1, pageSize: 50 });
    expect(campus.items.length).toBeGreaterThan(0);
    expect(campus.items.every((p) => p.campus === '东校区')).toBe(true);
    const empty = await api.feed({ scope: 'CAMPUS', sort: 'latest', page: 1, pageSize: 12, keyword: '捷安特' });
    expect(empty).toMatchObject({ total: 0, fallbackApplied: false, effectiveScope: 'CAMPUS' });
    expect(feedNotice(empty)).toBe('');
    expect(usesFeed('SCHOOL')).toBe(false);
    expect(feedQueryFrom({ sort: 'priceAsc', page: 1, pageSize: 12, keyword: '台灯', campus: '西校区', minPrice: 0 }, '生活用品', 'CAMPUS', 2))
      .toEqual({ scope: 'CAMPUS', sort: 'priceAsc', page: 2, pageSize: 12, keyword: '台灯', category: '生活用品', minPrice: 0 });
  });
});
