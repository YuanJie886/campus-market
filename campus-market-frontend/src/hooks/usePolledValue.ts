import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../api/errors';

/**
 * 站内未读数的统一轮询器（需求匹配 2.4、联系申请阶段 1 共用）。
 *
 * <p>本阶段不引入 WebSocket，刷新时机只有这几个：
 * <ul>
 *   <li>登录后首次加载；</li>
 *   <li>页面重新获得焦点 / 从后台切回前台；</li>
 *   <li>调用方主动 refresh() 或 set()（例如标记已读之后直接写入服务端返回的新数字）；</li>
 *   <li>前台时按 intervalMs 低频轮询。</li>
 * </ul>
 *
 * <p>约束：未登录不轮询；页面在后台时不轮询；登出立即停止并清空；卸载时取消。
 * 失败后退避（最长 5 分钟），429 时严格按 Retry-After 等待，不形成请求风暴。
 * 这里只取数字，从不把商品标题放进浏览器通知或系统推送。
 */
const MAX_BACKOFF_MS = 5 * 60_000;

export function usePolledValue<T>(enabled: boolean, fetcher: () => Promise<T>, initial: T, intervalMs: number):
  { value: T; refresh: () => void; set: (next: T) => void } {
  const [value, setValue] = useState<T>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const failures = useRef(0);
  const blockedUntil = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const initialRef = useRef(initial);

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const schedule = useCallback((delay: number) => {
    clear();
    if (!enabledRef.current) return;
    timer.current = setTimeout(() => void load(), delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!enabledRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (Date.now() < blockedUntil.current) {
      schedule(blockedUntil.current - Date.now());
      return;
    }
    const current = ++sequence.current;
    try {
      const next = await fetcherRef.current();
      if (current !== sequence.current || !enabledRef.current) return;   // 已过期或已登出
      failures.current = 0;
      setValue(next);
      schedule(intervalMs);
    } catch (e) {
      if (current !== sequence.current || !enabledRef.current) return;
      const error = e as ApiError;
      if (error?.code === 429 && error.retryAfterSeconds) {
        // 限流：严格等到服务端允许的时间，不提前重试
        blockedUntil.current = Date.now() + error.retryAfterSeconds * 1000;
        schedule(error.retryAfterSeconds * 1000);
        return;
      }
      failures.current += 1;
      schedule(Math.min(MAX_BACKOFF_MS, intervalMs * 2 ** failures.current));
    }
  }, [schedule, intervalMs]);

  useEffect(() => {
    if (!enabled) {
      // 登出：立即停止并清空，丢弃任何在途请求的结果
      clear();
      sequence.current += 1;
      failures.current = 0;
      setValue(initialRef.current);
      return;
    }
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
      else clear();   // 切到后台就停，不在后台轮询
    };
    const onFocus = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clear();
      sequence.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, load]);

  const refresh = useCallback(() => void load(), [load]);
  /** 直接写入服务端刚返回的值（例如标记已读的响应），并作废在途的旧请求 */
  const set = useCallback((next: T) => {
    sequence.current += 1;
    failures.current = 0;
    setValue(next);
    schedule(intervalMs);
  }, [schedule, intervalMs]);
  return { value, refresh, set };
}
