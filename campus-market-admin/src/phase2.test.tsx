import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AdminContext, ResourceContextProvider, memoryStore } from 'react-admin';
import App, { AuditList, AuditShow, UserShow, UsersList } from './App';
import { issuePasswordReset, ResetCodeContent, ResetCodeDialog, RESET_CODE_WARNING } from './PasswordReset';
import Dashboard from './Dashboard';
import StaffPermissions, { PendingRoleRequestNotice, staffSaveOutcome } from './StaffPermissions';
import { ProductShow, PRODUCT_READ_ONLY_NOTE } from './Products';
import { RoleRequestShow, RoleRequestsList } from './RoleRequests';
import { ReadAuditList, QUERY_DIGEST_TEXT } from './ReadAudit';
import { navigationGroups } from './AdminLayout';
import { dataProvider, listQuery, roleRequestDecision } from './dataProvider';
import { authProvider } from './authProvider';
import { clearSession, request } from './http';
import { i18nProvider } from './i18n';
import { PENDING_ROLE_REQUEST_NOTICE, ROLES } from './adminUi';

// 阶段 2（后台安全）：权限收窄、两人复核、复核请求、读取审计、利益回避 CONTACT_PARTY、限流提示。
// 与 phase1.test.tsx 相同：页面在 Node 中渲染，数据经真实的 dataProvider / authProvider 走被替换的 fetch。

interface Call { path: string; query: string; method: string; body?: unknown }
type Handler = unknown | Response | ((call: Call) => unknown);
/** 后端 AdminPermissions.permissions(role) 的结果（阶段 2）。 */
const PERMISSIONS: Record<string, string[]> = {
    SCHOOL_ADMIN: ['appeals:read', 'appeals:write', 'audit:read', 'cases:read', 'cases:write', 'orders:read', 'products:read', 'products:write', 'read-audit:read', 'role-requests:read', 'roles:read', 'users:read', 'users:write'],
    SENIOR_MODERATOR: ['appeals:read', 'appeals:write', 'cases:read', 'cases:write', 'products:read'],
    MODERATOR: ['appeals:read', 'appeals:write', 'cases:read', 'cases:write', 'products:read'],
    AUDITOR: ['audit:read', 'orders:read', 'products:read', 'read-audit:read', 'role-requests:read', 'roles:read', 'users:read'],
};
const identity = (role: string, id = 'admin-1') => ({ id, fullName: '陈予安', schoolId: 'school-1', role, permissions: PERMISSIONS[role] });

function stubApi(routes: Record<string, Handler>, me = identity('SCHOOL_ADMIN')) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
        const [path, query = ''] = input.split('?');
        const call = { path, query, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(call);
        if (path === '/v1/admin/me') return new Response(JSON.stringify({ code: 0, data: me }));
        const key = `${call.method} ${path}` in routes ? `${call.method} ${path}` : path in routes ? path : null;
        if (key) {
            const handler = routes[key];
            const value = typeof handler === 'function' ? (handler as (call: Call) => unknown)(call) : handler;
            if (value instanceof Response) return value;
            return new Response(JSON.stringify({ code: 0, data: value }));
        }
        return new Response(JSON.stringify({ code: 404, message: `未模拟 ${call.method} ${path}` }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    return { fetch, calls };
}
const failure = (status: number, message: string, data: unknown = null, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ code: status, data, message, requestId: 'req-1' }), { status, headers });

async function renderAdmin(element: ReactNode, { resource, path = `/${resource}`, store = {}, route = `/${resource}/:id?/*` }: { resource: string; path?: string; store?: Record<string, unknown>; route?: string }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const adminStore = memoryStore({ locale: 'zh', ...store });
    const ui = () => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><AdminContext dataProvider={dataProvider} authProvider={authProvider} i18nProvider={i18nProvider} store={adminStore} queryClient={queryClient}>
        <ResourceContextProvider value={resource}><Routes><Route path={route} element={element} /></Routes></ResourceContextProvider>
    </AdminContext></MemoryRouter>);
    let html = ui();
    for (let pass = 0; pass < 8; pass++) {
        const pending = queryClient.getQueryCache().getAll().filter(query => query.state.status === 'pending' && query.state.fetchStatus === 'idle');
        if (!pending.length) break;
        await Promise.all(pending.map(query => query.fetch().catch(() => undefined)));
        html = ui();
    }
    const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
    return { html, text, queryClient, adminStore };
}
const columns = (preferenceKey: string, count: number) => ({ [`preferences.${preferenceKey}.availableColumns`]: Array.from({ length: count }, (_, index) => ({ index: String(index) })) });
const buttons = (html: string) => [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, attributes, inner]) => ({ tag, text: inner.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').trim(), disabled: /\bdisabled=""/.test(attributes), href: /href="([^"]*)"/.exec(attributes)?.[1] }));
const buttonTexts = (html: string) => buttons(html).map(button => button.text);

const T = Date.parse('2026-10-19T02:00:00Z');
const roleRequest = (overrides: Record<string, unknown> = {}) => ({
    id: 'rr-1', targetId: 'user-9', targetNickname: '王老师', targetAccount: 'T2026009', requestedBy: 'admin-2', requesterNickname: '李主任',
    oldRole: null, oldActive: null, newRole: 'SCHOOL_ADMIN', newActive: true, note: '新学期增加一名学校管理员', status: 'PENDING',
    decidedBy: null, deciderNickname: null, decisionNote: null, decidedAt: null, expiresAt: T + 72 * 3600_000, createdAt: T, ...overrides,
});
const staffUser = { id: 'user-9', nickname: '王老师', account: 'T2026009', campus: '主校区', role: 'MODERATOR', active: true, createdAt: T };

beforeEach(() => {
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) original(...args); });
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('权限：菜单与可执行操作只来自 /v1/admin/me 的 permissions', () => {
    it('高级审核员只看到商品目录、治理案件、用户申诉；没有用户、历史订单、授权审计、复核与读取审计菜单', () => {
        expect(navigationGroups(PERMISSIONS.SENIOR_MODERATOR)).toEqual([
            { name: '运营管理', resources: ['products'] },
            { name: '社区治理', resources: ['cases', 'appeals'] },
        ]);
    });
    it('学校管理员与只读审计员看到「人员变更复核」与「读取审计」；审核员看不到', () => {
        const security = (role: string) => navigationGroups(PERMISSIONS[role]).find(group => group.name === '安全与权限')?.resources;
        expect(security('SCHOOL_ADMIN')).toEqual(['audit', 'role-requests', 'read-audit', 'roles']);
        expect(security('AUDITOR')).toEqual(['audit', 'role-requests', 'read-audit', 'roles']);
        expect(security('MODERATOR')).toBeUndefined();
        expect(navigationGroups(['read-audit:read'])).toEqual([{ name: '安全与权限', resources: ['read-audit'] }]);
        expect(navigationGroups(['role-requests:read'])).toEqual([{ name: '安全与权限', resources: ['role-requests'] }]);
    });
    it('高级审核员的工作台只请求商品、案件与申诉，快捷入口没有用户、历史订单与审计', async () => {
        const { calls } = stubApi({ '/v1/admin/products': { items: [], total: 4 }, '/v1/admin/cases': { items: [], total: 2 }, '/v1/admin/appeals': { items: [], total: 1 } }, identity('SENIOR_MODERATOR'));
        const { text } = await renderAdmin(<Dashboard />, { resource: 'dashboard', path: '/', route: '/' });
        expect(text).toContain('商品目录');
        expect(text).toContain('治理案件');
        expect(text).not.toMatch(/用户与工作人员|历史订单|授权审计|人员变更复核|读取审计/);
        const paths = calls.map(call => call.path).filter(path => path !== '/v1/admin/me');
        expect(new Set(paths)).toEqual(new Set(['/v1/admin/products', '/v1/admin/cases', '/v1/admin/appeals']));
    });
    it('高级审核员不能编辑商品：canAccess 拒绝写入，详情页没有「编辑商品」「管理下架」并说明只有学校管理员可以', async () => {
        stubApi({ '/v1/admin/products/p-1': { id: 'p-1', title: 'Kindle', description: 'd', price: 280, category: '数码电子', campus: '主校区', status: '在售', moderationHidden: false, version: 'v1', sellerId: 'seller-1', images: [], history: [] } }, identity('SENIOR_MODERATOR'));
        for (const resource of ['users', 'orders', 'audit', 'role-requests', 'read-audit']) await expect(authProvider.canAccess!({ resource, action: 'list' })).resolves.toBe(false);
        await expect(authProvider.canAccess!({ resource: 'products', action: 'edit' })).resolves.toBe(false);
        await expect(authProvider.canAccess!({ resource: 'products', action: 'show' })).resolves.toBe(true);
        const { html, text } = await renderAdmin(<ProductShow />, { resource: 'products', path: '/products/p-1/show' });
        expect(text).toContain('Kindle');
        expect(buttonTexts(html)).not.toContain('编辑商品');
        expect(buttonTexts(html)).not.toContain('管理下架');
        expect(text).toContain(PRODUCT_READ_ONLY_NOTE);
        expect(PRODUCT_READ_ONLY_NOTE).not.toContain('高级审核员');
    });
    it('角色说明与后端一致：高级审核员不再写用户 / 订单 / 审计只读与商品编辑；审计员与学校管理员包含复核与读取审计', () => {
        const role = (id: string) => ROLES.find(item => item.id === id)!;
        expect([role('SENIOR_MODERATOR').description, ...role('SENIOR_MODERATOR').capabilities].join('|')).not.toMatch(/用户与历史订单|授权审计|商品信息编辑/);
        expect(role('SENIOR_MODERATOR').capabilities).toContain('本校商品（只读）');
        expect(role('AUDITOR').capabilities.join('|')).toMatch(/人员变更复核.*读取审计/);
        expect(role('SCHOOL_ADMIN').capabilities.join('|')).toMatch(/读取审计/);
        expect(role('SCHOOL_ADMIN').capabilities.join('|')).toMatch(/另一位学校管理员确认/);
    });
});

describe('两人复核：涉及学校管理员的授权只提交复核请求', () => {
    const pendingRoleRequest = roleRequest({ requestedBy: 'admin-1', requesterNickname: '陈予安', oldRole: 'MODERATOR', oldActive: true });
    it('PATCH 只发送 role / active / note；响应带 pendingRoleRequest 时结果是「已提交，需要另一位学校管理员确认后生效」而不是「已更新」', async () => {
        const { calls } = stubApi({ 'PATCH /v1/admin/users/user-9/staff': { ...staffUser, pendingRoleRequest } });
        const { data } = await dataProvider.update('users', { id: 'user-9', data: { ...staffUser, role: 'SCHOOL_ADMIN', active: true, note: '新学期增加一名学校管理员' }, previousData: staffUser });
        expect(calls).toEqual([{ path: '/v1/admin/users/user-9/staff', query: '', method: 'PATCH', body: { role: 'SCHOOL_ADMIN', active: true, note: '新学期增加一名学校管理员' } }]);
        expect(data.role).toBe('MODERATOR');
        const outcome = staffSaveOutcome(data);
        expect(outcome).toEqual({ pending: pendingRoleRequest, message: '已提交，需要另一位学校管理员确认后生效' });
        expect(outcome.message).not.toMatch(/已更新|已生效/);
        expect(staffSaveOutcome({ ...staffUser, role: 'AUDITOR' })).toEqual({ pending: null, message: '工作人员权限已更新' });
    });
    it('提交后显示的提示：未生效、当前权限不变、可查看复核请求', () => {
        const html = renderToStaticMarkup(<MemoryRouter><PendingRoleRequestNotice request={pendingRoleRequest as never} /></MemoryRouter>);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        expect(text).toContain(PENDING_ROLE_REQUEST_NOTICE);
        expect(text).toContain('审核员 · 启用 → 学校管理员 · 启用');
        expect(text).toContain('当前权限保持不变');
        expect(buttons(html).find(button => button.text === '查看复核请求')?.href).toBe('/role-requests/rr-1/show');
    });
    it('配置学校管理员的表单说明保存后只提交复核请求；普通角色仍说明立即生效', async () => {
        stubApi({ '/v1/admin/users/user-9': { ...staffUser, role: 'SCHOOL_ADMIN' } });
        const admin = await renderAdmin(<StaffPermissions />, { resource: 'users', path: '/users/user-9' });
        expect(admin.text).toContain('保存后只提交复核请求，需要另一位学校管理员确认后生效');
        expect(admin.text).not.toContain('保存后立即生效');
        vi.unstubAllGlobals();
        stubApi({ '/v1/admin/users/user-9': staffUser });
        const moderator = await renderAdmin(<StaffPermissions />, { resource: 'users', path: '/users/user-9' });
        expect(moderator.text).toContain('保存后立即生效');
    });
    it.each([
        '该用户已有一条待确认的学校管理员变更，请先处理',
        '这是本校最后一名学校管理员，不能降级或停用',
    ])('409「%s」原样交给表单', async message => {
        stubApi({ 'PATCH /v1/admin/users/user-9/staff': failure(409, message) });
        await expect(dataProvider.update('users', { id: 'user-9', data: { role: 'MODERATOR', active: false, note: '调岗' }, previousData: staffUser }))
            .rejects.toMatchObject({ status: 409, message });
    });
});

describe('人员变更复核（role-requests）', () => {
    it('列表默认只看待确认的请求，按创建时间倒序；列出目标、变更前→变更后、发起人、说明、状态、到期时间', async () => {
        const { calls } = stubApi({ '/v1/admin/role-requests': { items: [roleRequest(), roleRequest({ id: 'rr-2', targetNickname: '赵同学', oldRole: 'SCHOOL_ADMIN', oldActive: true, newRole: 'AUDITOR', newActive: false, note: '离校交接' })], total: 2 } });
        const { text } = await renderAdmin(<RoleRequestsList />, { resource: 'role-requests', store: columns('role-requests.datagrid', 8) });
        const list = calls.filter(call => call.path === '/v1/admin/role-requests');
        expect(list).toHaveLength(1);
        expect(Object.fromEntries(new URLSearchParams(list[0].query))).toEqual({ page: '1', perPage: '25', sort: 'createdAt', order: 'DESC', status: 'PENDING' });
        for (const header of ['目标', '变更前 → 变更后', '发起人', '说明', '状态', '到期时间']) expect(text).toContain(header);
        for (const value of ['王老师', 'T2026009', '无后台角色 · 停用 → 学校管理员 · 启用', '李主任', '新学期增加一名学校管理员', '待确认',
            '学校管理员 · 启用 → 只读审计员 · 停用', '离校交接']) expect(text).toContain(value);
        expect(text).not.toMatch(/SCHOOL_ADMIN|AUDITOR|PENDING/);
    });
    it('状态筛选只发送后端接受的参数', () => {
        const query = listQuery('role-requests', { pagination: { page: 1, perPage: 25 }, sort: { field: 'createdAt', order: 'DESC' }, filter: { status: 'EXPIRED', q: '王', schoolId: 'forged', requestedBy: 'x' } });
        expect(Object.fromEntries(new URLSearchParams(query))).toEqual({ page: '1', perPage: '25', sort: 'createdAt', order: 'DESC', status: 'EXPIRED', q: '王' });
    });
    it('另一位学校管理员看到可用的「确认生效」「驳回」，看不到「撤回」', async () => {
        stubApi({ '/v1/admin/role-requests/rr-1': roleRequest() }, identity('SCHOOL_ADMIN', 'admin-1'));
        const { html, text } = await renderAdmin(<RoleRequestShow />, { resource: 'role-requests', path: '/role-requests/rr-1/show' });
        expect(buttons(html).find(button => button.text === '确认生效')).toMatchObject({ disabled: false });
        expect(buttons(html).find(button => button.text === '驳回')).toMatchObject({ disabled: false });
        expect(buttonTexts(html)).not.toContain('撤回');
        expect(text).toContain('无后台角色 · 停用');
        expect(text).toContain('学校管理员 · 启用');
    });
    it('发起人：「确认生效」「驳回」禁用并说明原因，可以「撤回」', async () => {
        stubApi({ '/v1/admin/role-requests/rr-1': roleRequest() }, identity('SCHOOL_ADMIN', 'admin-2'));
        const { html, text } = await renderAdmin(<RoleRequestShow />, { resource: 'role-requests', path: '/role-requests/rr-1/show' });
        expect(buttons(html).find(button => button.text === '确认生效')).toMatchObject({ disabled: true });
        expect(buttons(html).find(button => button.text === '驳回')).toMatchObject({ disabled: true });
        expect(buttons(html).find(button => button.text === '撤回')).toMatchObject({ disabled: false });
        expect(text).toContain('不能确认自己发起的变更，需要另一位学校管理员确认');
    });
    it('被变更的本人不能确认或驳回，也不能撤回别人发起的请求', async () => {
        stubApi({ '/v1/admin/role-requests/rr-1': roleRequest({ oldRole: 'SCHOOL_ADMIN', oldActive: true, newRole: 'MODERATOR' , targetId: 'admin-1' }) }, identity('SCHOOL_ADMIN', 'admin-1'));
        const { html, text } = await renderAdmin(<RoleRequestShow />, { resource: 'role-requests', path: '/role-requests/rr-1/show' });
        expect(buttons(html).find(button => button.text === '确认生效')).toMatchObject({ disabled: true });
        expect(buttonTexts(html)).not.toContain('撤回');
        expect(text).toContain('不能确认与自己有关的变更');
    });
    it('只读审计员（没有 users:write）只能查看，没有任何处理按钮', async () => {
        stubApi({ '/v1/admin/role-requests/rr-1': roleRequest() }, identity('AUDITOR', 'auditor-1'));
        const { html, text } = await renderAdmin(<RoleRequestShow />, { resource: 'role-requests', path: '/role-requests/rr-1/show' });
        expect(buttonTexts(html).filter(label => /确认生效|驳回|撤回/.test(label))).toEqual([]);
        expect(text).toContain('确认、驳回或撤回人员变更需要学校管理员权限');
    });
    it.each(['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'])('%s 的请求是终态，不提供处理按钮并显示处理结果', async status => {
        stubApi({ '/v1/admin/role-requests/rr-1': roleRequest({ status, decidedAt: T + 1000, deciderNickname: '周校长', decisionNote: '核实无误' }) }, identity('SCHOOL_ADMIN', 'admin-2'));
        const { html, text } = await renderAdmin(<RoleRequestShow />, { resource: 'role-requests', path: '/role-requests/rr-1/show' });
        expect(buttonTexts(html).filter(label => /确认生效|驳回|撤回/.test(label))).toEqual([]);
        expect(text).toContain('不能再处理');
        expect(text).toContain('周校长');
    });
    it('确认 / 驳回发送去掉首尾空白的必填理由；撤回不填理由时不发送请求体，填写时发送 {note}', async () => {
        const { calls } = stubApi({
            'POST /v1/admin/role-requests/rr-1/approve': roleRequest({ status: 'APPROVED' }),
            'POST /v1/admin/role-requests/rr-1/reject': roleRequest({ status: 'REJECTED' }),
            'POST /v1/admin/role-requests/rr-1/cancel': roleRequest({ status: 'CANCELLED' }),
        });
        await roleRequestDecision('rr-1', 'approve', '  已当面核实  ');
        await roleRequestDecision('rr-1', 'reject', '人选待定');
        await roleRequestDecision('rr-1', 'cancel');
        await roleRequestDecision('rr-1', 'cancel', '填错了人');
        expect(calls).toEqual([
            { path: '/v1/admin/role-requests/rr-1/approve', query: '', method: 'POST', body: { note: '已当面核实' } },
            { path: '/v1/admin/role-requests/rr-1/reject', query: '', method: 'POST', body: { note: '人选待定' } },
            { path: '/v1/admin/role-requests/rr-1/cancel', query: '', method: 'POST', body: undefined },
            { path: '/v1/admin/role-requests/rr-1/cancel', query: '', method: 'POST', body: { note: '填错了人' } },
        ]);
    });
    it('确认 / 驳回没有理由或超过 500 字时不发请求', async () => {
        const { fetch } = stubApi({});
        await expect(roleRequestDecision('rr-1', 'approve', '   ')).rejects.toMatchObject({ status: 400 });
        await expect(roleRequestDecision('rr-1', 'reject')).rejects.toMatchObject({ status: 400 });
        await expect(roleRequestDecision('rr-1', 'approve', 'x'.repeat(501))).rejects.toMatchObject({ status: 400 });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
        [403, 'approve', '不能确认自己发起的变更，需要另一位学校管理员确认'],
        [409, 'approve', '这条复核请求已过期，请重新发起'],
        [409, 'approve', '目标账号的后台权限在发起后已经变化，请驳回后重新发起'],
        [403, 'cancel', '只有发起人可以撤回这条复核请求'],
    ] as const)('%i 错误「%s → %s」原样返回给界面', async (status, decision, message) => {
        stubApi({ [`POST /v1/admin/role-requests/rr-1/${decision}`]: failure(status, message) });
        await expect(roleRequestDecision('rr-1', decision, '理由')).rejects.toMatchObject({ status, message });
    });
    it('复核请求没有编辑视图；dataProvider 也不提供修改', async () => {
        const { fetch } = stubApi({});
        await expect(dataProvider.update('role-requests', { id: 'rr-1', data: { status: 'APPROVED' }, previousData: { id: 'rr-1' } })).rejects.toMatchObject({ status: 405 });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('读取审计（read-audit）', () => {
    const row = (overrides: Record<string, unknown>) => ({ id: 'ra-1', actorId: 'admin-1', actorNickname: '陈予安', resource: 'users', recordId: null, resultCount: 25, withQuery: false, requestId: 'req-abc', createdAt: T, ...overrides });
    it('列表显示工作人员、中文资源名、记录编号、返回条数、「含搜索词（只存哈希）」、请求编号与时间', async () => {
        const { calls } = stubApi({ '/v1/admin/read-audit': { items: [
            row({ id: 'ra-1', resource: 'users', withQuery: true }),
            row({ id: 'ra-2', resource: 'orders', recordId: '9d0f1e2a', resultCount: null }),
            row({ id: 'ra-3', resource: 'audit' }), row({ id: 'ra-4', resource: 'role-requests' }), row({ id: 'ra-5', resource: 'read-audit', requestId: 'req-xyz' }),
        ], total: 5 } }, identity('AUDITOR', 'auditor-1'));
        const { html, text } = await renderAdmin(<ReadAuditList />, { resource: 'read-audit', store: columns('read-audit.datagrid', 7) });
        const list = calls.filter(call => call.path === '/v1/admin/read-audit');
        expect(Object.fromEntries(new URLSearchParams(list[0].query))).toEqual({ page: '1', perPage: '25', sort: 'createdAt', order: 'DESC' });
        for (const header of ['工作人员', '读取内容', '记录编号', '返回条数', '搜索条件', '请求编号', '时间']) expect(text).toContain(header);
        for (const label of [' 用户 ', ' 历史订单 ', ' 授权审计 ', ' 人员变更复核 ', ' 读取审计 ']) expect(text).toContain(label);
        expect(text.split(QUERY_DIGEST_TEXT)).toHaveLength(2);
        expect(QUERY_DIGEST_TEXT).toBe('含搜索词（只存哈希）');
        for (const value of ['陈予安', '9d0f1e2a', 'req-abc', 'req-xyz', '25']) expect(text).toContain(value);
        expect(text).not.toMatch(/\b(users|orders|role-requests|read-audit)\b/);
        // 只有列表：行不可点击，没有详情按钮
        expect(html).not.toContain('/read-audit/ra-1');
    });
    it('读取审计只注册列表；复核请求注册列表与详情，没有编辑或新建', () => {
        const admin = App() as ReactElement<{ children: ReactNode }>;
        const resources = (Children.toArray(admin.props.children).filter(isValidElement) as ReactElement<Record<string, unknown>>[]);
        const find = (name: string) => resources.find(resource => resource.props.name === name)!.props;
        expect(find('read-audit')).toMatchObject({ list: ReadAuditList, options: { label: '读取审计' } });
        expect(find('read-audit').show).toBeUndefined();
        expect(find('read-audit').edit).toBeUndefined();
        expect(find('role-requests')).toMatchObject({ list: RoleRequestsList, show: RoleRequestShow, options: { label: '人员变更复核' } });
        expect(find('role-requests').edit).toBeUndefined();
        expect(find('role-requests').create).toBeUndefined();
    });
    it('读取审计没有详情接口：getOne 不发请求', async () => {
        const { fetch } = stubApi({});
        await expect(dataProvider.getOne('read-audit', { id: 'ra-1' })).rejects.toMatchObject({ status: 404 });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('授权审计显示确认人与复核请求', () => {
    it('列表新增「确认人编号」列；详情显示确认人与关联复核请求链接，一人完成的变更标明无需确认', async () => {
        const audit = { id: 'a-1', actorId: 'admin-2', targetId: 'user-9', oldRole: null, newRole: 'SCHOOL_ADMIN', oldActive: null, newActive: true, note: '新学期增加一名学校管理员', requestId: 'req-1', confirmedBy: 'admin-1', roleRequestId: 'rr-1', createdAt: T };
        stubApi({ '/v1/admin/audit': { items: [audit], total: 1 }, '/v1/admin/audit/a-1': audit, '/v1/admin/audit/a-2': { ...audit, id: 'a-2', confirmedBy: null, roleRequestId: null, newRole: 'AUDITOR' } });
        const list = await renderAdmin(<AuditList />, { resource: 'audit', store: columns('audit.datagrid', 7) });
        expect(list.text).toContain('确认人编号');
        expect(list.text).toContain('admin-1');
        const show = await renderAdmin(<AuditShow />, { resource: 'audit', path: '/audit/a-1/show' });
        expect(show.text).toContain('关联复核请求');
        expect(buttons(show.html).find(button => button.text === 'rr-1')?.href).toBe('/role-requests/rr-1/show');
        const single = await renderAdmin(<AuditShow />, { resource: 'audit', path: '/audit/a-2/show' });
        expect(single.text).toContain('无需确认（一人完成）');
    });
});

describe('利益回避 CONTACT_PARTY 与限流提示', () => {
    const conflict = (reason: string) => failure(403, '这件商品与你本人有关，需要由其他工作人员管理', { code: 'CONFLICT_OF_INTEREST', reason });
    it('商品编辑被 403 CONFLICT_OF_INTEREST / CONTACT_PARTY 拒绝：保留后端信息并说明「你申请过这件商品的联系方式」', async () => {
        const { fetch } = stubApi({ 'PATCH /v1/admin/products/p-1': conflict('CONTACT_PARTY') });
        const error = await dataProvider.update('products', { id: 'p-1', data: { title: 't', description: 'd', price: 1, note: '核实', version: 'v1' }, previousData: { id: 'p-1' } }).catch(e => e);
        expect(error).toMatchObject({ status: 403 });
        expect(error.message).toBe('这件商品与你本人有关，需要由其他工作人员管理（回避原因：你申请过这件商品的联系方式）');
        expect(error.body.data).toEqual({ code: 'CONFLICT_OF_INTEREST', reason: 'CONTACT_PARTY' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('展示管理（visibility）同样显示后端信息与回避原因；其他原因码也翻译', async () => {
        stubApi({ 'POST /v1/admin/products/p-1/visibility': conflict('OWN_REPORT') });
        await expect(request('/v1/admin/products/p-1/visibility', { method: 'POST', body: JSON.stringify({ action: 'HIDE_PRODUCT', note: 'n', version: 'v1' }) }))
            .rejects.toMatchObject({ status: 403, message: '这件商品与你本人有关，需要由其他工作人员管理（回避原因：涉及你本人提交的举报）' });
        vi.unstubAllGlobals();
        stubApi({ 'POST /v1/admin/products/p-1/visibility': conflict('SOMETHING_NEW') });
        await expect(request('/v1/admin/products/p-1/visibility', { method: 'POST', body: '{}' })).rejects.toMatchObject({ message: '这件商品与你本人有关，需要由其他工作人员管理' });
    });
    it.each([
        ['30', '操作过于频繁，请在 30 秒后重试'],
        ['120', '操作过于频繁，请在 2 分钟后重试'],
        ['61', '操作过于频繁，请在 2 分钟后重试'],
    ])('429 带 Retry-After: %s 时显示「%s」，且不刷新会话、不重试', async (seconds, message) => {
        const { fetch } = stubApi({ '/v1/admin/users': failure(429, '请求过于频繁，请稍后再试', null, { 'Retry-After': seconds }) });
        const error = await dataProvider.getList('users', { pagination: { page: 1, perPage: 25 }, sort: { field: 'createdAt', order: 'DESC' }, filter: {} }).catch(e => e);
        expect(error).toMatchObject({ status: 429, message });
        expect(error.body.retryAfter).toBe(seconds);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('429 没有 Retry-After 时显示后端信息', async () => {
        stubApi({ 'POST /v1/admin/role-requests/rr-1/approve': failure(429, '请求过于频繁，请稍后再试') });
        await expect(roleRequestDecision('rr-1', 'approve', '理由')).rejects.toMatchObject({ status: 429, message: '请求过于频繁，请稍后再试' });
    });
});

describe('阶段 3：人工找回密码（签发重置码）与已注销账号', () => {
    const ticket = { ticketId: 'ticket-1', code: 'K7QD-2M9X-4PZA', expiresAt: T + 30 * 60_000 };
    const member = { ...staffUser, deleted: false };
    it('签发请求：POST /v1/admin/users/{id}/password-reset，请求体只有去掉首尾空白的 note；返回 ticketId / code / expiresAt', async () => {
        const { calls } = stubApi({ 'POST /v1/admin/users/user-9/password-reset': ticket });
        await expect(issuePasswordReset('user-9', '  本人持学生证到办公室，已核对照片与学号  ')).resolves.toEqual(ticket);
        expect(calls).toEqual([{ path: '/v1/admin/users/user-9/password-reset', query: '', method: 'POST', body: { note: '本人持学生证到办公室，已核对照片与学号' } }]);
    });
    it('说明为空、超过 500 字或包含尖括号时不发请求', async () => {
        const { fetch } = stubApi({});
        for (const note of ['', '   ', 'x'.repeat(501), '核对<b>']) await expect(issuePasswordReset('user-9', note)).rejects.toMatchObject({ status: 400 });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([
        [403, '不能为自己签发重置码，请由其他学校管理员处理'],
        [404, '用户不存在'],
        [403, '没有执行此操作的权限'],
    ])('%i「%s」原样交给界面', async (status, message) => {
        stubApi({ 'POST /v1/admin/users/user-9/password-reset': failure(status, message) });
        await expect(issuePasswordReset('user-9', '核对学生证')).rejects.toMatchObject({ status, message });
    });
    it('重置码不被保存：不写 localStorage / sessionStorage、不打日志、不进入 react-query 缓存或 react-admin store', async () => {
        const storage = () => ({ setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
        const local = storage(), session = storage();
        vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session);
        const logs = (['log', 'info', 'debug', 'warn'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined));
        stubApi({ '/v1/admin/users/user-9': member, 'POST /v1/admin/users/user-9/password-reset': ticket });
        const page = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/user-9/show' });
        const issued = await issuePasswordReset('user-9', '核对学生证');
        expect(issued.code).toBe(ticket.code);
        expect(local.setItem).not.toHaveBeenCalled();
        expect(session.setItem).not.toHaveBeenCalled();
        for (const spy of [...logs, console.error as unknown as ReturnType<typeof vi.fn>]) expect(JSON.stringify((spy as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(ticket.code);
        const cached = JSON.stringify(page.queryClient.getQueryCache().getAll().map(query => [query.queryKey, query.state.data]));
        expect(cached).toContain('王老师');
        expect(cached).not.toContain(ticket.code);
        expect(cached).not.toContain('password-reset');
        const keys = await Promise.all(['users', 'preferences', 'ticket'].map(key => page.adminStore.getItem(key)));
        expect(JSON.stringify(keys)).not.toContain(ticket.code);
    });
    it('重置码弹窗：显示重置码一次、完整警示与复制按钮；没有票据（已关闭）时不渲染重置码', () => {
        const html = renderToStaticMarkup(<ResetCodeContent ticket={ticket} nickname="王老师" copied="" onCopy={() => undefined} />);
        expect(RESET_CODE_WARNING).toBe('只显示这一次；请在线下核对身份后当面交给本人；30 分钟内有效，最多 5 次错误；重新签发会让旧码作废');
        expect(html).toContain(RESET_CODE_WARNING);
        expect(html.split(ticket.code)).toHaveLength(2);
        expect(buttonTexts(html)).toEqual(['复制重置码']);
        expect(html).toContain('关闭后无法再次查看');
        // 弹窗关闭（ticket=null）时不渲染重置码，也不渲染警示
        const closed = renderToStaticMarkup(<ResetCodeDialog ticket={null} nickname="王老师" onClose={() => undefined} />);
        expect(closed).not.toContain(ticket.code);
        expect(closed).not.toContain(RESET_CODE_WARNING);
    });
    it('用户详情：学校管理员查看他人时有「签发重置码」', async () => {
        stubApi({ '/v1/admin/users/user-9': member });
        const { html } = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/user-9/show' });
        expect(buttonTexts(html)).toContain('签发重置码');
        expect(buttonTexts(html)).toContain('配置权限');
    });
    it('用户详情：自己的账号、只读审计员都看不到「签发重置码」', async () => {
        stubApi({ '/v1/admin/users/admin-1': { ...member, id: 'admin-1', nickname: '陈予安', role: 'SCHOOL_ADMIN' } }, identity('SCHOOL_ADMIN', 'admin-1'));
        const own = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/admin-1/show' });
        expect(own.text).toContain('陈予安');
        expect(buttonTexts(own.html)).not.toContain('签发重置码');
        vi.unstubAllGlobals();
        stubApi({ '/v1/admin/users/user-9': member }, identity('AUDITOR', 'auditor-1'));
        const auditor = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/user-9/show' });
        expect(auditor.text).toContain('王老师');
        expect(buttonTexts(auditor.html)).not.toContain('签发重置码');
        expect(buttonTexts(auditor.html)).not.toContain('配置权限');
    });
    it('已注销账号：详情显示「已注销」，没有「配置权限」和「签发重置码」', async () => {
        stubApi({ '/v1/admin/users/gone-1': { ...member, id: 'gone-1', nickname: '已注销用户', account: 'deleted-gone-1', role: null, active: false, deleted: true } });
        const { html, text } = await renderAdmin(<UserShow />, { resource: 'users', path: '/users/gone-1/show' });
        expect(text).toContain('已注销');
        expect(buttonTexts(html)).not.toContain('签发重置码');
        expect(buttonTexts(html)).not.toContain('配置权限');
    });
    it('用户列表：已注销的行显示「已注销」且没有「配置权限」，正常账号保留', async () => {
        stubApi({ '/v1/admin/users': { items: [member, { ...member, id: 'gone-1', nickname: '已注销用户', account: 'deleted-gone-1', role: null, active: false, deleted: true }], total: 2 } });
        const { html, text } = await renderAdmin(<UsersList />, { resource: 'users', store: columns('users.datagrid', 8) });
        expect(text).toContain('已注销');
        expect(text).toContain('正常');
        const configure = buttons(html).filter(button => button.text === '配置权限').map(button => button.href);
        expect(configure).toEqual(['/users/user-9']);
    });
    it('已注销账号的权限配置页不显示表单，说明不能授予后台权限', async () => {
        stubApi({ '/v1/admin/users/gone-1': { ...member, id: 'gone-1', nickname: '已注销用户', role: null, active: false, deleted: true } });
        const { html, text } = await renderAdmin(<StaffPermissions />, { resource: 'users', path: '/users/gone-1' });
        expect(text).toContain('该账号已注销，不能授予后台权限。');
        expect(html).not.toContain('name="role"');
    });
});
