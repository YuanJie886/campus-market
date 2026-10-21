import { apiCall, apiOk, expect, makeStaff, open, sql, test } from '../fixtures';

/**
 * 阶段 3 账号生命周期（docs/account-lifecycle.md），真实后端 + 真实浏览器：
 *   #A1 修改密码：界面说明其他设备已退出；另一个设备的会话立即失效，当前设备保持登录；旧密码不能再登录；
 *   #A2 人工找回：学校管理员通过管理接口签发一次性重置码（与后端 AccountLifecycleIT 相同的 SQL 夹具配置 SCHOOL_ADMIN），
 *       用户在登录页「忘记密码？」进入找回页；错误的码显示统一的「账号或重置码无效或已过期」；小写、不带短横线的正确码可以重置；
 *       全部会话结束，新密码可以在界面登录；
 *   #A3 注销：在用圈子的所有者先得到 409 原话；归档后注销成功，回到首页并退出；商品下架、联系方式清除、资料匿名化，原账号不能登录。
 * 新密码与重置码都登记为敏感值，失败时从 trace 中替换掉。
 */

const single = (title: string) => ({
  title, description: 'E2E 账号生命周期', price: 18, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

test('#A1 修改密码：其他设备立即退出、当前设备保持登录；旧密码不能再登录', async ({ party, browser, secrets }) => {
  const me = await party('改密码');
  const newPassword = `np-${Date.now().toString(36)}-x`;
  secrets.add(newPassword);
  // 另一台设备：独立的 browser context 用账号密码登录
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    const login = await other.request.post('/v1/auth/login', { data: { account: me.account, password: me.password } });
    expect(login.status()).toBe(200);
    const otherToken = (await login.json()).data.accessToken as string;
    secrets.add(otherToken);

    await open(me, '/profile/security');
    const section = me.page.getByRole('region', { name: '修改密码' });
    await section.getByLabel(/^当前密码/).fill('definitely-not-it');
    await section.getByLabel(/^新密码/).fill(newPassword);
    await section.getByLabel(/^确认新密码/).fill(newPassword);
    await section.getByRole('button', { name: '修改密码' }).click();
    await expect(section.getByRole('alert')).toContainText('当前密码不正确');

    await section.getByLabel(/^当前密码/).fill(me.password);
    await section.getByRole('button', { name: '修改密码' }).click();
    await expect(section.getByRole('status')).toContainText(/你在其他设备上的 \d+ 个登录已全部退出.*这台设备保持登录/);

    // 另一台设备的会话已经结束；当前设备刷新后仍然登录
    const stale = await other.request.get('/v1/auth/me', { headers: { Authorization: `Bearer ${otherToken}` } });
    expect(stale.status()).toBe(401);
    expect((await other.request.post('/v1/auth/refresh')).status()).toBe(401);
    await me.page.reload();
    await expect(me.page.getByRole('button', { name: '用户菜单' })).toBeVisible();

    expect((await me.context.request.post('/v1/auth/login', { data: { account: me.account, password: me.password } })).status()).toBe(401);
    const fresh = await other.request.post('/v1/auth/login', { data: { account: me.account, password: newPassword } });
    expect(fresh.status()).toBe(200);
    secrets.add((await fresh.json()).data.accessToken);
  } finally {
    await other.close();
  }
});

test('#A2 人工找回：学校管理员签发重置码；错误的码统一提示；正确的码（小写、不带短横线）重置成功，全部会话结束，新密码可以登录', async ({ party, secrets }) => {
  const admin = await party('学校管理员');
  makeStaff(admin.id, 'SCHOOL_ADMIN');
  const forgetful = await party('忘记密码');
  const issued = await apiOk(admin, 'POST', `/v1/admin/users/${forgetful.id}/password-reset`, { note: 'E2E：线下核对学生证' });
  const code = issued.code as string;
  secrets.add(code);
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  // 库里只有哈希
  expect(sql(`SELECT count(*) FROM password_reset_tickets WHERE user_id = '${forgetful.id}' AND code_hash <> '${code}'`)).toBe('1');

  const guest = await party('找回访客', { register: false });
  const page = guest.page;
  await page.goto('/login');
  await page.getByRole('link', { name: '忘记密码？' }).click();
  await expect(page).toHaveURL(/\/password-reset$/);
  await expect(page.getByText(/请带上学生证等身份证明联系本校平台工作人员（学校管理员）/)).toBeVisible();
  const newPassword = `rp-${Date.now().toString(36)}-y`;
  secrets.add(newPassword);
  await page.getByLabel(/^学号 \/ 手机号/).fill(forgetful.account);
  await page.getByRole('textbox', { name: /^重置码/ }).fill('AAAA-AAAA-AAAA');
  await page.getByLabel(/^新密码/).fill(newPassword);
  await page.getByLabel(/^确认新密码/).fill(newPassword);
  await page.getByRole('button', { name: '重置密码' }).click();
  await expect(page.getByRole('alert')).toContainText('账号或重置码无效或已过期');

  await page.getByRole('textbox', { name: /^重置码/ }).fill(code.toLowerCase().replace(/-/g, ''));
  await page.getByRole('button', { name: '重置密码' }).click();
  await expect(page.getByText('密码已重置，所有设备上的登录都已退出。请用新密码登录。')).toBeVisible();

  // 原来的会话全部结束；重置码只能用一次
  expect((await apiCall(forgetful, 'GET', '/v1/auth/me')).status).toBe(401);
  const reused = await guest.context.request.post('/v1/auth/password-reset', { data: { account: forgetful.account, code, newPassword: `${newPassword}-2` } });
  expect(reused.status()).toBe(400);
  expect((await reused.json()).message).toBe('账号或重置码无效或已过期');

  await page.getByRole('link', { name: '去登录' }).click();
  await page.getByLabel('学号 / 手机号').fill(forgetful.account);
  await page.getByLabel(/^密码/).fill(newPassword);
  await page.getByRole('main').getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '用户菜单' })).toBeVisible();
  for (const c of await guest.context.cookies()) secrets.add(c.value);
});

test('#A3 注销：圈子所有者先得到 409 原话；归档后注销成功，退出并回到首页；商品下架、联系方式清除、资料匿名化，原账号不能登录', async ({ party }) => {
  const me = await party('注销者');
  const product = await apiOk(me, 'POST', '/v1/products', { ...single(`E2E 注销前在售 ${Date.now().toString(36)}`), contactPublic: true });
  const circle = await apiOk(me, 'POST', '/v1/circles', { type: 'CLUB', name: `E2E 注销社团 ${Date.now().toString(36)}` });

  await open(me, '/profile/security');
  const section = me.page.getByRole('region', { name: '注销账号' });
  await expect(section).toContainText('你在售的商品全部下架');
  await expect(section).toContainText('你上传的图片全部删除');
  await expect(section).toContainText('治理案件、举报、处理与限制记录');
  const submit = section.getByRole('button', { name: '注销账号' });
  await expect(submit).toBeDisabled();
  await section.getByLabel(/^当前密码/).fill(me.password);
  await section.getByLabel(/请输入「确认注销」/).fill('确认注销');
  await submit.click();
  await expect(section.getByRole('alert')).toContainText('你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销');

  await apiOk(me, 'POST', `/v1/circles/${circle.id}/archive`, {});
  await submit.click();
  await expect(me.page).toHaveURL(/\/$/);
  await expect(me.page.getByText('账号已注销，所有设备上的登录都已退出')).toBeVisible();
  await expect(me.page.getByRole('button', { name: '用户菜单' })).toHaveCount(0);

  expect(sql(`SELECT status || '|' || contact || '|' || contact_public FROM products WHERE id = '${product.id}'`)).toBe('已下架||false');
  expect(sql(`SELECT nickname || '|' || (deleted_at IS NOT NULL) FROM users WHERE id = '${me.id}'`)).toBe('已注销用户|true');
  expect((await apiCall(me, 'GET', '/v1/auth/me')).status).toBe(401);
  expect((await me.context.request.post('/v1/auth/login', { data: { account: me.account, password: me.password } })).status()).toBe(401);
});
