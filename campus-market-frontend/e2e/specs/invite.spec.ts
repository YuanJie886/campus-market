import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/**
 * 邀请制注册（首个试点）：只在后端 GET /v1/config 报告 registration.inviteRequired=true 时运行。
 * 默认 E2E 测试栈不开启邀请制（inviteRequired=false），整个文件跳过；开启邀请制的部署上按真实后端验证：
 *   · 落地页说明需要邀请码；注册页显示必填的「邀请码」与说明，空着不发出注册请求；
 *   · 服务端两条 400 提示原样显示；
 *   · /register#invite=CODE 预填并立即从地址栏删掉，邀请码不出现在任何请求地址里；
 *   · 设置了 E2E_REGISTRATION_INVITE_CODE（由学校工作人员发放的一次性测试邀请码）时，验证完整注册。
 */

const INVITE_REQUIRED = '请输入邀请码';
const INVITE_INVALID = '邀请码无效或已用完';
const HELP = '目前为小范围测试，需要学校工作人员发放的邀请码';

let inviteRequired = false;

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL });
  try {
    const res = await api.get('/v1/config');
    const body = res.ok() ? await res.json() : null;
    inviteRequired = body?.data?.registration?.inviteRequired === true;
  } finally {
    await api.dispose();
  }
});

test.beforeEach(() => {
  test.skip(!inviteRequired, '后端没有开启邀请制（GET /v1/config 的 registration.inviteRequired 不是 true）');
});

/** 填好邀请码以外的注册项（与 session.spec 相同：有多所学校时选演示学校，再选「东校区」） */
async function fillRegistration(page: Page, account: string, password: string) {
  await page.getByLabel('学号 / 手机号').fill(account);
  await page.getByLabel('昵称').fill('邀请注册');
  await page.getByLabel(/^密码/).fill(password);
  await page.getByLabel('确认密码').fill(password);
  await expect(page.getByText('正在加载学校列表…')).toHaveCount(0);
  const school = page.getByRole('combobox', { name: /^学校/ });
  if (await school.count()) {
    await school.click();
    await page.getByRole('option').filter({ hasNotText: 'E2E' }).first().click();
  }
  await page.getByRole('combobox', { name: /^所在校区/ }).click();
  await page.getByRole('option', { name: '东校区' }).click();
  await page.getByRole('checkbox', { name: /^已阅读并同意\s*《用户协议》\s*《隐私政策》$/ }).check();
}

const inviteBox = (page: Page) => page.getByRole('textbox', { name: /^邀请码/ });
const uniqueAccount = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 18);

test('落地页说明需要邀请码；注册页显示必填的邀请码与说明，空着点注册不发出请求', async ({ party, secrets }) => {
  const guest = await party('访客', { register: false });
  const { page } = guest;
  const registerPosts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/v1/auth/register')) registerPosts.push(r.url()) });
  await page.goto('/');
  await expect(page.getByText('目前为小范围测试，注册需要学校工作人员发放的邀请码。')).toBeVisible();
  await page.goto('/register');
  await expect(inviteBox(page)).toBeVisible();
  await expect(page.getByText(HELP)).toBeVisible();
  const password = `pw-${Math.random().toString(36).slice(2, 12)}`;
  secrets.add(password);
  await fillRegistration(page, uniqueAccount('inv'), password);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('alert').filter({ hasText: new RegExp(`^${INVITE_REQUIRED}$`) })).toBeVisible();
  await expect(inviteBox(page)).toBeFocused();
  expect(registerPosts).toEqual([]);
});

test('服务端：缺少邀请码 400「请输入邀请码」，无效邀请码 400「邀请码无效或已用完」；界面原样显示', async ({ party, secrets }) => {
  const guest = await party('访客', { register: false });
  const password = `pw-${Math.random().toString(36).slice(2, 12)}`;
  secrets.add(password);
  const base = { account: uniqueAccount('api'), password, nickname: '邀请注册', campus: '东校区', contact: '13800000000' };
  const missing = await guest.context.request.post('/v1/auth/register', { data: base });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).message).toBe(INVITE_REQUIRED);
  const wrong = await guest.context.request.post('/v1/auth/register', { data: { ...base, inviteCode: 'ZZZZ-ZZZZ-ZZZZ' } });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).message).toBe(INVITE_INVALID);

  const { page } = guest;
  await page.goto('/register');
  await fillRegistration(page, uniqueAccount('ui'), password);
  await inviteBox(page).fill('zzzz zzzz zzzz');
  await expect(inviteBox(page)).toHaveValue('ZZZZ-ZZZZ-ZZZZ');
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('alert').filter({ hasText: new RegExp(`^${INVITE_INVALID}$`) })).toBeVisible();
  await expect(inviteBox(page)).toBeFocused();
});

test('邀请链接 /register#invite=CODE：预填为大写分组，地址栏立即去掉片段，邀请码不出现在任何请求地址里', async ({ party, secrets }) => {
  const guest = await party('访客', { register: false });
  const { page } = guest;
  const code = 'abcd-efgh-jkmn';
  secrets.add('ABCD-EFGH-JKMN');
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto(`/register#invite=${code}`);
  await expect(inviteBox(page)).toHaveValue('ABCD-EFGH-JKMN');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).pathname).toBe('/register');
  expect(urls.filter((u) => /abcd|efgh|jkmn/i.test(u))).toEqual([]);
});

test('完整注册：通过邀请链接预填工作人员发放的测试邀请码（需要 E2E_REGISTRATION_INVITE_CODE）', async ({ party, secrets }) => {
  const code = process.env.E2E_REGISTRATION_INVITE_CODE;
  test.skip(!code, '没有提供 E2E_REGISTRATION_INVITE_CODE（一次性测试邀请码）');
  secrets.add(code);
  const guest = await party('访客', { register: false });
  const { page } = guest;
  const password = `pw-${Math.random().toString(36).slice(2, 12)}`;
  secrets.add(password);
  await page.goto(`/register#invite=${encodeURIComponent(code!)}`);
  await expect(inviteBox(page)).not.toHaveValue('');
  await fillRegistration(page, uniqueAccount('ok'), password);
  await page.getByRole('button', { name: '注册并登录' }).click();
  await expect(page.getByRole('button', { name: '用户菜单' })).toBeVisible();
  for (const c of await guest.context.cookies()) secrets.add(c.value);
});
