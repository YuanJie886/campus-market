import type { Page } from '@playwright/test';
import { apiCall, apiOk, expect, open, test, type Party } from '../fixtures';

/**
 * Web 与小程序对齐的新功能（真实后端）：
 *   #P1 批量发布：逐件「标记为可以发布」（不完整的一件原样显示服务端的「草稿还不能发布：…」）→ 一次发布整个批次；
 *   #P2 需求匹配「新建订阅」→ 之后同校有人发布标题含关键词的商品 → 「需求匹配」里出现这件商品；
 *   #P3 圈子以邀请码为主：界面创建圈子 → 生成邀请码 →「复制邀请码」→ 另一位同学在「用邀请码加入」里输入 → 加入；
 *       仅圈子可见的商品成员能看到，非成员与不存在相同（404）。
 */

const payload = (title: string) => ({
  title, description: 'E2E 对齐小程序', price: 18, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});
const stamp = () => Date.now().toString(36);

async function pickOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function draft(owner: Party, body: Record<string, unknown>) {
  return apiOk(owner, 'POST', '/v1/listing-drafts', { draftType: 'SINGLE', payload: body });
}

test('#P1 草稿「标记为可以发布」：不完整的一件显示服务端原话、仍是 DRAFT；补全后标记为 READY → 一次发布整个批次', async ({ party }) => {
  const owner = await party('标记卖家');
  const prefix = `E2E 标记 ${stamp()}`;
  const complete = await draft(owner, payload(`${prefix}-1`));
  const partial = await draft(owner, { title: `${prefix}-2` });
  const batch = await apiOk(owner, 'POST', '/v1/listing-batches', { draftIds: [complete.id, partial.id] });
  const page = owner.page;
  await open(owner, `/publish/batch?batch=${batch.id}`);

  const first = page.getByRole('region', { name: /第 1 件/ });
  await first.getByRole('button', { name: '标记为可以发布' }).click();
  await expect(first.getByText('第 1 件已标记为可以发布')).toBeVisible();
  expect((await apiOk(owner, 'GET', `/v1/listing-drafts/${complete.id}`)).status).toBe('READY');

  await page.getByRole('button', { name: new RegExp(`第 2 件 · ${prefix}-2`) }).click();
  const second = page.getByRole('region', { name: /第 2 件/ });
  await second.getByRole('button', { name: '标记为可以发布' }).click();
  await expect(second.getByRole('alert')).toContainText('草稿还不能发布：');
  expect((await apiOk(owner, 'GET', `/v1/listing-drafts/${partial.id}`)).status).toBe('DRAFT');

  // 补全第 2 件（在界面上逐项填写），再标记
  await second.getByLabel('描述').fill('E2E 界面补全的描述');
  await second.getByLabel('价格（元）').fill('22');
  await pickOption(page, /^分类/, '其他');
  await pickOption(page, /^成色/, '几乎全新');
  await pickOption(page, /^校区/, '东校区');
  await second.getByRole('button', { name: '第 2 件选择图片 1' }).click();
  await second.getByLabel('联系方式（只有你自己能看到草稿里的联系方式）').fill('13800000000');
  await second.getByRole('button', { name: '标记为可以发布' }).click();
  await expect(second.getByText('第 2 件已标记为可以发布')).toBeVisible();
  expect((await apiOk(owner, 'GET', `/v1/listing-drafts/${partial.id}`)).status).toBe('READY');

  await page.getByRole('button', { name: '发布这 2 件' }).click();
  await page.getByRole('dialog', { name: '确认一次发布 2 件？' }).getByRole('button', { name: '确认发布' }).click();
  await expect(page.getByText('已发布 2 件')).toBeVisible();
  expect((await apiOk(owner, 'GET', `/v1/products?keyword=${encodeURIComponent(prefix)}`)).total).toBe(2);
  expect((await apiOk(owner, 'GET', `/v1/listing-drafts/${partial.id}`)).status).toBe('PUBLISHED');
});

test('#P2 「新建订阅」→ 之后发布的匹配商品出现在「需求匹配」里', async ({ party }) => {
  const buyer = await party('订阅买家');
  const seller = await party('订阅卖家');
  const keyword = `电热水壶${stamp().slice(-5)}`;
  const page = buyer.page;
  await open(buyer, '/demands?tab=subscriptions');
  await expect(page.getByText('还没有订阅。')).toBeVisible();
  await page.getByRole('button', { name: '新建订阅' }).click();
  const dialog = page.getByRole('dialog', { name: '订阅一个需求' });
  await dialog.getByRole('button', { name: '确认订阅' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('请至少填写关键词或选择分类');
  await dialog.getByLabel(/^关键词/).fill(keyword);
  await dialog.getByLabel(/^最高价/).fill('200');
  await dialog.getByRole('button', { name: '确认订阅' }).click();
  await expect(page.getByText('订阅成功，有匹配的新商品时会出现在「需求匹配」里')).toBeVisible();
  await expect(page.getByRole('list', { name: '我的订阅' })).toContainText(`关键词「${keyword}」`);
  // 相同条件再订阅一次：不重复创建
  await page.getByRole('button', { name: '新建订阅' }).click();
  await dialog.getByLabel(/^关键词/).fill(keyword);
  await dialog.getByLabel(/^最高价/).fill('200');
  await dialog.getByRole('button', { name: '确认订阅' }).click();
  await expect(page.getByText('你已经订阅过相同条件，没有重复创建')).toBeVisible();
  expect((await apiOk(buyer, 'GET', '/v1/demand-subscriptions')).length).toBe(1);

  const title = `九成新 ${keyword} 1.5L`;
  await apiOk(seller, 'POST', '/v1/products', { ...payload(title), price: 60 });
  await open(buyer, '/demands');
  await expect(page.getByRole('list', { name: '需求匹配列表' }).getByText(title)).toBeVisible();
});

test('#P3 圈子邀请码：创建 →「复制邀请码」→ 另一位同学输入邀请码加入 → 圈子商品成员可见、非成员 404', async ({ party, secrets }) => {
  const owner = await party('圈主');
  const name = `E2E邀请码圈${stamp().slice(-5)}`;
  const page = owner.page;
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.E2E_BASE_URL });
  await open(owner, '/circles/new');
  await pickOption(page, '圈子类型', /社团/);
  await page.getByLabel('圈子名称').fill(name);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('link', { name: '管理圈子' }).click();
  await page.getByRole('button', { name: '生成邀请码' }).click();
  const box = page.getByRole('group', { name: '新邀请码（只显示这一次）' });
  await expect(box).toBeFocused();
  const code = (await box.getByTestId('invite-code').textContent())!.trim();
  secrets.add(code);
  expect(code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByText('#code=')).toHaveCount(0);           // 不再显示邀请链接
  await box.getByRole('button', { name: '复制邀请码' }).click();
  await expect(box.getByText('邀请码已复制')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  const circleId = new URL(page.url()).pathname.split('/')[2];

  const member = await party('受邀成员');
  await open(member, '/circles');
  await member.page.getByRole('link', { name: '用邀请码加入' }).click();
  await expect(member.page).toHaveURL(/\/circles\/join$/);
  await member.page.getByRole('textbox', { name: '邀请码' }).fill(code);
  await member.page.getByRole('button', { name: '加入' }).click();
  await expect(member.page).toHaveURL(new RegExp(`/circles/${circleId}$`));
  await expect(member.page.getByRole('heading', { name })).toBeVisible();
  expect(member.page.url()).not.toContain(code);
  // 同一个邀请码不能再用
  const outsider = await party('圈外同学');
  const reuse = await apiCall(outsider, 'POST', '/v1/circle-invites/redeem', { token: code });
  expect(reuse.status).toBeGreaterThanOrEqual(400);

  const title = `E2E 圈内书架 ${stamp()}`;
  const product = await apiOk(owner, 'POST', '/v1/products', { ...payload(title), visibility: 'CIRCLE_ONLY', circleIds: [circleId] });
  await open(member, `/product/${product.id}`);
  await expect(member.page.getByRole('heading', { name: title })).toBeVisible();
  await open(outsider, `/product/${product.id}`);
  await expect(outsider.page.getByText('商品不存在或已被删除')).toBeVisible();
  await expect(outsider.page.getByRole('heading', { name: title })).toHaveCount(0);
  expect((await apiCall(outsider, 'GET', `/v1/products/${product.id}`)).status).toBe(404);
});
