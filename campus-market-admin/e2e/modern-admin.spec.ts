import { test, expect, type Page } from '@playwright/test';

const read = ['users', 'products', 'orders', 'cases', 'appeals', 'audit', 'role-requests', 'read-audit', 'roles'].map(resource => `${resource}:read`);
// 与后端 AdminPermissions（阶段 2）一致
const adminPermissions = [...read, 'users:write', 'products:write', 'cases:write', 'appeals:write'];
const seniorModeratorPermissions = ['products:read', 'cases:read', 'cases:write', 'appeals:read', 'appeals:write'];
const auditorPermissions = ['users:read', 'products:read', 'orders:read', 'audit:read', 'role-requests:read', 'read-audit:read', 'roles:read'];
const T0 = Date.parse('2026-10-19T02:00:00Z');
const sampleRoleRequests = () => [
    { id: 'rr-1', targetId: 'user-9', targetNickname: '王老师', targetAccount: 'T2026009', requestedBy: 'admin-2', requesterNickname: '李主任', oldRole: null, oldActive: null, newRole: 'SCHOOL_ADMIN', newActive: true, note: '新学期增加一名学校管理员', status: 'PENDING', expiresAt: T0 + 72 * 3600_000, createdAt: T0 },
    { id: 'rr-2', targetId: 'user-8', targetNickname: '赵老师', targetAccount: 'T2026008', requestedBy: 'admin-2', requesterNickname: '李主任', oldRole: 'SCHOOL_ADMIN', oldActive: true, newRole: 'AUDITOR', newActive: true, note: '调岗为审计', status: 'PENDING', expiresAt: T0 + 70 * 3600_000, createdAt: T0 - 1000 },
    { id: 'rr-3', targetId: 'user-7', targetNickname: '孙老师', targetAccount: 'T2026007', requestedBy: 'admin-1', requesterNickname: '陈予安', oldRole: 'SCHOOL_ADMIN', oldActive: true, newRole: 'SCHOOL_ADMIN', newActive: false, note: '离校停用', status: 'APPROVED', decidedBy: 'admin-2', deciderNickname: '李主任', decisionNote: '核实', decidedAt: T0 + 5000, expiresAt: T0 + 72 * 3600_000, createdAt: T0 - 5000 },
];
const sampleReadAudit = [
    { id: 'ra-1', actorId: 'admin-1', actorNickname: '陈予安', resource: 'users', recordId: null, resultCount: 25, withQuery: true, requestId: 'req-users-search', createdAt: T0 },
    { id: 'ra-2', actorId: 'auditor-1', actorNickname: '周审计', resource: 'orders', recordId: '674aad03-c000-4150-b075-42a38b1bcc61', resultCount: null, withQuery: false, requestId: 'req-order-detail', createdAt: T0 - 60_000 },
    { id: 'ra-3', actorId: 'auditor-1', actorNickname: '周审计', resource: 'role-requests', recordId: null, resultCount: 3, withQuery: false, requestId: 'req-role-requests', createdAt: T0 - 120_000 },
    { id: 'ra-4', actorId: 'auditor-1', actorNickname: '周审计', resource: 'read-audit', recordId: null, resultCount: 4, withQuery: false, requestId: 'req-read-audit', createdAt: T0 - 180_000 },
];
/** GET /v1/schools（公开接口）：只列出可见学校；演示学校 pilot（校区编号与名称相同，如「东校区」）在生产环境被隐藏。 */
const sampleSchools = [
    { id: 'aust', name: '安徽理工大学', shortName: '安理', campuses: [{ id: 'aust-huainan', name: '淮南校区', hasBuildings: true }, { id: 'aust-hefei', name: '合肥校区', hasBuildings: false }] },
    { id: 'hfut', name: '合肥工业大学', shortName: '合工大', campuses: [{ id: 'hfut-tunxi', name: '屯溪路校区', hasBuildings: true }] },
];
const sampleOrder = {
    id: '674aad03-c000-4150-b075-42a38b1bcc61', productId: '9405904a-97d5-4e51-8e6b-2bd8b143b190',
    productTitle: '宜家台灯 · 宿舍阅读灯', productCategory: '生活用品', productCampus: 'aust-huainan', productCondition: '几乎全新', productListingKind: 'SINGLE', productStatus: '在售',
    productDescription: '暖光护眼台灯，使用一个学期，功能完好。附带原装电源线，适合宿舍阅读。', productImages: [],
    productCurrentPrice: 99, price: 88, priceSnapshot: 88, currency: 'CNY', categorySnapshot: '生活用品', conditionSnapshot: '几乎全新', listingKindSnapshot: 'SINGLE',
    buyerId: 'buyer-1', buyerNickname: '明月', buyerAccount: '20260021', buyerCampus: 'aust-hefei',
    sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016', sellerCampus: 'aust-huainan',
    status: 'EXPIRED', meetingPointId: 'main-library', meetingPointName: '图书馆东门', meetingCampus: 'aust-huainan',
    meetingAt: Date.parse('2026-10-09T06:00:00Z'), meetingEndsAt: Date.parse('2026-10-09T06:30:00Z'), meetingRevision: 1,
    createdAt: Date.parse('2026-10-08T02:00:00Z'), updatedAt: Date.parse('2026-10-08T03:00:00Z'), expiresAt: Date.parse('2026-10-09T02:00:00Z'),
    events: [
        { id: 'event-1', actorId: 'buyer-1', actorNickname: '明月', eventCode: 'STATUS_CHANGED', toStatus: 'PENDING_SELLER_CONFIRM', createdAt: Date.parse('2026-10-08T02:00:00Z') },
        { id: 'event-2', actorId: 'seller-1', actorNickname: '清风', eventCode: 'STATUS_CHANGED', fromStatus: 'PENDING_SELLER_CONFIRM', toStatus: 'PENDING_MEETING', createdAt: Date.parse('2026-10-08T02:30:00Z') },
        { id: 'event-3', actorId: 'buyer-1', actorNickname: '明月', eventCode: 'MEETING_PROPOSED', meetingRevision: 1, createdAt: Date.parse('2026-10-08T02:45:00Z') },
        { id: 'event-4', actorId: 'seller-1', actorNickname: '清风', eventCode: 'MEETING_ACCEPTED', meetingRevision: 1, createdAt: Date.parse('2026-10-08T03:00:00Z') },
        // V16 停用站内交易时统一关闭，没有操作人
        { id: 'event-5', eventCode: 'STATUS_CHANGED', fromStatus: 'PENDING_MEETING', toStatus: 'EXPIRED', createdAt: Date.parse('2026-10-15T00:00:00Z') },
    ], reviews: [], bundleItems: [], cancellation: null,
};
const sampleProduct = {
    id: 'p-1', title: '九成新 Kindle Paperwhite', description: '宿舍阅读用 Kindle，屏幕完好，附赠保护套和充电线。',
    category: '数码电子', condition: '几乎全新', listingKind: 'SINGLE', price: 280, status: '在售', campus: 'aust-huainan',
    sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016', moderationHidden: false,
    images: [], version: 'product-v1', views: 128, visibility: 'PUBLIC', createdAt: Date.parse('2026-10-08T02:20:00Z'), history: [] as Record<string, unknown>[],
};
async function mockAdmin(page: Page, permissions = adminPermissions, me: { id?: string; role?: string; schoolId?: string } = {}, options: { schoolsAvailable?: boolean } = {}) {
    let authenticated = false;
    /** 学校目录是否可用；不可用时返回 503（测试可在中途切换）。 */
    let schoolsAvailable = options.schoolsAvailable ?? true;
    let product = { ...sampleProduct, history: [...sampleProduct.history] };
    const roleRequests: Record<string, unknown>[] = sampleRoleRequests();
    /** 复核请求的处理：路径与原始请求体（没有请求体时为 null）。 */
    const decisions: { path: string; body: string | null }[] = [];
    const writes: Record<string, unknown>[] = [];
    /** 签发重置码：路径与原始请求体。 */
    const resets: { path: string; body: string | null }[] = [];
    // 阶段 3：已注销账号（匿名化后的资料，deleted=true）
    const deletedUser = { id: 'gone-1', nickname: '已注销用户', account: 'deleted-gone-1', campus: 'aust-huainan', role: null, active: false, deleted: true, createdAt: '2026-09-01T08:00:00Z' };
    const queries: URL[] = [];
    const requests: { method: string; path: string }[] = [];
    let user = { id: 'staff-1', nickname: '林小雨', account: '20260018', campus: 'aust-hefei', role: 'MODERATOR', active: true, createdAt: '2026-10-01T08:00:00Z' };
    await page.route('**/v1/**', async route => {
        const url = new URL(route.request().url()); const path = url.pathname;
        queries.push(url); requests.push({ method: route.request().method(), path });
        // 公开接口，不需要登录
        if (path === '/v1/schools') {
            await route.fulfill(schoolsAvailable ? { json: { code: 0, data: sampleSchools } } : { status: 503, json: { code: 503, message: '服务暂不可用' } });
            return;
        }
        if (path === '/v1/auth/login') authenticated = true;
        if (!authenticated) { await route.fulfill({ status: 401, json: { code: 401, message: '请登录' } }); return; }
        let data: unknown;
        if (path.startsWith('/v1/auth/')) data = { accessToken: 'ui-test-only', expiresAtIso: '2099-01-01' };
        else if (path === '/v1/admin/me') data = { id: me.id ?? 'admin-1', fullName: '陈予安', schoolId: me.schoolId ?? 'aust', role: me.role ?? (permissions.includes('users:write') ? 'SCHOOL_ADMIN' : 'AUDITOR'), permissions };
        else if (path.endsWith('/staff')) {
            const payload = route.request().postDataJSON(); writes.push(payload);
            if (payload.role === 'SCHOOL_ADMIN' || user.role === 'SCHOOL_ADMIN') {
                // 阶段 2：涉及学校管理员的变更只生成待确认的复核请求，用户记录不变
                const pendingRoleRequest = { id: 'rr-new', status: 'PENDING', targetId: user.id, targetNickname: user.nickname, targetAccount: user.account, requestedBy: me.id ?? 'admin-1', requesterNickname: '陈予安', oldRole: user.role, oldActive: user.active, newRole: payload.role, newActive: payload.active, note: payload.note, expiresAt: T0 + 72 * 3600_000, createdAt: T0 };
                roleRequests.unshift(pendingRoleRequest);
                data = { ...user, pendingRoleRequest };
            } else { user = { ...user, ...payload }; data = user; }
        }
        else if (path === '/v1/admin/role-requests') {
            const status = url.searchParams.get('status');
            const items = roleRequests.filter(item => !status || item.status === status);
            data = { items, total: items.length };
        }
        else if (/^\/v1\/admin\/role-requests\/[^/]+\/(approve|reject|cancel)$/.test(path)) {
            const [, , , , id, decision] = path.split('/');
            decisions.push({ path, body: route.request().postData() });
            const index = roleRequests.findIndex(item => item.id === id);
            roleRequests[index] = { ...roleRequests[index], status: { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[decision], decidedAt: Date.now(), ...(decision === 'cancel' ? {} : { decidedBy: me.id ?? 'admin-1', deciderNickname: '陈予安', decisionNote: JSON.parse(route.request().postData() ?? '{}').note }) };
            data = roleRequests[index];
        }
        else if (path.startsWith('/v1/admin/role-requests/')) data = roleRequests.find(item => item.id === path.split('/').at(-1));
        else if (path === '/v1/admin/read-audit') data = { items: sampleReadAudit, total: sampleReadAudit.length };
        else if (path.endsWith('/password-reset') && route.request().method() === 'POST') {
            resets.push({ path, body: route.request().postData() });
            data = { ticketId: `ticket-${resets.length}`, code: resets.length === 1 ? 'K7QD-2M9X-4PZA' : 'R3NB-8WUE-6TCH', expiresAt: Date.now() + 30 * 60_000 };
        }
        else if (path === '/v1/admin/users/gone-1') data = deletedUser;
        else if (path === '/v1/admin/users/staff-1') data = user;
        else if (path === '/v1/admin/users/admin-1') data = { ...user, id: 'admin-1', nickname: '陈予安', role: 'SCHOOL_ADMIN' };
        else if (path === '/v1/admin/users') data = { items: [user, deletedUser], total: 1286 };
        else if (path === '/v1/admin/products/p-1/visibility' || (path === '/v1/admin/products/p-1' && route.request().method() === 'PATCH')) {
            const payload = route.request().postDataJSON(); writes.push(payload);
            const action = payload.action || 'EDIT_PRODUCT';
            product = { ...product, ...(action === 'EDIT_PRODUCT' ? { title: payload.title, description: payload.description, price: payload.price } : { moderationHidden: action === 'HIDE_PRODUCT' }), version: `${product.version}-next`, history: [{ id: `h-${writes.length}`, action, actorNickname: '陈予安', note: payload.note, createdAt: Date.now() }, ...product.history] };
            data = product;
        }
        else if (path === '/v1/admin/products/p-1') data = product;
        else if (path === '/v1/admin/products') data = { items: [
            product,
            { id: 'p-2', title: '高等数学教材 · 同济第八版', category: '书籍教材', price: 25, status: '已售出', campus: 'aust-hefei', moderationHidden: false, createdAt: '2026-10-08T01:30:00Z' },
            { id: 'p-3', title: '宜家台灯，毕业低价转让', category: '生活用品', price: 45, status: '在售', campus: '东校区', moderationHidden: false, createdAt: '2026-10-07T11:40:00Z' },
        ], total: 432 };
        else if (path === '/v1/admin/cases') data = { items: [
            { id: 'c-1', targetType: 'PRODUCT', target: { label: '商品描述与实物不符' }, status: 'OPEN', reportCount: 3, createdAt: '2026-10-08T02:00:00Z' },
            { id: 'c-2', targetType: 'NO_SHOW', target: { label: '预约面交后未按时到场' }, status: 'OPEN', reportCount: 1, createdAt: '2026-10-08T01:00:00Z' },
            { id: 'c-3', targetType: 'COMMENT', target: { label: '评论包含不友善内容' }, status: 'OPEN', reportCount: 2, createdAt: '2026-10-07T09:00:00Z' },
        ], total: 12 };
        else if (path === '/v1/admin/orders') data = { items: [sampleOrder], total: 1 };
        else if (path === `/v1/admin/orders/${sampleOrder.id}`) data = sampleOrder;
        else if (path === '/v1/admin/appeals') data = { items: [], total: 3 };
        else if (path === '/v1/admin/audit') data = { items: [{ id: 'a-1', actorId: 'admin-1', targetId: 'staff-1', oldRole: 'AUDITOR', newRole: 'MODERATOR', newActive: true, note: '负责新学期日常内容审核', createdAt: '2026-10-07T04:00:00Z' }], total: 1 };
        else if (path === '/v1/admin/roles') data = { items: [
            { id: 'SCHOOL_ADMIN', name: '学校管理员', permissions: adminPermissions },
            { id: 'AUDITOR', name: '只读审计员', permissions: ['users:read', 'products:read', 'orders:read', 'audit:read', 'roles:read'] },
        ], total: 2 };
        else data = { items: [], total: 0 };
        await route.fulfill({ json: { code: 0, data } });
    });
    await page.goto('/admin/');
    await page.getByLabel('用户名', { exact: false }).fill('ui-test');
    await page.getByLabel(/^密码/).fill('ui-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '校园集市运营工作台' })).toBeVisible();
    return { writes, queries, requests, decisions, resets, setSchoolsAvailable: (value: boolean) => { schoolsAvailable = value; } };
}
const LEGACY_NOTICE = '平台已停用站内交易，现在只展示商品与联系方式。这里是停用前产生的历史订单，已在平台停用站内交易时统一关闭，仅供只读查看，不能新建、编辑或删除。';
/** 页面上不应出现的写入入口：新建、编辑、删除、保存、批量选择。 */
async function expectNoWriteAffordances(page: Page) {
    for (const role of ['button', 'link', 'menuitem'] as const) await expect(page.getByRole(role, { name: /新建|创建|编辑|删除|保存|Create|Edit|Delete/ })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
}

test('工作台读取真实接口总数，待办链接保留筛选，快速导航支持搜索', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1120 });
    const { queries } = await mockAdmin(page);
    await expect(page.getByRole('link', { name: '校园用户：1286' })).toBeVisible();
    await expect(page.getByRole('link', { name: '待处理案件：12' })).toBeVisible();
    await expect(page.getByRole('link', { name: '待复核申诉：3' })).toBeVisible();
    await expect(page.getByText('九成新 Kindle Paperwhite')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
    await page.getByRole('link', { name: '待处理案件：12' }).click();
    await expect(page.getByRole('heading', { name: '治理案件' })).toBeVisible();
    await expect.poll(() => queries.filter(url => url.pathname.endsWith('/cases')).at(-1)?.searchParams.get('status')).toBe('OPEN');
    await page.getByRole('button', { name: '快速导航' }).click();
    await page.getByLabel('搜索管理页面').fill('角色');
    await page.getByRole('button', { name: '角色权限', exact: true }).click();
    await expect(page.getByRole('heading', { name: '角色权限' })).toBeVisible();
    await expect(page.getByText('用户与工作人员 · 管理')).toBeVisible();
});

test('工作人员授权预览和确认，确认前不提交，取消后可继续编辑', async ({ page }, testInfo) => {
    const { writes } = await mockAdmin(page);
    await page.goto('/admin/users/staff-1');
    await expect(page.getByRole('heading', { name: '配置工作人员权限' })).toBeVisible();
    await expect(page.getByText('审核员 · 权限范围')).toBeVisible();
    await page.getByRole('combobox', { name: '后台角色' }).click();
    await page.getByRole('option', { name: '只读审计员' }).click();
    await expect(page.getByText('只读审计员 · 权限范围')).toBeVisible();
    await page.getByLabel('授权或停用原因').fill('临时调整为审计工作');
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('staff-permissions.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认工作人员权限变更' });
    await expect(dialog).toBeVisible();
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '返回修改' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(page).toHaveURL(/\/users\/staff-1\/show$/);
    expect(writes).toEqual([{ role: 'AUDITOR', active: true, note: '临时调整为审计工作' }]);
});

test('用户列表支持列选择与 CSV 导出，导出不超过服务端分页上限', async ({ page }, testInfo) => {
    const { queries } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '用户与工作人员' }).click();
    await expect(page.getByText('林小雨')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('users-list.png'), fullPage: true });
    await page.getByRole('button', { name: /列|Columns/ }).click();
    await expect(page.getByRole('switch', { name: '账号' })).toBeVisible();
    await page.getByRole('switch', { name: '账号' }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: '账号' })).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出记录' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    expect(queries.some(url => url.pathname.endsWith('/users') && url.searchParams.get('perPage') === '100')).toBe(true);
});

test('授权保存失败保留确认内容，可直接重试', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    let first = true;
    await page.route('**/v1/admin/users/staff-1/staff', async route => {
        if (first) { first = false; await route.fulfill({ status: 503, json: { code: 503, message: '服务暂不可用，请稍后重试' } }); }
        else await route.fallback();
    });
    await page.goto('/admin/users/staff-1');
    await page.getByLabel('授权或停用原因').fill('核对工作人员访问权限');
    await page.getByRole('switch', { name: '启用后台权限' }).uncheck();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认工作人员权限变更' });
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(dialog.getByText('服务暂不可用，请稍后重试')).toBeVisible();
    await expect(dialog.getByText('变更原因：核对工作人员访问权限')).toBeVisible();
    expect(writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '确认变更' }).click();
    await expect(page).toHaveURL(/\/users\/staff-1\/show$/);
    expect(writes).toEqual([{ role: 'MODERATOR', active: false, note: '核对工作人员访问权限' }]);
});

test('只读角色隐藏写入入口，工作台不请求无权读取的治理数据', async ({ page }) => {
    const { queries } = await mockAdmin(page, ['users:read', 'products:read', 'orders:read', 'audit:read', 'roles:read']);
    await expect(page.getByRole('menuitem', { name: '治理案件' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '用户申诉' })).toHaveCount(0);
    expect(queries.some(url => /\/admin\/(cases|appeals)$/.test(url.pathname))).toBe(false);
    await expect(page.getByRole('link', { name: '历史订单（只读）：1' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '历史订单（只读）' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '交易订单' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '用户与工作人员' }).click();
    await expect(page.getByText('林小雨')).toBeVisible();
    await expect(page.getByRole('button', { name: '配置权限' })).toHaveCount(0);
});

test('手机宽度工作台不横向溢出，自身权限不能修改', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAdmin(page);
    await expect(page.getByRole('link', { name: '校园用户：1286' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mobile-dashboard.png'), fullPage: true });
    await page.goto('/admin/users/admin-1');
    await expect(page.getByText('不能修改自己的后台权限，请由其他学校管理员操作。')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
});


test('历史订单只读：菜单与标题改名、列表和详情显示说明，没有新建、编辑、删除入口', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { queries, requests } = await mockAdmin(page);
    await expect(page.getByRole('menuitem', { name: '交易订单' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '历史订单（只读）' }).click();
    await expect(page.getByRole('heading', { name: '历史订单（只读）', level: 1 })).toBeVisible();
    await expect(page.getByRole('note', { name: '历史订单说明' })).toHaveText(LEGACY_NOTICE);
    await expect(page.getByText(sampleOrder.productTitle, { exact: true })).toBeVisible();
    await expect(page.getByText('明月', { exact: true })).toBeVisible();
    await expect(page.getByText('清风', { exact: true })).toBeVisible();
    await expect(page.getByText('20260021', { exact: true })).toBeVisible();
    await expect(page.getByText('20250016', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell').getByText('已过期', { exact: true })).toBeVisible();
    await expectNoWriteAffordances(page);
    await page.getByLabel('搜索订单、商品、买家或卖家').fill('明月');
    await expect.poll(() => queries.filter(url => url.pathname.endsWith('/orders')).at(-1)?.searchParams.get('q')).toBe('明月');
    await page.getByRole('button', { name: '清除筛选' }).click();
    await page.screenshot({ path: testInfo.outputPath('orders-list.png'), fullPage: true });
    // 点击行进入只读详情（不是编辑页）
    await page.getByText(sampleOrder.productTitle, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${sampleOrder.id}/show$`));
    await expect(page.getByRole('heading', { name: '历史订单详情', level: 1 })).toBeVisible();
    await expect(page.getByRole('note', { name: '历史订单说明' })).toHaveText(LEGACY_NOTICE);
    await expect(page.getByText(sampleOrder.productDescription)).toBeVisible();
    await expect(page.getByRole('heading', { name: '交易双方', exact: true })).toBeVisible();
    await expect(page.getByText('图书馆东门')).toBeVisible();
    await expect(page.getByText('当前售价：¥99.00 · 淮南校区')).toBeVisible();
    await expect(page.getByText('¥88.00', { exact: true })).toHaveCount(2);
    await expect(page.getByText('接受改约', { exact: true })).toBeVisible();
    await expect(page.getByText('待面交 → 已过期', { exact: true })).toBeVisible();
    await expect(page.getByText('暂无交易评价')).toBeVisible();
    await expectNoWriteAffordances(page);
    await page.screenshot({ path: testInfo.outputPath('order-details.png'), fullPage: true });
    await page.reload();
    await expect(page.getByText(sampleOrder.productDescription)).toBeVisible();
    await page.getByRole('link', { name: '返回历史订单' }).click();
    await page.getByRole('link', { name: '详情', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${sampleOrder.id}/show$`));
    // 没有注册编辑和新建视图：react-admin 对未注册的子路径回落到只读列表，不会出现编辑或新建表单
    for (const path of [`/admin/orders/${sampleOrder.id}`, '/admin/orders/create']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: '历史订单（只读）', level: 1 })).toBeVisible();
        await expect(page.getByRole('note', { name: '历史订单说明' })).toHaveText(LEGACY_NOTICE);
        await expect(page.getByText(sampleOrder.productTitle, { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: '历史订单详情' })).toHaveCount(0);
        await expect(page.getByRole('textbox')).toHaveCount(1);
        await expect(page.getByRole('textbox', { name: '搜索订单、商品、买家或卖家' })).toBeVisible();
        await expectNoWriteAffordances(page);
    }
    expect(requests.filter(request => request.path.startsWith('/v1/admin/orders') && request.method !== 'GET')).toEqual([]);
});

test('手机订单详情正常换行，旧快照空值及取消说明、评价正确展示', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAdmin(page);
    await page.route(`**/v1/admin/orders/${sampleOrder.id}`, route => route.fulfill({ json: { code: 0, data: {
        ...sampleOrder, status: 'CANCELLED', priceSnapshot: null, categorySnapshot: null, conditionSnapshot: null, listingKindSnapshot: null, meetingEndsAt: null,
        cancellation: { actorId: 'buyer-1', reasonCode: 'SCHEDULE_CONFLICT', phase: 'AFTER_SELLER_CONFIRM', note: '临时调整面交安排', createdAt: sampleOrder.updatedAt },
        reviews: [{ id: 'review-1', reviewerId: 'buyer-1', reviewerNickname: '明月', rating: 5, comment: '沟通及时，态度友好', createdAt: sampleOrder.updatedAt }],
    } } }));
    await page.goto(`/admin/orders/${sampleOrder.id}/show`);
    await expect(page.getByRole('note', { name: '历史订单说明' })).toBeVisible();
    await expect(page.getByText('临时调整面交安排')).toBeVisible();
    await expect(page.getByText('沟通及时，态度友好')).toBeVisible();
    await expect(page.getByText('时间冲突', { exact: true })).toBeVisible();
    await expect(page.getByText('未记录', { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('mobile-order-details.png'), fullPage: true });
});


test('商品管理支持筛选、完整详情、编辑确认与操作历史', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { writes, queries } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await expect(page.getByText('清风')).toBeVisible();
    await page.getByRole('combobox', { name: '展示管理' }).click();
    await page.getByRole('option', { name: '正常展示' }).click();
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.get('moderationHidden')).toBe('false');
    await page.screenshot({ path: testInfo.outputPath('product-catalog.png'), fullPage: true });
    await page.getByRole('link', { name: '管理详情' }).first().click();
    await expect(page.getByText(sampleProduct.description, { exact: true })).toBeVisible();
    await expect(page.getByText('校园账号：20250016')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('product-management.png'), fullPage: true });
    await page.getByRole('button', { name: '编辑商品', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('商品标题').fill('Kindle 阅读器 · 已核实');
    await dialog.getByLabel('商品价格（元）').fill('260.50');
    await dialog.getByLabel('操作原因').fill('核实商品描述和当前售价');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    expect(writes).toHaveLength(0);
    await expect(dialog.getByText('价格：¥280.00 → ¥260.50')).toBeVisible();
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('核实商品描述和当前售价', { exact: true })).toBeVisible();
    expect(writes[0]).toMatchObject({ title: 'Kindle 阅读器 · 已核实', price: 260.5, version: 'product-v1' });
});

test('商品下架和恢复需要填写原因并确认，失败后可重试', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    await page.goto('/admin/products/p-1/show');
    await page.getByRole('button', { name: '管理下架', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: '预览变更' })).toBeDisabled();
    await dialog.getByLabel('操作原因').fill('商品信息待核实');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    expect(writes).toHaveLength(0);
    let first = true;
    await page.route('**/v1/admin/products/p-1/visibility', async route => {
        if (first) { first = false; await route.fulfill({ status: 503, json: { code: 503, message: '保存暂时失败' } }); }
        else await route.fallback();
    });
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog.getByText('保存暂时失败')).toBeVisible();
    await expect(dialog.getByLabel('操作原因')).toHaveValue('商品信息待核实');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '恢复展示', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('操作原因').fill('核实后恢复展示');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '管理下架', exact: true })).toBeVisible();
    expect(writes.map(write => write.action)).toEqual(['HIDE_PRODUCT', 'RESTORE_PRODUCT']);
});

test('只读角色不能编辑商品，手机详情不溢出', async ({ page }, testInfo) => {
    await mockAdmin(page, ['products:read']);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/products/p-1/show');
    await expect(page.getByText('当前角色可查看商品', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑商品', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '管理下架', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('mobile-product-management.png'), fullPage: true });
});

test('商品编辑新规则：只有已售出的商品不能编辑，后端拒绝信息原样展示，状态筛选不再有预约中', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await page.getByRole('combobox', { name: '商品状态' }).click();
    await expect(page.getByRole('option').filter({ hasText: /\S/ })).toHaveText(['在售', '已售出', '已下架']);
    await page.keyboard.press('Escape');
    let status = '已售出';
    await page.route('**/v1/admin/products/p-1', async route => {
        if (route.request().method() === 'PATCH') { await route.fulfill({ status: 409, json: { code: 409, message: '已售出的商品不能编辑' } }); return; }
        await route.fulfill({ json: { code: 0, data: { ...sampleProduct, status } } });
    });
    await page.goto('/admin/products/p-1/show');
    await expect(page.getByRole('button', { name: '编辑商品', exact: true })).toBeDisabled();
    await expect(page.getByText('已售出的商品不能编辑，仍可进行展示管理。')).toBeVisible();
    await expect(page.getByRole('button', { name: '管理下架', exact: true })).toBeEnabled();
    await expect(page.getByText(/预约中/)).toHaveCount(0);
    // 卖家刚刚把商品标为已售出：页面还是在售，提交时后端拒绝，界面原样显示后端信息
    status = '在售';
    await page.reload();
    await expect(page.getByText('已售出的商品不能编辑，仍可进行展示管理。')).toHaveCount(0);
    await page.getByRole('button', { name: '编辑商品', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('操作原因').fill('核实商品描述');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog.getByText('已售出的商品不能编辑')).toBeVisible();
    expect(writes).toHaveLength(0);
});

test('治理：处理动作提供「限制申请联系方式」，不提供已停用的预约与爽约动作；历史记录与申诉标注历史', async ({ page }) => {
    await mockAdmin(page);
    const decisions: unknown[] = [];
    const caseRecord = {
        id: 'c-1', targetType: 'USER', target: { label: '骚扰同学的用户' }, status: 'OPEN', reportCount: 1, createdAt: '2026-10-08T02:00:00Z',
        // 模拟旧版后端仍返回已停用动作：界面不能提供它们
        allowedActions: ['RESTRICT_CONTACT', 'RESTRICT_BOOKING', 'CONFIRM_NO_SHOW', 'REJECT_NO_SHOW', 'RESTRICT_PUBLISHING', 'NO_ACTION'],
        reports: [{ id: 'r-1', reasonCode: 'HARASSMENT', note: '多次骚扰', createdAt: Date.parse('2026-10-08T02:00:00Z') }],
        actions: [
            { id: 'a-1', actionCode: 'RESTRICT_BOOKING', reasonCode: 'FRAUD_RISK', effective: false, createdAt: Date.parse('2026-09-01T00:00:00Z') },
            { id: 'a-2', actionCode: 'CONFIRM_NO_SHOW', reasonCode: 'CONFIRMED_NO_SHOW', effective: false, createdAt: Date.parse('2026-09-02T00:00:00Z') },
        ],
    };
    await page.route('**/v1/admin/cases/c-1**', async route => {
        if (route.request().method() === 'POST') { decisions.push(route.request().postDataJSON()); await route.fulfill({ json: { code: 0, data: { ...caseRecord, status: 'RESOLVED', allowedActions: [] } } }); return; }
        await route.fulfill({ json: { code: 0, data: caseRecord } });
    });
    await page.route(url => url.pathname === '/v1/admin/appeals', route => route.fulfill({ json: { code: 0, data: { items: [
        { id: 'ap-1', reason: '限制过重', status: 'PENDING', decidable: false, createdAt: Date.parse('2026-10-09T00:00:00Z'), subject: { kind: 'RESTRICTION', scope: 'CONTACT' } },
        { id: 'ap-2', reason: '旧限制', status: 'PENDING', decidable: false, createdAt: Date.parse('2026-10-01T00:00:00Z'), subject: { kind: 'RESTRICTION', scope: 'BOOKING' } },
        { id: 'ap-3', reason: '旧爽约', status: 'PENDING', decidable: false, createdAt: Date.parse('2026-09-30T00:00:00Z'), subject: { kind: 'ACTION', actionCode: 'CONFIRM_NO_SHOW' } },
    ], total: 3 } } }));
    await page.goto('/admin/cases/c-1/show');
    await expect(page.getByText('限制预约新订单（历史）', { exact: true })).toBeVisible();
    await expect(page.getByText('确认爽约（历史）', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('骚扰', { exact: true })).toBeVisible();
    await expect(page.getByText(/RESTRICT_BOOKING|CONFIRM_NO_SHOW/)).toHaveCount(0);
    await page.goto('/admin/cases/c-1');
    await page.getByRole('combobox', { name: '处理动作' }).click();
    await expect(page.getByRole('option').filter({ hasText: /\S/ })).toHaveText(['限制申请联系方式', '限制发布', '不采取措施']);
    await page.getByRole('option', { name: '限制申请联系方式' }).click();
    await page.getByRole('combobox', { name: '处理原因' }).click();
    await expect(page.getByRole('option', { name: /爽约/ })).toHaveCount(0);
    await page.getByRole('option', { name: '骚扰' }).click();
    await page.getByLabel('限制时长（小时，仅限制类动作需要）').fill('24');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ action: 'RESTRICT_CONTACT', reasonCode: 'HARASSMENT', durationHours: 24 });
    await page.goto('/admin/appeals');
    await expect(page.getByRole('cell', { name: '申请联系方式', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '预约新订单（历史）', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '确认爽约（历史）', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^(CONTACT|BOOKING|CONFIRM_NO_SHOW)$/ })).toHaveCount(0);
});

// ───────────── 阶段 2：后台安全 ─────────────

test('阶段 2：授予学校管理员只提交复核请求，表单显示「已提交，需要另一位学校管理员确认后生效」，不宣称已更新', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1120 });
    const { writes, requests } = await mockAdmin(page);
    await page.goto('/admin/users/staff-1');
    await page.getByRole('combobox', { name: '后台角色' }).click();
    await page.getByRole('option', { name: '学校管理员' }).click();
    await expect(page.getByText('保存后只提交复核请求，需要另一位学校管理员确认后生效')).toBeVisible();
    await page.getByLabel('授权或停用原因').fill('新学期增加一名学校管理员');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认工作人员权限变更' });
    await expect(dialog.getByText('这项变更涉及学校管理员：提交后不会立即生效')).toBeVisible();
    await dialog.getByRole('button', { name: '提交复核请求' }).click();
    await expect(dialog).toHaveCount(0);
    const notice = page.getByRole('status', { name: '待确认的人员变更' });
    await expect(notice).toContainText('已提交，需要另一位学校管理员确认后生效');
    await expect(notice).toContainText('审核员 · 启用 → 学校管理员 · 启用');
    await expect(page.getByText('工作人员权限已更新')).toHaveCount(0);
    await expect(page).toHaveURL(/\/users\/staff-1$/);
    expect(writes).toEqual([{ role: 'SCHOOL_ADMIN', active: true, note: '新学期增加一名学校管理员' }]);
    expect(requests.filter(request => request.method === 'PATCH').map(request => request.path)).toEqual(['/v1/admin/users/staff-1/staff']);
    await page.screenshot({ path: testInfo.outputPath('staff-pending-role-request.png'), fullPage: true });
    await notice.getByRole('link', { name: '查看复核请求' }).click();
    await expect(page).toHaveURL(/\/role-requests\/rr-new\/show$/);
    await expect(page.getByRole('heading', { name: '人员变更复核详情' })).toBeVisible();
    await expect(page.getByText('新学期增加一名学校管理员')).toBeVisible();
});

test('阶段 2：人员授权的 409 信息原样显示在确认框中', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    const messages = ['该用户已有一条待确认的学校管理员变更，请先处理', '这是本校最后一名学校管理员，不能降级或停用'];
    let attempt = 0;
    await page.route('**/v1/admin/users/staff-1/staff', route => route.fulfill({ status: 409, json: { code: 409, message: messages[attempt++] } }));
    await page.goto('/admin/users/staff-1');
    await page.getByRole('combobox', { name: '后台角色' }).click();
    await page.getByRole('option', { name: '学校管理员' }).click();
    await page.getByLabel('授权或停用原因').fill('再次提交');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认工作人员权限变更' });
    for (const message of messages) {
        await dialog.getByRole('button', { name: '提交复核请求' }).click();
        await expect(dialog.getByText(message, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('已提交，需要另一位学校管理员确认后生效')).toHaveCount(0);
    expect(writes).toHaveLength(0);
});

test('阶段 2：人员变更复核列表默认待确认，另一位学校管理员填写理由后确认 / 驳回，请求路径与请求体准确', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { queries, decisions } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '人员变更复核' }).click();
    await expect(page.getByRole('heading', { name: '人员变更复核', level: 1 })).toBeVisible();
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/role-requests').at(-1)?.searchParams.get('status')).toBe('PENDING');
    for (const header of ['目标', '变更前 → 变更后', '发起人', '说明', '状态', '到期时间']) await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '无后台角色 · 停用 → 学校管理员 · 启用' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '学校管理员 · 启用 → 只读审计员 · 启用' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '李主任' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '待确认', exact: true })).toHaveCount(2);
    await expect(page.getByText('孙老师')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('role-requests-list.png'), fullPage: true });
    await page.getByText('王老师').click();
    await expect(page).toHaveURL(/\/role-requests\/rr-1\/show$/);
    await expect(page.getByRole('button', { name: '撤回', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '确认生效', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '确认这条人员变更' });
    await expect(dialog.getByRole('button', { name: '确认并生效' })).toBeDisabled();
    await dialog.getByLabel('确认理由').fill('   ');
    await expect(dialog.getByRole('button', { name: '确认并生效' })).toBeDisabled();
    await dialog.getByLabel('确认理由').fill('  已当面核实任命文件  ');
    await dialog.getByRole('button', { name: '确认并生效' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已确认生效').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '确认生效', exact: true })).toHaveCount(0);
    await page.goto('/admin/role-requests/rr-2/show');
    await page.getByRole('button', { name: '驳回', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '驳回这条人员变更' });
    await expect(dialog.getByRole('button', { name: '确认驳回' })).toBeDisabled();
    await dialog.getByLabel('驳回理由').fill('需要先完成交接');
    await dialog.getByRole('button', { name: '确认驳回' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已驳回', { exact: true }).first()).toBeVisible();
    expect(decisions).toEqual([
        { path: '/v1/admin/role-requests/rr-1/approve', body: JSON.stringify({ note: '已当面核实任命文件' }) },
        { path: '/v1/admin/role-requests/rr-2/reject', body: JSON.stringify({ note: '需要先完成交接' }) },
    ]);
});

test('阶段 2：发起人不能确认或驳回自己的请求，只能撤回（不填说明时不发请求体）', async ({ page }) => {
    const { decisions } = await mockAdmin(page, adminPermissions, { id: 'admin-2' });
    await page.goto('/admin/role-requests/rr-1/show');
    await expect(page.getByRole('button', { name: '确认生效', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '驳回', exact: true })).toBeDisabled();
    await expect(page.getByText('不能确认自己发起的变更，需要另一位学校管理员确认', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '撤回', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '撤回这条人员变更' });
    await expect(dialog.getByRole('button', { name: '确认撤回' })).toBeEnabled();
    await dialog.getByRole('button', { name: '确认撤回' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已撤回', { exact: true }).first()).toBeVisible();
    expect(decisions).toEqual([{ path: '/v1/admin/role-requests/rr-1/cancel', body: null }]);
    // 同一发起人的另一条请求同样只能撤回
    await page.goto('/admin/role-requests/rr-2/show');
    await expect(page.getByRole('button', { name: '撤回', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '确认生效', exact: true })).toBeDisabled();
});

test('阶段 2：另一位学校管理员确认时后端拒绝（409 / 403），信息原样显示在确认框', async ({ page }) => {
    const { decisions } = await mockAdmin(page);
    const failures = [
        { status: 409, message: '目标账号的后台权限在发起后已经变化，请驳回后重新发起' },
        { status: 409, message: '这条复核请求已过期，请重新发起' },
        { status: 403, message: '不能确认自己发起的变更，需要另一位学校管理员确认' },
    ];
    let attempt = 0;
    await page.route('**/v1/admin/role-requests/rr-1/approve', route => { const failure = failures[attempt++]; return route.fulfill({ status: failure.status, json: { code: failure.status, message: failure.message } }); });
    await page.goto('/admin/role-requests/rr-1/show');
    await page.getByRole('button', { name: '确认生效', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认这条人员变更' });
    await dialog.getByLabel('确认理由').fill('核实');
    for (const failure of failures) {
        await dialog.getByRole('button', { name: '确认并生效' }).click();
        await expect(dialog.getByText(failure.message, { exact: true })).toBeVisible();
    }
    expect(attempt).toBe(3);
    expect(decisions).toEqual([]);
});

test('阶段 2：只读审计员看到复核与读取审计菜单；读取审计列表显示中文资源名与「含搜索词（只存哈希）」，没有详情页；复核请求只读', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { queries, requests } = await mockAdmin(page, auditorPermissions, { id: 'auditor-1', role: 'AUDITOR' });
    await expect(page.getByRole('menuitem', { name: '人员变更复核' })).toBeVisible();
    await page.getByRole('menuitem', { name: '读取审计' }).click();
    await expect(page.getByRole('heading', { name: '读取审计', level: 1 })).toBeVisible();
    for (const header of ['工作人员', '读取内容', '记录编号', '返回条数', '搜索条件', '请求编号']) await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
    // 时间列可排序，表头的可访问名称带排序说明
    await expect(page.getByRole('columnheader', { name: /时间/ })).toBeVisible();
    for (const label of ['用户', '历史订单', '人员变更复核', '读取审计']) await expect(page.getByRole('cell', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '含搜索词（只存哈希）', exact: true })).toHaveCount(1);
    await expect(page.getByRole('cell', { name: /^(users|orders|role-requests|read-audit)$/ })).toHaveCount(0);
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/read-audit').at(-1)?.searchParams.get('sort')).toBe('createdAt');
    await page.screenshot({ path: testInfo.outputPath('read-audit-list.png'), fullPage: true });
    await page.getByRole('cell', { name: '周审计' }).first().click();
    await expect(page).toHaveURL(/\/read-audit(\?.*)?$/);
    expect(requests.some(request => /^\/v1\/admin\/read-audit\/.+/.test(request.path))).toBe(false);
    await page.goto('/admin/role-requests/rr-1/show');
    await expect(page.getByText('确认、驳回或撤回人员变更需要学校管理员权限', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /确认生效|驳回|撤回/ })).toHaveCount(0);
});

test('阶段 2：审核员看不到人员变更复核与读取审计菜单', async ({ page }) => {
    const { queries } = await mockAdmin(page, seniorModeratorPermissions, { role: 'MODERATOR' });
    await expect(page.getByRole('menuitem', { name: '治理案件' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '人员变更复核' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: '读取审计' })).toHaveCount(0);
    expect(queries.some(url => /\/admin\/(role-requests|read-audit)$/.test(url.pathname))).toBe(false);
});

test('阶段 2：高级审核员没有用户、历史订单、授权审计菜单，也不能编辑商品', async ({ page }) => {
    const { queries, writes } = await mockAdmin(page, seniorModeratorPermissions, { id: 'senior-1', role: 'SENIOR_MODERATOR' });
    for (const name of ['商品目录', '治理案件', '用户申诉']) await expect(page.getByRole('menuitem', { name })).toBeVisible();
    for (const name of ['用户与工作人员', '历史订单（只读）', '授权审计', '人员变更复核', '读取审计', '角色权限']) await expect(page.getByRole('menuitem', { name })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /校园用户/ })).toHaveCount(0);
    expect(queries.some(url => /\/admin\/(users|orders|audit|role-requests|read-audit)$/.test(url.pathname))).toBe(false);
    await page.goto('/admin/products/p-1/show');
    await expect(page.getByText(sampleProduct.description, { exact: true })).toBeVisible();
    await expect(page.getByText('当前角色可查看商品，信息编辑和展示管理需要学校管理员权限。')).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑商品', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '管理下架', exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(0);
});

test('阶段 2：商品编辑与展示管理被利益回避拒绝（CONTACT_PARTY）时显示后端信息与「你申请过这件商品的联系方式」', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    const conflict = { status: 403, json: { code: 403, message: '这件商品与你本人有关，需要由其他工作人员管理', data: { code: 'CONFLICT_OF_INTEREST', reason: 'CONTACT_PARTY' } } };
    await page.route('**/v1/admin/products/p-1', route => route.request().method() === 'PATCH' ? route.fulfill(conflict) : route.fallback());
    await page.route('**/v1/admin/products/p-1/visibility', route => route.fulfill(conflict));
    await page.goto('/admin/products/p-1/show');
    for (const action of ['编辑商品', '管理下架']) {
        await page.getByRole('button', { name: action, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('操作原因').fill('核实商品信息');
        await dialog.getByRole('button', { name: '预览变更' }).click();
        await dialog.getByRole('button', { name: '确认提交' }).click();
        await expect(dialog.getByText('这件商品与你本人有关，需要由其他工作人员管理（回避原因：你申请过这件商品的联系方式）', { exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: '取消' }).click();
        await expect(dialog).toHaveCount(0);
    }
    expect(writes).toHaveLength(0);
});

test('阶段 2：后台限流 429 按 Retry-After 提示多久后重试', async ({ page }) => {
    const { writes } = await mockAdmin(page);
    await page.route('**/v1/admin/products/p-1/visibility', route => route.fulfill({ status: 429, headers: { 'Retry-After': '120' }, json: { code: 429, message: '请求过于频繁，请稍后再试' } }));
    await page.goto('/admin/products/p-1/show');
    await page.getByRole('button', { name: '管理下架', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('操作原因').fill('核实商品信息');
    await dialog.getByRole('button', { name: '预览变更' }).click();
    await dialog.getByRole('button', { name: '确认提交' }).click();
    await expect(dialog.getByText('操作过于频繁，请在 2 分钟后重试', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
    // 列表读取被限流：通知同样使用 Retry-After
    await page.route('**/v1/admin/users?*', route => route.fulfill({ status: 429, headers: { 'Retry-After': '45' }, json: { code: 429, message: '请求过于频繁，请稍后再试' } }));
    await page.goto('/admin/users');
    await expect(page.getByText('操作过于频繁，请在 45 秒后重试')).toBeVisible();
});

// ───────────── 阶段 3：人工找回密码与已注销账号 ─────────────

test('阶段 3：签发重置码需要填写身份核对说明，重置码只显示一次，可复制，关闭后页面与浏览器存储都不保留', async ({ page }, testInfo) => {
    const consoleText: string[] = [];
    page.on('console', message => consoleText.push(message.text()));
    // 记录复制到剪贴板的内容（无头浏览器不提供系统剪贴板）
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string[] }).copied = [...((window as unknown as { copied?: string[] }).copied ?? []), text]; } } });
    });
    const { resets } = await mockAdmin(page);
    await page.goto('/admin/users/staff-1/show');
    await expect(page.getByText('林小雨').first()).toBeVisible();
    await page.getByRole('button', { name: '签发重置码' }).click();
    const confirm = page.getByRole('dialog', { name: '为「林小雨」签发重置码' });
    await expect(confirm.getByRole('button', { name: '确认签发' })).toBeDisabled();
    await confirm.getByLabel('身份核对说明').fill('   ');
    await expect(confirm.getByRole('button', { name: '确认签发' })).toBeDisabled();
    expect(resets).toHaveLength(0);
    await confirm.getByLabel('身份核对说明').fill('  本人持学生证到办公室，已核对照片与学号  ');
    await confirm.getByRole('button', { name: '确认签发' }).click();
    const dialog = page.getByRole('dialog', { name: '重置码已签发' });
    await expect(dialog.getByLabel('重置码')).toHaveText('K7QD-2M9X-4PZA');
    await expect(dialog.getByRole('alert')).toHaveText('只显示这一次；请在线下核对身份后当面交给本人；30 分钟内有效，最多 5 次错误；重新签发会让旧码作废');
    await expect(page.getByText('K7QD-2M9X-4PZA')).toHaveCount(1);
    expect(resets).toEqual([{ path: '/v1/admin/users/staff-1/password-reset', body: JSON.stringify({ note: '本人持学生证到办公室，已核对照片与学号' }) }]);
    await page.screenshot({ path: testInfo.outputPath('password-reset-code.png'), fullPage: true });
    await dialog.getByRole('button', { name: '复制重置码' }).click();
    await expect(dialog.getByText('已复制，请当面交给本人')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { copied?: string[] }).copied)).toEqual(['K7QD-2M9X-4PZA']);
    // 点击背景不会误关
    await page.mouse.click(5, 5);
    await expect(dialog.getByLabel('重置码')).toBeVisible();
    await dialog.getByRole('button', { name: '我已记下，关闭' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('K7QD-2M9X-4PZA')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML.includes('K7QD-2M9X-4PZA'))).toBe(false);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('K7QD');
    expect(consoleText.join('\n')).not.toContain('K7QD');
    // 再次打开回到确认步骤（说明清空），不会再显示旧码；重新签发得到新码
    await page.getByRole('button', { name: '签发重置码' }).click();
    await expect(confirm.getByLabel('身份核对说明')).toHaveValue('');
    await expect(page.getByText('K7QD-2M9X-4PZA')).toHaveCount(0);
    await confirm.getByLabel('身份核对说明').fill('再次核对学生证');
    await confirm.getByRole('button', { name: '确认签发' }).click();
    await expect(dialog.getByLabel('重置码')).toHaveText('R3NB-8WUE-6TCH');
    await dialog.getByRole('button', { name: '我已记下，关闭' }).click();
    await expect(page.getByText('R3NB-8WUE-6TCH')).toHaveCount(0);
    expect(resets).toHaveLength(2);
});

test('阶段 3：签发失败的信息原样显示，不显示重置码', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/v1/admin/users/staff-1/password-reset', route => route.fulfill({ status: 403, json: { code: 403, message: '不能为自己签发重置码，请由其他学校管理员处理' } }));
    await page.goto('/admin/users/staff-1/show');
    await page.getByRole('button', { name: '签发重置码' }).click();
    const confirm = page.getByRole('dialog', { name: '为「林小雨」签发重置码' });
    await confirm.getByLabel('身份核对说明').fill('核对学生证');
    await confirm.getByRole('button', { name: '确认签发' }).click();
    await expect(confirm.getByText('不能为自己签发重置码，请由其他学校管理员处理', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '重置码已签发' })).toHaveCount(0);
});

test('阶段 3：自己的账号没有「签发重置码」；已注销账号显示「已注销」且没有配置权限与签发入口', async ({ page }) => {
    const { requests } = await mockAdmin(page);
    await page.goto('/admin/users/admin-1/show');
    await expect(page.getByText('陈予安').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '签发重置码' })).toHaveCount(0);
    await page.goto('/admin/users');
    const deletedRow = page.getByRole('row').filter({ hasText: 'deleted-gone-1' });
    await expect(deletedRow.getByText('已注销', { exact: true })).toBeVisible();
    await expect(deletedRow.getByRole('link', { name: '配置权限' })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: '林小雨' }).getByRole('link', { name: '配置权限' })).toBeVisible();
    await page.goto('/admin/users/gone-1/show');
    await expect(page.getByText('deleted-gone-1')).toBeVisible();
    await expect(page.getByText('已注销', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '签发重置码' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /配置权限|编辑/ })).toHaveCount(0);
    await page.goto('/admin/users/gone-1');
    await expect(page.getByText('该账号已注销，不能授予后台权限。')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
    expect(requests.filter(request => request.method !== 'GET' && request.path.startsWith('/v1/admin/'))).toEqual([]);
});

test('阶段 3：只读审计员看不到签发重置码', async ({ page }) => {
    await mockAdmin(page, auditorPermissions, { id: 'auditor-1', role: 'AUDITOR' });
    await page.goto('/admin/users/staff-1/show');
    await expect(page.getByText('林小雨').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '签发重置码' })).toHaveCount(0);
});

// ───────────── 校区数据驱动：GET /v1/schools ─────────────

const schoolRequests = (requests: { method: string; path: string }[]) => requests.filter(request => request.path === '/v1/schools').length;

test('校区：商品、历史订单、用户与权限页显示校区名称，隐藏学校显示原始编号，站内跳转只请求一次 /v1/schools', async ({ page }) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { requests } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await expect(page.getByRole('row').filter({ hasText: sampleProduct.title }).getByText('淮南校区', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '高等数学教材' }).getByText('合肥校区', { exact: true })).toBeVisible();
    // 隐藏的演示学校 pilot：目录里没有，显示原始编号
    await expect(page.getByRole('row').filter({ hasText: '宜家台灯，毕业低价转让' }).getByText('东校区', { exact: true })).toBeVisible();
    await expect(page.getByText(/aust-(huainan|hefei)/)).toHaveCount(0);
    await page.getByRole('row').filter({ hasText: sampleProduct.title }).getByRole('link', { name: '管理详情' }).click();
    await expect(page.getByText('数码电子 · 几乎全新 · 淮南校区', { exact: true })).toBeVisible();
    await expect(page.getByText('校区：淮南校区', { exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '历史订单（只读）' }).click();
    await expect(page.getByText('生活用品 · 淮南校区', { exact: true })).toBeVisible();
    await page.getByText(sampleOrder.productTitle, { exact: true }).click();
    await expect(page.getByText('当前售价：¥99.00 · 淮南校区')).toBeVisible();
    const buyer = page.locator('.order-party-detail').filter({ hasText: '明月' });
    await expect(buyer.locator('.order-info').filter({ hasText: '所在校区' })).toContainText('合肥校区');
    const seller = page.locator('.order-party-detail').filter({ hasText: '清风' });
    await expect(seller.locator('.order-info').filter({ hasText: '所在校区' })).toContainText('淮南校区');
    await expect(page.locator('.order-info').filter({ hasText: '面交校区' })).toContainText('淮南校区');
    await expect(page.getByText(/aust-(huainan|hefei)/)).toHaveCount(0);
    await page.getByRole('menuitem', { name: '用户与工作人员' }).click();
    await expect(page.getByRole('row').filter({ hasText: '林小雨' }).getByText('合肥校区', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'deleted-gone-1' }).getByText('淮南校区', { exact: true })).toBeVisible();
    await page.getByRole('row').filter({ hasText: '林小雨' }).getByText('林小雨').click();
    await expect(page).toHaveURL(/\/users\/staff-1\/show$/);
    await expect(page.getByText('合肥校区', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '配置权限' }).click();
    await expect(page.getByText('20260018 · 合肥校区', { exact: true })).toBeVisible();
    await expect(page.getByText(/aust-(huainan|hefei)/)).toHaveCount(0);
    expect(schoolRequests(requests)).toBe(1);
});

test('校区筛选：下拉只列本校校区名称，选择后按校区编号筛选', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1540, height: 1080 });
    const { queries } = await mockAdmin(page);
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await expect(page.getByRole('textbox', { name: /所在校区/ })).toHaveCount(0);
    await page.getByRole('combobox', { name: '所在校区' }).click();
    await expect(page.getByRole('option').filter({ hasText: /\S/ })).toHaveText(['淮南校区', '合肥校区']);
    await page.getByRole('option', { name: '合肥校区' }).click();
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.get('campus')).toBe('aust-hefei');
    await expect(page.getByRole('combobox', { name: '所在校区' })).toHaveText('合肥校区');
    expect(JSON.parse(new URL(page.url()).searchParams.get('filter') ?? '{}')).toMatchObject({ campus: 'aust-hefei' });
    await page.screenshot({ path: testInfo.outputPath('product-campus-filter.png'), fullPage: true });
    // 刷新后筛选仍显示名称、仍按编号查询
    await page.reload();
    await expect(page.getByRole('combobox', { name: '所在校区' })).toHaveText('合肥校区');
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.get('campus')).toBe('aust-hefei');
    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.has('campus')).toBe(false);
});

test('校区筛选：工作人员的学校不在目录中（隐藏的 pilot）时列出所有可见校区，并带学校简称区分', async ({ page }) => {
    const { queries } = await mockAdmin(page, adminPermissions, { schoolId: 'pilot' });
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await page.getByRole('combobox', { name: '所在校区' }).click();
    await expect(page.getByRole('option').filter({ hasText: /\S/ })).toHaveText(['安理 · 淮南校区', '安理 · 合肥校区', '合工大 · 屯溪路校区']);
    await page.getByRole('option', { name: '合工大 · 屯溪路校区' }).click();
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.get('campus')).toBe('hfut-tunxi');
});

test('学校目录读取失败：显示原始编号，筛选回落为自由输入的校区编号；失败不缓存，进入下一页重新读取后显示名称', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { queries, requests, setSchoolsAvailable } = await mockAdmin(page, adminPermissions, {}, { schoolsAvailable: false });
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await expect(page.getByRole('row').filter({ hasText: sampleProduct.title }).getByText('aust-huainan', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '高等数学教材' }).getByText('aust-hefei', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '所在校区' })).toHaveCount(0);
    const campusText = page.getByRole('textbox', { name: '所在校区（校区编号）' });
    await expect(campusText).toBeVisible();
    await campusText.fill('aust-hefei');
    await expect.poll(() => queries.filter(url => url.pathname === '/v1/admin/products').at(-1)?.searchParams.get('campus')).toBe('aust-hefei');
    const failedAttempts = schoolRequests(requests);
    expect(failedAttempts).toBeGreaterThanOrEqual(1);
    // 后端恢复：失败没有被缓存，打开详情页时重新读取并显示名称
    setSchoolsAvailable(true);
    await page.getByRole('row').filter({ hasText: sampleProduct.title }).getByRole('link', { name: '管理详情' }).click();
    await expect(page.getByText('校区：淮南校区', { exact: true })).toBeVisible();
    expect(schoolRequests(requests)).toBe(failedAttempts + 1);
    // 成功后缓存：回到列表显示名称与下拉，不再请求
    await page.getByRole('menuitem', { name: '商品目录' }).click();
    await expect(page.getByRole('combobox', { name: '所在校区' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: sampleProduct.title }).getByText('淮南校区', { exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '用户与工作人员' }).click();
    await expect(page.getByRole('row').filter({ hasText: '林小雨' }).getByText('合肥校区', { exact: true })).toBeVisible();
    expect(schoolRequests(requests)).toBe(failedAttempts + 1);
    expect(errors).toEqual([]);
});
