import { describe, it, expect, vi } from "vitest";
import { HttpTransport } from "./httpTransport";
import { TokenStore } from "../utils/tokenStore";
function store() {
  let token: string | null = "old-token";
  return {
    get: () => token ? { accessToken: token, expiresAtIso: new Date(Date.now() + 900000).toISOString() } : null,
    getAccessToken: () => token,
    set: (value: { accessToken: string }) => {
      token = value.accessToken;
    },
    clear: () => {
      token = null;
    },
  } as TokenStore;
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
    const http = new HttpTransport({ tokenStore: store(), fetchImpl });
    await expect(http.post("/v1/orders", {})).rejects.toMatchObject({
      code: 409,
      message: "服务拒绝",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refreshes once for concurrent expired requests and retries with the new token", async () => {
    const tokens = store();
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
    const http = new HttpTransport({ tokenStore: tokens, fetchImpl });
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
    const http = new HttpTransport({ tokenStore: store(), fetchImpl });
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
      const http = new HttpTransport({ tokenStore: store() });
      expect(await http.get("/v1/health")).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
