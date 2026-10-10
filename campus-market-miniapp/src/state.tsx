import Taro from '@tarojs/taro';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { User } from './model';
import { api, bindSessionExpiry } from './api';
interface State { user: User | null; ready: boolean; setUser: (user: User | null) => void; favorites: string[]; loadFavorites: () => Promise<void>; toggleFavorite: (id: string) => Promise<void> }
const Context = createContext<State | null>(null);
export function MarketProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false), [favorites, setFavorites] = useState<string[]>([]);
  const identity = useRef(user?.id); identity.current = user?.id;
  const loadFavorites = async () => { const uid = user?.id, values = await api.favorites(); if (uid === identity.current) setFavorites(values); };
  useEffect(() => { api.restore().then(setUser).catch(notifyError).finally(() => setReady(true)); }, []);
  useEffect(() => bindSessionExpiry(() => setUser(null)), []);
  useEffect(() => { setFavorites([]); if (user) void loadFavorites().catch(notifyError); }, [user?.id]);
  const toggleFavorite = async (id: string) => { const desired = !favorites.includes(id); await api.favorite(id, desired); await loadFavorites(); };
  return <Context.Provider value={{ user, ready, setUser, favorites, loadFavorites, toggleFavorite }}>{children}</Context.Provider>;
}
export function useMarket() { const value = useContext(Context); if (!value) throw new Error('缺少 MarketProvider'); return value; }
export const notifyError = (error: unknown) => { void Taro.showToast({ title: error instanceof Error ? error.message : '操作失败，请重试', icon: 'none', duration: 2500 }); };
export const notify = (title: string) => { void Taro.showToast({ title, icon: 'none' }); };
export function goLogin(returnTo?: string) { void Taro.navigateTo({ url: `/pages/login/index${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}` }); }
