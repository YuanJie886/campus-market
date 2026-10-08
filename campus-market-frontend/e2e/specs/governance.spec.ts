import { apiOk, expect, hourStart, localInput, makeStaff, open, slotEndedMinutesAgo, sql, test, type Party } from '../fixtures';

/** 8.1 #10 受限用户不能新下单但能完成已有订单；#11 爽约报告不自动处罚；#12 工作人员处理与另一位工作人员处理申诉 */

const single = (title: string) => ({
  title, description: 'E2E 治理', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});
const orderBody = (productId: string) => ({
  productId, meetingPointId: '东校区-library', meetingAtIso: hourStart(30).toISOString(), contact: '13800000000',
  idempotencyKey: crypto.randomUUID(),
});

async function acceptedOrder(seller: Party, buyer: Party, title: string) {
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const order = await apiOk(buyer, 'POST', '/v1/orders', orderBody(product.id), { 'Idempotency-Key': crypto.randomUUID() });
  await apiOk(seller, 'POST', `/v1/orders/${order.id}/transitions`, { to: 'PENDING_MEETING' });
  return { product, order };
}

/** 工作人员在界面上对一个用户案件执行「限制预约新订单」 */
async function staffRestrictsBooking(staff: Party, target: Party, reporter: Party) {
  await apiOk(reporter, 'POST', '/v1/moderation-reports', { targetType: 'USER', targetId: target.id, reasonCode: 'HARASSMENT' });
  // 队列按学校共享（并行测试会产生多个用户案件）：按目标找到本测试的案件，再在界面上处理
  const caseId = sql(`SELECT id FROM moderation_cases WHERE target_type = 'USER' AND target_id = '${target.id}' ORDER BY created_at DESC LIMIT 1`);
  await open(staff, '/moderation');
  await expect(staff.page.getByRole('list', { name: '案件列表' })).toBeVisible();
  await open(staff, `/moderation/cases/${caseId}`);
  await staff.page.getByRole('radio', { name: '限制预约新订单（需要二次确认）' }).check();
  await staff.page.getByRole('combobox', { name: /处理原因/ }).click();
  await staff.page.getByRole('option', { name: '骚扰' }).click();
  await staff.page.getByRole('button', { name: '提交处理' }).click();
  const confirm = staff.page.getByRole('dialog', { name: '确认执行「限制预约新订单」？' });
  await expect(confirm).toContainText('到期自动解除');
  await confirm.getByRole('button', { name: '确认限制预约新订单' }).click();
  await expect(staff.page.getByText(/已处理：限制预约新订单。操作已写入审计/)).toBeVisible();
}

test('#10 受限用户：不能预约新订单（界面给出原因与到期时间）；已经成立的订单照常确认与核销', async ({ party, secrets }) => {
  const staff = await party('工作人员');
  makeStaff(staff.id);
  const seller = await party('卖家');
  const buyer = await party('被限制买家');
  const reporter = await party('举报人');
  const { order } = await acceptedOrder(seller, buyer, `E2E 已有订单 ${Date.now().toString(36)}`);
  await staffRestrictsBooking(staff, buyer, reporter);

  const other = await apiOk(seller, 'POST', '/v1/products', single(`E2E 新商品 ${Date.now().toString(36)}`));
  await open(buyer, `/product/${other.id}`);
  await buyer.page.getByRole('button', { name: '我想要' }).click();
  const dialog = buyer.page.getByRole('dialog', { name: '预约校园面交' });
  await buyer.page.getByRole('combobox', { name: '面交地点' }).click();
  await buyer.page.getByRole('option', { name: /图书馆门口/ }).click();
  await dialog.getByLabel('面交时间').fill(localInput(hourStart(40)));
  await dialog.getByRole('button', { name: '确认预约' }).click();
  await expect(buyer.page.getByText(/「预约新订单」功能暂时受限，至 .* 自动恢复/)).toBeVisible();

  // 已有订单：买家确认面交、卖家核销
  const code = (await apiOk(buyer, 'GET', '/v1/orders?role=buyer')).find((o: { id: string }) => o.id === order.id).confirmationCode as string;
  secrets.add(code);
  await open(buyer, '/profile/orders');
  await buyer.page.getByRole('button', { name: '已验货付款，确认面交' }).click();
  await expect(buyer.page.getByText('订单已更新')).toBeVisible();
  await open(seller, '/profile/orders');
  await seller.page.getByRole('tab', { name: '我卖出的' }).click();
  await seller.page.getByLabel('买家提供的六位确认码').fill(code);
  await seller.page.getByRole('button', { name: '核验并完成交易' }).click();
  await expect(seller.page.getByText('双方已确认，交易完成')).toBeVisible();

  await open(buyer, '/profile/restrictions');
  await expect(buyer.page.getByText('暂时不能：预约新订单（生效中）')).toBeVisible();
  await expect(buyer.page.getByText(/仍然可以浏览、沟通，并完成已经成立的订单/)).toBeVisible();
});

test('#11 爽约报告：档期结束后报告对方，报告只是「等待对方回应」，不产生任何限制；对方可以照常下单', async ({ party }) => {
  const seller = await party('报告卖家');
  const buyer = await party('被报告买家');
  // 先有一次已确认的爽约：如果单方报告会被当成处罚依据，下一次就会触发 24 小时限制
  const first = await acceptedOrder(seller, buyer, `E2E 爽约一 ${Date.now().toString(36)}`);
  slotEndedMinutesAgo(first.order.id, 30);
  const r1 = await apiOk(seller, 'POST', `/v1/orders/${first.order.id}/no-show-reports`, { reasonCode: 'DID_NOT_ARRIVE' });
  await apiOk(buyer, 'POST', `/v1/no-show-reports/${r1.id}/acknowledge`, {});

  const second = await acceptedOrder(seller, buyer, `E2E 爽约二 ${Date.now().toString(36)}`);
  slotEndedMinutesAgo(second.order.id, 30);
  await open(seller, `/orders/${second.order.id}`);
  await expect(seller.page.getByText(/判断依据：双方确认、接受时冻结的档期/)).toBeVisible();
  await seller.page.getByRole('button', { name: '报告对方爽约' }).click();
  const dialog = seller.page.getByRole('dialog', { name: '报告对方爽约' });
  await dialog.getByRole('radio', { name: '对方没有到场' }).check();
  await dialog.getByRole('button', { name: '提交报告' }).click();
  await expect(seller.page.getByText(/等待对方回应（不会产生任何处罚）/)).toBeVisible();

  await open(buyer, '/profile/restrictions');
  await expect(buyer.page.getByText('目前没有生效中的限制。')).toBeVisible();
  const again = await apiOk(seller, 'POST', '/v1/products', single(`E2E 爽约后 ${Date.now().toString(36)}`));
  const r = await buyer.context.request.post('/v1/orders', { data: orderBody(again.id), headers: { Authorization: `Bearer ${buyer.token}`, 'Idempotency-Key': crypto.randomUUID() } });
  expect(r.status()).toBe(200);
});

test('#12 工作人员 A 在界面上限制 → 用户在界面上申诉 → A 的申诉队列里没有这条（回避）→ 工作人员 B 在界面上接受 → 限制解除', async ({ party }) => {
  const a = await party('工作人员A');
  makeStaff(a.id);
  const b = await party('工作人员B');
  makeStaff(b.id);
  const target = await party('申诉人');
  const reporter = await party('举报人2');
  await staffRestrictsBooking(a, target, reporter);

  await open(target, '/profile/restrictions');
  await target.page.getByRole('button', { name: '对「预约新订单」限制提出申诉' }).click();
  const dialog = target.page.getByRole('dialog', { name: '提出申诉' });
  await dialog.getByLabel('申诉理由').fill('我没有骚扰，请复核聊天记录');
  await dialog.getByRole('button', { name: '提交申诉' }).click();
  await expect(target.page.getByText('申诉已提交，将由另一位平台工作人员处理。')).toBeVisible();

  await open(a, '/moderation/appeals');
  await expect(a.page.getByText(/与你本人或你做出的处理有关的申诉会由其他工作人员决定/)).toBeVisible();
  await expect(a.page.getByText('我没有骚扰，请复核聊天记录')).toHaveCount(0);

  await open(b, '/moderation/appeals');
  await expect(b.page.getByText('申诉理由：我没有骚扰，请复核聊天记录')).toBeVisible();
  await b.page.getByRole('button', { name: '接受申诉' }).click();
  const accept = b.page.getByRole('dialog', { name: '接受这条申诉？' });
  await accept.getByRole('button', { name: '确认接受申诉' }).click();
  await expect(b.page.getByText(/申诉已接受，已写入审计/)).toBeVisible();

  await open(target, '/profile/restrictions');
  await expect(target.page.getByText('目前没有生效中的限制。')).toBeVisible();
});
