import type { Locator, Page } from '@playwright/test';
import { apiOk, expect, open, test } from '../fixtures';

/** 8.1 #15 手机尺寸关键路径；#16 只用键盘完成发布、申请联系与同意的核心操作 */

const single = (title: string) => ({
  title, description: 'E2E 手机与键盘', price: 40, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

async function noHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, '页面不应出现横向滚动').toBeLessThanOrEqual(width + 1);
}

/** 只按 Tab，直到焦点落在目标元素上（真实的键盘焦点顺序） */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('按 Tab 无法到达目标元素');
}

test('#15 手机尺寸（390×844）：搜索 → 商品详情 → 申请联系 → 联系申请列表；各步都没有横向滚动', async ({ party }) => {
  const seller = await party('手机卖家');
  const title = `E2E 手机台灯 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const buyer = await party('手机买家', { viewport: { width: 390, height: 844 } });
  await open(buyer, `/?keyword=${encodeURIComponent(title)}`);
  await noHorizontalScroll(buyer.page);
  await buyer.page.getByRole('link', { name: `查看闲置：${title}` }).filter({ visible: true }).first().click();
  await expect(buyer.page.getByRole('heading', { name: title }).filter({ visible: true }).first()).toBeVisible();
  await noHorizontalScroll(buyer.page);
  const want = buyer.page.getByRole('button', { name: '我想要' });
  await want.scrollIntoViewIfNeeded();
  const box = await want.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await want.click();
  await expect(buyer.page.getByText('联系申请已发送，等待卖家同意')).toBeVisible();
  await expect(buyer.page.getByRole('button', { name: '等待卖家同意' })).toBeDisabled();
  await noHorizontalScroll(buyer.page);
  await open(buyer, '/profile/contact-requests');
  await buyer.page.getByRole('tab', { name: '我发出的申请' }).click();
  await expect(buyer.page.getByRole('link', { name: title })).toBeVisible();
  await expect(buyer.page.getByText('等待卖家同意')).toBeVisible();
  await noHorizontalScroll(buyer.page);
  expect((await apiOk(buyer, 'GET', `/v1/products/${product.id}/contact-request`)).status).toBe('PENDING');
});

test('#16 只用键盘：发布一件商品（Tab 定位、键入、方向键选分类、空格选图片、回车提交），买家用键盘申请联系，卖家用键盘同意', async ({ party }) => {
  const seller = await party('键盘卖家');
  const page = seller.page;
  const title = `E2E 键盘发布 ${Date.now().toString(36)}`;
  await open(seller, '/publish');
  await page.getByLabel(/^商品标题/).focus();           // 起点：第一个输入框
  await page.keyboard.type(title);
  await tabTo(page, page.getByLabel(/^商品描述/));
  await page.keyboard.type('键盘发布的商品，全程没有使用鼠标。');
  await tabTo(page, page.getByLabel(/^出售价格/));
  await page.keyboard.type('66');
  const category = page.getByRole('combobox', { name: /^分类/ });
  await tabTo(page, category);
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');                     // 分类列表最后一项是「其他」
  await page.keyboard.press('Enter');
  await expect(category).toContainText('其他');
  await expect(page.getByText('该分类暂无结构化验货清单，可以直接发布。')).toBeVisible();
  const contact = page.getByLabel(/^联系方式/);
  await tabTo(page, contact);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('13800000000');
  await tabTo(page, page.getByRole('button', { name: '选择图片 1', exact: true }));
  await page.keyboard.press('Space');
  await expect(page.getByText(/商品图片（1\/9）/)).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: '立即发布' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('发布成功，快去看看你的宝贝吧～')).toBeVisible();
  const product = (await apiOk(seller, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).items[0];
  expect(product.title).toBe(title);

  const buyer = await party('键盘买家');
  const bp = buyer.page;
  await open(buyer, `/product/${product.id}`);
  await tabTo(bp, bp.getByRole('button', { name: '我想要' }));
  await bp.keyboard.press('Enter');
  await expect(bp.getByText('联系申请已发送，等待卖家同意')).toBeVisible();

  await open(seller, '/profile/contact-requests');
  await tabTo(page, page.getByRole('button', { name: '同意展示联系方式' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('已同意，仅该买家可以查看联系方式')).toBeVisible();
  expect((await apiOk(buyer, 'GET', `/v1/products/${product.id}/contact-request`)).status).toBe('APPROVED');
  await open(buyer, `/product/${product.id}`);
  await expect(bp.getByText('卖家联系方式：13800000000')).toBeVisible();
});
