import { ApiError } from '../api/errors';
import { authTokenStore } from './authTokenStore';

/**
 * 会话恢复与主动刷新调度（仅 REST 模式）。
 *
 * <p>Access Token 改为纯内存后，刷新页面会丢失它。恢复途径只有一条：
 * 带上 HttpOnly 的 refresh Cookie 调 `/v1/auth/refresh` 换一枚新的。
 * 这里把「启动恢复」和「过期前主动刷新」集中管理，避免散落在各处形成定时器风暴。
 */

/** 启动恢复的结果。调用方据此区分「未登录」与「认证服务暂时不可用」。 */
export type RecoveryOutcome =
  | { kind: 'authenticated' }
  | { kind: 'anonymous' }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'unavailable'; message: string };

/** 过期前多久主动刷新。 */
const REFRESH_LEAD_MS = 60_000;
/** 即使已经很接近过期，也不要立刻连发，留一个最小延迟。 */
const MIN_REFRESH_DELAY_MS = 5_000;
/** 跨标签页锁名：多个标签页同时刷新时串行化，避免 refresh token 轮换互相作废。 */
const REFRESH_LOCK = 'campus-market-refresh';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** 取消已排定的主动刷新。Token 变化、登出、卸载时都必须调用。 */
export function cancelScheduledRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * 按内存中的 expiresAt 安排一次主动刷新。
 *
 * <p>全页面只保留<b>一个</b> timer：重排前先取消旧的。
 * 不解析 JWT 的 exp——客户端解析出来的值不能作为真值，这里只用后端返回的 expiresAtIso 做调度。
 * 刷新失败不重排，交由后续请求的 401 单飞流程处理，避免形成定时器风暴。
 */
export function scheduleProactiveRefresh(refresh: () => Promise<unknown>): void {
  cancelScheduledRefresh();
  const expiresAt = authTokenStore.getExpiresAt();
  if (expiresAt === null) return;

  const delay = Math.max(MIN_REFRESH_DELAY_MS, expiresAt - Date.now() - REFRESH_LEAD_MS);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    // 失败不重排：让下一次业务请求的 401 走单飞刷新，避免失败后无限自我重试
    void refresh().catch(() => undefined);
  }, delay);
}

/**
 * 在跨标签页锁内执行刷新。
 *
 * <p>后端的 refresh token 每次刷新都会轮换（{@code sessions.rotate}），
 * 两个标签页同时刷新时，后提交的那个会因为旧 hash 已失效而失败，
 * 甚至可能把另一个标签页刚拿到的有效会话判成过期。Web Locks 让它们串行。
 *
 * <p>不支持 Web Locks 的浏览器直接执行——降级为「仅单标签页 single-flight」，
 * 这一点在报告中如实说明，不假装已完全解决跨标签页竞争。
 */
export async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return task();
  return locks.request(REFRESH_LOCK, task) as Promise<T>;
}

/**
 * 页面启动时尝试用 refresh Cookie 恢复登录。
 *
 * <p>刻意<b>不</b>读取任何本地存储的旧 Token 作为凭据——它们可能已被吊销，
 * 且 0.9A 起本就不该存在。
 */
export async function recoverSession(
  refresh: () => Promise<unknown>,
): Promise<RecoveryOutcome> {
  try {
    await withRefreshLock(refresh);
    return { kind: 'authenticated' };
  } catch (e) {
    const error = e as ApiError;
    // 401：没有有效 refresh Cookie，就是未登录。这是正常路径，不该反复报错。
    if (error?.code === 401) {
      authTokenStore.clearAccessToken();
      return { kind: 'anonymous' };
    }
    // 429：认证服务在限流，读 Retry-After 告知用户稍后再试，绝不立即循环重试
    if (error?.code === 429) {
      return { kind: 'rate-limited', retryAfterSeconds: error.retryAfterSeconds ?? 60 };
    }
    // 其余（503 / 网络失败 / 超时）：服务暂时不可用，
    // 与「未登录」严格区分——不得擅自把它当成匿名态，也不得伪造登录。
    return { kind: 'unavailable', message: error?.message ?? '认证服务暂时不可用' };
  }
}
