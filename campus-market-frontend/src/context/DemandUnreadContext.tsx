import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useDemandUnread } from '../hooks/useDemandUnread';

/**
 * 需求匹配未读数的全局共享。
 *
 * <p>导航栏角标与收件箱页都需要这个数字；各自轮询会让请求量翻倍，
 * 还会出现两处数字短暂不一致。全站只保留这一个轮询器。
 */
interface DemandUnreadValue {
  count: number;
  refresh: () => void;
}

const DemandUnreadContext = createContext<DemandUnreadValue>({ count: 0, refresh: () => {} });

export function DemandUnreadProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const value = useDemandUnread(isAuthenticated);
  return <DemandUnreadContext.Provider value={value}>{children}</DemandUnreadContext.Provider>;
}

export function useDemandUnreadCount(): DemandUnreadValue {
  return useContext(DemandUnreadContext);
}
