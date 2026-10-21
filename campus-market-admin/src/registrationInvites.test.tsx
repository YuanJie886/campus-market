import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { AdminContext, ResourceContextProvider, memoryStore } from 'react-admin';
import App from './App';
import {
    CLOSED_INVITE_DIALOG, INVITE_CODE_WARNING, INVITE_DEFAULTS, InviteCodeContent, InviteDialog, RegistrationInviteShow, RegistrationInvitesList,
    createRegistrationInvite, inviteDialogReducer, inviteDraftProblems, inviteMessage, invitePayload, inviteStatusLabel, inviteStatusNames, issuerText,
    revokeRegistrationInvite, type InviteDialogState, type InviteDraft,
} from './RegistrationInvites';
import { navigationGroups } from './AdminLayout';
import { ReadAuditList } from './ReadAudit';
import { dataProvider, listQuery } from './dataProvider';
import { authProvider } from './authProvider';
import { clearSession } from './http';
import { i18nProvider } from './i18n';

// 注册邀请码（小范围测试只开放邀请注册）。与 phase2.test.tsx 相同：页面在 Node 中渲染，数据经真实的 dataProvider / authProvider 走被替换的 fetch。

interface Call { path: string; query: string; method: string; body?: unknown }
type Handler = unknown | Response | ((call: Call) => unknown);
const INVITE_READ = 'registration-invites:read', INVITE_WRITE = 'registration-invites:write';
/** 后端权限（阶段 2 的 AdminPermissions 加上邀请码）：学校管理员读写，只读审计员只读，审核员没有。 */
const PERMISSIONS: Record<string, string[]> = {
    SCHOOL_ADMIN: ['appeals:read', 'appeals:write', 'audit:read', 'cases:read', 'cases:write', 'orders:read', 'products:read', 'products:write', 'read-audit:read', INVITE_READ, INVITE_WRITE, 'role-requests:read', 'roles:read', 'users:read', 'users:write'],
    SENIOR_MODERATOR: ['appeals:read', 'appeals:write', 'cases:read', 'cases:write', 'products:read'],
    MODERATOR: ['appeals:read', 'appeals:write', 'cases:read', 'cases:write', 'products:read'],
    AUDITOR: ['audit:read', 'orders:read', 'products:read', 'read-audit:read', INVITE_READ, 'role-requests:read', 'roles:read', 'users:read'],
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
const failure = (status: number, message: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ code: status, data: null, message, requestId: 'req-1' }), { status, headers });

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
    const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ');
    return { html, text, queryClient, adminStore };
}
const columns = (preferenceKey: string, count: number) => ({ [`preferences.${preferenceKey}.availableColumns`]: Array.from({ length: count }, (_, index) => ({ index: String(index) })) });
const buttons = (html: string) => [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, attributes, inner]) => ({ tag, text: inner.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').trim(), disabled: /\bdisabled=""/.test(attributes), href: /href="([^"]*)"/.exec(attributes)?.[1] }));
const buttonTexts = (html: string) => buttons(html).map(button => button.text);
const plain = (html: string) => html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const T = Date.parse('2026-10-19T02:00:00Z');
const CODE = 'W4TN-8KQZ-3HVA';
const invite = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1', codeHint: 'Q7KD', maxUses: 10, usedCount: 3, expiresAt: T + 14 * 86_400_000, revokedAt: null,
    note: '计算机学院 2026 级试点', createdBy: '陈予安', createdAt: T, status: 'ACTIVE', ...overrides,
});
const sampleList = () => [
    invite(),
    invite({ id: 'inv-2', codeHint: 'M2PX', maxUses: 1, usedCount: 1, note: null, createdBy: null, status: 'USED_UP' }),
    invite({ id: 'inv-3', codeHint: 'Z9AB', usedCount: 0, note: '社团招新', createdBy: '李主任', status: 'EXPIRED' }),
    invite({ id: 'inv-4', codeHint: 'H4RT', usedCount: 2, note: '误发', status: 'REVOKED', revokedAt: T + 3600_000 }),
];
const withUses = (overrides: Record<string, unknown> = {}) => invite({ uses: [
    { userId: 'user-31', nickname: '林同学', usedAt: T + 60_000 },
    { userId: 'user-32', nickname: '周同学', usedAt: T + 120_000 },
    { userId: 'user-33', nickname: null, usedAt: T + 180_000 },
], ...overrides });
const draft = (overrides: Partial<InviteDraft> = {}): InviteDraft => ({ ...INVITE_DEFAULTS, ...overrides });

beforeEach(() => {
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { if (!String(args[0]).includes('useLayoutEffect does nothing on the server')) original(...args); });
});
afterEach(() => { clearSession(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('注册邀请码：权限', () => {
    it('学校管理员可以查看与发放 / 撤销；只读审计员只能查看；审核员与高级审核员都没有', async () => {
        const access = async (role: string) => {
            vi.unstubAllGlobals(); stubApi({}, identity(role));
            return Promise.all(['list', 'show', 'write'].map(action => authProvider.canAccess!({ resource: 'registration-invites', action })));
        };
        expect(await access('SCHOOL_ADMIN')).toEqual([true, true, true]);
        expect(await access('AUDITOR')).toEqual([true, true, false]);
        expect(await access('MODERATOR')).toEqual([false, false, false]);
        expect(await access('SENIOR_MODERATOR')).toEqual([false, false, false]);
    });
    it('菜单「运营管理」分组：学校管理员与只读审计员看到「注册邀请码」，审核员看不到', () => {
        const operations = (role: string) => navigationGroups(PERMISSIONS[role]).find(group => group.name === '运营管理')?.resources;
        expect(operations('SCHOOL_ADMIN')).toEqual(['users', 'registration-invites', 'products', 'orders']);
        expect(operations('AUDITOR')).toEqual(['users', 'registration-invites', 'products', 'orders']);
        expect(operations('MODERATOR')).toEqual(['products']);
        expect(navigationGroups([INVITE_READ])).toEqual([{ name: '运营管理', resources: ['registration-invites'] }]);
    });
    it('学校管理员的列表有「发放邀请码」，只有状态为「有效」的行有「撤销」', async () => {
        stubApi({ '/v1/admin/registration-invites': { items: sampleList(), total: 4 } });
        const { html } = await renderAdmin(<RegistrationInvitesList />, { resource: 'registration-invites', store: columns('registration-invites.datagrid', 7) });
        expect(buttonTexts(html)).toContain('发放邀请码');
        expect(buttonTexts(html).filter(label => label === '撤销')).toHaveLength(1);
    });
    it('只读审计员的列表与详情都没有「发放邀请码」「撤销」，详情说明需要学校管理员权限', async () => {
        stubApi({ '/v1/admin/registration-invites': { items: sampleList(), total: 4 }, '/v1/admin/registration-invites/inv-1': withUses() }, identity('AUDITOR', 'auditor-1'));
        const list = await renderAdmin(<RegistrationInvitesList />, { resource: 'registration-invites', store: columns('registration-invites.datagrid', 7) });
        expect(list.text).toContain('Q7KD');
        expect(buttonTexts(list.html).filter(label => /发放邀请码|撤销/.test(label))).toEqual([]);
        const show = await renderAdmin(<RegistrationInviteShow />, { resource: 'registration-invites', path: '/registration-invites/inv-1/show' });
        expect(show.text).toContain('林同学');
        expect(buttonTexts(show.html).filter(label => /发放邀请码|撤销/.test(label))).toEqual([]);
        expect(show.text).toContain('只读查看：发放和撤销邀请码需要学校管理员权限。');
    });
    it('只注册列表与详情：没有新建 / 编辑视图，dataProvider 也不提供创建或删除', async () => {
        const admin = App() as ReactElement<{ children: ReactNode }>;
        const resources = Children.toArray(admin.props.children).filter(isValidElement) as ReactElement<Record<string, unknown>>[];
        const props = resources.find(resource => resource.props.name === 'registration-invites')!.props;
        expect(props).toMatchObject({ list: RegistrationInvitesList, show: RegistrationInviteShow, options: { label: '注册邀请码' } });
        expect(props.create).toBeUndefined();
        expect(props.edit).toBeUndefined();
        const { fetch } = stubApi({});
        await expect(dataProvider.create('registration-invites', { data: { maxUses: 10, expiresInDays: 14 } })).rejects.toMatchObject({ status: 405 });
        await expect(dataProvider.delete('registration-invites', { id: 'inv-1', previousData: { id: 'inv-1' } })).rejects.toMatchObject({ status: 405 });
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('注册邀请码：列表与详情', () => {
    it('列表按契约发送 page / size（不发 perPage、排序或搜索），显示尾号、已用/上限、到期、备注、发放人（空为「服务器命令」）与中文状态', async () => {
        const { calls } = stubApi({ '/v1/admin/registration-invites': { items: sampleList(), total: 4 } });
        const { text } = await renderAdmin(<RegistrationInvitesList />, { resource: 'registration-invites', store: columns('registration-invites.datagrid', 7) });
        const list = calls.filter(call => call.path === '/v1/admin/registration-invites');
        expect(list).toHaveLength(1);
        expect(Object.fromEntries(new URLSearchParams(list[0].query))).toEqual({ page: '1', size: '25' });
        for (const header of ['尾号', '已用/上限', '到期', '备注', '发放人', '状态']) expect(text).toContain(header);
        for (const value of ['Q7KD', 'M2PX', 'Z9AB', 'H4RT', '3 / 10', '1 / 1', '计算机学院 2026 级试点', '社团招新', '陈予安', '李主任', '服务器命令', '有效', '已用完', '已过期', '已撤销', '共 4 条记录', '导出最多 50 条筛选结果']) expect(text).toContain(value);
        expect(text.split('服务器命令')).toHaveLength(2);
        expect(text).not.toMatch(/ACTIVE|USED_UP|EXPIRED|REVOKED/);
    });
    it('状态筛选只发送 status；每页最多 50 条（size 超出时截到 50）；其他资源仍用 perPage', () => {
        const query = (perPage: number, filter: Record<string, unknown>) => Object.fromEntries(new URLSearchParams(listQuery('registration-invites', { pagination: { page: 2, perPage }, sort: { field: 'createdAt', order: 'DESC' }, filter })));
        expect(query(25, { status: 'USED_UP', q: 'x', schoolId: 'forged', createdBy: 'me' })).toEqual({ page: '2', size: '25', status: 'USED_UP' });
        expect(query(100, {})).toEqual({ page: '2', size: '50' });
        expect(query(25, { status: '' })).toEqual({ page: '2', size: '25' });
        expect(Object.fromEntries(new URLSearchParams(listQuery('role-requests', { pagination: { page: 1, perPage: 25 }, sort: { field: 'createdAt', order: 'DESC' }, filter: {} })))).toEqual({ page: '1', perPage: '25', sort: 'createdAt', order: 'DESC' });
    });
    it('响应没有 total 时按是否取满一页给出翻页信息，列表显示本页条数', async () => {
        stubApi({ '/v1/admin/registration-invites': (call: Call) => ({ items: new URLSearchParams(call.query).get('page') === '1' ? Array.from({ length: 50 }, (_, index) => invite({ id: `inv-${index}` })) : [invite()] }) });
        const full = await dataProvider.getList('registration-invites', { pagination: { page: 1, perPage: 50 }, sort: { field: 'createdAt', order: 'DESC' }, filter: {} });
        expect(full.total).toBeUndefined();
        expect(full.pageInfo).toEqual({ hasPreviousPage: false, hasNextPage: true });
        const last = await dataProvider.getList('registration-invites', { pagination: { page: 2, perPage: 50 }, sort: { field: 'createdAt', order: 'DESC' }, filter: {} });
        expect(last.pageInfo).toEqual({ hasPreviousPage: true, hasNextPage: false });
        vi.unstubAllGlobals();
        stubApi({ '/v1/admin/registration-invites': { items: sampleList().slice(0, 2) } });
        const { text } = await renderAdmin(<RegistrationInvitesList />, { resource: 'registration-invites', store: columns('registration-invites.datagrid', 7) });
        expect(text).toContain('本页 2 条记录');
    });
    it('详情：GET /v1/admin/registration-invites/{id}，显示尾号、状态、发放信息与使用记录（昵称、用户编号、使用时间）', async () => {
        const { calls } = stubApi({ '/v1/admin/registration-invites/inv-1': withUses() });
        const { html, text } = await renderAdmin(<RegistrationInviteShow />, { resource: 'registration-invites', path: '/registration-invites/inv-1/show' });
        expect(calls.filter(call => call.path.startsWith('/v1/admin/registration-invites')).map(call => call.path)).toEqual(['/v1/admin/registration-invites/inv-1']);
        for (const value of ['尾号 Q7KD', '有效', '3 / 10', '计算机学院 2026 级试点', '陈予安', '使用记录（3）', '林同学', '周同学', '未提供昵称', 'user-31', 'user-33']) expect(text).toContain(value);
        // 学校管理员能读用户：昵称链接到用户详情
        expect(buttons(html).find(button => button.text === '林同学')?.href).toBe('/users/user-31/show');
        expect(buttonTexts(html)).toContain('撤销');
    });
    it('详情：服务器命令发放、已撤销的邀请码显示「服务器命令」与撤销时间，没有「撤销」；没有使用记录时说明', async () => {
        stubApi({ '/v1/admin/registration-invites/inv-4': invite({ id: 'inv-4', createdBy: null, status: 'REVOKED', revokedAt: T + 3600_000, usedCount: 0, uses: [] }) });
        const { html, text } = await renderAdmin(<RegistrationInviteShow />, { resource: 'registration-invites', path: '/registration-invites/inv-4/show' });
        expect(text).toContain('服务器命令');
        expect(text).toContain('撤销时间');
        expect(text).toContain('这个邀请码已撤销，不能再用于注册。');
        expect(text).toContain('还没有人用这个邀请码注册。');
        expect(buttonTexts(html)).not.toContain('撤销');
    });
});

describe('注册邀请码：读取留痕', () => {
    it('后端为邀请码列表与详情写读取审计：读取审计页显示「注册邀请码」而不是资源编号', async () => {
        stubApi({ '/v1/admin/read-audit': { items: [{ id: 'ra-9', actorId: 'auditor-1', actorNickname: '周审计', resource: 'registration-invites', recordId: 'inv-1', resultCount: null, withQuery: false, requestId: 'req-invite', createdAt: T }], total: 1 } }, identity('AUDITOR', 'auditor-1'));
        const { text } = await renderAdmin(<ReadAuditList />, { resource: 'read-audit', store: columns('read-audit.datagrid', 7) });
        expect(text).toContain(' 注册邀请码 ');
        expect(text).not.toContain('registration-invites');
    });
});

describe('注册邀请码：状态与发放人文案', () => {
    it('四种状态的中文名：有效 / 已用完 / 已过期 / 已撤销；未知状态原样显示', () => {
        expect(inviteStatusNames).toEqual({ ACTIVE: '有效', USED_UP: '已用完', EXPIRED: '已过期', REVOKED: '已撤销' });
        expect(['ACTIVE', 'USED_UP', 'EXPIRED', 'REVOKED'].map(inviteStatusLabel)).toEqual(['有效', '已用完', '已过期', '已撤销']);
        expect(inviteStatusLabel('PAUSED')).toBe('PAUSED');
        expect(inviteStatusLabel(null)).toBe('未设置');
    });
    it('发放人：昵称原样显示；null（服务器命令发放）显示「服务器命令」', () => {
        expect(issuerText('陈予安')).toBe('陈予安');
        expect(issuerText(null)).toBe('服务器命令');
        expect(issuerText(undefined)).toBe('服务器命令');
    });
    it('邀请消息：「校园集市小范围测试邀请码：XXXX-XXXX-XXXX，N 天内有效，注册时填写」', () => {
        expect(inviteMessage(CODE, 14)).toBe('校园集市小范围测试邀请码：W4TN-8KQZ-3HVA，14 天内有效，注册时填写');
        expect(inviteMessage('ABCD-EFGH-JKLM', 1)).toBe('校园集市小范围测试邀请码：ABCD-EFGH-JKLM，1 天内有效，注册时填写');
    });
});

describe('注册邀请码：发放请求与输入校验', () => {
    it('默认值：可使用 10 次、14 天、备注为空，默认值本身合法', () => {
        expect(INVITE_DEFAULTS).toEqual({ maxUses: '10', expiresInDays: '14', note: '' });
        expect(inviteDraftProblems(draft())).toEqual({});
        expect(invitePayload(draft())).toEqual({ maxUses: 10, expiresInDays: 14 });
    });
    it.each([
        ['maxUses', '0', '可用次数需为 1～500 的整数'], ['maxUses', '501', '可用次数需为 1～500 的整数'], ['maxUses', '2.5', '可用次数需为 1～500 的整数'],
        ['maxUses', '', '可用次数需为 1～500 的整数'], ['maxUses', '-3', '可用次数需为 1～500 的整数'],
        ['expiresInDays', '0', '有效天数需为 1～90 的整数'], ['expiresInDays', '91', '有效天数需为 1～90 的整数'], ['expiresInDays', '7.5', '有效天数需为 1～90 的整数'], ['expiresInDays', 'abc', '有效天数需为 1～90 的整数'],
        ['note', 'x'.repeat(101), '备注最多 100 个字'], ['note', '😀'.repeat(101), '备注最多 100 个字'],
    ] as const)('%s=%j 不合法：「%s」，不发请求', async (field, value, message) => {
        const { fetch } = stubApi({});
        expect(inviteDraftProblems(draft({ [field]: value }))).toEqual({ [field]: message });
        await expect(createRegistrationInvite(draft({ [field]: value }))).rejects.toMatchObject({ status: 400, message });
        expect(fetch).not.toHaveBeenCalled();
    });
    it('边界值合法：1 / 500 次、1 / 90 天、100 个字的备注（去掉首尾空白、按字符而不是 UTF-16 单元计算，与后端一致）', () => {
        for (const value of [draft({ maxUses: '1', expiresInDays: '1' }), draft({ maxUses: '500', expiresInDays: '90' }), draft({ note: `  ${'备'.repeat(100)}  ` }), draft({ note: '😀'.repeat(100) })]) expect(inviteDraftProblems(value)).toEqual({});
    });
    it('POST /v1/admin/registration-invites：请求体只有 maxUses、expiresInDays 与去掉首尾空白的 note；备注为空时不发送 note', async () => {
        const issued = { ...invite({ id: 'inv-new', codeHint: '3HVA', usedCount: 0 }), code: CODE };
        const { calls } = stubApi({ 'POST /v1/admin/registration-invites': issued });
        await expect(createRegistrationInvite(draft({ maxUses: ' 30 ', expiresInDays: '7', note: '  社团招新  ' }))).resolves.toEqual(issued);
        await createRegistrationInvite(draft({ note: '   ' }));
        expect(calls).toEqual([
            { path: '/v1/admin/registration-invites', query: '', method: 'POST', body: { maxUses: 30, expiresInDays: 7, note: '社团招新' } },
            { path: '/v1/admin/registration-invites', query: '', method: 'POST', body: { maxUses: 10, expiresInDays: 14 } },
        ]);
    });
    it('撤销：POST /v1/admin/registration-invites/{id}/revoke，没有请求体', async () => {
        const { calls } = stubApi({ 'POST /v1/admin/registration-invites/inv-1/revoke': invite({ status: 'REVOKED', revokedAt: T }) });
        await expect(revokeRegistrationInvite('inv-1')).resolves.toMatchObject({ id: 'inv-1', status: 'REVOKED' });
        expect(calls).toEqual([{ path: '/v1/admin/registration-invites/inv-1/revoke', query: '', method: 'POST', body: undefined }]);
    });
    it.each([
        [400, '可用次数需为 1～500 的整数'],
        [403, '没有执行此操作的权限'],
        [409, '本校有效邀请码已达上限，请先撤销不用的邀请码'],
        [429, '请求过于频繁，请稍后再试'],
    ])('发放失败 %i：服务器信息「%s」原样交给界面', async (status, message) => {
        stubApi({ 'POST /v1/admin/registration-invites': failure(status, message) });
        await expect(createRegistrationInvite(draft())).rejects.toMatchObject({ status, message });
    });
    it.each([
        [403, '没有执行此操作的权限'],
        [409, '邀请码状态已变化，请刷新后重试'],
        [429, '请求过于频繁，请稍后再试'],
    ])('撤销失败 %i：服务器信息「%s」原样交给界面', async (status, message) => {
        stubApi({ 'POST /v1/admin/registration-invites/inv-1/revoke': failure(status, message) });
        await expect(revokeRegistrationInvite('inv-1')).rejects.toMatchObject({ status, message });
    });
});

describe('注册邀请码：完整邀请码只显示一次', () => {
    const issued = { code: CODE, days: 14, maxUses: 10, expiresAt: T + 14 * 86_400_000 };
    it('弹窗状态：打开是空白表单；生成后带邀请码；关闭立即丢弃邀请码；再次打开回到表单，不会再显示旧码', () => {
        let state: InviteDialogState = CLOSED_INVITE_DIALOG;
        state = inviteDialogReducer(state, { type: 'open' });
        expect(state).toEqual({ phase: 'form' });
        state = inviteDialogReducer(state, { type: 'issued', issued });
        expect(state).toEqual({ phase: 'issued', issued });
        // 已显示邀请码时不会被「打开」或新的结果覆盖
        expect(inviteDialogReducer(state, { type: 'open' })).toBe(state);
        expect(inviteDialogReducer(state, { type: 'issued', issued: { ...issued, code: 'OTHER-CODE-0000' } })).toBe(state);
        state = inviteDialogReducer(state, { type: 'close' });
        expect(state).toEqual({ phase: 'closed' });
        expect(JSON.stringify(state)).not.toContain(CODE);
        state = inviteDialogReducer(state, { type: 'open' });
        expect(state).toEqual({ phase: 'form' });
        // 弹窗已关闭时迟到的结果被丢弃
        expect(inviteDialogReducer(CLOSED_INVITE_DIALOG, { type: 'issued', issued })).toBe(CLOSED_INVITE_DIALOG);
    });
    it('邀请码页：警示「只显示这一次」、邀请码与邀请消息各一次、「复制邀请码」「复制邀请消息」', () => {
        const html = renderToStaticMarkup(<InviteCodeContent issued={issued} copied="" onCopy={() => undefined} />);
        expect(INVITE_CODE_WARNING).toContain('只显示这一次');
        expect(INVITE_CODE_WARNING).toContain('关闭后无法再次查看');
        expect(html).toContain(INVITE_CODE_WARNING);
        expect(html).toContain(`aria-label="邀请码"`);
        // 邀请码本身一次 + 邀请消息里一次
        expect(html.split(CODE)).toHaveLength(3);
        expect(plain(html)).toContain('校园集市小范围测试邀请码：W4TN-8KQZ-3HVA，14 天内有效，注册时填写');
        expect(buttonTexts(html)).toEqual(['复制邀请码', '复制邀请消息']);
        const copied = plain(renderToStaticMarkup(<InviteCodeContent issued={issued} copied="message" onCopy={() => undefined} />));
        expect(copied).toContain('邀请消息已复制');
        expect(copied.split(CODE)).toHaveLength(3);
    });
    it('弹窗关闭（closed）或处于表单阶段时不渲染任何邀请码与警示', () => {
        const props = { draft: draft(), busy: false, error: '', copied: '' as const, onDraft: () => undefined, onSubmit: () => undefined, onCopy: () => undefined, onClose: () => undefined };
        const closed = renderToStaticMarkup(<InviteDialog {...props} state={CLOSED_INVITE_DIALOG} />);
        expect(closed).not.toContain(CODE);
        expect(closed).not.toContain(INVITE_CODE_WARNING);
        const reopened = renderToStaticMarkup(<InviteDialog {...props} state={inviteDialogReducer(inviteDialogReducer({ phase: 'issued', issued }, { type: 'close' }), { type: 'open' })} />);
        expect(reopened).not.toContain(CODE);
        expect(reopened).not.toContain(INVITE_CODE_WARNING);
    });
    it('完整邀请码不被保存：不写 localStorage / sessionStorage、不打日志、不进入 react-query 缓存或 react-admin store', async () => {
        const storage = () => ({ setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
        const local = storage(), session = storage();
        vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session);
        const logs = (['log', 'info', 'debug', 'warn'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined));
        stubApi({ '/v1/admin/registration-invites': { items: sampleList(), total: 4 }, 'POST /v1/admin/registration-invites': { ...invite({ id: 'inv-new', codeHint: '3HVA' }), code: CODE } });
        const page = await renderAdmin(<RegistrationInvitesList />, { resource: 'registration-invites', store: columns('registration-invites.datagrid', 7) });
        const created = await createRegistrationInvite(draft());
        expect(created.code).toBe(CODE);
        expect(local.setItem).not.toHaveBeenCalled();
        expect(session.setItem).not.toHaveBeenCalled();
        for (const spy of [...logs, console.error as unknown as ReturnType<typeof vi.fn>]) expect(JSON.stringify((spy as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(CODE);
        const cached = JSON.stringify(page.queryClient.getQueryCache().getAll().map(query => [query.queryKey, query.state.data]));
        expect(cached).toContain('Q7KD');
        expect(cached).not.toContain(CODE);
        const keys = await Promise.all(['registration-invites', 'preferences', 'invite'].map(key => page.adminStore.getItem(key)));
        expect(JSON.stringify(keys)).not.toContain(CODE);
    });
});
