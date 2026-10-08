import type { Page } from '@playwright/test';
import { apiOk, expect, hourStart, localInput, open, test, type Party } from '../fixtures';

/**
 * 8.1 #1 普通非教材单件完整交易（发布 → 浏览 → 预约 → 接单 → 确认面交 → 核销 → 评价，全部在界面上完成）；
 *     #2 数码商品声明与验货；#3 整套打包完整交易；#9 验货不一致阻断核销。
 * 买卖双方各用独立的 browser context；账号每次随机。
 */

async function pickOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

async function publishViaUi(seller: Party, title: string, category: string) {
  const page = seller.page;
  await open(seller, '/publish');
  await page.getByLabel(/^商品标题/).fill(title);
  await page.getByLabel(/^商品描述/).fill('E2E 真实浏览器测试：成色良好，可当面验货。');
  await page.getByLabel(/^出售价格/).fill('88');
  await pickOption(page, /^分类/, category);
  await pickOption(page, /^成色/, '几乎全新');
  // 有结构化验货清单的分类：每一项都声明「正常」；没有清单的分类页面会明确说明可以直接发布
  const declaration = page.locator('section[aria-labelledby="declaration-title"]');
  await expect(declaration.or(page.getByText('该分类暂无结构化验货清单，可以直接发布。'))).toBeVisible();
  if (await declaration.count()) {
    for (const group of await declaration.getByRole('radiogroup').all()) await group.getByLabel('正常').check();
  }
  await page.getByLabel(/^联系方式/).fill('13800000000');
  await page.getByRole('button', { name: '选择图片 1', exact: true }).click();
  await page.getByRole('button', { name: '立即发布' }).click();
  await expect(page.getByText('发布成功，快去看看你的宝贝吧～')).toBeVisible();
}

async function bookViaUi(buyer: Party, productId: string, title: string) {
  const page = buyer.page;
  await open(buyer, `/product/${productId}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: '我想要' }).click();
  const dialog = page.getByRole('dialog', { name: '预约校园面交' });
  await pickOption(page, '面交地点', /图书馆门口/);
  await dialog.getByLabel('面交时间').fill(localInput(hourStart(28)));
  await expect(dialog.getByTestId('booking-slot')).toContainText('（60 分钟）');
  await dialog.getByRole('button', { name: '确认预约' }).click();
  await expect(page.getByText('预约成功，等待卖家确认')).toBeVisible();
}

async function sellerAccepts(seller: Party) {
  await open(seller, '/profile/orders');
  await seller.page.getByRole('tab', { name: '我卖出的' }).click();
  await expect(seller.page.getByText(/接受即确认完整时段：.*（60 分钟）/)).toBeVisible();
  await seller.page.getByRole('button', { name: '接受预约' }).click();
  await expect(seller.page.getByText('订单已更新')).toBeVisible();
}

async function confirmationCode(buyer: Party): Promise<string> {
  await open(buyer, '/profile/orders');
  const alert = buyer.page.getByText(/交易确认码：/);
  await expect(alert).toBeVisible();
  return (await alert.locator('strong').innerText()).trim();
}

async function buyerConfirms(buyer: Party) {
  await open(buyer, '/profile/orders');
  const confirm = buyer.page.getByRole('button', { name: '已验货付款，确认面交' });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(buyer.page.getByText('订单已更新')).toBeVisible();
}

async function sellerCompletes(seller: Party, code: string) {
  await open(seller, '/profile/orders');
  await seller.page.getByRole('tab', { name: '我卖出的' }).click();
  await seller.page.getByLabel('买家提供的六位确认码').fill(code);
  await seller.page.getByRole('button', { name: '核验并完成交易' }).click();
  await expect(seller.page.getByText('双方已确认，交易完成')).toBeVisible();
}

async function inspectAll(buyer: Party, orderId: string, result: '与声明一致' | '与声明不一致') {
  const page = buyer.page;
  await open(buyer, `/orders/${orderId}`);
  const panel = page.locator('section[aria-labelledby="inspection-title"]');
  await expect(panel).toBeVisible();
  for (const group of await panel.getByRole('radiogroup').all()) await group.getByLabel(result).check();
  await panel.getByRole('button', { name: '提交验货结果' }).click();
  const confirm = page.getByRole('dialog', { name: '提交后不能修改' });
  if (result === '与声明不一致') await expect(confirm).toContainText('不能再确认面交或核销');
  await confirm.getByRole('button', { name: '确认提交' }).click();
}

const productIdByTitle = async (p: Party, title: string) =>
  ((await apiOk(p, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).items as Array<{ id: string; title: string }>).find((x) => x.title === title)!.id;

test('#1 普通非教材单件：界面发布 → 浏览 → 预约（明确时段）→ 接单 → 确认面交 → 核销 → 双方评价', async ({ party, secrets }) => {
  const seller = await party('卖家');
  const buyer = await party('买家');
  const title = `E2E 台灯 ${Date.now().toString(36)}`;
  await publishViaUi(seller, title, '生活用品');
  await open(buyer, '/');
  await buyer.page.getByRole('textbox', { name: /搜索/ }).first().fill(title);
  await buyer.page.keyboard.press('Enter');
  await expect(buyer.page.getByText(title).first()).toBeVisible();
  const productId = await productIdByTitle(buyer, title);
  await bookViaUi(buyer, productId, title);
  await sellerAccepts(seller);
  // 生活用品有结构化验货清单：买家当面逐项验货后才能确认面交
  await inspectAll(buyer, (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].id, '与声明一致');
  const code = await confirmationCode(buyer);
  secrets.add(code);
  await buyerConfirms(buyer);
  await sellerCompletes(seller, code);
  await open(buyer, '/profile/orders');
  await buyer.page.getByRole('button', { name: '评价卖家' }).click();
  await buyer.page.getByLabel('评价内容').fill('交易顺利，按约定时间见面');
  await buyer.page.getByRole('button', { name: '提交评价' }).click();
  await expect(buyer.page.getByText(/买家评价 · 5 星/)).toBeVisible();
  const product = await apiOk(buyer, 'GET', `/v1/products/${productId}`);
  expect(product.status).toBe('已售出');
});

test('#2 数码商品：发布时逐项声明；买家当面逐项验货全部一致后才能确认面交并核销', async ({ party, secrets }) => {
  const seller = await party('数码卖家');
  const buyer = await party('数码买家');
  const title = `E2E 耳机 ${Date.now().toString(36)}`;
  await publishViaUi(seller, title, '数码电子');
  const productId = await productIdByTitle(buyer, title);
  await open(buyer, `/product/${productId}`);
  await expect(buyer.page.getByText(/卖家声明|验货清单/).first()).toBeVisible();
  await bookViaUi(buyer, productId, title);
  await sellerAccepts(seller);
  await open(buyer, '/profile/orders');
  await expect(buyer.page.getByRole('button', { name: '已验货付款，确认面交' })).toBeDisabled();
  const orderId = (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].id as string;
  await inspectAll(buyer, orderId, '与声明一致');
  const code = await confirmationCode(buyer);
  secrets.add(code);
  await buyerConfirms(buyer);
  await sellerCompletes(seller, code);
});

test('#3 整套打包：发布整套 → 预约 → 接单 → 确认 → 核销，商品整体售出', async ({ party, secrets }) => {
  const seller = await party('打包卖家');
  const buyer = await party('打包买家');
  const title = `E2E 宿舍整套 ${Date.now().toString(36)}`;
  const bundle = await apiOk(seller, 'POST', '/v1/products', {
    listingKind: 'BUNDLE', title, description: '毕业整套打包', price: 120, category: '其他', condition: '轻微使用痕迹', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    bundleItems: [
      { name: '台灯', category: '生活用品', condition: '轻微使用痕迹', quantity: 1, note: '' },
      { name: '收纳箱', category: '生活用品', condition: '轻微使用痕迹', quantity: 2, note: '' },
    ],
  });
  await open(buyer, `/product/${bundle.id}`);
  await expect(buyer.page.getByText('收纳箱')).toBeVisible();
  await bookViaUi(buyer, bundle.id, title);
  await sellerAccepts(seller);
  // 整套打包按明细逐项验货后才能确认面交
  await open(buyer, '/profile/orders');
  await expect(buyer.page.getByText(/请先在「面交与验货」中逐项验货/)).toBeVisible();
  await inspectAll(buyer, (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].id, '与声明一致');
  const code = await confirmationCode(buyer);
  secrets.add(code);
  await buyerConfirms(buyer);
  await sellerCompletes(seller, code);
  expect((await apiOk(buyer, 'GET', `/v1/products/${bundle.id}`)).status).toBe('已售出');
});

test('#9 验货不一致：订单转为待处理，买家不能确认面交，卖家输入正确确认码也不能核销', async ({ party, secrets }) => {
  const seller = await party('不一致卖家');
  const buyer = await party('不一致买家');
  const title = `E2E 平板 ${Date.now().toString(36)}`;
  await publishViaUi(seller, title, '数码电子');
  const productId = await productIdByTitle(buyer, title);
  await bookViaUi(buyer, productId, title);
  await sellerAccepts(seller);
  const orderId = (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].id as string;
  const code = (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].confirmationCode as string;
  secrets.add(code);
  await inspectAll(buyer, orderId, '与声明不一致');
  await open(buyer, '/profile/orders');
  await expect(buyer.page.getByText(/验货不一致：不能确认面交或核销/)).toBeVisible();
  await expect(buyer.page.getByRole('button', { name: '已验货付款，确认面交' })).toHaveCount(0);
  await open(seller, '/profile/orders');
  await seller.page.getByRole('tab', { name: '我卖出的' }).click();
  await expect(seller.page.getByLabel('买家提供的六位确认码')).toHaveCount(0);
  // 直接请求也被拒绝（服务端是最终防线）
  const r = await seller.context.request.post(`/v1/orders/${orderId}/transitions`, {
    data: { to: 'COMPLETED', confirmationCode: code }, headers: { Authorization: `Bearer ${seller.token}` },
  });
  expect(r.status()).toBe(409);
  expect((await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].canonicalStatus).toBe('DISPUTED');
});
