import type { Locator, Page } from '@playwright/test';
import { apiOk, expect, hourStart, open, test } from '../fixtures';

/** 8.1 #15 手机尺寸关键路径；#16 只用键盘完成发布与预约的核心操作 */

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

/** 在 datetime-local 里逐段输入（年 → 月 → 日 → 时 → 分），全部通过键盘 */
async function typeDateTime(page: Page, d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  await page.keyboard.type(String(d.getFullYear()));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(p(d.getMonth() + 1));
  await page.keyboard.type(p(d.getDate()));
  await page.keyboard.type(p(d.getHours()));
  await page.keyboard.type(p(d.getMinutes()));
}

test('#15 手机尺寸（390×844）：搜索 → 商品详情 → 预约对话框完整可用 → 我的订单；各步都没有横向滚动', async ({ party }) => {
  const seller = await party('手机卖家');
  const title = `E2E 手机台灯 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const buyer = await party('手机买家', { viewport: { width: 390, height: 844 } });
  await open(buyer, `/?keyword=${encodeURIComponent(title)}`);
  await noHorizontalScroll(buyer.page);
  await buyer.page.getByRole('link', { name: `查看闲置：${title}` }).filter({ visible: true }).first().click();
  await expect(buyer.page.getByRole('heading', { name: title }).filter({ visible: true }).first()).toBeVisible();
  await noHorizontalScroll(buyer.page);
  await buyer.page.getByRole('button', { name: '我想要' }).click();
  const dialog = buyer.page.getByRole('dialog', { name: '预约校园面交' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await buyer.page.getByRole('combobox', { name: '面交地点' }).click();
  await buyer.page.getByRole('option', { name: /图书馆门口/ }).click();
  const start = hourStart(30);
  const pad = (n: number) => String(n).padStart(2, '0');
  await dialog.getByLabel('面交时间').fill(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:00`);
  await expect(dialog.getByTestId('booking-slot')).toContainText('60 分钟');
  await dialog.getByRole('button', { name: '确认预约' }).scrollIntoViewIfNeeded();
  await dialog.getByRole('button', { name: '确认预约' }).click();
  await expect(buyer.page.getByText('预约成功，等待卖家确认')).toBeVisible();
  await expect(buyer.page).toHaveURL(/\/profile\/orders$/);
  await expect(buyer.page.getByText(title)).toBeVisible();
  await noHorizontalScroll(buyer.page);
  expect((await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0].productId).toBe(product.id);
});

test('#16 只用键盘：发布一件商品（Tab 定位、键入、方向键选分类、空格选图片、回车提交），再用键盘完成预约', async ({ party }) => {
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
  await expect(page.getByText(/商品图片（1\/5）/)).toBeVisible();
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
  const dialog = bp.getByRole('dialog', { name: '预约校园面交' });
  const point = bp.getByRole('combobox', { name: '面交地点' });
  await tabTo(bp, point);
  await bp.keyboard.press('Enter');
  await bp.keyboard.press('ArrowDown');
  await bp.keyboard.press('Enter');                     // 用方向键选一个面交点
  await expect(point).toContainText(/东校区 · /);
  await tabTo(bp, dialog.getByLabel('面交时间'));
  const start = hourStart(30);
  await typeDateTime(bp, start);
  await expect(dialog.getByTestId('booking-slot')).toContainText('（60 分钟）');
  await tabTo(bp, dialog.getByRole('button', { name: '确认预约' }));
  await bp.keyboard.press('Enter');
  await expect(bp.getByText('预约成功，等待卖家确认')).toBeVisible();
  const order = (await apiOk(buyer, 'GET', '/v1/orders?role=buyer'))[0];
  expect(Date.parse(order.meetingAtIso)).toBe(start.getTime());
  expect(Date.parse(order.meetingEndsAtIso) - Date.parse(order.meetingAtIso)).toBe(60 * 60_000);
});
