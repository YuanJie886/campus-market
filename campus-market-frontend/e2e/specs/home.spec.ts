import type { Page, Request } from '@playwright/test';
import { apiOk, expect, open, test, type Party } from '../fixtures';

/**
 * 首页对齐小程序（主产品）：
 *   #H1 未登录：落地页说明产品与三步，主按钮去登录，协议链接；1280 / 390 都没有横向滚动；
 *   #H2 范围切换（真实后端 + 种子宿舍楼）：本楼 → feed scope=BUILDING，本楼没有时放宽到本园区并提示；
 *       本校区 → scope=CAMPUS（只含本人校区、不放宽）；全校 → 普通列表；所选范围在本次会话内保留；
 *   #H3 没填宿舍楼：本楼 → 409 →「去设置」引导；本校区不需要宿舍楼；
 *   #H4 登录后的首页：390×844 没有横向滚动、两列网格；1280×800 四列网格。
 * 种子楼栋来自 V3__building_market.sql：东校区 沁园 1～3 号楼、松园 4～5 号楼。
 */

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title, description: 'E2E 首页范围', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000', ...extra,
});

const tagOf = () => `首页${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

async function noHorizontalScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, '页面不应出现横向滚动').toBeLessThanOrEqual(width + 1);
}

const isFeed = (request: Request) => new URL(request.url()).pathname === '/v1/products/feed';

/** 选择一个范围，并返回它触发的 feed 请求参数（「全校」不请求 feed，返回 null） */
async function pickScope(page: Page, name: '本楼' | '本校区' | '全校'): Promise<URLSearchParams | null> {
  const radio = page.getByRole('radio', { name });
  if (name === '全校') {
    await radio.check();
    await expect(radio).toBeChecked();
    return null;
  }
  const [request] = await Promise.all([page.waitForRequest(isFeed), radio.check()]);
  await expect(radio).toBeChecked();
  return new URL(request.url()).searchParams;
}

async function gridColumns(page: Page): Promise<number> {
  const list = page.getByRole('list', { name: '商品列表' });
  await expect(list).toBeVisible();
  return list.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
}

test('#H1 未登录：首页是说明产品的落地页（同校闲置展示、申请联系方式、卖家同意后才展示、平台不交易不支付），1280 与 390 都没有横向滚动', async ({ party }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const guest = await party(`访客${viewport.width}`, { register: false, viewport });
    const page = guest.page;
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: '同校同学的闲置，在这里展示和找到' })).toBeVisible();
    await expect(page.getByText('登录后查看本校在售好物')).toBeVisible();
    await expect(page.getByText('卖家发布闲置，买家看中后申请联系方式，卖家同意后才会展示。', { exact: false })).toBeVisible();
    await expect(page.getByText('平台不交易、不支付')).toBeVisible();
    await expect(page.getByRole('region', { name: '三步用起来' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('link', { name: '《用户协议》' })).toHaveAttribute('href', '/terms');
    await expect(page.getByRole('link', { name: '《隐私政策》' })).toHaveAttribute('href', '/privacy');
    await expect(page.getByRole('radiogroup', { name: '商品范围' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^查看闲置：/ })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/实名|认证/);
    await noHorizontalScroll(page);
    await page.getByRole('button', { name: '登录 / 注册' }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('#H2 范围切换：本楼（种子宿舍楼，放宽到本园区）→ 本校区（只含本人校区）→ 全校；请求参数与提示同小程序；范围在会话内保留', async ({ party }) => {
  const tag = tagOf();
  const seller = await party('东校卖家');
  const sameZone = `${tag} 沁园二号楼台灯`;
  await apiOk(seller, 'POST', '/v1/products', item(sameZone, { buildingId: 'east-qinyuan-2' }));
  const westSeller = await party('西校卖家', { campus: '西校区' });
  const otherCampus = `${tag} 西校区书架`;
  await apiOk(westSeller, 'POST', '/v1/products', item(otherCampus, { campus: '西校区', buildingId: 'west-zhuyuan-1' }));

  const buyer: Party = await party('住沁园一号楼');
  await apiOk(buyer, 'PATCH', '/v1/auth/me', { dormBuildingId: 'east-qinyuan-1' });
  const page = buyer.page;
  await open(buyer, `/?keyword=${encodeURIComponent(tag)}`);
  await expect(page.getByRole('radio', { name: '全校' })).toBeChecked();
  await expect(page.getByRole('link', { name: `查看闲置：${otherCampus}` })).toBeVisible();

  // 本楼：本楼没有 → 服务端放宽到本园区，筛选（关键词）不变
  const building = await pickScope(page, '本楼');
  expect(building?.get('scope')).toBe('BUILDING');
  expect(building?.get('keyword')).toBe(tag);
  expect(building?.get('page')).toBe('1');
  expect(building?.has('campus')).toBe(false);
  await expect(page.getByRole('status').filter({ hasText: '本楼暂无匹配，已为你展示本园区的商品（筛选条件保持不变）。' })).toBeVisible();
  await expect(page.getByRole('link', { name: `查看闲置：${sameZone}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `查看闲置：${otherCampus}` })).toHaveCount(0);
  const feed = await apiOk(buyer, 'GET', `/v1/products/feed?scope=BUILDING&sort=latest&page=1&pageSize=40&keyword=${encodeURIComponent(tag)}`);
  expect(feed).toMatchObject({ requestedScope: 'BUILDING', effectiveScope: 'ZONE', fallbackApplied: true });

  // 本校区：本人校区，不放宽、没有提示
  const campus = await pickScope(page, '本校区');
  expect(campus?.get('scope')).toBe('CAMPUS');
  expect(campus?.get('keyword')).toBe(tag);
  await expect(page.getByRole('link', { name: `查看闲置：${sameZone}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `查看闲置：${otherCampus}` })).toHaveCount(0);
  await expect(page.getByText(/本楼暂无匹配|全校都没有/)).toHaveCount(0);

  // 本次会话内保留所选范围（与小程序常驻的集市页一致）
  await page.reload();
  await expect(page.getByRole('button', { name: '用户菜单' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '本校区' })).toBeChecked();

  // 全校：回到普通列表，不再请求 feed
  let feedRequests = 0;
  page.on('request', (r) => { if (isFeed(r)) feedRequests += 1 });
  await pickScope(page, '全校');
  await expect(page.getByRole('link', { name: `查看闲置：${otherCampus}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `查看闲置：${sameZone}` })).toBeVisible();
  expect(feedRequests).toBe(0);
  await noHorizontalScroll(page);
});

test('#H3 没填宿舍楼：本楼 → 409 →「去设置」引导（不显示结果或订阅入口）；本校区不需要宿舍楼；本校区为空时给订阅入口', async ({ party }) => {
  const tag = tagOf();
  const buyer = await party('没填宿舍楼');
  const page = buyer.page;
  await open(buyer, `/?keyword=${encodeURIComponent(tag)}`);

  const [response] = await Promise.all([page.waitForResponse((r) => isFeed(r.request())), page.getByRole('radio', { name: '本楼' }).check()]);
  expect(response.status()).toBe(409);
  await expect(page.getByText('还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。')).toBeVisible();
  await expect(page.getByRole('link', { name: '去设置' })).toHaveAttribute('href', '/profile');
  await expect(page.getByRole('button', { name: '订阅这个需求' })).toHaveCount(0);

  const [campusResponse] = await Promise.all([page.waitForResponse((r) => isFeed(r.request())), page.getByRole('radio', { name: '本校区' }).check()]);
  expect(campusResponse.status()).toBe(200);
  expect(new URL(campusResponse.url()).searchParams.get('scope')).toBe('CAMPUS');
  await expect(page.getByRole('heading', { name: '暂时没有找到合适的好物' })).toBeVisible();
  await expect(page.getByText('没有找到？订阅一下，有货第一时间通知你。')).toBeVisible();
  await expect(page.getByRole('button', { name: '订阅这个需求' })).toBeVisible();
  await expect(page.getByText(/还没有填写宿舍楼/)).toHaveCount(0);
});

test('#H4 登录后的首页：390×844 没有横向滚动、两列网格、搜索可用；1280×800 四列网格', async ({ party }) => {
  const seller = await party('网格卖家');
  const tag = tagOf();
  for (let i = 0; i < 5; i += 1) await apiOk(seller, 'POST', '/v1/products', item(`${tag} 第${i + 1}件 一个比较长的标题用来检查两行截断`));

  const phone = await party('手机', { viewport: { width: 390, height: 844 } });
  await open(phone, '/');
  const search = phone.page.getByRole('searchbox', { name: '搜索商品' });
  await search.fill(tag);
  await search.press('Enter');
  await expect(phone.page).toHaveURL(new RegExp(`\\?keyword=${encodeURIComponent(tag)}$`));
  await expect(phone.page.getByRole('link', { name: /^查看闲置：/ })).toHaveCount(5);
  expect(await gridColumns(phone.page)).toBe(2);
  await noHorizontalScroll(phone.page);
  await phone.page.getByRole('button', { name: /筛选与排序/ }).click();
  await expect(phone.page.getByLabel('最低价')).toBeVisible();
  await noHorizontalScroll(phone.page);

  const desktop = await party('桌面', { viewport: { width: 1280, height: 800 } });
  await open(desktop, `/?keyword=${encodeURIComponent(tag)}`);
  await expect(desktop.page.getByRole('link', { name: /^查看闲置：/ })).toHaveCount(5);
  expect(await gridColumns(desktop.page)).toBe(4);
  await noHorizontalScroll(desktop.page);
});
