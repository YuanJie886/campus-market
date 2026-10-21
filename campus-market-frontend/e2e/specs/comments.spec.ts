import { apiOk, expect, open, sql, test } from '../fixtures';

/**
 * 商品留言板（与小程序 CommentBoard 一致）：
 *   #C1 买家在界面上留言（自由文字）→ 卖家在界面上回复 → 第三人在界面上举报这条回复（举报对象是回复本身）；
 *   #C2 内容安全：留言命中违禁词时，留言框下方原样显示服务端的「内容可能包含违规信息，请修改后再提交」，原文保留，没有发出。
 */

const PLACEHOLDER = '想问点什么？例如：还在吗？能小刀吗？';
const BLOCKED = '内容可能包含违规信息，请修改后再提交';

const single = (title: string) => ({
  title, description: 'E2E 商品留言', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

test('#C1 留言与回复都在界面上完成；第三人举报的是那条回复', async ({ party }) => {
  const seller = await party('留言卖家');
  const title = `E2E 留言台灯 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));
  const question = `周末可以看实物吗 ${Date.now().toString(36)}`;
  const answer = `可以，周六下午在图书馆门口 ${Date.now().toString(36)}`;

  const buyer = await party('留言买家');
  await open(buyer, `/product/${product.id}`);
  await buyer.page.getByPlaceholder(PLACEHOLDER).fill(question);
  await buyer.page.getByRole('button', { name: '留言', exact: true }).click();
  await expect(buyer.page.getByText('留言成功')).toBeVisible();
  await expect(buyer.page.getByText(question)).toBeVisible();

  await open(seller, `/product/${product.id}`);
  await expect(seller.page.getByText(question)).toBeVisible();
  await expect(seller.page.getByRole('button', { name: '举报留言' })).toBeVisible();   // 别人的留言可以举报
  await seller.page.getByRole('button', { name: '回复', exact: true }).click();
  const replyBox = seller.page.getByPlaceholder(`回复 @${buyer.nickname}`);
  await expect(replyBox).toBeVisible();
  await replyBox.fill(answer);
  // 回复状态下提交按钮写「回复」（第一个是提交按钮，后面是每条留言下的「回复」）
  await seller.page.getByRole('button', { name: '回复', exact: true }).first().click();
  await expect(seller.page.getByText('留言成功')).toBeVisible();
  await expect(seller.page.getByText(answer)).toBeVisible();
  await expect(seller.page.getByRole('button', { name: '举报回复' })).toHaveCount(0);   // 自己的回复不能举报
  const comments = await apiOk(seller, 'GET', `/v1/products/${product.id}/comments`) as Array<{ id: string; content: string; parentId: string | null }>;
  const top = comments.find((c) => c.content === question)!;
  const reply = comments.find((c) => c.content === answer)!;
  expect(reply.parentId).toBe(top.id);

  const viewer = await party('举报路人');
  await open(viewer, `/product/${product.id}`);
  await expect(viewer.page.getByText(answer)).toBeVisible();
  await viewer.page.getByRole('button', { name: '举报回复' }).click();
  const dialog = viewer.page.getByRole('dialog', { name: '举报留言' });
  await expect(dialog).toContainText(`举报对象：${seller.nickname}的回复`);
  await dialog.getByLabel('骚扰或辱骂').check();
  await dialog.getByRole('button', { name: '提交举报' }).click();
  await expect(dialog.getByText('已收到举报。之后可以在「我的举报」里查看处理状态。')).toBeVisible();
  const mine = await apiOk(viewer, 'GET', '/v1/moderation-reports/mine') as Array<{ targetType: string; targetId: string }>;
  expect(mine.map((r) => [r.targetType, r.targetId])).toEqual([['COMMENT', reply.id]]);
});

test('#C2 内容安全：留言命中违禁词 → 留言框下方原样显示服务端提示，原文保留，没有发出', async ({ party }) => {
  const seller = await party('安全卖家');
  const product = await apiOk(seller, 'POST', '/v1/products', single(`E2E 安全留言 ${Date.now().toString(36)}`));
  const buyer = await party('安全买家');
  await open(buyer, `/product/${product.id}`);
  const text = `有没有四六级代考的渠道 ${Date.now().toString(36)}`;
  await buyer.page.getByPlaceholder(PLACEHOLDER).fill(text);
  await buyer.page.getByRole('button', { name: '留言', exact: true }).click();
  // 留言框下方的内联提示（全局提示条里也会有同一句话）；REST 会在末尾附上错误编号
  const inline = buyer.page.locator('p[role="alert"]').filter({ hasText: BLOCKED });
  await expect(inline).toBeVisible();
  await expect(inline).toHaveText(new RegExp(`^${BLOCKED}(（错误编号：[^）]+）)?$`));
  await expect(buyer.page.getByPlaceholder(PLACEHOLDER)).toHaveValue(text);
  expect(await apiOk(buyer, 'GET', `/v1/products/${product.id}/comments`)).toEqual([]);
  expect(sql(`SELECT count(*) FROM comments WHERE product_id = '${product.id}'`)).toBe('0');
});
