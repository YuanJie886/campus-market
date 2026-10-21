import { apiCall, apiOk, expect, open, test } from '../fixtures';

/**
 * 私信（与小程序一致：只有快捷消息，没有自由文字）：
 *   #M1 买家在商品详情点「私信卖家」→ 只看到买家可发送的快捷消息、没有输入框 → 发送一条；
 *       卖家看到未读并打开会话 → 只看到卖家可发送的快捷消息 → 用卖家模板回复；买家看到回复；
 *       第三人打开同一会话看不到任何内容，接口 404；
 *   #M2 绕过界面直接调接口发送自由文字 → 400「私信目前只能发送预设的快捷消息」，消息没有写入。
 */

const BUYER_ASK = '你好，这件还在吗？';
const SELLER_REPLY = '还在的，可以在商品页申请联系方式。';
const SELLER_ONLY = '不好意思，已经出了。';

const single = (title: string) => ({
  title, description: 'E2E 私信快捷消息', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
});

test('#M1 私信卖家：买家只能发买家快捷消息 → 卖家看到未读并用卖家模板回复 → 买家看到回复；第三人无法访问', async ({ party }) => {
  const seller = await party('私信卖家');
  const title = `E2E 私信台灯 ${Date.now().toString(36)}`;
  const product = await apiOk(seller, 'POST', '/v1/products', single(title));

  const buyer = await party('私信买家');
  await open(buyer, `/product/${product.id}`);
  await expect(buyer.page.getByRole('heading', { name: title })).toBeVisible();
  await buyer.page.getByRole('button', { name: '私信卖家' }).click();
  await expect(buyer.page).toHaveURL(/\/messages\/[^/]+$/);
  const conversationId = new URL(buyer.page.url()).pathname.split('/').pop()!;
  await expect(buyer.page.getByText('为保护双方安全，私信目前只能发送快捷消息；交换联系方式请使用「申请联系方式」')).toBeVisible();
  const buyerQuick = buyer.page.getByRole('list', { name: '可发送的快捷消息' });
  await expect(buyerQuick.getByRole('button', { name: BUYER_ASK })).toBeVisible();
  await expect(buyerQuick.getByRole('button', { name: SELLER_ONLY })).toHaveCount(0);
  await expect(buyerQuick.getByRole('button', { name: SELLER_REPLY })).toHaveCount(0);
  await expect(buyer.page.getByRole('textbox', { name: '输入消息' })).toHaveCount(0);
  await buyerQuick.getByRole('button', { name: BUYER_ASK }).click();
  await expect(buyer.page.getByRole('log', { name: '聊天记录' }).getByText(BUYER_ASK)).toBeVisible();

  // 卖家：导航栏「消息」有未读，打开会话后已读
  expect((await apiOk(seller, 'GET', '/v1/messages/unread')).count).toBe(1);
  await open(seller, '/');
  await expect(seller.page.getByRole('button', { name: '消息' })).toContainText('1');
  await seller.page.getByRole('button', { name: '消息' }).click();
  await expect(seller.page).toHaveURL(/\/messages$/);
  await seller.page.getByRole('button', { name: new RegExp(buyer.nickname) }).click();
  await expect(seller.page).toHaveURL(new RegExp(`/messages/${conversationId}$`));
  await expect(seller.page.getByRole('log', { name: '聊天记录' }).getByText(BUYER_ASK)).toBeVisible();
  await expect.poll(async () => (await apiOk(seller, 'GET', '/v1/messages/unread')).count).toBe(0);
  const sellerQuick = seller.page.getByRole('list', { name: '可发送的快捷消息' });
  await expect(sellerQuick.getByRole('button', { name: SELLER_ONLY })).toBeVisible();
  await expect(sellerQuick.getByRole('button', { name: BUYER_ASK })).toHaveCount(0);
  await expect(seller.page.getByRole('textbox', { name: '输入消息' })).toHaveCount(0);
  await sellerQuick.getByRole('button', { name: SELLER_REPLY }).click();
  await expect(seller.page.getByRole('log', { name: '聊天记录' }).getByText(SELLER_REPLY)).toBeVisible();

  // 买家看到卖家的回复
  await open(buyer, `/messages/${conversationId}`);
  const log = buyer.page.getByRole('log', { name: '聊天记录' });
  await expect(log.getByText(SELLER_REPLY)).toBeVisible();
  await expect(log.getByText(BUYER_ASK)).toBeVisible();

  // 第三人：界面上看不到这段会话，接口 404（与会话不存在相同）
  const stranger = await party('私信路人');
  await open(stranger, `/messages/${conversationId}`);
  await expect(stranger.page.getByRole('heading', { name: '站内消息' })).toBeVisible();
  await expect(stranger.page.getByText(BUYER_ASK)).toHaveCount(0);
  await expect(stranger.page.getByText(SELLER_REPLY)).toHaveCount(0);
  const denied = await apiCall(stranger, 'GET', `/v1/conversations/${conversationId}/messages`);
  expect(denied.status).toBe(404);
  expect(denied.body.message).toBe('会话不存在');
  expect((await apiCall(stranger, 'POST', `/v1/conversations/${conversationId}/messages`, { templateCode: 'BUYER_STILL_AVAILABLE' })).status).toBe(404);
});

test('#M2 接口直接发送自由文字：400「私信目前只能发送预设的快捷消息」，没有写入', async ({ party }) => {
  const seller = await party('文字卖家');
  const product = await apiOk(seller, 'POST', '/v1/products', single(`E2E 文字私信 ${Date.now().toString(36)}`));
  const buyer = await party('文字买家');
  const conversation = await apiOk(buyer, 'POST', '/v1/conversations', { productId: product.id });
  const res = await apiCall(buyer, 'POST', `/v1/conversations/${conversation.id}/messages`, { content: '加我微信聊吧' });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('私信目前只能发送预设的快捷消息');
  expect(await apiOk(buyer, 'GET', `/v1/conversations/${conversation.id}/messages`)).toEqual([]);
  // 卖家模板不能由买家发送（服务端原话）
  const wrongRole = await apiCall(buyer, 'POST', `/v1/conversations/${conversation.id}/messages`, { templateCode: 'SELLER_SOLD' });
  expect(wrongRole.status).toBe(400);
  expect(wrongRole.body.message).toBe('这条快捷消息不能由你发送');
});
