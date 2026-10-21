import { createContext, useContext, type ReactNode } from 'react';
import type { ContactUnreadCounts } from '../api/contracts';
import { useAuth } from './AuthContext';
import { NO_CONTACT_UNREAD, useContactUnread } from '../hooks/useContactUnread';

/**
 * 联系申请未读数的全局共享：导航栏角标、个人中心标签与联系申请页用同一个数字、同一个轮询器。
 * 由 Layout 提供（所有页面都在 Layout 之下），因此不需要改动应用根部的 Provider 结构。
 */
interface ContactUnreadValue {
  counts: ContactUnreadCounts;
  refresh: () => void;
  /** 写入服务端刚返回的未读数（例如标记已读的响应） */
  set: (next: ContactUnreadCounts) => void;
}

const ContactUnreadContext = createContext<ContactUnreadValue>({ counts: NO_CONTACT_UNREAD, refresh: () => {}, set: () => {} });

export function ContactUnreadProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const value = useContactUnread(isAuthenticated);
  return <ContactUnreadContext.Provider value={value}>{children}</ContactUnreadContext.Provider>;
}

export function useContactUnreadCounts(): ContactUnreadValue {
  return useContext(ContactUnreadContext);
}

/** 读屏用的可访问名称：数字写进名称里，而不只是一个角标 */
export function contactUnreadLabel(total: number): string {
  return total > 0 ? `联系申请，${total} 条未读` : '联系申请';
}
