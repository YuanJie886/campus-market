import { ApiError, parseRetryAfterSeconds, unwrapEnvelope } from "./errors";
import { withRefreshLock } from "../utils/sessionRecovery";
import { authTokenStore } from "../utils/authTokenStore";
import type { AuthSession } from "./contracts";
export interface HttpTransportOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
export class HttpTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private refreshing: Promise<void> | null = null;
  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }
  private refresh(): Promise<void> {
    // 单飞：并发 401 共享同一个 Promise，只发一次 refresh。
    // 再包一层 Web Locks，让多个标签页的 refresh 串行——后端 refresh token 会轮换，
    // 并发刷新会互相作废。
    if (!this.refreshing)
      this.refreshing = withRefreshLock(() => this.request<AuthSession>(
        "/v1/auth/refresh",
        { method: "POST" },
        false,   // refresh 自身不得再触发 refresh，杜绝递归
      ))
        .then((s) =>
          authTokenStore.setAccessToken(s.accessToken, s.expiresAtIso),
        )
        .catch((e) => {
          if (e instanceof ApiError && e.code === 401) authTokenStore.clearAccessToken();
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
    const token = authTokenStore.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers,
        signal: controller.signal,
      });
      // 每个业务请求最多自动重试一次（retry=false 传下去）。
      // login/register/refresh/logout 的 401 是真实结果，不触发刷新。
      // 429 从不自动重试——那会把限流变成自我加剧的风暴。
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
          // requestId 优先取响应头，缺失时回落到 envelope
          requestId:
            response.headers.get("X-Request-ID") ??
            (typeof b?.requestId === "string" ? b.requestId : undefined),
          httpStatus: response.status,
          retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("Retry-After")),
          // 后端错误 envelope 把结构化详情放在 data 里（限制范围与到期时间、NO_EXPLICIT_SLOT、CONFLICT_OF_INTEREST、
          // 批量发布的问题清单……）。8.1 真实浏览器 E2E 发现这里曾经丢掉它们，界面只能退回通用提示
          details: errorDetails(b),
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
  patch<T>(path: string, body: unknown, headers?: HeadersInit) {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers,
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

/** 错误 envelope 里的结构化详情：后端放在 data，兼容旧的 details 字段；null / 非对象一律视为没有详情 */
function errorDetails(b: Record<string, unknown> | undefined): unknown {
  const value = b?.data ?? b?.details;
  return value !== null && typeof value === "object" ? value : undefined;
}
