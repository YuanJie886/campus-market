import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AdminContext, ResourceContextProvider, memoryStore } from 'react-admin';
import { UserShow, UsersList } from './App';
import StaffPermissions from './StaffPermissions';
import { ProductShow, ProductsList } from './Products';
import { OrderShow, OrdersList } from './Orders';
import { dataProvider, listQuery } from './dataProvider';
import { authProvider } from './authProvider';
import { clearSession } from './http';
import { i18nProvider } from './i18n';
import { CAMPUS_FILTER_LABEL, CAMPUS_FILTER_TEXT_LABEL } from './CampusUi';
import { SCHOOLS_PATH, campusFilterChoices, campusLabel, campusNames, getSchoolsState, loadSchools, parseSchools, resetSchoolsCache, subscribeSchools, type SchoolsState } from './schools';

// 校区由数据驱动：GET /v1/schools 只读取一次；后台所有显示校区的位置都显示名称，商品筛选用校区名称下拉、提交校区编号。
// 与 phase1/phase2 相同：页面在 Node 中渲染，数据经真实的 dataProvider / authProvider / loadSchools 走被替换的 fetch。

const SCHOOLS = [
    { id: 'aust', name: '安徽理工大学', shortName: '安理', campuses: [{ id: 'aust-huainan', name: '淮南校区', hasBuildings: true }, { id: 'aust-hefei', name: '合肥校区', hasBuildings: false }] },
    { id: 'hfut', name: '合肥工业大学', shortName: '合工大', campuses: [{ id: 'hfut-tunxi', name: '屯溪路校区', hasBuildings: true }] },
];
const directory = parseSchools(SCHOOLS);
const identity = (schoolId: string) => ({ id: 'admin-1', fullName: '陈予安', schoolId, role: 'SCHOOL_ADMIN', permissions: ['users:read', 'users:write', 'products:read', 'products:write', 'orders:read'] });

interface Call { path: string; query: string; method: string }
/** routes 的值：数据（code 0 信封）、Response，或按调用次数返回的函数。 */
function stubApi(routes: Record<string, unknown>, me = identity('aust')) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
        const [path, query = ''] = input.split('?');
        calls.push({ path, query, method: init.method ?? 'GET' });
        if (path === '/v1/admin/me') return new Response(JSON.stringify({ code: 0, data: me }));
        if (path in routes) {
            const handler = routes[path];
            const value = typeof handler === 'function' ? (handler as () => unknown)() : handler;
            return value instanceof Response ? value : new Response(JSON.stringify({ code: 0, data: value }));
        }
        return new Response(JSON.stringify({ code: 404, message: `未模拟 ${path}` }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    return { fetch, calls, schoolCalls: () => calls.filter(call => call.path === SCHOOLS_PATH).length };
}
/** 浏览器里由 useSchools 在挂载时触发；服务端渲染不执行 effect，测试先读取一次（失败也吞掉，状态记为失败）。 */
const preload = () => loadSchools().catch(() => undefined);
const unavailable = () => new Response(JSON.stringify({ code: 503, message: '服务暂不可用' }), { status: 503 });

async function renderAdmin(element: ReactNode, { resource, path = `/${resource}`, store = {} }: { resource: string; path?: string; store?: Record<string, unknown> }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const adminStore = memoryStore({ locale: 'zh', ...store });
    const ui = () => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AdminContext dataProvider={dataProvider} authProvider={authProvider} i18nProvider={i18nProvider} store={adminStore} queryClient={queryClient}>
        <ResourceContextProvider value={resource}><Routes><Route path={`/${resource}/:id?/*`} element={element} /></Routes></ResourceContextProvider>
    </AdminContext></MemoryRouter>);
    let html = ui();
    for (let pass = 0; pass < 8; pass++) {
        const pending = queryClient.getQueryCache().getAll().filter(query => query.state.status === 'pending' && query.state.fetchStatus === 'idle');
        if (!pending.length) break;
        await Promise.all(pending.map(query => query.fetch().catch(() => undefined)));
        html = ui();
    }
    const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
    return { html, text };
}
const columns = (preferenceKey: string, count: number) => ({ [`preferences.${preferenceKey}.availableColumns`]: Array.from({ length: count }, (_, index) => ({ index: String(index) })) });
/** 筛选栏里 name="campus" 的输入框：下拉（MUI Select 的隐藏输入）或自由输入。 */
const campusInput = (html: string) => /<input[^>]*name="campus"[^>]*>/.exec(html)?.[0] ?? '';

const product = (id: string, campus: string, title: string) => ({ id, title, description: '屏幕完好', price: 280, category: '数码电子', campus, status: '在售', moderationHidden: false, version: 'v1', sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016', images: [], history: [] });
const PRODUCTS = { items: [product('p-1', 'aust-huainan', '九成新 Kindle'), product('p-2', 'aust-hefei', '高等数学教材'), product('p-3', '东校区', '宜家台灯')], total: 3 };
const ORDER = {
    id: 'order-1', productId: 'p-1', productTitle: '宜家台灯 · 宿舍阅读灯', productCategory: '生活用品', productCampus: 'aust-huainan', status: 'EXPIRED',
    buyerId: 'buyer-1', buyerNickname: '明月', buyerAccount: '20260021', buyerCampus: 'aust-hefei',
    sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016', sellerCampus: 'aust-huainan',
    meetingPointName: '图书馆东门', meetingCampus: 'aust-huainan', price: 88, createdAt: Date.parse('2026-10-08T02:00:00Z'), events: [], reviews: [],
};
const MEMBER = { id: 'user-9', nickname: '王老师', account: 'T2026009', campus: 'aust-hefei', role: 'MODERATOR', active: true, createdAt: Date.parse('2026-10-01T00:00:00Z') };

beforeEach(() => {
    resetSchoolsCache();
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) original(...args); });
});
afterEach(() => { resetSchoolsCache(); clearSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('校区名称：目录中有名称就显示名称，否则回落到原始编号', () => {
    it('可见学校的校区编号显示名称；隐藏学校（pilot）或未知编号显示原始编号；空值不显示', () => {
        const names = campusNames(directory);
        expect(campusLabel('aust-huainan', names)).toBe('淮南校区');
        expect(campusLabel('aust-hefei', names)).toBe('合肥校区');
        expect(campusLabel('东校区', names)).toBe('东校区');
        expect(campusLabel('retired-campus', names)).toBe('retired-campus');
        for (const empty of [null, undefined, '']) expect(campusLabel(empty, names)).toBeUndefined();
    });
    it('目录读取失败（没有名称表）时所有校区显示原始编号', () => {
        expect(campusLabel('aust-huainan')).toBe('aust-huainan');
        expect(campusLabel('aust-huainan', campusNames(undefined))).toBe('aust-huainan');
    });
    it('解析目录：丢弃缺少编号或名称的学校与校区；不是数组时视为读取失败', () => {
        expect(parseSchools([...SCHOOLS, { id: '', name: '无编号' }, { id: 'x', name: '坏校区', campuses: [{ id: 'x-1' }, null, { id: 'x-2', name: '正常' }] }]).map(school => [school.id, school.campuses.map(campus => campus.id)]))
            .toEqual([['aust', ['aust-huainan', 'aust-hefei']], ['hfut', ['hfut-tunxi']], ['x', ['x-2']]]);
        expect(() => parseSchools({ items: [], total: 0 })).toThrow('学校目录格式无效');
        expect(() => parseSchools(null)).toThrow();
    });
});

describe('学校目录只请求一次，失败不缓存', () => {
    it('多次与并发调用只请求一次 /v1/schools', async () => {
        const { fetch, schoolCalls } = stubApi({ [SCHOOLS_PATH]: SCHOOLS });
        const [first, second] = await Promise.all([loadSchools(), loadSchools()]);
        const third = await loadSchools();
        expect(first).toEqual(directory);
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(schoolCalls()).toBe(1);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('请求失败（503）不缓存：下次调用重新请求，成功后再缓存', async () => {
        let attempt = 0;
        const { schoolCalls } = stubApi({ [SCHOOLS_PATH]: () => (attempt++ === 0 ? unavailable() : SCHOOLS) });
        await expect(loadSchools()).rejects.toMatchObject({ status: 503 });
        await expect(loadSchools()).resolves.toEqual(directory);
        await loadSchools();
        expect(schoolCalls()).toBe(2);
    });
    it('页面状态：读取中 → 失败（回落）→ 重新读取成功后通知订阅的组件显示名称', async () => {
        let attempt = 0;
        stubApi({ [SCHOOLS_PATH]: () => (attempt++ === 0 ? unavailable() : SCHOOLS) });
        const seen: SchoolsState[] = [];
        const unsubscribe = subscribeSchools(() => seen.push(getSchoolsState()));
        expect(getSchoolsState()).toEqual({ failed: false, loading: false });
        await loadSchools().catch(() => undefined);
        expect(getSchoolsState()).toEqual({ failed: true, loading: false });
        await loadSchools();
        unsubscribe();
        expect(seen.map(item => [item.loading, item.failed, item.data?.length ?? 0])).toEqual([[true, false, 0], [false, true, 0], [true, true, 0], [false, false, 2]]);
        expect(getSchoolsState().data).toEqual(directory);
    });
    it('格式无效的响应同样不缓存；公开接口 401 不触发会话刷新', async () => {
        let attempt = 0;
        const { calls, schoolCalls } = stubApi({ [SCHOOLS_PATH]: () => (attempt++ === 0 ? { items: [], total: 0 } : new Response(JSON.stringify({ code: 401, message: '请登录' }), { status: 401 })) });
        await expect(loadSchools()).rejects.toMatchObject({ status: 502 });
        await expect(loadSchools()).rejects.toMatchObject({ status: 401 });
        expect(schoolCalls()).toBe(2);
        expect(calls.some(call => call.path.startsWith('/v1/auth/'))).toBe(false);
    });
});

describe('商品「所在校区」筛选选项（value = 校区编号）', () => {
    it('已知当前工作人员的学校：只列本校校区，名称不加学校前缀', () => {
        expect(campusFilterChoices(directory, 'aust')).toEqual([{ id: 'aust-huainan', name: '淮南校区' }, { id: 'aust-hefei', name: '合肥校区' }]);
        expect(campusFilterChoices(directory, 'hfut')).toEqual([{ id: 'hfut-tunxi', name: '屯溪路校区' }]);
    });
    it('学校未知或不在目录中（例如被隐藏的 pilot）：列出所有可见校区，跨学校时加学校简称', () => {
        const all = [{ id: 'aust-huainan', name: '安理 · 淮南校区' }, { id: 'aust-hefei', name: '安理 · 合肥校区' }, { id: 'hfut-tunxi', name: '合工大 · 屯溪路校区' }];
        expect(campusFilterChoices(directory, undefined)).toEqual(all);
        expect(campusFilterChoices(directory, 'pilot')).toEqual(all);
        expect(campusFilterChoices(parseSchools([{ id: 'only', name: '唯一学校', campuses: [{ id: 'only-main', name: '主校区' }] }]), null)).toEqual([{ id: 'only-main', name: '主校区' }]);
    });
    it('目录不可用时没有选项（界面回落为自由输入）', () => {
        expect(campusFilterChoices(undefined, 'aust')).toEqual([]);
        expect(campusFilterChoices([], 'aust')).toEqual([]);
    });
    it('筛选把校区编号原样发给后端', () => {
        const query = new URLSearchParams(listQuery('products', { pagination: { page: 1, perPage: 25 }, sort: { field: 'createdAt', order: 'DESC' }, filter: { campus: 'aust-hefei' } }));
        expect(query.get('campus')).toBe('aust-hefei');
    });
});

describe('页面显示校区名称', () => {
    it('商品目录：校区列显示名称、隐藏学校显示原始编号；筛选是校区下拉；整页只请求一次目录', async () => {
        const { schoolCalls } = stubApi({ [SCHOOLS_PATH]: SCHOOLS, '/v1/admin/products': PRODUCTS });
        await preload();
        const { html, text } = await renderAdmin(<ProductsList />, { resource: 'products', store: columns('products.management.v2', 9) });
        expect(text).toContain('淮南校区');
        expect(text).toContain('合肥校区');
        expect(text).toContain('东校区');
        expect(text).not.toMatch(/aust-huainan|aust-hefei/);
        expect(text).toContain(CAMPUS_FILTER_LABEL);
        expect(text).not.toContain(CAMPUS_FILTER_TEXT_LABEL);
        expect(text).not.toContain('完整名称');
        expect(campusInput(html)).toContain('MuiSelect-nativeInput');
        expect(schoolCalls()).toBe(1);
    });
    it('商品目录：目录尚未读取完成时先显示原始编号，筛选是加载中的下拉而不是自由输入', async () => {
        stubApi({ [SCHOOLS_PATH]: SCHOOLS, '/v1/admin/products': PRODUCTS });
        const { html, text } = await renderAdmin(<ProductsList />, { resource: 'products', store: columns('products.management.v2', 9) });
        expect(text).toContain('aust-huainan');
        expect(text).toContain(CAMPUS_FILTER_LABEL);
        expect(text).not.toContain(CAMPUS_FILTER_TEXT_LABEL);
        expect(campusInput(html)).not.toContain('type="text"');
    });
    it('商品目录：目录读取失败时显示原始编号，筛选回落为自由输入的校区编号', async () => {
        const { schoolCalls } = stubApi({ [SCHOOLS_PATH]: unavailable, '/v1/admin/products': PRODUCTS });
        await preload();
        const { html, text } = await renderAdmin(<ProductsList />, { resource: 'products', store: columns('products.management.v2', 9) });
        expect(text).toContain('aust-huainan');
        expect(text).toContain('aust-hefei');
        expect(text).toContain('九成新 Kindle');
        expect(text).toContain(CAMPUS_FILTER_TEXT_LABEL);
        expect(campusInput(html)).toContain('type="text"');
        expect(campusInput(html)).toContain('maxLength="100"');
        expect(schoolCalls()).toBe(1);
    });
    it('商品详情：摘要与卖家信息显示校区名称；失败时显示原始编号', async () => {
        stubApi({ [SCHOOLS_PATH]: SCHOOLS, '/v1/admin/products/p-1': product('p-1', 'aust-huainan', '九成新 Kindle') });
        await preload();
        const named = await renderAdmin(<ProductShow />, { resource: 'products', path: '/products/p-1/show' });
        expect(named.text).toContain('数码电子 · 淮南校区');
        expect(named.text).toContain('校区：淮南校区');
        expect(named.text).not.toContain('aust-huainan');
        vi.unstubAllGlobals(); resetSchoolsCache();
        stubApi({ [SCHOOLS_PATH]: unavailable, '/v1/admin/products/p-1': product('p-1', 'aust-huainan', '九成新 Kindle') });
        await preload();
        const raw = await renderAdmin(<ProductShow />, { resource: 'products', path: '/products/p-1/show' });
        expect(raw.text).toContain('校区：aust-huainan');
    });
    it('历史订单：列表商品格与详情的商品、买家、卖家、面交校区都显示名称', async () => {
        stubApi({ [SCHOOLS_PATH]: SCHOOLS, '/v1/admin/orders': { items: [ORDER], total: 1 }, '/v1/admin/orders/order-1': ORDER });
        await preload();
        const list = await renderAdmin(<OrdersList />, { resource: 'orders', store: columns('orders.transaction-details.v2', 8) });
        expect(list.text).toContain('生活用品 · 淮南校区');
        const detail = await renderAdmin(<OrderShow />, { resource: 'orders', path: '/orders/order-1/show' });
        expect(detail.text).toContain('· 淮南校区');
        expect(detail.text).toMatch(/所在校区 合肥校区/);
        expect(detail.text).toMatch(/所在校区 淮南校区/);
        expect(detail.text).toMatch(/面交校区 淮南校区/);
        expect(detail.text).not.toMatch(/aust-huainan|aust-hefei/);
    });
    it('用户列表、用户详情与权限配置页显示校区名称', async () => {
        stubApi({ [SCHOOLS_PATH]: SCHOOLS, '/v1/admin/users': { items: [MEMBER], total: 1 }, '/v1/admin/users/user-9': MEMBER });
        await preload();
        const list = await renderAdmin(<UsersList />, { resource: 'users', store: columns('users.datagrid', 8) });
        expect(list.text).toContain('合肥校区');
        expect(list.text).not.toContain('aust-hefei');
        const show = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/user-9/show' });
        expect(show.text).toContain('合肥校区');
        expect(show.text).not.toContain('aust-hefei');
        const staff = await renderAdmin(<StaffPermissions />, { resource: 'users', path: '/users/user-9' });
        expect(staff.text).toContain('T2026009 · 合肥校区');
    });
    it('用户页面在目录读取失败时显示原始编号', async () => {
        stubApi({ [SCHOOLS_PATH]: unavailable, '/v1/admin/users/user-9': MEMBER });
        await preload();
        const show = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/user-9/show' });
        expect(show.text).toContain('aust-hefei');
        const staff = await renderAdmin(<StaffPermissions />, { resource: 'users', path: '/users/user-9' });
        expect(staff.text).toContain('T2026009 · aust-hefei');
    });
});
