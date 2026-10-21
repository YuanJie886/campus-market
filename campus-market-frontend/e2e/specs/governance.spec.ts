import { apiCall, apiOk, expect, makeStaff, open, sql, test, type Party } from '../fixtures';

/**
 * #9 举报商品 → 工作人员在界面上隐藏 → 其他同学与已获同意的买家都看不到，卖家看到被隐藏；
 * #10 受限用户不能发布新商品（界面给出原因与到期时间），仍然可以下架已有商品与沟通；
 * #12 工作人员处理与另一位工作人员处理申诉（含回避）。
 * 原 #11「爽约报告不自动处罚」依赖的预约与爽约接口已随交易流程移除，场景退役。
 */

const single = (title: string) => ({
  title, description: 'E2E 治理', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

function caseFor(type: 'USER' | 'PRODUCT', targetId: string) {
  return sql(`SELECT id FROM moderation_cases WHERE target_type = '${type}' AND target_id = '${targetId}' ORDER BY created_at DESC LIMIT 1`);
}

/** 工作人员在界面上处理一个案件（高风险动作需要二次确认） */
async function staffDecides(staff: Party, caseId: string, action: string, reason: string) {
  // 队列按学校共享（并行测试会产生多个案件）：先确认队列可用，再按 id 打开本测试的案件
  await open(staff, '/moderation');
  await expect(staff.page.getByRole('list', { name: '案件列表' })).toBeVisible();
  await open(staff, `/moderation/cases/${caseId}`);
  await staff.page.getByRole('radio', { name: `${action}（需要二次确认）` }).check();
  await staff.page.getByRole('combobox', { name: /处理原因/ }).click();
  await staff.page.getByRole('option', { name: reason }).click();
  await staff.page.getByRole('button', { name: '提交处理' }).click();
  const confirm = staff.page.getByRole('dialog', { name: `确认执行「${action}」？` });
  await confirm.getByRole('button', { name: `确认${action}` }).click();
  await expect(staff.page.getByText(new RegExp(`已处理：${action}。操作已写入审计`))).toBeVisible();
}

async function staffRestrictsPublishing(staff: Party, target: Party, reporter: Party) {
  await apiOk(reporter, 'POST', '/v1/moderation-reports', { targetType: 'USER', targetId: target.id, reasonCode: 'SPAM' });
  await staffDecides(staff, caseFor('USER', target.id), '限制发布商品', '违反平台规则');
}

test('#9 隐藏商品：举报后工作人员在界面上隐藏 → 其他同学与已获同意联系的买家都看不到（与不存在相同），卖家看到被隐藏', async ({ party }) => {
  const staff = await party('工作人员');
  makeStaff(staff.id);
  const seller = await party('违规卖家');
  const buyer = await party('已同意买家');
  const viewer = await party('其他同学');
  const title = `E2E 违规商品 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const request = await apiOk(buyer, 'POST', `/v1/products/${product.id}/contact-request`, {});
  await apiOk(seller, 'POST', `/v1/contact-requests/${request.id}/decision`, { status: 'APPROVED' });
  await apiOk(viewer, 'POST', '/v1/moderation-reports', { targetType: 'PRODUCT', targetId: product.id, reasonCode: 'PROHIBITED_ITEM' });

  await staffDecides(staff, caseFor('PRODUCT', product.id), '隐藏商品', '违禁物品');

  for (const who of [viewer, buyer]) {
    await open(who, `/product/${product.id}`);
    await expect(who.page.getByText('商品不存在或已被删除')).toBeVisible();
    await expect(who.page.getByText('13800000000')).toHaveCount(0);
    expect((await apiOk(who, 'GET', `/v1/products?keyword=${encodeURIComponent(title)}`)).total).toBe(0);
  }
  expect(JSON.stringify(await apiOk(buyer, 'GET', '/v1/contact-requests'))).not.toContain(product.id);
  expect((await apiOk(seller, 'GET', `/v1/products/${product.id}`)).moderationHidden).toBe(true);
});

test('#10 受限用户：不能发布新商品（界面给出原因与到期时间）；已有商品照常下架，「我的限制」写明仍然可以做的事', async ({ party }) => {
  const staff = await party('工作人员');
  makeStaff(staff.id);
  const target = await party('被限制卖家');
  const reporter = await party('举报人');
  await apiOk(target, 'POST', '/v1/products', single(`E2E 受限前商品 ${Date.now().toString(36)}`));
  await staffRestrictsPublishing(staff, target, reporter);

  const page = target.page;
  await open(target, '/publish');
  await page.getByLabel(/^商品标题/).fill(`E2E 受限发布 ${Date.now().toString(36)}`);
  await page.getByLabel(/^商品描述/).fill('受限期间尝试发布一件新的商品，用来确认发布入口被拦截。');
  await page.getByLabel(/^出售价格/).fill('20');
  await page.getByRole('combobox', { name: /^分类/ }).click();
  await page.getByRole('option', { name: '其他' }).click();
  await page.getByRole('combobox', { name: /^成色/ }).click();
  await page.getByRole('option', { name: '几乎全新' }).click();
  await page.getByLabel(/^联系方式/).fill('13800000000');
  await page.getByRole('button', { name: '选择图片 1', exact: true }).click();
  await page.getByRole('button', { name: '立即发布' }).click();
  await expect(page.getByRole('main').getByText(/「发布商品」功能暂时受限，至 .* 自动恢复/)).toBeVisible();

  await open(target, '/profile/listings');
  await page.getByRole('button', { name: '下架' }).click();
  await expect(page.getByText('商品已下架')).toBeVisible();

  await open(target, '/profile/restrictions');
  await expect(page.getByText('暂时不能：发布商品（生效中）')).toBeVisible();
  await expect(page.getByText(/仍然可以保存草稿、下架已发布的商品/)).toBeVisible();
  expect((await apiCall(target, 'POST', '/v1/products', single('E2E 接口也被拦'))).status).toBe(403);
});

test('#12 工作人员 A 在界面上限制 → 用户在界面上申诉 → A 的申诉队列里没有这条（回避）→ 工作人员 B 在界面上接受 → 限制解除', async ({ party }) => {
  const a = await party('工作人员A');
  makeStaff(a.id);
  const b = await party('工作人员B');
  makeStaff(b.id);
  const target = await party('申诉人');
  const reporter = await party('举报人2');
  await staffRestrictsPublishing(a, target, reporter);

  await open(target, '/profile/restrictions');
  await target.page.getByRole('button', { name: '对「发布商品」限制提出申诉' }).click();
  const dialog = target.page.getByRole('dialog', { name: '提出申诉' });
  await dialog.getByLabel('申诉理由').fill('我没有发布垃圾信息，请复核');
  await dialog.getByRole('button', { name: '提交申诉' }).click();
  await expect(target.page.getByText('申诉已提交，将由另一位平台工作人员处理。')).toBeVisible();

  await open(a, '/moderation/appeals');
  await expect(a.page.getByText(/与你本人或你做出的处理有关的申诉会由其他工作人员决定/)).toBeVisible();
  await expect(a.page.getByText('我没有发布垃圾信息，请复核')).toHaveCount(0);

  await open(b, '/moderation/appeals');
  await expect(b.page.getByText('申诉理由：我没有发布垃圾信息，请复核')).toBeVisible();
  await b.page.getByRole('button', { name: '接受申诉' }).click();
  const accept = b.page.getByRole('dialog', { name: '接受这条申诉？' });
  await accept.getByRole('button', { name: '确认接受申诉' }).click();
  await expect(b.page.getByText(/申诉已接受，已写入审计/)).toBeVisible();

  await open(target, '/profile/restrictions');
  await expect(target.page.getByText('目前没有生效中的限制。')).toBeVisible();
  expect((await apiCall(target, 'POST', '/v1/products', single(`E2E 解除后发布 ${Date.now().toString(36)}`))).status).toBe(200);
});
