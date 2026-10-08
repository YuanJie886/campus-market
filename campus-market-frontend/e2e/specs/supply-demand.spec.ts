import { apiCall, apiOk, expect, open, test, type Party } from '../fixtures';

/** 8.1 #4 批量发布与失败回滚（全有或全无）；#5 普通关键词需求命中 */

const payload = (title: string) => ({
  title, description: 'E2E 批量发布', price: 15, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

async function draft(owner: Party, title: string) {
  return apiOk(owner, 'POST', '/v1/listing-drafts', { draftType: 'SINGLE', payload: payload(title) });
}

test('#4 批量发布：确认后服务端发现一件不合格 → 整个批次都没有发布；修好后一次发布全部', async ({ party }) => {
  const owner = await party('毕业生');
  const prefix = `E2E 批量 ${Date.now().toString(36)}`;
  const drafts = [await draft(owner, `${prefix}-1`), await draft(owner, `${prefix}-2`), await draft(owner, `${prefix}-3`)];
  const batch = await apiOk(owner, 'POST', '/v1/listing-batches', { draftIds: drafts.map((d: { id: string }) => d.id) });
  await open(owner, `/publish/batch?batch=${batch.id}`);
  await owner.page.getByRole('button', { name: '发布这 3 件' }).click();
  const confirm = owner.page.getByRole('dialog', { name: '确认一次发布 3 件？' });
  await expect(confirm).toContainText('任何一件失败，这个批次都不会发布任何商品');
  // 客户端检查通过之后、确认之前，第 2 件在服务端变得不合格（例如在另一台设备上清空了价格）
  const d2 = await apiOk(owner, 'GET', `/v1/listing-drafts/${drafts[1].id}`);
  await apiOk(owner, 'PATCH', `/v1/listing-drafts/${drafts[1].id}`, { expectedVersion: d2.version, payload: { ...payload(`${prefix}-2`), price: null } });
  await confirm.getByRole('button', { name: '确认发布' }).click();
  await expect(owner.page.getByText('整个批次都没有发布。请按下面的清单逐件修改，其他已填写的内容都还在。')).toBeVisible();
  await expect(owner.page.getByText(/第 2 件/).first()).toBeVisible();
  expect((await apiOk(owner, 'GET', `/v1/products?keyword=${encodeURIComponent(prefix)}`)).total).toBe(0);

  const again = await apiOk(owner, 'GET', `/v1/listing-drafts/${drafts[1].id}`);
  await apiOk(owner, 'PATCH', `/v1/listing-drafts/${drafts[1].id}`, { expectedVersion: again.version, payload: payload(`${prefix}-2`) });
  await owner.page.reload();
  await owner.page.getByRole('button', { name: '发布这 3 件' }).click();
  await owner.page.getByRole('dialog', { name: '确认一次发布 3 件？' }).getByRole('button', { name: '确认发布' }).click();
  await expect(owner.page.getByText('已发布 3 件')).toBeVisible();
  expect((await apiOk(owner, 'GET', `/v1/products?keyword=${encodeURIComponent(prefix)}`)).total).toBe(3);
});

test('#5 关键词需求：搜索无结果时订阅 → 之后同校有人发布标题含关键词的商品 → 匹配收件箱出现这件商品', async ({ party }) => {
  const buyer = await party('求购者');
  const seller = await party('出售者');
  const keyword = `显示器${Date.now().toString(36).slice(-4)}`;
  await open(buyer, `/?keyword=${encodeURIComponent(keyword)}`);
  await buyer.page.getByRole('button', { name: '订阅这个需求' }).click();
  const dialog = buyer.page.getByRole('dialog');
  await expect(dialog.getByLabel(/^关键词/)).toHaveValue(keyword);
  await dialog.getByRole('button', { name: /订阅/ }).last().click();
  await expect(buyer.page.getByText(/已订阅|订阅成功/).first()).toBeVisible();
  const title = `九成新 ${keyword} 27 寸`;
  await apiOk(seller, 'POST', '/v1/products', { ...payload(title), price: 500 });
  await open(buyer, '/demands');
  await expect(buyer.page.getByRole('list', { name: '需求匹配列表' }).getByText(title)).toBeVisible();
  // 不相关的关键词不会命中
  const matches = await apiOk(buyer, 'GET', '/v1/demand-matches');
  expect(JSON.stringify(matches)).toContain(title);
  expect((await apiCall(buyer, 'GET', '/v1/demand-subscriptions')).data.length).toBe(1);
});
