import { apiCall, apiOk, ensureSecondSchool, expect, open, test } from '../fixtures';

/** 8.1 #6 私密圈子成员可见、非成员 404；#7 两所学校隔离；#8 邀请 → 登录 → 主动兑换 */

const single = (title: string, extra: Record<string, unknown> = {}) => ({
  title, description: 'E2E 圈子与学校', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000', ...extra,
});
const shortName = (prefix: string) => `${prefix}${Date.now().toString(36).slice(-5)}`;

test('#6 私密圈子：成员能看到圈子商品，非成员打开同一个链接得到与不存在相同的页面；列表里也看不到', async ({ party }) => {
  const owner = await party('圈主');
  const member = await party('成员');
  const outsider = await party('非成员');
  const circle = await apiOk(owner, 'POST', '/v1/circles', { type: 'CLUB', name: shortName('私密圈'), description: 'E2E', visibility: 'PRIVATE' });
  const invite = await apiOk(owner, 'POST', `/v1/circles/${circle.id}/invites`, {});
  await apiOk(member, 'POST', '/v1/circle-invites/redeem', { token: invite.token });
  const title = `E2E 圈内台灯 ${Date.now().toString(36)}`;
  const product = await apiOk(owner, 'POST', '/v1/products', single(title, { visibility: 'CIRCLE_ONLY', circleIds: [circle.id] }));

  await open(member, `/product/${product.id}`);
  await expect(member.page.getByRole('heading', { name: title })).toBeVisible();
  await expect(member.page.getByText('圈子可见')).toBeVisible();

  await open(outsider, `/product/${product.id}`);
  await expect(outsider.page.getByText('商品不存在或已被删除')).toBeVisible();
  await expect(outsider.page.getByRole('heading', { name: title })).toHaveCount(0);
  const missing = await apiCall(outsider, 'GET', `/v1/products/${crypto.randomUUID()}`);
  const hidden = await apiCall(outsider, 'GET', `/v1/products/${product.id}`);
  expect(hidden.status).toBe(404);
  expect(hidden.body.message).toBe(missing.body.message);
  const search = await apiOk(outsider, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`);
  expect(search.total).toBe(0);
});

test('#7 两所学校：他校用户看不到本校商品（详情 404、搜索 0 条），带 schoolId 参数 400；不能预约他校商品', async ({ party }) => {
  const lakeCampus = ensureSecondSchool();
  const seller = await party('试点卖家');
  const lake = await party('湖畔同学', { campus: lakeCampus });
  const title = `E2E 本校商品 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  await open(lake, `/product/${product.id}`);
  await expect(lake.page.getByText('商品不存在或已被删除')).toBeVisible();
  await open(lake, `/?keyword=${encodeURIComponent(title)}`);
  // 页面会回显搜索词；断言的是结果里没有这件商品的链接
  await expect(lake.page.getByText(/没有找到|暂无/).first()).toBeVisible();
  await expect(lake.page.getByRole('link', { name: `查看闲置：${title}` })).toHaveCount(0);
  expect((await apiOk(lake, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).total).toBe(0);
  expect((await apiCall(lake, 'GET', '/v1/products?schoolId=pilot')).status).toBe(400);
  const book = await apiCall(lake, 'POST', '/v1/orders', {
    productId: product.id, meetingPointId: '东校区-library', meetingAtIso: new Date(Date.now() + 86_400_000).toISOString(), contact: '1', idempotencyKey: crypto.randomUUID(),
  }, { 'Idempotency-Key': crypto.randomUUID() });
  expect(book.status).toBe(404);
  // 本校同学照常看到
  const peer = await party('试点同学');
  await open(peer, `/?keyword=${encodeURIComponent(title)}`);
  await expect(peer.page.getByRole('link', { name: `查看闲置：${title}` }).first()).toBeVisible();   // 同一断言的正向对照
  await open(peer, `/product/${product.id}`);
  await expect(peer.page.getByRole('heading', { name: title })).toBeVisible();
});

test('#8 邀请链接 → 未登录访客 → 登录 → 回到邀请页自动填好 → 用户点击「加入」才兑换；地址栏与浏览器存储里都没有邀请码', async ({ party, secrets }) => {
  const owner = await party('邀请圈主');
  const invitee = await party('受邀人');            // 只用它的账号密码；登录发生在下面的访客 context
  const circle = await apiOk(owner, 'POST', '/v1/circles', { type: 'CLUB', name: shortName('邀请圈'), description: 'E2E', visibility: 'PRIVATE' });
  const invite = await apiOk(owner, 'POST', `/v1/circles/${circle.id}/invites`, {});
  secrets.add(invite.token);

  const guest = await party('访客', { register: false });
  const page = guest.page;
  await page.goto(`/circles/join#code=${encodeURIComponent(invite.token)}`);
  await expect(page.getByText(/已收到邀请码。登录或注册后会回到这里/)).toBeVisible();
  expect(page.url()).not.toContain('#');
  expect(page.url()).not.toContain(invite.token);
  await page.getByRole('button', { name: '去登录' }).click();
  await expect(page.getByText(/登录后会回到圈子邀请页，由你确认是否加入/)).toBeVisible();
  await page.getByLabel(/^学号 \/ 手机号/).fill(invitee.account);
  await page.getByLabel(/^密码/).fill(invitee.password);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();   // 表单里的登录按钮（导航栏也有一个）
  await expect(page.getByText('邀请码已自动填好，确认后点击「加入」。')).toBeVisible();
  // 还没有兑换：成员里没有受邀人
  expect((await apiOk(owner, 'GET', `/v1/circles/${circle.id}/members`)).items.map((m: { userId: string }) => m.userId)).not.toContain(invitee.id);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(invite.token);
  expect((await guest.context.cookies()).map((c) => c.value).join(';')).not.toContain(invite.token);
  await page.getByRole('button', { name: '加入' }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circle.id}$`));
  expect((await apiOk(owner, 'GET', `/v1/circles/${circle.id}/members`)).items.map((m: { userId: string }) => m.userId)).toContain(invitee.id);
  expect(page.url()).not.toContain(invite.token);
});
