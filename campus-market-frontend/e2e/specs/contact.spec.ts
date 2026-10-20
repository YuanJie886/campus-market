import type { Page } from '@playwright/test';
import { apiCall, apiOk, expect, open, sql, test, type Party } from '../fixtures';

/**
 * 平台只展示商品 + 联系请求（阶段 0 新的核心链路）：
 *   #1 发布 → 浏览 → 申请联系 → 卖家同意 → 买家看到联系方式 → 下架，全部在界面上完成；
 *   #2 卖家拒绝时买家始终看不到联系方式；卖家选择公开联系方式时不需要申请；
 *   #3 整套打包商品同样只有一个联系入口，申请不改变商品状态。
 * 买卖双方与第三人各用独立的 browser context；账号每次随机。
 */

const CONTACT = '13800000000';

const single = (title: string, extra: Record<string, unknown> = {}) => ({
  title, description: 'E2E 联系请求', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: CONTACT, ...extra,
});

async function pickOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function publishViaUi(seller: Party, title: string) {
  const page = seller.page;
  await open(seller, '/publish');
  await page.getByLabel(/^商品标题/).fill(title);
  await page.getByLabel(/^商品描述/).fill('E2E 真实浏览器测试：成色良好，联系卖家后自行约定。');
  await page.getByLabel(/^出售价格/).fill('88');
  await pickOption(page, /^分类/, '其他');
  await pickOption(page, /^成色/, '几乎全新');
  await expect(page.getByText('该分类暂无结构化验货清单，可以直接发布。')).toBeVisible();
  await page.getByLabel(/^联系方式/).fill(CONTACT);
  await page.getByRole('button', { name: '选择图片 1', exact: true }).click();
  await page.getByRole('button', { name: '立即发布' }).click();
  await expect(page.getByText('发布成功，快去看看你的宝贝吧～')).toBeVisible();
}

/** 买家在详情页点「我想要」发出联系申请 */
async function requestViaUi(buyer: Party, productId: string, title: string) {
  const page = buyer.page;
  await open(buyer, `/product/${productId}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('卖家未公开联系方式，点击“我想要”申请，经卖家同意后展示。')).toBeVisible();
  await expect(page.getByText(CONTACT)).toHaveCount(0);
  await page.getByRole('button', { name: '我想要' }).click();
  await expect(page.getByText('联系申请已发送，等待卖家同意')).toBeVisible();
  await expect(page.getByRole('button', { name: '等待卖家同意' })).toBeDisabled();
  await expect(page.getByText(CONTACT)).toHaveCount(0);
}

/** 卖家在「联系申请」里处理唯一一条待处理申请 */
async function sellerDecides(seller: Party, buyerNickname: string, approve: boolean) {
  const page = seller.page;
  await open(seller, '/profile/contact-requests');
  await expect(page.getByText(`${buyerNickname} 想查看你的联系方式`, { exact: false })).toBeVisible();
  if (approve) {
    await page.getByRole('button', { name: '同意展示联系方式' }).click();
    await expect(page.getByText('已同意，仅该买家可以查看联系方式')).toBeVisible();
  } else {
    await page.getByRole('button', { name: '拒绝' }).click();
    await expect(page.getByText('已拒绝该联系申请')).toBeVisible();
  }
}

test('#1 核心链路：界面发布 → 搜索浏览 → 申请联系 → 卖家同意 → 买家看到联系方式（第三人看不到）→ 卖家下架后不再出现在搜索里', async ({ party }) => {
  const seller = await party('卖家');
  const title = `E2E 联系台灯 ${Date.now().toString(36)}`;
  await publishViaUi(seller, title);
  const product = (await apiOk(seller, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).items[0];
  expect(product.contactPublic).toBe(false);

  const buyer = await party('买家');
  await open(buyer, `/?keyword=${encodeURIComponent(title)}`);
  await buyer.page.getByRole('link', { name: `查看闲置：${title}` }).first().click();
  await expect(buyer.page).toHaveURL(new RegExp(`/product/${product.id}$`));
  await requestViaUi(buyer, product.id, title);

  await sellerDecides(seller, buyer.nickname, true);

  await open(buyer, '/profile/contact-requests');
  await buyer.page.getByRole('tab', { name: '我发出的申请' }).click();
  await expect(buyer.page.getByText('已同意展示')).toBeVisible();
  await buyer.page.getByRole('link', { name: '查看卖家联系方式' }).click();
  await expect(buyer.page.getByText(`卖家联系方式：${CONTACT}`)).toBeVisible();
  await expect(buyer.page.getByRole('button', { name: '查看联系方式' })).toBeEnabled();

  // 同意只针对这一位买家
  const other = await party('第三人');
  await open(other, `/product/${product.id}`);
  await expect(other.page.getByRole('heading', { name: title })).toBeVisible();
  await expect(other.page.getByText(CONTACT)).toHaveCount(0);
  expect((await apiOk(other, 'GET', `/v1/products/${product.id}`)).contact).toBe('');

  // 卖家下架
  await open(seller, '/profile/listings');
  await seller.page.getByRole('button', { name: '下架' }).click();
  await expect(seller.page.getByText('商品已下架')).toBeVisible();
  await open(buyer, `/?keyword=${encodeURIComponent(title)}`);
  await expect(buyer.page.getByRole('link', { name: `查看闲置：${title}` })).toHaveCount(0);
  expect((await apiOk(buyer, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).total).toBe(0);
  // 下架后对其他同学与不存在相同：不能再申请联系，也不产生申请记录
  const late = await party('下架后申请人');
  expect((await apiCall(late, 'POST', `/v1/products/${product.id}/contact-request`, {})).status).toBe(404);
  expect(sql(`SELECT count(*) FROM contact_requests WHERE product_id = '${product.id}'`)).toBe('1');
});

test('#2 卖家拒绝：买家看到「卖家已拒绝」且始终看不到联系方式；卖家公开联系方式时直接展示、无需申请', async ({ party }) => {
  const seller = await party('拒绝卖家');
  const title = `E2E 拒绝联系 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const buyer = await party('被拒买家');
  await requestViaUi(buyer, product.id, title);
  await sellerDecides(seller, buyer.nickname, false);

  await open(buyer, `/product/${product.id}`);
  await expect(buyer.page.getByRole('button', { name: '卖家已拒绝' })).toBeDisabled();
  await expect(buyer.page.getByText('卖家未同意展示联系方式。')).toBeVisible();
  await expect(buyer.page.getByText(CONTACT)).toHaveCount(0);
  expect((await apiOk(buyer, 'GET', `/v1/products/${product.id}`)).contact).toBe('');
  // 拒绝是终态（阶段 1 起）：再次申请 409 原话，记录仍是 REJECTED
  const again = await apiCall(buyer, 'POST', `/v1/products/${product.id}/contact-request`, {});
  expect(again.status).toBe(409);
  expect(again.body.message).toBe('卖家已拒绝这次申请，不能再次申请');
  expect(sql(`SELECT status FROM contact_requests WHERE product_id = '${product.id}'`)).toBe('REJECTED');

  const publicTitle = `E2E 公开联系 ${Date.now().toString(36)}`;
  const open1 = await apiOk(seller, 'POST', '/v1/products', single(publicTitle, { contactPublic: true }));
  await open(buyer, `/product/${open1.id}`);
  await expect(buyer.page.getByText(`卖家联系方式：${CONTACT}`)).toBeVisible();
  await expect(buyer.page.getByRole('button', { name: '查看联系方式' })).toBeEnabled();
  expect((await apiCall(buyer, 'POST', `/v1/products/${open1.id}/contact-request`, {})).status).toBe(409);
});

test('#3 整套打包：详情页同样只有一个「我想要」入口，同意后展示联系方式，申请不改变整套的在售状态', async ({ party }) => {
  const seller = await party('打包卖家');
  const title = `E2E 宿舍整套 ${Date.now().toString(36)}`;
  const items = [1, 2, 3].map((n) => ({ name: `明细${n}`, category: '生活用品', condition: '轻微使用痕迹', quantity: 1, note: `第 ${n} 件` }));
  const bundle = await apiCall(seller, 'POST', '/v1/products', { ...single(title), listingKind: 'BUNDLE', condition: '轻微使用痕迹', price: 120, bundleItems: items });
  expect(bundle.status, JSON.stringify(bundle.body)).toBe(200);
  const buyer = await party('打包买家');
  await requestViaUi(buyer, bundle.data.id, title);
  await sellerDecides(seller, buyer.nickname, true);
  await open(buyer, `/product/${bundle.data.id}`);
  await expect(buyer.page.getByText(`卖家联系方式：${CONTACT}`)).toBeVisible();
  expect((await apiOk(seller, 'GET', `/v1/products/${bundle.data.id}`)).status).toBe('在售');
});

test('#4 买家撤回申请后重新申请（同一条记录）；卖家同意后又撤回同意：买家立即看不到联系方式、不能再次申请', async ({ party }) => {
  const seller = await party('撤回卖家');
  const title = `E2E 撤回与重新申请 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const buyer = await party('撤回买家');
  await requestViaUi(buyer, product.id, title);
  const first = await apiOk(buyer, 'GET', `/v1/products/${product.id}/contact-request`);

  // 买家撤回 → 「重新申请」→ 回到等待，仍是同一条申请
  await buyer.page.getByRole('button', { name: '撤回申请' }).click();
  await expect(buyer.page.getByText('已撤回联系申请，需要时可以重新申请')).toBeVisible();
  await expect(buyer.page.getByText('你已撤回这次联系申请。需要时可以点击“重新申请”，卖家会重新收到申请。')).toBeVisible();
  expect((await apiOk(buyer, 'GET', `/v1/products/${product.id}/contact-request`)).status).toBe('WITHDRAWN');
  await buyer.page.getByRole('button', { name: '重新申请' }).click();
  await expect(buyer.page.getByRole('button', { name: '等待卖家同意' })).toBeDisabled();
  const again = await apiOk(buyer, 'GET', `/v1/products/${product.id}/contact-request`);
  expect([again.id, again.status]).toEqual([first.id, 'PENDING']);

  // 卖家同意 → 买家看到联系方式
  await sellerDecides(seller, buyer.nickname, true);
  await open(buyer, `/product/${product.id}`);
  await expect(buyer.page.getByText(`卖家联系方式：${CONTACT}`)).toBeVisible();

  // 卖家撤回同意（二次确认）
  await open(seller, '/profile/contact-requests');
  await seller.page.getByRole('button', { name: '撤回同意' }).click();
  const dialog = seller.page.getByRole('dialog', { name: '撤回对这次申请的同意？' });
  await expect(dialog).toContainText('将立即看不到');
  await dialog.getByRole('button', { name: '确认撤回同意' }).click();
  await expect(seller.page.getByText('已撤回同意，该买家已看不到这件商品的联系方式')).toBeVisible();

  // 买家：联系方式立即消失，按钮不可点击，再次申请 409（不会静默成功）
  await open(buyer, `/product/${product.id}`);
  await expect(buyer.page.getByRole('button', { name: '卖家已撤回同意' })).toBeDisabled();
  await expect(buyer.page.getByText(CONTACT)).toHaveCount(0);
  expect((await apiOk(buyer, 'GET', `/v1/products/${product.id}`)).contact).toBe('');
  expect((await apiCall(buyer, 'POST', `/v1/products/${product.id}/contact-request`, {})).status).toBe(409);
  expect(sql(`SELECT status FROM contact_requests WHERE product_id = '${product.id}'`)).toBe('REVOKED');
});
