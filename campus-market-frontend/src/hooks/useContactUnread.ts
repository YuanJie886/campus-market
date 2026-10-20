import { useCallback } from 'react';
import { getApiClient } from '../api/client';
import type { ContactUnreadCounts } from '../api/contracts';
import { usePolledValue } from './usePolledValue';

/**
 * 联系申请未读数（阶段 1）：卖家未读的新申请 + 买家未读的同意 / 拒绝 / 撤回同意。
 * 与需求匹配同一套刷新规则（登录后、获得焦点、前台 60 秒一次；后台暂停；429 按 Retry-After）。
 */
export const CONTACT_POLL_INTERVAL_MS = 60_000;
export const NO_CONTACT_UNREAD: ContactUnreadCounts = { received: 0, updates: 0, total: 0 };

export function useContactUnread(enabled: boolean): { counts: ContactUnreadCounts; refresh: () => void; set: (next: ContactUnreadCounts) => void } {
  const fetcher = useCallback(() => getApiClient().getContactRequestUnreadCount(), []);
  const { value, refresh, set } = usePolledValue(enabled, fetcher, NO_CONTACT_UNREAD, CONTACT_POLL_INTERVAL_MS);
  return { counts: value, refresh, set };
}
