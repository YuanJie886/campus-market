import { test, expect, type Page } from '@playwright/test';

const read = ['users', 'products', 'orders', 'cases', 'appeals', 'audit', 'roles'].map(resource => `${resource}:read`);
const adminPermissions = [...read, 'users:write', 'cases:write', 'appeals:write'];
const sampleOrder = {
    id: '674aad03-c000-4150-b075-42a38b1bcc61', productId: '9405904a-97d5-4e51-8e6b-2bd8b143b190',
    productTitle: '宜家台灯 · 宿舍阅读灯', productCategory: '生活用品', productCampus: '主校区', productCondition: '几乎全新', productListingKind: 'SINGLE', productStatus: '预约中',
    productDescription: '暖光护眼台灯，使用一个学期，功能完好。附带原装电源线，适合宿舍阅读。', productImages: [],
    productCurrentPrice: 99, price: 88, priceSnapshot: 88, currency: 'CNY', categorySnapshot: '生活用品', conditionSnapshot: '几乎全新', listingKindSnapshot: 'SINGLE',
    buyerId: 'buyer-1', buyerNickname: '明月', buyerAccount: '20260021', buyerCampus: '主校区',
    sellerId: 'seller-1', sellerNickname: '清风', sellerAccount: '20250016', sellerCampus: '主校区',
    status: 'PENDING_MEETING', meetingPointId: 'main-library', meetingPointName: '图书馆东门', meetingCampus: '主校区',
    meetingAt: Date.parse('2026-10-09T06:00:00Z'), meetingEndsAt: Date.parse('2026-10-09T06:30:00Z'), meetingRevision: 1,
    createdAt: Date.parse('2026-10-08T02:00:00Z'), updatedAt: Date.parse('2026-10-08T03:00:00Z'), expiresAt: Date.parse('2026-10-09T02:00:00Z'),
    events: [
        { id: 'event-1', actorId: 'buyer-1', actorNickname: '明月', eventCode: 'STATUS_CHANGED', toStatus: 'PENDING_SELLER_CONFIRM', createdAt: Date.parse('2026-10-08T02:00:00Z') },
        { id: 'event-2', actorId: 'seller-1', actorNickname: '清风', eventCode: 'STATUS_CHANGED', fromStatus: 'PENDING_SELLER_CONFIRM', toStatus: 'PENDING_MEETING', createdAt: Date.parse('2026-10-08T02:30:00Z') },
        { id: 'event-3', actorId: 'buyer-1', actorNickname: '明月', eventCode: 'MEETING_PROPOSED', meetingRevision: 1, createdAt: Date.parse('2026-10-08T02:45:00Z') },
        { id: 'event-4', actorId: 'seller-1', actorNickname: '清风', eventCode: 'MEETING_ACCEPTED', meetingRevision: 1, createdAt: Date.parse('2026-10-08T03:00:00Z') },
    ], reviews: [], bundleItems: [], cancellation: null,
};
async function mockAdmin(page: Page, permissions = adminPermissions) {
    let authenticated = false;
    const writes: Record<string, unknown>[] = [];
    const queries: URL[] = [];
    let user = { id: 'staff-1', nickname: '林小雨', account: '20260018', campus: '主校区', role: 'MODERATOR', active: true, createdAt: '2026-10-01T08:00:00Z' };
    await page.route('**/v1/**', async route => {
        const url = new URL(route.request().url()); const path = url.pathname;
        queries.push(url);
        if (path === '/v1/auth/login') authenticated = true;
        if (!authenticated) { await route.fulfill({ status: 401, json: { code: 401, message: '请登录' } }); return; }
        let data: unknown;
        if (path.startsWith('/v1/auth/')) data = { accessToken: 'ui-test-only', expiresAtIso: '2099-01-01' };
        else if (path === '/v1/admin/me') data = { id: 'admin-1', fullName: '陈予安', schoolId: 'school-1', role: permissions.includes('users:write') ? 'SCHOOL_ADMIN' : 'AUDITOR', permissions };
        else if (path.endsWith('/staff')) {
            const payload = route.request().postDataJSON(); writes.push(payload);
            user = { ...user, ...payload }; data = user;
        }
        else if (path === '/v1/admin/users/staff-1') data = user;
        else if (path === '/v1/admin/users/admin-1') data = { ...user, id: 'admin-1', nickname: '陈予安', role: 'SCHOOL_ADMIN' };
        else if (path === '/v1/admin/users') data = { items: [user], total: 1286 };
        else if (path === '/v1/admin/products') data = { items: [
            { id: 'p-1', title: '九成新 Kindle Paperwhite', category: '数码电子', price: 280, status: '在售', campus: '主校区', moderationHidden: false, createdAt: '2026-10-08T02:20:00Z' },
            { id: 'p-2', title: '高等数学教材 · 同济第八版', category: '书籍教材', price: 25, status: '预约中', campus: '主校区', moderationHidden: false, createdAt: '2026-10-08T01:30:00Z' },
            { id: 'p-3', title: '宜家台灯，毕业低价转让', category: '生活用品', price: 45, status: '在售', campus: '主校区', moderationHidden: false, createdAt: '2026-10-07T11:40:00Z' },
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
    return { writes, queries };
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
