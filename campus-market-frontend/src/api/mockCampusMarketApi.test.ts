import { afterEach, describe, expect, it, vi } from "vitest";
import { MockCampusMarketApi } from "./mockCampusMarketApi";
import { TokenStore } from "../utils/tokenStore";

function installLocalStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal("window", { localStorage });
}

afterEach(() => vi.unstubAllGlobals());

describe("MockCampusMarketApi order conversations", () => {
  it("creates a conversation with a new order", async () => {
    installLocalStorage();
    const api = new MockCampusMarketApi(new TokenStore());
    await api.register({ account: "seller-new", password: "secret1", nickname: "卖家", campus: "东校区" });
    const product = await api.createProduct({
      title: "新商品",
      description: "没有既有会话",
      price: 20,
      category: "数码电子",
      condition: "几乎全新",
      campus: "东校区",
      images: [],
    });
    await api.register({ account: "buyer-new", password: "secret1", nickname: "买家", campus: "东校区" });

    const order = await api.createOrder({
      productId: product.id,
      meetingPointId: "东校区-library",
      meetingAtIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      contact: "buyer-contact",
      idempotencyKey: "new-order-key",
    });

    expect(order.conversationId).toBeTruthy();
    expect((await api.listConversations()).map((item) => item.id)).toEqual([order.conversationId]);
  });

  it("reuses an existing conversation on order creation and an idempotent retry", async () => {
    installLocalStorage();
    const api = new MockCampusMarketApi(new TokenStore());
    await api.register({ account: "seller-001", password: "secret1", nickname: "卖家", campus: "东校区" });
    const product = await api.createProduct({
      title: "测试商品",
      description: "用于预约测试",
      price: 20,
      category: "数码电子",
      condition: "几乎全新",
      campus: "东校区",
      images: [],
    });
    await api.register({ account: "buyer-001", password: "secret1", nickname: "买家", campus: "东校区" });

    const input = {
      productId: product.id,
      meetingPointId: "东校区-library",
      meetingAtIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      contact: "buyer-contact",
      idempotencyKey: "checkout-retry-key",
    };
    const existingConversation = await api.getOrCreateConversation(product.id);
    const created = await api.createOrder(input);
    const retried = await api.createOrder(input);
    const conversations = await api.listConversations();

    expect(created.conversationId).toBeTruthy();
    expect(created.conversationId).toBe(existingConversation.id);
    expect(retried.conversationId).toBe(created.conversationId);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(created.conversationId);
  });
});
