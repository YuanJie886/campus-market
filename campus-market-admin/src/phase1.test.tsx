import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AdminContext, ResourceContextProvider, memoryStore } from 'react-admin';
import App, { AppealsList, CaseEdit, CaseShow } from './App';
import { OrderShow, OrdersList, LEGACY_ORDERS_NOTICE } from './Orders';
import { ProductShow, SOLD_PRODUCT_EDIT_NOTE } from './Products';
import { dataProvider } from './dataProvider';
import { authProvider } from './authProvider';
import { clearSession } from './http';
import { i18nProvider } from './i18n';
import { decisionActionChoices, decisionReasonChoices, resourceNames } from './adminUi';

// 阶段 1（站内交易停用）：管理后台的历史订单只读、商品编辑新规则、治理标签。
// 页面在 Node 中用 react-dom/server 渲染，数据经真实的 dataProvider / authProvider 走被替换的 fetch。

type Routes = Record<string, unknown>;
interface Call { path: string; method: string; body?: unknown }
const adminIdentity = (permissions: string[]) => ({ id: 'admin-1', fullName: '陈予安', schoolId: 'school-1', role: 'SCHOOL_ADMIN', permissions });
const allPermissions = ['users:read', 'users:write', 'products:read', 'products:write', 'orders:read', 'cases:read', 'cases:write', 'appeals:read', 'appeals:write', 'audit:read', 'roles:read'];

function stubApi(routes: Routes, me = adminIdentity(allPermissions)) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
        const path = input.split('?')[0];
        calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
        if (path === '/v1/admin/me') return new Response(JSON.stringify({ code: 0, data: me }));
        if (path in routes) {
            const value = routes[path];
            if (value instanceof Response) return value;
            return new Response(JSON.stringify({ code: 0, data: value }));
        }
        return new Response(JSON.stringify({ code: 404, message: `未模拟 ${path}` }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    return { fetch, calls };
}

/** 渲染一次让 react-query 登记查询，执行这些查询后再渲染，直到没有待取的数据。 */
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
/** DatagridConfigurable 在浏览器里挂载后才登记列；服务端渲染时预先写入同样的列偏好。 */
const columns = (preferenceKey: string, count: number) => ({ [`preferences.${preferenceKey}.availableColumns`]: Array.from({ length: count }, (_, index) => ({ index: String(index) })) });
/** 页面里所有按钮：文字与是否禁用。 */
const buttons = (html: string) => [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, attributes, inner]) => ({ tag, text: inner.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').trim(), disabled: /\bdisabled=""/.test(attributes), href: /href="([^"]*)"/.exec(attributes)?.[1] }));

const legacyOrder = {
    id: 'order-1', productId: 'p-1', productTitle: '宜家台灯 · 宿舍阅读灯', productDescription: '暖光护眼台灯', status: 'EXPIRED',
    buyerId: 'buyer-1', buyerNickname: '明月', buyerAccount: '20260021', sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016',
    price: 88, createdAt: Date.parse('2026-10-08T02:00:00Z'), updatedAt: Date.parse('2026-10-10T00:00:00Z'),
    events: [{ id: 'e-1', eventCode: 'STATUS_CHANGED', fromStatus: 'PENDING_MEETING', toStatus: 'EXPIRED', createdAt: Date.parse('2026-10-10T00:00:00Z') }], reviews: [],
};
const product = (status: string) => ({
    id: 'p-1', title: '九成新 Kindle Paperwhite', description: '屏幕完好', price: 280, category: '数码电子', campus: '主校区', status,
    moderationHidden: false, version: 'v1', sellerId: 'seller-1', sellerNickname: '清风', images: [], history: [],
});

// 服务端渲染不执行 useLayoutEffect，React 会对此发出与本测试无关的警告。
beforeEach(() => {
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) original(...args); });
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('历史订单只读（站内交易已停用）', () => {
    it('orders 资源在菜单中名为「历史订单（只读）」，只注册列表和详情，没有编辑与新建视图', () => {
        const admin = App() as ReactElement<{ children: ReactNode }>;
        const resources = Children.toArray(admin.props.children).filter(isValidElement) as ReactElement<Record<string, unknown>>[];
        const orders = resources.find(resource => resource.props.name === 'orders');
        expect(orders?.props.options).toEqual({ label: '历史订单（只读）' });
        expect(resourceNames.orders).toBe('历史订单（只读）');
        expect(orders?.props.list).toBe(OrdersList);
        expect(orders?.props.show).toBe(OrderShow);
        expect(orders?.props.edit).toBeUndefined();
        expect(orders?.props.create).toBeUndefined();
    });

    it('历史订单列表显示只读说明；每行只有「详情」入口，没有新建、编辑、删除或批量选择', async () => {
        const { calls } = stubApi({ '/v1/admin/orders': { items: [legacyOrder], total: 1 } });
        const { html, text } = await renderAdmin(<OrdersList />, { resource: 'orders', store: columns('orders.transaction-details.v2', 8) });
        expect(text).toContain('历史订单（只读）');
        expect(text).toContain(LEGACY_ORDERS_NOTICE);
        expect(LEGACY_ORDERS_NOTICE).toMatch(/已停用站内交易.*历史订单.*统一关闭.*只读/);
        expect(text).toContain('宜家台灯 · 宿舍阅读灯');
        expect(text).toContain('已过期');
        const links = buttons(html);
        expect(links.filter(link => link.text === '详情').map(link => link.href)).toEqual(['/orders/order-1/show']);
        expect(links.some(link => link.href === '/orders/order-1' || link.href === '/orders/create')).toBe(false);
        expect(links.map(link => link.text).join('|')).not.toMatch(/新建|创建|编辑|删除/);
        expect(html).not.toContain('type="checkbox"');
        expect(calls.filter(call => call.path.startsWith('/v1/admin/orders'))).toEqual([{ path: '/v1/admin/orders', method: 'GET', body: undefined }]);
    });

    it('历史订单详情显示只读说明与历史标题，没有编辑或删除入口', async () => {
        const { calls } = stubApi({ '/v1/admin/orders/order-1': legacyOrder });
        const { html, text } = await renderAdmin(<OrderShow />, { resource: 'orders', path: '/orders/order-1/show' });
        expect(text).toContain('历史订单详情');
        expect(text).toContain(LEGACY_ORDERS_NOTICE);
        expect(text).toContain('暖光护眼台灯');
        expect(text).toContain('待面交 → 已过期');
        const links = buttons(html);
        expect(links.map(link => link.text)).toContain('返回历史订单');
        expect(links.map(link => link.text).join('|')).not.toMatch(/新建|创建|编辑|删除|保存/);
        expect(calls.every(call => call.method === 'GET')).toBe(true);
    });

    it('dataProvider 拒绝修改、新建和删除历史订单，且不向后端发送写请求', async () => {
        const { fetch } = stubApi({});
        await expect(dataProvider.update('orders', { id: 'order-1', data: { status: 'COMPLETED' }, previousData: { id: 'order-1' } }))
            .rejects.toMatchObject({ status: 405, message: '历史订单只读：站内交易已停用，订单不能修改' });
        await expect(dataProvider.create('orders', { data: { productId: 'p-1' } })).rejects.toMatchObject({ status: 405 });
        await expect(dataProvider.delete('orders', { id: 'order-1', previousData: { id: 'order-1' } })).rejects.toMatchObject({ status: 405 });
        await expect(dataProvider.deleteMany('orders', { ids: ['order-1'] })).rejects.toMatchObject({ status: 405 });
        await expect(dataProvider.updateMany('orders', { ids: ['order-1'], data: {} })).rejects.toMatchObject({ status: 405 });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('即使身份里带有 orders:write，后台也不授予订单的编辑、新建或删除权限，只保留查看', async () => {
        stubApi({}, adminIdentity(['orders:read', 'orders:write']));
        for (const action of ['edit', 'create', 'delete', 'write']) {
            await expect(authProvider.canAccess!({ resource: 'orders', action })).resolves.toBe(false);
        }
        await expect(authProvider.canAccess!({ resource: 'orders', action: 'list' })).resolves.toBe(true);
        await expect(authProvider.canAccess!({ resource: 'orders', action: 'show' })).resolves.toBe(true);
    });
});

describe('商品编辑规则：只有已售出的商品不能编辑', () => {
    it('已售出商品的「编辑商品」按钮禁用并说明新规则，不再提及预约中', async () => {
        stubApi({ '/v1/admin/products/p-1': product('已售出') });
        const { html, text } = await renderAdmin(<ProductShow />, { resource: 'products', path: '/products/p-1/show' });
        expect(buttons(html).find(button => button.text === '编辑商品')).toMatchObject({ disabled: true });
        expect(buttons(html).find(button => button.text === '管理下架')).toMatchObject({ disabled: false });
        expect(text).toContain(SOLD_PRODUCT_EDIT_NOTE);
        expect(SOLD_PRODUCT_EDIT_NOTE).toBe('已售出的商品不能编辑，仍可进行展示管理。');
        expect(text).not.toContain('预约中');
    });

    it.each(['在售', '已下架'])('%s商品可以编辑（历史订单不再阻止编辑），不显示限制说明', async status => {
        stubApi({ '/v1/admin/products/p-1': product(status) });
        const { html, text } = await renderAdmin(<ProductShow />, { resource: 'products', path: '/products/p-1/show' });
        expect(buttons(html).find(button => button.text === '编辑商品')).toMatchObject({ disabled: false });
        expect(text).not.toContain(SOLD_PRODUCT_EDIT_NOTE);
    });

    it('后端以 409「已售出的商品不能编辑」拒绝时，原样把信息交给界面且不重试', async () => {
        const { fetch, calls } = stubApi({ '/v1/admin/products/p-1': new Response(JSON.stringify({ code: 409, message: '已售出的商品不能编辑' }), { status: 409 }) });
        await expect(dataProvider.update('products', { id: 'p-1', data: { title: 't', description: 'd', price: 1, note: '核实', version: 'v1', status: '在售' }, previousData: { id: 'p-1' } }))
            .rejects.toMatchObject({ status: 409, message: '已售出的商品不能编辑' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(calls[0]).toEqual({ path: '/v1/admin/products/p-1', method: 'PATCH', body: { title: 't', description: 'd', price: 1, note: '核实', version: 'v1' } });
    });
});

describe('治理标签：CONTACT / RESTRICT_CONTACT，预约与爽约只作历史', () => {
    it('处理动作选项提供「限制申请联系方式」，不提供已停用的预约与爽约动作', () => {
        expect(decisionActionChoices(['HIDE_COMMENT', 'RESTRICT_CONTACT', 'RESTRICT_BOOKING', 'CONFIRM_NO_SHOW', 'REJECT_NO_SHOW', 'NO_ACTION'])).toEqual([
            { id: 'HIDE_COMMENT', name: '隐藏评论' },
            { id: 'RESTRICT_CONTACT', name: '限制申请联系方式' },
            { id: 'NO_ACTION', name: '不采取措施' },
        ]);
        expect(decisionReasonChoices.map(choice => choice.id)).not.toContain('CONFIRMED_NO_SHOW');
        expect(decisionReasonChoices.map(choice => choice.name).join('|')).not.toMatch(/爽约|历史/);
    });

    it('案件只剩已停用动作时，处理页不提供任何动作；有 RESTRICT_CONTACT 时显示处理表单', async () => {
        const record = { id: 'c-1', status: 'OPEN', target: { label: '旧爽约报告' }, reports: [], actions: [] };
        stubApi({ '/v1/admin/cases/c-1': { ...record, allowedActions: ['RESTRICT_BOOKING', 'CONFIRM_NO_SHOW', 'REJECT_NO_SHOW'] } });
        const retired = await renderAdmin(<CaseEdit />, { resource: 'cases', path: '/cases/c-1' });
        expect(retired.text).toContain('当前案件没有可用处理动作');
        expect(retired.html).not.toContain('name="action"');
        expect(retired.text).not.toContain('处理原因');
        vi.unstubAllGlobals();
        stubApi({ '/v1/admin/cases/c-1': { ...record, allowedActions: ['RESTRICT_CONTACT', 'NO_ACTION'] } });
        const current = await renderAdmin(<CaseEdit />, { resource: 'cases', path: '/cases/c-1' });
        expect(current.html).toContain('name="action"');
        expect(current.text).toContain('处理原因');
        expect(current.text).not.toContain('当前案件没有可用处理动作');
    });

    it('案件处理记录用中文显示动作与原因，停用的预约与爽约动作标为历史', async () => {
        const action = (id: string, actionCode: string, reasonCode: string) => ({ id, actionCode, reasonCode, note: null, effective: true, createdAt: Date.parse('2026-09-01T00:00:00Z') });
        stubApi({ '/v1/admin/cases/c-1': {
            id: 'c-1', status: 'RESOLVED', target: { label: '用户' }, allowedActions: [],
            reports: [{ id: 'r-1', reasonCode: 'CONFIRMED_NO_SHOW', createdAt: Date.parse('2026-09-01T00:00:00Z') }],
            actions: [action('a-1', 'RESTRICT_BOOKING', 'FRAUD_RISK'), action('a-2', 'CONFIRM_NO_SHOW', 'CONFIRMED_NO_SHOW'), action('a-3', 'REJECT_NO_SHOW', 'INSUFFICIENT_EVIDENCE'), action('a-4', 'RESTRICT_CONTACT', 'HARASSMENT')],
        } });
        const { text } = await renderAdmin(<CaseShow />, { resource: 'cases', path: '/cases/c-1/show' });
        for (const label of ['限制预约新订单（历史）', '确认爽约（历史）', '驳回爽约报告（历史）', '限制申请联系方式', '欺诈风险', '骚扰']) expect(text).toContain(label);
        expect(text).not.toMatch(/RESTRICT_BOOKING|CONFIRM_NO_SHOW|REJECT_NO_SHOW|RESTRICT_CONTACT/);
    });

    it('申诉列表把限制范围 CONTACT 显示为「申请联系方式」，BOOKING 显示为「预约新订单（历史）」', async () => {
        const appeal = (id: string, subject: Record<string, unknown>) => ({ id, reason: '申诉理由', status: 'PENDING', decidable: false, createdAt: Date.parse('2026-10-01T00:00:00Z'), subject });
        stubApi({ '/v1/admin/appeals': { items: [
            appeal('ap-1', { kind: 'RESTRICTION', scope: 'CONTACT' }),
            appeal('ap-2', { kind: 'RESTRICTION', scope: 'BOOKING' }),
            appeal('ap-3', { kind: 'ACTION', actionCode: 'RESTRICT_CONTACT' }),
            appeal('ap-4', { kind: 'ACTION', actionCode: 'CONFIRM_NO_SHOW' }),
        ], total: 4 } });
        const { text } = await renderAdmin(<AppealsList />, { resource: 'appeals', store: columns('appeals.datagrid', 8) });
        for (const label of ['申请联系方式', '预约新订单（历史）', '限制申请联系方式', '确认爽约（历史）']) expect(text).toContain(label);
        expect(text).not.toMatch(/\bCONTACT\b|\bBOOKING\b|RESTRICT_CONTACT|CONFIRM_NO_SHOW/);
    });
});
