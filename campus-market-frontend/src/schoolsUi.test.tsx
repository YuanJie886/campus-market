// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { RestCampusMarketApi } from './api/restCampusMarketApi';
import { HttpTransport } from './api/httpTransport';
import { ApiError } from './api/errors';
import { normalizeSchools, type CampusMarketApi, type School } from './api/contracts';
import { loadSchools, useSchools } from './hooks/useSchools';
import { campusChoicesFor, campusLabel, campusesOfSchool, defaultCampusFor, hasBuildings, schoolOfCampus } from './utils/schools';
import { describeConditions } from './utils/demand';
import { availableScopes, effectiveScope, MARKET_SCOPE_KEY } from './utils/marketScope';
import { BUILDINGS_PENDING } from './components/BuildingSelect';
import { CAMPUS_REQUIRED, SCHOOL_REQUIRED } from './pages/RegisterPage';
import type { MockBuilding } from './data/buildings';
import { axeViolations } from './test-axe';
import * as domainTypes from './types';

/**
 * 学校与校区改为数据登记（GET /v1/schools）：首个试点学校安徽理工大学（淮南校区 aust-huainan、合肥校区 aust-hefei），
 * 校区 id 不再等于显示名称。离线演示仍是演示学校（pilot，东 / 西 / 南 / 北校区，id 等于名称）。
 */

const AUST: School = {
  id: 'aust', name: '安徽理工大学', shortName: '安理工',
  campuses: [
    { id: 'aust-huainan', name: '淮南校区', hasBuildings: true },
    { id: 'aust-hefei', name: '合肥校区', hasBuildings: false },
  ],
};
const PILOT: School = {
  id: 'pilot', name: '演示学校', shortName: '演示',
  campuses: ['东校区', '西校区', '南校区', '北校区'].map((c) => ({ id: c, name: c, hasBuildings: true })),
};

type MockInternals = { db: { campusSchools: Record<string, string>; buildings: MockBuilding[] }; persist(): void };

/** 在离线 Mock 里登记安徽理工大学（校区归属与楼栋），并让 getSchools 返回给定的学校列表（带真实校区名称） */
function mockWithAust(schools: School[] = [AUST, PILOT], opts: { huainanBuilding?: boolean } = {}): MockCampusMarketApi {
  const api = new MockCampusMarketApi();
  const internals = api as unknown as MockInternals;
  internals.db.campusSchools['aust-huainan'] = 'aust';
  internals.db.campusSchools['aust-hefei'] = 'aust';
  if (opts.huainanBuilding !== false) {
    internals.db.buildings.push({ id: 'aust-hn-1', campusId: 'aust-huainan', zone: '东苑', name: '1号楼', latitude: null, longitude: null, active: true, sortOrder: 1 });
  }
  internals.persist();
  vi.spyOn(api, 'getSchools').mockResolvedValue(schools);
  setApiClient(api);
  return api;
}

const register = (api: CampusMarketApi, campus: string, account = `u${Math.random().toString(36).slice(2, 9)}`) =>
  api.register({ account, password: 'test-password', nickname: '同学', campus, contact: '13800000000' });

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

async function optionsOf(combobox: HTMLElement): Promise<string[]> {
  fireEvent.mouseDown(combobox);
  const listbox = await screen.findByRole('listbox');
  const names = within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return names;
}

async function choose(combobox: HTMLElement, option: string) {
  fireEvent.mouseDown(combobox);
  fireEvent.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('学校数据与辅助函数', () => {
  it('campusLabel：已知校区给名称，未知 / 列表未加载回落到原始 id；schoolOfCampus / campusesOfSchool / hasBuildings', () => {
    const schools = [AUST, PILOT];
    expect(campusLabel(schools, 'aust-huainan')).toBe('淮南校区');
    expect(campusLabel(schools, '东校区')).toBe('东校区');
    expect(campusLabel(schools, 'gone-campus')).toBe('gone-campus');
    expect(campusLabel([], 'aust-hefei')).toBe('aust-hefei');
    expect(campusLabel(schools, null)).toBe('');
    expect(schoolOfCampus(schools, 'aust-hefei')?.id).toBe('aust');
    expect(schoolOfCampus(schools, 'nope')).toBeNull();
    expect(campusesOfSchool(schools, 'aust').map((c) => c.id)).toEqual(['aust-huainan', 'aust-hefei']);
    expect(campusesOfSchool(schools, 'nope')).toEqual([]);
    expect(hasBuildings(schools, 'aust-hefei')).toBe(false);
    expect(hasBuildings(schools, 'aust-huainan')).toBe(true);
    // 未知校区不提前隐藏任何入口
    expect(hasBuildings(schools, 'nope')).toBe(true);
    expect(hasBuildings([], 'aust-hefei')).toBe(true);
  });

  it('选择器选项只列本人学校的校区；本人学校未知时只保留本人当前校区；默认校区 = 本人校区，否则本校第一个校区', () => {
    expect(campusChoicesFor([AUST, PILOT], 'aust-hefei').map((c) => c.name)).toEqual(['淮南校区', '合肥校区']);
    expect(campusChoicesFor([AUST, PILOT], '西校区').map((c) => c.id)).toEqual(['东校区', '西校区', '南校区', '北校区']);
    expect(campusChoicesFor([], 'aust-hefei')).toEqual([{ id: 'aust-hefei', name: 'aust-hefei', hasBuildings: true }]);
    expect(campusChoicesFor([AUST], '')).toEqual([]);
    expect(defaultCampusFor([AUST], 'aust-hefei', 'aust')).toBe('aust-hefei');
    expect(defaultCampusFor([AUST], null, 'aust')).toBe('aust-huainan');
    expect(defaultCampusFor([AUST], null, null)).toBe('');
  });

  it('normalizeSchools：丢弃没有 id 的学校 / 校区，名称缺失回落到 id，hasBuildings 只认明确的 false', () => {
    expect(normalizeSchools(null)).toEqual([]);
    expect(normalizeSchools([
      { id: 'aust', name: '安徽理工大学', campuses: [{ id: 'aust-huainan', name: '淮南校区', hasBuildings: false }, { name: '没有 id' }, { id: 'aust-hefei' }] },
      { name: '没有 id 的学校', campuses: [] },
      'junk',
    ])).toEqual([{ id: 'aust', name: '安徽理工大学', shortName: '安徽理工大学', campuses: [
      { id: 'aust-huainan', name: '淮南校区', hasBuildings: false },
      { id: 'aust-hefei', name: 'aust-hefei', hasBuildings: true },
    ] }]);
  });

  it('前端不再导出写死的校区常量（Campus 只是字符串）', () => {
    expect('CAMPUSES' in domainTypes).toBe(false);
    const campus: domainTypes.Campus = 'aust-huainan';
    expect(campus).toBe('aust-huainan');
  });

  it('useSchools：同一个 API 客户端只请求一次 /v1/schools，多个组件共用；绑定的 campusLabel 回落到 id', async () => {
    const getSchools = vi.fn(async () => [AUST]);
    const api = { getSchools } as unknown as CampusMarketApi;
    setApiClient(api);
    const first = renderHook(() => useSchools());
    const second = renderHook(() => useSchools());
    expect(first.result.current.loading).toBe(true);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(getSchools).toHaveBeenCalledTimes(1);
    // 已加载后新挂载的组件同步拿到结果，不再请求
    const third = renderHook(() => useSchools());
    expect(third.result.current.loading).toBe(false);
    expect(third.result.current.campusLabel('aust-hefei')).toBe('合肥校区');
    expect(third.result.current.campusLabel('legacy-id')).toBe('legacy-id');
    expect(third.result.current.schoolOfCampus('aust-huainan')?.name).toBe('安徽理工大学');
    expect(third.result.current.campusesOfSchool('aust')).toHaveLength(2);
    expect(third.result.current.hasBuildings('aust-hefei')).toBe(false);
    expect(await loadSchools(api)).toEqual([AUST]);
    expect(getSchools).toHaveBeenCalledTimes(1);
  });

  it('useSchools：失败不缓存——给出带编号的错误，reload() 重新请求；没有 getSchools 的客户端按空列表处理', async () => {
    const getSchools = vi.fn()
      .mockRejectedValueOnce(new ApiError({ code: 500, message: '服务暂不可用', requestId: 'rid-schools-1', httpStatus: 500 }))
      .mockResolvedValueOnce([PILOT]);
    setApiClient({ getSchools } as unknown as CampusMarketApi);
    const { result } = renderHook(() => useSchools());
    await waitFor(() => expect(result.current.error).toContain('rid-schools-1'));
    expect(result.current.schools).toEqual([]);
    result.current.reload();
    await waitFor(() => expect(result.current.schools).toEqual([PILOT]));
    expect(result.current.error).toBeNull();
    expect(getSchools).toHaveBeenCalledTimes(2);

    setApiClient({} as unknown as CampusMarketApi);
    const legacy = renderHook(() => useSchools());
    await waitFor(() => expect(legacy.result.current.loading).toBe(false));
    expect(legacy.result.current.campusLabel('东校区')).toBe('东校区');
  });

  it('订阅条件里的校区写名称（不写 id）', () => {
    const label = (id: string | null | undefined) => campusLabel([AUST], id);
    expect(describeConditions({ keyword: '台灯', geoScope: 'CAMPUS', campusId: 'aust-huainan' }, label)).toBe('关键词「台灯」 · 本校区：淮南校区');
    expect(describeConditions({ category: '其他', geoScope: 'ZONE', campusId: 'aust-huainan', zone: '东苑' }, label)).toBe('其他 · 本园区：淮南校区东苑');
    // 不传名称函数时原样显示（旧调用方）
    expect(describeConditions({ keyword: 'x', geoScope: 'CAMPUS', campusId: 'aust-hefei' })).toBe('关键词「x」 · 本校区：aust-hefei');
  });

  it('首页范围：没有楼栋时不提供「本楼」，记着的「本楼」回到默认范围；未知时照常提供', () => {
    expect(availableScopes(false).map((s) => s.label)).toEqual(['本校区', '全校']);
    expect(availableScopes(null).map((s) => s.label)).toEqual(['本楼', '本校区', '全校']);
    expect(effectiveScope('BUILDING', availableScopes(false))).toBe('SCHOOL');
    expect(effectiveScope('CAMPUS', availableScopes(false))).toBe('CAMPUS');
  });
});

describe('离线 Mock：同一个 getSchools 形状与同样的校验', () => {
  it('演示学校 pilot：东 / 西 / 南 / 北校区，id 等于名称；hasBuildings 按启用的楼栋计算', async () => {
    const api = new MockCampusMarketApi();
    expect(await api.getSchools()).toEqual([PILOT]);
    const internals = api as unknown as MockInternals;
    for (const b of internals.db.buildings) if (b.campusId === '北校区') b.active = false;
    const north = (await api.getSchools())[0].campuses.find((c) => c.id === '北校区');
    expect(north).toEqual({ id: '北校区', name: '北校区', hasBuildings: false });
    expect(await api.listBuildings('北校区')).toEqual([]);
  });

  it('未登记的校区：注册、改资料、发布商品都是 400「校区无效」', async () => {
    const api = new MockCampusMarketApi();
    const code = (p: Promise<unknown>) => p.then(() => 0, (e: ApiError) => `${e.code} ${e.message}`);
    expect(await code(register(api, 'aust-huainan'))).toBe('400 校区无效');
    expect(await code(register(api, ''))).toBe('400 校区无效');
    await register(api, '东校区');
    expect(await code(api.updateProfile({ campus: 'aust-huainan' }))).toBe('400 校区无效');
    expect(await code(api.createProduct({ title: '台灯', description: 'd', price: 10, category: '其他', condition: '全新', campus: 'aust-hefei', images: ['https://example.invalid/a.png'], contact: '1' } as never))).toBe('400 校区无效');
  });
});

describe('REST：路径与请求体', () => {
  it('GET /v1/schools（响应逐项校验）；校区 id 原样用于 /v1/buildings?campus= 与注册请求体', async () => {
    const calls: Array<[string, string, string | undefined]> = [];
    const responses: Record<string, unknown> = {
      '/v1/schools': [{ id: 'aust', name: '安徽理工大学', shortName: '安理工', campuses: [{ id: 'aust-huainan', name: '淮南校区', hasBuildings: true }, { id: 'aust-hefei', name: '合肥校区', hasBuildings: false }] }],
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      calls.push([init?.method ?? 'GET', path, init?.body as string | undefined]);
      const data = responses[path.split('?')[0]] ?? (path.startsWith('/v1/auth/register') ? { accessToken: 't', expiresAtIso: new Date(Date.now() + 60_000).toISOString(), user: {} } : []);
      return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rest = new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
    expect(await rest.getSchools()).toEqual([AUST]);
    expect(await rest.listBuildings('aust-hefei')).toEqual([]);
    await rest.register({ account: 'a2026001', password: 'test-password', nickname: '同学', campus: 'aust-huainan' });
    expect(calls.map(([m, u]) => `${m} ${u}`)).toEqual([
      'GET /v1/schools',
      'GET /v1/buildings?campus=aust-hefei',
      'POST /v1/auth/register',
    ]);
    expect(JSON.parse(calls[2][2] ?? '{}').campus).toBe('aust-huainan');
  });

  it('构建检查：/v1/schools 只出现在 REST 产物里（Mock 产物由离线数据给出学校列表）', () => {
    const script = Object.values(import.meta.glob(['../scripts/check-bundles.mjs'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];
    const restOnly = script.slice(script.indexOf('const REST_ONLY'), script.indexOf('function bundle'));
    expect(restOnly).toContain("'/v1/schools'");
  });
});

describe('注册：先选学校，再选校区（来自 /v1/schools）', () => {
  it('多所学校：显示「学校」选择；没有默认校区；未选时给出可访问的校验提示；只列所选学校的校区；提交校区 id', async () => {
    const api = mockWithAust([AUST, PILOT]);
    const spy = vi.spyOn(api, 'register');
    const { container } = renderApp('/register');
    await screen.findByRole('heading', { name: '注册新账号' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText(/学号 \/ 手机号/), { target: { value: 'aust2026001' } });
    fireEvent.change(screen.getByLabelText(/^昵称/), { target: { value: '新同学' } });
    fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: 'test-password' } });
    fireEvent.change(screen.getByLabelText(/^确认密码/), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^已阅读并同意/ }));

    const school = await screen.findByRole('combobox', { name: /^学校/ });
    await waitFor(() => expect(school.getAttribute('aria-disabled')).not.toBe('true'));
    const campus = screen.getByRole('combobox', { name: /^所在校区/ });
    // 新用户没有默认校区；没选学校前校区不可选
    expect(campus.textContent?.replace(/​/g, '').trim()).toBe('');
    expect(campus.getAttribute('aria-disabled')).toBe('true');
    expect(await optionsOf(school)).toEqual(['安徽理工大学', '演示学校']);

    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    expect(await screen.findByText(SCHOOL_REQUIRED)).toBeTruthy();
    expect(document.activeElement).toBe(school);
    expect(spy).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);

    await choose(school, '安徽理工大学');
    expect(screen.queryByText(SCHOOL_REQUIRED)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    expect(await screen.findByText(CAMPUS_REQUIRED)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    expect(await optionsOf(campus)).toEqual(['淮南校区', '合肥校区']);

    await choose(campus, '淮南校区');
    // 换学校后已选校区清空
    await choose(school, '演示学校');
    expect(campus.textContent?.replace(/​/g, '').trim()).toBe('');
    await choose(school, '安徽理工大学');
    await choose(campus, '淮南校区');
    expect(screen.queryByText(CAMPUS_REQUIRED)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toEqual({ account: 'aust2026001', password: 'test-password', nickname: '新同学', campus: 'aust-huainan', contact: '' });
    await waitFor(async () => expect((await api.getCurrentUser())?.campus).toBe('aust-huainan'));
  });

  it('只有一所学校：不显示学校选择，直接列出该校的校区（仍然没有默认值）', async () => {
    const api = mockWithAust([AUST]);
    const spy = vi.spyOn(api, 'register');
    const { container } = renderApp('/register');
    const campus = await screen.findByRole('combobox', { name: /^所在校区/ }, { timeout: 5000 });
    await waitFor(() => expect(campus.getAttribute('aria-disabled')).not.toBe('true'));
    expect(screen.queryByRole('combobox', { name: /^学校/ })).toBeNull();
    expect(screen.getByText(/安徽理工大学/)).toBeTruthy();
    expect(campus.textContent?.replace(/​/g, '').trim()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '注册并登录' }));
    expect(await screen.findByText(CAMPUS_REQUIRED)).toBeTruthy();
    expect(document.activeElement).toBe(campus);
    expect(spy).not.toHaveBeenCalled();
    expect(await optionsOf(campus)).toEqual(['淮南校区', '合肥校区']);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('学校列表加载失败：显示带编号的错误与「重新加载」，不发出注册请求', async () => {
    const api = new MockCampusMarketApi();
    vi.spyOn(api, 'getSchools')
      .mockRejectedValueOnce(new ApiError({ code: 503, message: '服务暂不可用', requestId: 'rid-sch-9', httpStatus: 503 }))
      .mockResolvedValueOnce([PILOT]);
    setApiClient(api);
    renderApp('/register');
    const alert = await screen.findByText(/学校列表加载失败/, {}, { timeout: 5000 });
    expect(alert.textContent).toContain('rid-sch-9');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    const campus = await screen.findByRole('combobox', { name: /^所在校区/ });
    await waitFor(() => expect(campus.getAttribute('aria-disabled')).not.toBe('true'));
    expect(await optionsOf(campus)).toEqual(['东校区', '西校区', '南校区', '北校区']);
  });
});

describe('显示校区名称（带命名空间的 id）', () => {
  it('商品卡片「校区 · 楼栋」、详情、资料卡与首页标题都显示「淮南校区」，不显示 aust-huainan', async () => {
    const api = mockWithAust();
    await register(api, 'aust-huainan');
    const withBuilding = await api.createProduct({ title: '淮南台灯', description: 'd', price: 10, category: '其他', condition: '全新', campus: 'aust-huainan', buildingId: 'aust-hn-1', images: ['https://example.invalid/a.png'], contact: '1' } as never);
    await api.createProduct({ title: '淮南书架', description: 'd', price: 20, category: '其他', condition: '全新', campus: 'aust-huainan', images: ['https://example.invalid/a.png'], contact: '1' } as never);
    renderApp('/');
    await screen.findByText('淮南台灯', {}, { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('淮南校区 · 1号楼')).toBeTruthy());
    expect(screen.getAllByText('淮南校区').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('aust-huainan');
    cleanup();

    renderApp(`/product/${withBuilding.id}`);
    await screen.findByRole('heading', { name: '淮南台灯' }, { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('淮南校区 · 东苑1号楼')).toBeTruthy());
    expect(document.body.textContent).not.toContain('aust-huainan');
    cleanup();

    renderApp('/profile');
    await waitFor(() => expect(screen.getByText(/淮南校区 · 账号/)).toBeTruthy(), { timeout: 5000 });
  });

  it('需求订阅列表里的「本校区」写校区名称', async () => {
    const api = mockWithAust();
    await register(api, 'aust-hefei');
    await api.createDemandSubscription({ keyword: '电热水壶', geoScope: 'CAMPUS', campusId: 'aust-hefei' });
    renderApp('/demands?tab=subscriptions');
    await waitFor(() => expect(screen.getByText('关键词「电热水壶」 · 本校区：合肥校区')).toBeTruthy(), { timeout: 5000 });
  });
});

describe('校区选择器只列本人学校的校区', () => {
  it('资料页「所在校区」与首页校区筛选：安徽理工大学的同学只看到淮南 / 合肥校区', async () => {
    const api = mockWithAust();
    await register(api, 'aust-huainan');
    renderApp('/profile');
    const campus = await screen.findByRole('combobox', { name: /^所在校区/ }, { timeout: 5000 });
    await waitFor(() => expect(campus.textContent).toContain('淮南校区'));
    expect(await optionsOf(campus)).toEqual(['淮南校区', '合肥校区']);
    cleanup();

    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: /筛选与排序/ }, { timeout: 5000 }));
    const filter = await screen.findByRole('combobox', { name: /^校区/ });
    await waitFor(async () => expect(await optionsOf(filter)).toEqual(['全部校区', '淮南校区', '合肥校区']));
  });

  it('发布页「交易地点（校区）」默认本人校区，只列本校校区；演示学校的同学只看到东 / 西 / 南 / 北校区', async () => {
    const api = mockWithAust();
    await register(api, 'aust-hefei');
    renderApp('/publish');
    const campus = await screen.findByRole('combobox', { name: /交易地点（校区）/ }, { timeout: 5000 });
    await waitFor(() => expect(campus.textContent).toContain('合肥校区'));
    expect(await optionsOf(campus)).toEqual(['淮南校区', '合肥校区']);
    cleanup();

    const demo = mockWithAust();
    await register(demo, '西校区');
    renderApp('/publish');
    const demoCampus = await screen.findByRole('combobox', { name: /交易地点（校区）/ }, { timeout: 5000 });
    await waitFor(() => expect(demoCampus.textContent).toContain('西校区'));
    expect(await optionsOf(demoCampus)).toEqual(['东校区', '西校区', '南校区', '北校区']);
  });
});

describe('校区还没有楼栋', () => {
  it('hasBuildings=false：首页不提供「本楼」（会话里记着的「本楼」回到全校），本校区 / 全校照常', async () => {
    const api = mockWithAust();
    await register(api, 'aust-hefei');
    window.sessionStorage.setItem(MARKET_SCOPE_KEY, 'BUILDING');
    const feed = vi.spyOn(api, 'feedProducts');
    const { container } = renderApp('/');
    const group = await screen.findByRole('radiogroup', { name: '商品范围' }, { timeout: 5000 });
    await waitFor(() => expect(within(group).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['本校区', '全校']));
    expect((within(group).getByRole('radio', { name: '全校' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: '本校区' }));
    await waitFor(() => expect(feed).toHaveBeenCalled());
    expect(feed.mock.calls.every(([q]) => q.scope === 'CAMPUS')).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('/v1/buildings 返回空列表（即使 hasBuildings 没说没有）时同样不提供「本楼」；有楼栋的校区照常三项', async () => {
    const api = mockWithAust([AUST, PILOT], { huainanBuilding: false });
    await register(api, 'aust-huainan');
    renderApp('/');
    const group = await screen.findByRole('radiogroup', { name: '商品范围' }, { timeout: 5000 });
    await waitFor(() => expect(within(group).queryByRole('radio', { name: '本楼' })).toBeNull());
    cleanup();

    const demo = mockWithAust();
    await register(demo, '东校区');
    renderApp('/');
    const demoGroup = await screen.findByRole('radiogroup', { name: '商品范围' }, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(demoGroup).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['本楼', '本校区', '全校']);
  });

  it('宿舍楼与取货楼栋选择处显示「本校楼栋信息还在录入中」，而不是空列表；资料仍可保存', async () => {
    const api = mockWithAust();
    await register(api, 'aust-hefei');
    const listBuildings = vi.spyOn(api, 'listBuildings');
    const { container } = renderApp('/profile');
    expect(await screen.findByText(BUILDINGS_PENDING, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /^宿舍楼/ })).toBeNull();
    // 服务端已说明没有楼栋：不再请求楼栋列表
    expect(listBuildings).not.toHaveBeenCalledWith('aust-hefei');
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(async () => expect((await api.getCurrentUser())?.campus).toBe('aust-hefei'));
    cleanup();

    renderApp('/publish');
    await screen.findByRole('combobox', { name: /交易地点（校区）/ }, { timeout: 5000 });
    expect(await screen.findByText(BUILDINGS_PENDING)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /^取货楼栋/ })).toBeNull();
  });

  it('切到有楼栋的校区后楼栋选择恢复（淮南校区：东苑 · 1号楼）', async () => {
    const api = mockWithAust();
    await register(api, 'aust-hefei');
    renderApp('/profile');
    await screen.findByText(BUILDINGS_PENDING, {}, { timeout: 5000 });
    await choose(screen.getByRole('combobox', { name: /^所在校区/ }), '淮南校区');
    const dorm = await screen.findByRole('combobox', { name: /^宿舍楼/ });
    expect(screen.queryByText(BUILDINGS_PENDING)).toBeNull();
    expect(await optionsOf(dorm)).toEqual(['不填写', '东苑 · 1号楼']);
  });
});
