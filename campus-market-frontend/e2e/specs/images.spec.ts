import { apiOk, expect, open, sql, test } from '../fixtures';

/**
 * 阶段 4 图片上传（docs/images-and-content-safety.md），真实后端 + 与 nginx 相同 CSP 的静态服务器：
 *   #I1 卖家在发布页用文件输入框上传一张真实 PNG（浏览器里生成的内存缓冲区，不读本机文件）→ 发布 →
 *       商品里只存 upload:<id> 引用，响应里是短时签名地址（同源相对路径）；卖家与同校买家在商品详情页都能看到图片真正加载出来
 *       （naturalWidth > 0，CSP 的 img-src 'self' 允许），控制台没有 CSP 违规；
 *   #I2 内容安全：标题命中违禁词时，发布表单旁原样显示「内容可能包含违规信息，请修改后再提交」，商品没有发布。
 */

// ---------- 生成一张有效的 PNG（存储型 deflate，不依赖 zlib） ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff] }
function chunk(type: string, data: number[]): number[] {
  const body = [...type].map((ch) => ch.charCodeAt(0)).concat(data);
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}
/** size×size 的纯色 RGB PNG */
function solidPng(size = 16, rgb: [number, number, number] = [220, 60, 40]): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < size; y++) { raw.push(0); for (let x = 0; x < size; x++) raw.push(...rgb) }
  let a = 1, b = 0;
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521 }
  // zlib：头 0x78 0x01 + 一个存储块（BFINAL=1, BTYPE=00）+ Adler-32
  const len = raw.length;
  const zlib = [0x78, 0x01, 0x01, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff, ...raw, ...u32(((b << 16) | a) >>> 0)];
  const ihdr = [...u32(size), ...u32(size), 8, 2, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', zlib), ...chunk('IEND', [])]);
}

async function pickOption(page: import('@playwright/test').Page, label: RegExp, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test('#I1 发布页上传真实 PNG：商品只存 upload 引用，详情页在 CSP 下真正加载出图片（卖家与同校买家）', async ({ party, consoleErrors }) => {
  const seller = await party('上传卖家');
  const page = seller.page;
  const title = `E2E 上传图片 ${Date.now().toString(36)}`;
  await open(seller, '/publish');
  await page.getByLabel(/^商品标题/).fill(title);
  await page.getByLabel(/^商品描述/).fill('E2E 真实浏览器测试：上传一张真实的图片。');
  await page.getByLabel(/^出售价格/).fill('42');
  await pickOption(page, /^分类/, '其他');
  await pickOption(page, /^成色/, '几乎全新');
  await expect(page.getByText('该分类暂无结构化验货清单，可以直接发布。')).toBeVisible();
  await page.getByLabel(/^联系方式/).fill('13800000000');

  const input = page.getByLabel('上传图片');
  await expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
  await input.setInputFiles({ name: 'e2e-upload.png', mimeType: 'image/png', buffer: Buffer.from(solidPng()) });
  const thumb = page.getByRole('img', { name: '商品图片第 1 张（封面）' });
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('src', /^\/v1\/images\/[0-9a-f-]{36}\?exp=\d+&sig=/);
  // 张数上限来自 GET /v1/config（默认 9；旧后端 404 时同样回落到 9）
  await expect(page.getByText('商品图片（1/9）')).toBeVisible();

  await page.getByRole('button', { name: '立即发布' }).click();
  await expect(page.getByText('发布成功，快去看看你的宝贝吧～')).toBeVisible();
  await expect(page).toHaveURL(/\/product\/[0-9a-f-]{36}$/);
  const productId = page.url().split('/').pop()!;

  // 库里只存引用；响应里是签名地址
  expect(sql(`SELECT images::text FROM products WHERE id = '${productId}'`)).toMatch(/^\["upload:[0-9a-f-]{36}"\]$/);
  expect((await apiOk(seller, 'GET', `/v1/products/${productId}`)).images[0]).toMatch(/^\/v1\/images\/[0-9a-f-]{36}\?exp=\d+&sig=/);

  const loaded = async (p: import('@playwright/test').Page) => {
    const img = p.getByRole('img', { name: title, exact: true });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    return img.getAttribute('src');
  };
  expect(await loaded(page)).toMatch(/^\/v1\/images\//);

  const buyer = await party('看图买家');
  await open(buyer, `/product/${productId}`);
  expect(await loaded(buyer.page)).toMatch(/^\/v1\/images\//);

  expect(consoleErrors.filter((e) => /Content Security Policy|Refused to load the image/i.test(e))).toEqual([]);
});

test('#I2 内容安全：标题命中违禁词时，发布表单旁原样显示统一提示，商品没有发布', async ({ party }) => {
  const seller = await party('违禁卖家');
  const page = seller.page;
  const title = `E2E 四六级代考 ${Date.now().toString(36)}`;
  await open(seller, '/publish');
  await page.getByLabel(/^商品标题/).fill(title);
  await page.getByLabel(/^商品描述/).fill('E2E 真实浏览器测试：内容安全拦截。');
  await page.getByLabel(/^出售价格/).fill('10');
  await pickOption(page, /^分类/, '其他');
  await pickOption(page, /^成色/, '几乎全新');
  await page.getByLabel(/^联系方式/).fill('13800000000');
  await page.getByRole('button', { name: '选择图片 1', exact: true }).click();
  await page.getByRole('button', { name: '立即发布' }).click();
  // 表单里的内联提示（全局提示条里也会有同一句话）
  await expect(page.locator('.MuiStack-root').getByRole('alert').filter({ hasText: '内容可能包含违规信息，请修改后再提交' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/publish$/);
  expect(sql(`SELECT count(*) FROM products WHERE title = '${title}'`)).toBe('0');
});
