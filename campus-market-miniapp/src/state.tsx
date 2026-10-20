import Taro, { useDidShow } from '@tarojs/taro';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { UnreadCount, User } from './model';
import { api, bindSessionExpiry } from './api';
import { UnreadStore } from './unread';
/** 联系申请未读数：页面显示时刷新，自定义 tabBar 订阅后在「通知」上显示角标。 */
export const unread = new UnreadStore(() => api.unreadCount());
interface State { user: User | null; ready: boolean; setUser: (user: User | null) => void; favorites: string[]; loadFavorites: () => Promise<void>; toggleFavorite: (id: string) => Promise<void> }
const Context = createContext<State | null>(null);
export function MarketProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false), [favorites, setFavorites] = useState<string[]>([]);
  const identity = useRef(user?.id); identity.current = user?.id;
  const loadFavorites = async () => { const uid = user?.id, values = await api.favorites(); if (uid === identity.current) setFavorites(values); };
  useEffect(() => { api.restore().then(setUser).catch(notifyError).finally(() => setReady(true)); }, []);
  useEffect(() => bindSessionExpiry(() => setUser(null)), []);
  useEffect(() => { setFavorites([]); if (user) void loadFavorites().catch(notifyError); }, [user?.id]);
  useEffect(() => { if (user) void unread.refresh(); else unread.clear(); }, [user?.id]);
  const toggleFavorite = async (id: string) => { const desired = !favorites.includes(id); await api.favorite(id, desired); await loadFavorites(); };
  return <Context.Provider value={{ user, ready, setUser, favorites, loadFavorites, toggleFavorite }}>{children}</Context.Provider>;
}
/** 订阅未读数；页面每次显示时（已登录）重新读取。 */
export function useUnread(): UnreadCount {
  const { user } = useMarket();
  const [count, setCount] = useState(unread.current);
  useEffect(() => unread.subscribe(setCount), []);
  useDidShow(() => { if (user) void unread.refresh(); });
  return count;
}
export function useMarket() { const value = useContext(Context); if (!value) throw new Error('缺少 MarketProvider'); return value; }
export const notifyError = (error: unknown) => { void Taro.showToast({ title: error instanceof Error ? error.message : '操作失败，请重试', icon: 'none', duration: 2500 }); };
export const notify = (title: string) => { void Taro.showToast({ title, icon: 'none' }); };
export function goLogin(returnTo?: string) { void Taro.navigateTo({ url: `/pages/login/index${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}` }); }
