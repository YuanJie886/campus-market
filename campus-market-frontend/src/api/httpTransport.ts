import { ApiError, unwrapEnvelope } from "./errors";
import { TokenStore } from "../utils/tokenStore";
import type { AuthSession } from "./contracts";
export interface HttpTransportOptions {
  baseUrl?: string;
  timeoutMs?: number;
  tokenStore?: TokenStore;
  fetchImpl?: typeof fetch;
}
export class HttpTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private refreshing: Promise<void> | null = null;
  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.tokenStore = options.tokenStore ?? new TokenStore();
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }
  private refresh(): Promise<void> {
    if (!this.refreshing)
      this.refreshing = this.request<AuthSession>(
        "/v1/auth/refresh",
        { method: "POST" },
        false,
      )
        .then((s) =>
          this.tokenStore.set({
            accessToken: s.accessToken,
            expiresAtIso: s.expiresAtIso,
          }),
        )
        .catch((e) => {
          if (e instanceof ApiError && e.code === 401) this.tokenStore.clear();
          throw e;
        })
        .finally(() => {
          this.refreshing = null;
        });
    return this.refreshing;
  }
  async request<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
  ): Promise<T> {
    const controller = new AbortController(),
      timer = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const token = this.tokenStore.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers,
        signal: controller.signal,
      });
      if (
        response.status === 401 &&
        retry &&
        !/\/auth\/(login|register|refresh|logout)$/.test(path)
      ) {
        await this.refresh();
        return await this.request<T>(path, init, false);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError({
          code: response.status || -2,
          message: "服务响应不是有效 JSON，请检查后端是否启动",
        });
      }
      if (!response.ok) {
        const b = payload as Record<string, unknown>;
        throw new ApiError({
          code: typeof b?.code === "number" ? b.code : response.status,
          message:
            typeof b?.message === "string"
              ? b.message
              : `请求失败（${response.status}）`,
        });
      }
      return unwrapEnvelope<T>(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError")
        throw new ApiError({ code: -3, message: "请求超时，请稍后重试" });
      throw ApiError.from(e);
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string, body?: unknown, headers?: HeadersInit) {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
    });
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}
