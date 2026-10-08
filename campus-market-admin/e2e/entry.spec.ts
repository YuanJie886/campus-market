import { test, expect } from '@playwright/test';

test('未登录访问后台与子页面、刷新均显示登录表单', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/v1/**', route => route.fulfill({
        status: 401, json: { code: 401, message: '请登录' },
    }));
    for (const path of ['/admin/', '/admin/users']) {
        await page.goto(path);
        await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/admin\/login$/);
        await page.reload();
        await expect(page.getByLabel('用户名', { exact: false })).toBeVisible();
    }
    expect(errors).toEqual([]);
});

test('后端不可用仍可打开登录页，提交时显示错误', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/v1/**', route => route.fulfill({
        status: 503, contentType: 'text/plain', body: 'Service unavailable',
    }));
    await page.goto('/admin/');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    await page.getByLabel('用户名', { exact: false }).fill('browser-test');
    await page.getByLabel(/^密码/).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('后端未返回有效 JSON，请检查服务与代理配置')).toBeVisible();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
});

test('登录后菜单、直接访问资源及刷新保留 /admin 路径', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let authenticated = false;
    await page.route('**/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/v1/auth/login') authenticated = true;
        if (!authenticated) {
            await route.fulfill({ status: 401, json: { code: 401, message: '请登录' } });
            return;
        }
        const data = path === '/v1/admin/me'
            ? { id: 'browser-admin', fullName: '测试管理员', schoolId: 'test-school', role: 'SCHOOL_ADMIN', permissions: ['users:read', 'users:write', 'products:read'] }
            : path.startsWith('/v1/auth/')
                ? { accessToken: 'browser-only-token', expiresAtIso: '2099-01-01' }
                : { items: [{ id: 'browser-user', nickname: '测试同学', account: 'test-account', campus: '测试校区', active: true, createdAt: '2026-10-08T00:00:00Z' }], total: 1 };
        await route.fulfill({ json: { code: 0, data } });
    });
    await page.goto('/admin/');
    await page.getByLabel('用户名', { exact: false }).fill('browser-test');
    await page.getByLabel(/^密码/).fill('browser-test-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('校园集市运营工作台')).toBeVisible();
    await page.getByRole('menuitem', { name: '用户与工作人员' }).click();
    await expect(page).toHaveURL(/\/admin\/users(?:\?|$)/);
    await expect(page.getByText('测试同学')).toBeVisible();
    await page.reload();
    await expect(page.getByText('测试同学')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '用户与工作人员' })).toHaveAttribute('href', '/admin/users');
    expect(errors).toEqual([]);
});
