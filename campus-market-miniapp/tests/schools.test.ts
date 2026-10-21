import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { DEMO_SCHOOLS } from '../src/api/mockRules';
import { RestApi } from '../src/api/rest';
import { ApiError, Transport, type RequestPort, type Response } from '../src/api/transport';
import { registerAccount, registrationError } from '../src/account';
import { describeConditions } from '../src/demand';
import { effectiveScope, marketScopes } from '../src/feed';
import {
  BUILDINGS_PENDING, REGISTRATION_CAMPUS_REQUIRED, SchoolCatalog, SchoolsStore, buildingPickerState, parseSchools, registrationChoice,
} from '../src/schools';
import type { School } from '../src/model';

/** 第一所试点学校（与 GET /v1/schools 同形）：校区 id 带命名空间，还没有楼栋。 */
const AUST: School = {
  id: 'aust', name: '安徽理工大学', shortName: '安理工',
  campuses: [{ id: 'aust-huainan', name: '淮南校区', hasBuildings: false }, { id: 'aust-hefei', name: '合肥校区', hasBuildings: false }],
};
const PILOT: School = DEMO_SCHOOLS[0];
const single = new SchoolCatalog([AUST], true);
const multiple = new SchoolCatalog([AUST, PILOT], true);

function mockApi() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return new MockApi(storage);
}
const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' } });
const bad = (message: string, statusCode = 400): Response => ({ statusCode, data: { code: statusCode, message } });
function rest(reply: (input: Parameters<RequestPort>[0]) => Response) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  return { api: new RestApi(new Transport(handler, 'https://campus.example', true)), handler };
}

describe('学校目录：读取一次并缓存', () => {
  it('并发与重复调用只请求一次；读到后通知订阅者，之后直接用缓存', async () => {
    const loader = vi.fn(async () => [AUST]);
    const store = new SchoolsStore(loader), seen: string[][] = [];
    store.subscribe((c) => seen.push(c.schools.map((s) => s.id)));
    expect(store.current.loaded).toBe(false);
    const [a, b] = await Promise.all([store.load(), store.load()]);
    expect(a).toBe(b);
    await store.load();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([['aust']]);
    expect(store.current.loaded).toBe(true);
    expect(store.current.campusLabel('aust-hefei')).toBe('合肥校区');
  });
  it('读取失败不缓存：下次使用时重新请求', async () => {
    const loader = vi.fn<() => Promise<School[]>>().mockRejectedValueOnce(new ApiError('网络异常', 0)).mockResolvedValueOnce([AUST]);
    const store = new SchoolsStore(loader);
    await expect(store.load()).rejects.toThrow('网络异常');
    expect(store.current.loaded).toBe(false);
    expect((await store.load()).campusLabel('aust-huainan')).toBe('淮南校区');
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('演示模式：同一个 getSchools() 形状，经同一个缓存读取（pilot 东 / 西 / 南 / 北校区都有楼栋）', async () => {
    const api = mockApi(), spy = vi.spyOn(api, 'schools');
    const store = new SchoolsStore(() => api.schools());
    await store.load(); await store.load();
    expect(spy).toHaveBeenCalledTimes(1);
    const pilot = store.current.schools.find((s) => s.id === 'pilot')!;
    expect(pilot.campuses).toEqual(['东校区', '西校区', '南校区', '北校区'].map((id) => ({ id, name: id, hasBuildings: true })));
    for (const s of store.current.schools) {
      expect(Object.keys(s).sort()).toEqual(['campuses', 'id', 'name', 'shortName']);
      for (const c of s.campuses) expect(Object.keys(c).sort()).toEqual(['hasBuildings', 'id', 'name']);
    }
  });
});

describe('campusLabel：显示名称，找不到时原样显示 id', () => {
  it('带命名空间的校区 id 显示为名称（aust-huainan → 淮南校区）；卡片「校区 · 楼栋」、订阅范围同样用名称', () => {
    expect(single.campusLabel('aust-huainan')).toBe('淮南校区');
    expect(single.locationLabel('aust-huainan', '3号楼')).toBe('淮南校区 · 3号楼');
    expect(single.locationLabel('aust-hefei', null)).toBe('合肥校区');
    expect(describeConditions({ keyword: '台灯', geoScope: 'CAMPUS', campusId: 'aust-huainan' }, (id) => single.campusLabel(id))).toBe('关键词「台灯」 · 本校区：淮南校区');
    expect(describeConditions({ keyword: '台灯', geoScope: 'ZONE', campusId: 'aust-hefei', zone: '北园' }, (id) => single.campusLabel(id))).toBe('关键词「台灯」 · 本园区：合肥校区北园');
  });
  it('未加载、未知或已停用的校区原样显示 id；空值为空串', () => {
    expect(new SchoolCatalog().campusLabel('aust-huainan')).toBe('aust-huainan');
    expect(single.campusLabel('retired-campus')).toBe('retired-campus');
    expect(single.locationLabel('retired-campus', '1号楼')).toBe('retired-campus · 1号楼');
    expect(single.campusLabel(null)).toBe('');
    expect(single.schoolOfCampus('aust-hefei')?.name).toBe('安徽理工大学');
    expect(single.schoolOfCampus('东校区')).toBeNull();
    expect(multiple.campusesOfSchool('aust').map((c) => c.id)).toEqual(['aust-huainan', 'aust-hefei']);
    expect(multiple.campusesOfSchool('nope')).toEqual([]);
  });
});

describe('注册：先选学校，再选校区', () => {
  it('只有一所学校：不显示学校选择，自动选中；校区必须选，提交的是校区 id', async () => {
    let choice = registrationChoice(single, null, null);
    expect(choice).toMatchObject({ showSchoolPicker: false, school: { id: 'aust' }, campus: null });
    expect(choice.campuses.map((c) => c.name)).toEqual(['淮南校区', '合肥校区']);
    const input = { account: 'student01', password: 'password123', nickname: '小明', campus: choice.campus?.id ?? '', contact: '' };
    expect(registrationError(input, true)).toBe(REGISTRATION_CAMPUS_REQUIRED);
    choice = registrationChoice(single, null, 'aust-huainan');
    expect(choice.campus).toMatchObject({ id: 'aust-huainan', name: '淮南校区' });
    const register = vi.fn(async () => ({ id: 'u1', nickname: '小明', campus: 'aust-huainan' }));
    await registerAccount({ register }, { ...input, campus: choice.campus!.id }, true);
    expect(register).toHaveBeenCalledExactlyOnceWith({ account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '' });
  });
  it('多所学校：显示学校选择，不替用户默认；校区只列所选学校的，别校校区不会被选中', () => {
    let choice = registrationChoice(multiple, null, null);
    expect(choice).toMatchObject({ showSchoolPicker: true, school: null, campuses: [], campus: null });
    expect(choice.schools.map((s) => s.name)).toEqual(['安徽理工大学', '演示学校']);
    choice = registrationChoice(multiple, 'pilot', 'aust-huainan');
    expect(choice.campuses.map((c) => c.id)).toEqual(['东校区', '西校区', '南校区', '北校区']);
    expect(choice.campus).toBeNull();
    expect(registrationChoice(multiple, 'aust', 'aust-hefei').campus?.name).toBe('合肥校区');
    // 只有一个校区的学校自动选中校区
    const oneCampus = new SchoolCatalog([AUST, { id: 's2', name: '二校', shortName: '二校', campuses: [{ id: 's2-main', name: '主校区', hasBuildings: true }] }], true);
    expect(registrationChoice(oneCampus, 's2', null).campus?.id).toBe('s2-main');
    // 没有校区的学校不出现在注册里
    expect(registrationChoice(new SchoolCatalog([AUST, { id: 'empty', name: '空', shortName: '空', campuses: [] }], true), null, null).showSchoolPicker).toBe(false);
  });
  it('演示模式：从 getSchools() 选择学校与校区注册；无效校区 400「校区无效」', async () => {
    const api = mockApi(), catalog = new SchoolCatalog(await api.schools(), true);
    const choice = registrationChoice(catalog, 'demo-school-b', null);
    expect(choice.showSchoolPicker).toBe(true);
    expect(choice.campus?.id).toBe('demo-b-main');
    const user = await registerAccount(api, { account: 'newmate01', password: 'password123', nickname: '新同学', campus: choice.campus!.id, contact: '' }, true);
    expect(user.campus).toBe('demo-b-main');
    await expect(api.register({ account: 'newmate02', password: 'password123', nickname: '新同学', campus: '东区', contact: '' })).rejects.toMatchObject({ code: 400, message: '校区无效' });
  });
});

describe('校区选择只列本人所在学校', () => {
  it('发布 / 打包 / 资料 / 需求订阅共用 campusOptions：只有本校校区', () => {
    expect(multiple.campusOptions('aust-hefei').map((c) => c.id)).toEqual(['aust-huainan', 'aust-hefei']);
    expect(multiple.campusOptions('西校区').map((c) => c.id)).toEqual(['东校区', '西校区', '南校区', '北校区']);
    // 目录里还没有本人校区：只有本人校区本身，不会混入别的学校
    expect(multiple.campusOptions('unknown-campus')).toEqual([{ id: 'unknown-campus', name: 'unknown-campus', hasBuildings: false }]);
    expect(multiple.campusOptions(null)).toEqual([]);
  });
  it('演示模式：本人是 pilot 时看不到另一所演示学校的校区；改到别校或无效校区被服务端拒绝', async () => {
    const api = mockApi(), catalog = new SchoolCatalog(await api.schools(), true);
    const buyer = await api.login('buyer001', 'demo12345');
    const options = catalog.campusOptions(buyer.campus).map((c) => c.id);
    expect(options).toEqual(['东校区', '西校区', '南校区', '北校区']);
    expect(options).not.toContain('demo-b-main');
    await expect(api.updateProfile({ nickname: '小鹿同学', campus: 'demo-b-main', contact: '' })).rejects.toMatchObject({ code: 400, message: '不能通过资料修改学校' });
    await expect(api.updateProfile({ nickname: '小鹿同学', campus: '东区', contact: '' })).rejects.toMatchObject({ code: 400, message: '校区无效' });
    await expect(api.createSubscription({ keyword: '台灯', geoScope: 'CAMPUS', campusId: '东区' })).rejects.toMatchObject({ code: 400, message: '校区无效' });
    expect((await api.updateProfile({ nickname: '小鹿同学', campus: '南校区', contact: '' })).campus).toBe('南校区');
  });
});

describe('楼栋：本校区还没有楼栋时', () => {
  it('集市页不显示「本楼」，本校区 / 全校照常；已在「本楼」时回到全校', () => {
    expect(marketScopes(single.hasBuildings('aust-huainan')).map((s) => s.label)).toEqual(['本校区', '全校']);
    expect(marketScopes(new SchoolCatalog([PILOT], true).hasBuildings('东校区')).map((s) => s.label)).toEqual(['本楼', '本校区', '全校']);
    expect(marketScopes(new SchoolCatalog().hasBuildings('东校区')).map((s) => s.key)).toEqual(['CAMPUS', 'SCHOOL']);
    expect(effectiveScope('BUILDING', false)).toBe('SCHOOL');
    expect(effectiveScope('CAMPUS', false)).toBe('CAMPUS');
    expect(effectiveScope('BUILDING', true)).toBe('BUILDING');
  });
  it('宿舍楼 / 取货楼栋选择器：楼栋为空时显示「本校楼栋信息还在录入中」', async () => {
    expect(buildingPickerState([])).toEqual({ pending: true, text: '本校楼栋信息还在录入中' });
    expect(BUILDINGS_PENDING).toBe('本校楼栋信息还在录入中');
    const api = mockApi();
    await api.login('school002', 'demo12345');
    expect(buildingPickerState(await api.buildings('demo-b-main'))).toMatchObject({ pending: true, text: BUILDINGS_PENDING });
    await api.login('buyer001', 'demo12345');
    expect(buildingPickerState(await api.buildings('东校区'))).toEqual({ pending: false });
  });
  it('本校区与全校在没有楼栋的学校照常工作（演示另一所学校）', async () => {
    const api = mockApi();
    const me = await api.login('school002', 'demo12345');
    expect(me.campus).toBe('demo-b-main');
    const campus = await api.feed({ scope: 'CAMPUS', sort: 'latest', page: 1, pageSize: 20 });
    expect(campus.items.map((p) => p.id)).toEqual(['other-school-product']);
    expect((await api.list({ sort: 'latest', page: 1, pageSize: 20 })).items.map((p) => p.id)).toEqual(['other-school-product']);
  });
});

describe('REST：GET /v1/schools', () => {
  it('公开接口：未登录也不带令牌；解析学校与校区，hasBuildings 只认 true', async () => {
    const { api, handler } = rest(() => ok([{ ...AUST, campuses: [...AUST.campuses, { id: 'aust-x', hasBuildings: 'yes' }, { name: '缺 id' }] }]));
    const schools = await api.schools();
    expect(handler).toHaveBeenCalledTimes(1);
    const [input] = handler.mock.calls[0];
    expect(input).toMatchObject({ method: 'GET', url: 'https://campus.example/v1/schools' });
    expect(input.header.Authorization).toBeUndefined();
    expect(schools).toEqual([{ ...AUST, campuses: [...AUST.campuses, { id: 'aust-x', name: 'aust-x', hasBuildings: false }] }]);
  });
  it('缓存只请求一次；响应格式不对时报「服务响应异常」', async () => {
    const { api, handler } = rest(() => ok([AUST]));
    const store = new SchoolsStore(() => api.schools());
    await store.load(); await store.load();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.current.campusLabel('aust-huainan')).toBe('淮南校区');
    await expect(rest(() => ok({ items: [] })).api.schools()).rejects.toMatchObject({ message: '服务响应异常，请稍后重试' });
    expect(() => parseSchools(null)).toThrow();
  });
  it('请求继续提交校区 id；400「校区无效」原样传给页面；楼栋按校区 id 查询', async () => {
    const { api, handler } = rest((input) => input.url.includes('/v1/auth/register') ? bad('校区无效') : input.url.includes('/v1/buildings') ? ok([]) : bad('校区无效'));
    await expect(api.register({ account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '' })).rejects.toMatchObject({ code: 400, message: '校区无效' });
    expect(buildingPickerState(await api.buildings('aust-huainan'))).toMatchObject({ pending: true });
    await expect(api.updateProfile({ nickname: '小明', campus: 'aust-hefei', contact: '' })).rejects.toMatchObject({ message: '校区无效' });
    expect(handler.mock.calls.map(([i]) => [i.method, i.url.replace('https://campus.example', ''), i.data])).toEqual([
      ['POST', '/v1/auth/register', { account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '' }],
      ['GET', '/v1/buildings?campus=aust-huainan', undefined],
      ['PATCH', '/v1/auth/me', { nickname: '小明', campus: 'aust-hefei', contact: '' }],
    ]);
  });
});

describe('演示库升级', () => {
  it('旧缓存里放在南校区的他校账号与商品移到另一所演示学校，跨校隔离保持不变', async () => {
    let value: unknown;
    const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
    await new MockApi(storage).logout();
    const old = value as { users: { id: string; campus: string }[]; products: { sellerId: string; campus: string }[]; circles?: { school: string }[] };
    old.users.find((u) => u.id === 'other-school')!.campus = '南校区';
    for (const p of old.products) if (p.sellerId === 'other-school') p.campus = '南校区';
    old.circles = [{ id: 'c-old', school: 'demo-school-a', type: 'CLASS', name: '旧圈子', description: '', visibility: 'DISCOVERABLE', ownerId: 'demo-buyer', status: 'ACTIVE', createdAt: 1, updatedAt: 1 } as never];
    const api = new MockApi(storage);
    expect((await api.login('school002', 'demo12345')).campus).toBe('demo-b-main');
    await api.login('buyer001', 'demo12345');
    await expect(api.detail('other-school-product')).rejects.toThrow('不存在');
    expect((value as { circles: { school: string }[] }).circles[0].school).toBe('pilot');
  });
});
