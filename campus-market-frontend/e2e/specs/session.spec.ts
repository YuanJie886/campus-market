import { apiOk, expect, open, test } from '../fixtures';

/** 8.1 #13 浏览器刷新登录恢复；#14 直接打开商品详情无 Hook 错误；SPA 深链接刷新 */

const single = (title: string) => ({
  title, description: 'E2E 商品', price: 25, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

test('#13 界面注册 → 刷新后登录恢复（刷新 Cookie：HttpOnly + SameSite=Strict + 仅 /v1/auth；本地 http 不带 Secure）；令牌不落浏览器存储', async ({ browser, secrets }) => {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByText('登录后查看本校在售好物')).toBeVisible();
  await page.goto('/register');
  const account = `ui${Date.now().toString(36)}`.slice(0, 16);
  const password = `pw-${Math.random().toString(36).slice(2, 12)}`;
  secrets.add(password);
  await page.getByLabel('学号 / 手机号').fill(account);
  await page.getByLabel('昵称').fill('界面注册');
  await page.getByLabel(/^密码/).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('button', { name: '用户菜单' })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === 'cm_refresh')!;
  secrets.add(cookie.value);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth', secure: false });
  await page.reload();
  await expect(page.getByRole('button', { name: '用户菜单' })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\./);
  expect(storage).not.toContain(cookie.value);
  await context.close();
});

test('#14 直接打开商品详情（冷启动、刷新）不出现 React Hook 错误；SPA 深链接刷新正常', async ({ party, consoleErrors }) => {
  const seller = await party('卖家');
  const product = await apiOk(seller, 'POST', '/v1/products', single(`E2E 直达 ${Date.now()}`));
  const viewer = await party('访客');
  await viewer.page.goto(`/product/${product.id}`);
  await expect(viewer.page.getByRole('heading', { name: product.title })).toBeVisible();
  await viewer.page.reload();
  await expect(viewer.page.getByRole('heading', { name: product.title })).toBeVisible();
  await open(viewer, '/profile/orders');
  await viewer.page.reload();
  await expect(viewer.page.getByRole('tab').first()).toBeVisible();
  const hookErrors = consoleErrors.filter((e) => /hook|Minified React error|Rendered (more|fewer) hooks/i.test(e));
  expect(hookErrors).toEqual([]);
});
