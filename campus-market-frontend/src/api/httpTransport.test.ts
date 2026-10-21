import { describe, it, expect, vi } from "vitest";
import { HttpTransport } from "./httpTransport";
import { authTokenStore } from "../utils/authTokenStore";

/** Token 已改为模块级内存单例（0.9A），测试前重置并预置一个初始值。 */
function seedToken(token: string | null = "old-token") {
  authTokenStore.clearAccessToken();
  if (token) authTokenStore.setAccessToken(token, new Date(Date.now() + 900_000).toISOString());
}
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: status === 200 ? 0 : status,
      data,
      message: status === 200 ? "ok" : "服务拒绝",
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
describe("REST transport", () => {
  it("does not turn server rejection into a successful local write", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, 409));
    const http = (seedToken(), new HttpTransport({ fetchImpl }));
    await expect(http.post("/v1/orders", {})).rejects.toMatchObject({
      code: 409,
      message: "服务拒绝",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refreshes once for concurrent expired requests and retries with the new token", async () => {
    let refreshes = 0;
    const fetchImpl = vi.fn(
      async (path: RequestInfo | URL, options?: RequestInit) => {
        if (String(path).endsWith("/auth/refresh")) {
          refreshes++;
          await Promise.resolve();
          return response({
            accessToken: "new-token",
            expiresAtIso: new Date(Date.now() + 900000).toISOString(),
          });
        }
        return new Headers(options?.headers).get("Authorization") ===
          "Bearer new-token"
          ? response({ id: "server-id" })
          : response(null, 401);
      },
    );
    const http = (seedToken(), new HttpTransport({ fetchImpl }));
    const results = await Promise.all([
      http.get("/v1/auth/me"),
      http.get("/v1/favorites"),
    ]);
    expect(refreshes).toBe(1);
    expect(results).toEqual([{ id: "server-id" }, { id: "server-id" }]);
    expect(
      fetchImpl.mock.calls.every(([, opts]) => opts?.credentials === "include"),
    ).toBe(true);
  });
  it("does not refresh on a bad password and propagates failed refresh", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, 401));
    const http = (seedToken(), new HttpTransport({ fetchImpl }));
    await expect(http.post("/v1/auth/login", {})).rejects.toMatchObject({
      code: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(http.get("/v1/orders")).rejects.toMatchObject({ code: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("binds native fetch to its global receiver", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async function (this: unknown) {
      expect(this).toBe(globalThis);
      return response("ok");
    };
    try {
      const http = (seedToken(), new HttpTransport({}));
      expect(await http.get("/v1/health")).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });
  it("8.1 回归：错误 envelope 的结构化详情（后端放在 data 里）进入 ApiError.details；data 为 null 时没有详情", async () => {
    const envelope = (code: number, data: unknown) => new Response(JSON.stringify({ code, data, message: "失败", requestId: "req-1" }),
      { status: code, headers: { "Content-Type": "application/json" } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(envelope(403, { code: "RESTRICTED", scope: "BOOKING", endsAt: 123 }))
      .mockResolvedValueOnce(envelope(400, { items: [{ position: 2, code: "MISSING_FIELD", field: "price" }] }))
      .mockResolvedValueOnce(envelope(404, null));
    const http = (seedToken(), new HttpTransport({ fetchImpl }));
    await expect(http.post("/v1/orders", {})).rejects.toMatchObject({ code: 403, details: { code: "RESTRICTED", scope: "BOOKING", endsAt: 123 } });
    await expect(http.post("/v1/listing-batches/b/publish")).rejects.toMatchObject({ code: 400, details: { items: [{ position: 2 }] } });
    const missing = (await http.get("/v1/products/x").catch((e: unknown) => e)) as { details?: unknown };
    expect(missing.details).toBeUndefined();
  });
});
