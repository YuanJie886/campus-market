import { useCallback } from 'react';
import { getApiClient } from '../api/client';
import { usePolledValue } from './usePolledValue';

/**
 * 需求匹配未读数（2.4）。刷新时机、后台暂停、退避与 429 处理见 usePolledValue。
 * 前台时每 60 秒低频轮询一次；未登录不轮询。
 */
export const DEMAND_POLL_INTERVAL_MS = 60_000;

export function useDemandUnread(enabled: boolean): { count: number; refresh: () => void } {
  const fetcher = useCallback(() => getApiClient().getDemandUnreadCount(), []);
  const { value, refresh } = usePolledValue(enabled, fetcher, 0, DEMAND_POLL_INTERVAL_MS);
  return { count: value, refresh };
}
