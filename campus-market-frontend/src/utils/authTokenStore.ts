/**
 * Access Token 的<b>纯内存</b>存储（仅 REST 生产模式使用）。
 *
 * <p>改造前 Token 存在 `localStorage` 的 `campus_market_access_token_v1`，
 * 任何 XSS 都能直接读走一枚 15 分钟内有效的访问令牌——后端 README 声称「保存在
 * 前端内存中」，实际并非如此（0.5A 审计 R-09）。
 *
 * <p>现在 Token 只活在这个模块的闭包里：页面关闭即消失，刷新后靠 HttpOnly 的
 * refresh Cookie 重新换取。Refresh Token 始终不对 JavaScript 可见。
 *
 * <p>刻意<b>不</b>导出可写的全局变量，也不提供把 Token 写入任何 Web Storage 的途径。
 * `expiresAt` 只用于安排主动刷新，<b>不</b>作为授权依据——权限一律以后端为准。
 */

let accessToken: string | null = null;
/** 毫秒时间戳。仅用于刷新调度，不参与任何权限判断。 */
let expiresAt: number | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => {
    try { listener() } catch { /* 监听器异常不得影响认证流程 */ }
  });
}

export const authTokenStore = {
  getAccessToken(): string | null {
    return accessToken;
  },

  /** 记录一次签发结果。expiresAtIso 由后端给出（0.8D 起与 JWT exp 同源）。 */
  setAccessToken(token: string, expiresAtIso?: string): void {
    accessToken = token || null;
    const parsed = expiresAtIso ? Date.parse(expiresAtIso) : Number.NaN;
    expiresAt = Number.isFinite(parsed) ? parsed : null;
    notify();
  },

  clearAccessToken(): void {
    accessToken = null;
    expiresAt = null;
    notify();
  },

  /** 过期时刻（毫秒）；未知时为 null。仅供刷新调度使用。 */
  getExpiresAt(): number | null {
    return expiresAt;
  },

  /** 订阅 Token 变化，用于重新安排主动刷新。返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener) };
  },
};

/**
 * 历史上曾经持久化过 Access Token 的 key。
 * 只列举明确已知的认证 key，删除时不触碰任何其他数据。
 */
export const LEGACY_AUTH_STORAGE_KEYS = Object.freeze([
  'campus_market_access_token_v1',
]);

/**
 * 启动时清除遗留的持久化 Access Token。
 *
 * <p>刻意逐个 `removeItem` 而<b>不</b>用 `localStorage.clear()`——后者会连带清掉
 * Mock 演示数据、筛选偏好等无关内容。不读取旧 Token 的值，也不把它迁入新存储：
 * 一个已经暴露在磁盘上的令牌没有继续使用的价值，直接丢弃并走 refresh 重新签发。
 *
 * <p>幂等：重复调用无副作用；storage 不可用（隐私模式）时静默跳过。
 */
export function purgeLegacyAuthTokens(): void {
  for (const key of LEGACY_AUTH_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage 不可用时无需处理 */
    }
  }
}
