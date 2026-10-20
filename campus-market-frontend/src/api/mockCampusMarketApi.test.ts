// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { MockCampusMarketApi } from "./mockCampusMarketApi";
import type { ProductCreateInput } from "./contracts";

const listing: ProductCreateInput = {
  title: "测试商品",
  description: "用于站内会话测试",
  price: 20,
  category: "其他",
  condition: "全新",
  campus: "东校区",
  images: [],
  contact: "wechat:seller",
};

let api: MockCampusMarketApi;
beforeEach(() => {
  localStorage.clear();
  api = new MockCampusMarketApi();
});

describe("MockCampusMarketApi product conversations", () => {
  it("creates a conversation directly from a product, without any order", async () => {
    await api.register({ account: "seller-new", password: "secret1", nickname: "卖家", campus: "东校区" });
    const product = await api.createProduct(listing);
    await api.register({ account: "buyer-new", password: "secret1", nickname: "买家", campus: "东校区" });

    const conversation = await api.getOrCreateConversation(product.id);

    expect(conversation.productId).toBe(product.id);
    expect((await api.listConversations()).map((item) => item.id)).toEqual([conversation.id]);
    const db = JSON.parse(localStorage.getItem("campus_market_mock_database_v1")!);
    expect(db.market.orders.filter((o: { productId: string }) => o.productId === product.id)).toHaveLength(0);
    // 平台只展示商品与联系方式：适配层里根本没有下单入口
    expect("createOrder" in api).toBe(false);
  });

  it("reuses the existing conversation on retry and after a contact request; the seller cannot open one on their own product", async () => {
    await api.register({ account: "seller-001", password: "secret1", nickname: "卖家", campus: "东校区" });
    const product = await api.createProduct(listing);
    await expect(api.getOrCreateConversation(product.id)).rejects.toMatchObject({ code: 400 });
    await api.register({ account: "buyer-001", password: "secret1", nickname: "买家", campus: "东校区" });

    const existing = await api.getOrCreateConversation(product.id);
    await api.requestContact(product.id);
    const retried = await api.getOrCreateConversation(product.id);
    await api.sendMessage(existing.id, "还在吗？");

    expect(retried.id).toBe(existing.id);
    expect(await api.listConversations()).toHaveLength(1);
    await api.login({ account: "seller-001", password: "secret1" });
    const sellerView = await api.listConversations();
    expect(sellerView.map((c) => c.id)).toEqual([existing.id]);
    expect((await api.listMessages(existing.id)).map((m) => m.content)).toEqual(["还在吗？"]);
  });
});
