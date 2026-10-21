import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { Campus, ClientConfig, School, SchoolCampus, UnreadCount, User } from './model';
import { api, bindSessionExpiry } from './api';
import { CountStore, UnreadStore, ValueStore } from './unread';
import { Poller } from './polling';
import { SCHOOLS_LOAD_FAILED, SchoolsStore, type SchoolCatalog } from './schools';
import { ApiError } from './api/transport';
/** 联系申请未读数：页面显示时刷新，自定义 tabBar 订阅后在「通知」上显示角标。 */
export const unread = new UnreadStore(() => api.unreadCount());
/** 私信未读数（GET /v1/messages/unread）：与联系申请未读数一起显示在「通知」角标上。 */
export const messageUnread = new CountStore(() => api.messageUnread());
/** 需求匹配未读数（GET /v1/demand-matches/unread-count）：同样计入「通知」角标。 */
export const demandUnread = new CountStore(() => api.demandUnread());
/** GET /v1/config：读取前为 null（此时不显示任何外部头像，照片张数按默认 9 张）。 */
export const clientConfig = new ValueStore<ClientConfig | null>(() => api.clientConfig(), null);
/**
 * 学校与校区目录：整个小程序只有这一个来源（GET /v1/schools），首次需要时读取一次并缓存；读取失败不缓存，下次使用时重试。
 * 下面几个函数读的是当前快照：组件里请用 useSchools() 订阅，目录读到后会重新渲染。
 */
export const schools = new SchoolsStore(() => api.schools());
/** 校区显示名称（例如 aust-huainan → 淮南校区）；目录里没有时原样显示 id。 */
export const campusLabel = (id: Campus | null | undefined) => schools.current.campusLabel(id);
export const schoolOfCampus = (id: Campus | null | undefined): School | null => schools.current.schoolOfCampus(id);
export const campusesOfSchool = (schoolId: string | null | undefined): SchoolCampus[] => schools.current.campusesOfSchool(schoolId);
export const hasBuildings = (id: Campus | null | undefined) => schools.current.hasBuildings(id);
/** 订阅学校目录（首次调用时触发读取）：catalog 是当前快照；error 是读取失败的提示，retry 重新读取。 */
export function useSchools(): { catalog: SchoolCatalog; error: string; retry: () => void } {
  const [catalog, setCatalog] = useState(schools.current), [error, setError] = useState('');
  const retry = () => { setError(''); schools.load().then(setCatalog, (e) => setError(e instanceof ApiError && e.message ? e.message : SCHOOLS_LOAD_FAILED)); };
  useEffect(() => { const off = schools.subscribe(setCatalog); if (!schools.current.loaded) retry(); else setCatalog(schools.current); return off; }, []);
  return { catalog, error, retry };
}
interface State { user: User | null; ready: boolean; setUser: (user: User | null) => void; favorites: string[]; loadFavorites: () => Promise<void>; toggleFavorite: (id: string) => Promise<void> }
const Context = createContext<State | null>(null);
export function MarketProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false), [favorites, setFavorites] = useState<string[]>([]);
  const identity = useRef(user?.id); identity.current = user?.id;
  const loadFavorites = async () => { const uid = user?.id, values = await api.favorites(); if (uid === identity.current) setFavorites(values); };
  useEffect(() => { api.restore().then(setUser).catch(notifyError).finally(() => setReady(true)); void clientConfig.refresh(); void schools.load().catch(() => undefined); }, []);
  useEffect(() => bindSessionExpiry(() => setUser(null)), []);
  useEffect(() => { setFavorites([]); if (user) void loadFavorites().catch(notifyError); }, [user?.id]);
  useEffect(() => { if (user) { void unread.refresh(); void messageUnread.refresh(); void demandUnread.refresh(); } else { unread.clear(); messageUnread.clear(); demandUnread.clear(); } }, [user?.id]);
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
/** 订阅私信未读数；页面每次显示时（已登录）重新读取。 */
export function useMessageUnread(): number {
  const { user } = useMarket();
  const [count, setCount] = useState(messageUnread.current);
  useEffect(() => messageUnread.subscribe(setCount), []);
  useDidShow(() => { if (user) void messageUnread.refresh(); });
  return count;
}
/** 订阅需求匹配未读数；页面每次显示时（已登录）重新读取。 */
export function useDemandUnread(): number {
  const { user } = useMarket();
  const [count, setCount] = useState(demandUnread.current);
  useEffect(() => demandUnread.subscribe(setCount), []);
  useDidShow(() => { if (user) void demandUnread.refresh(); });
  return count;
}
/** 客户端配置（照片张数上限、是否允许外部图片）。 */
export function useClientConfig(): ClientConfig | null {
  const [config, setConfig] = useState(clientConfig.current);
  useEffect(() => clientConfig.subscribe(setConfig), []);
  return config;
}
/** 只在页面显示时轮询（与 Web 的 visibilityState 判断相同）：显示时开始，隐藏 / 卸载 / enabled=false 时停止。 */
export function usePolling(task: () => Promise<unknown>, intervalMs: number, enabled: boolean) {
  const latest = useRef(task); latest.current = task;
  const poller = useRef<Poller | null>(null);
  if (!poller.current) poller.current = new Poller(() => latest.current(), intervalMs);
  const visible = useRef(true);
  useDidShow(() => { visible.current = true; if (enabled) poller.current?.start(); });
  useDidHide(() => { visible.current = false; poller.current?.stop(); });
  useEffect(() => { if (enabled && visible.current) poller.current?.start(); else poller.current?.stop(); }, [enabled]);
  useEffect(() => () => poller.current?.stop(), []);
}
export function useMarket() { const value = useContext(Context); if (!value) throw new Error('缺少 MarketProvider'); return value; }
/** 错误提示：短文案用轻提示；长文案（例如受限 403「…可以在「我的限制」里查看原因或提交申诉。」）用弹窗完整显示，轻提示会截断。 */
export const notifyError = (error: unknown) => {
  const message = error instanceof Error && error.message ? error.message : '操作失败，请重试';
  if (message.length > 24) { void Taro.showModal({ title: '提示', content: message, showCancel: false, confirmColor: '#194e41' }); return; }
  void Taro.showToast({ title: message, icon: 'none', duration: 2500 });
};
export const notify = (title: string) => { void Taro.showToast({ title, icon: 'none' }); };
export function goLogin(returnTo?: string) { void Taro.navigateTo({ url: `/pages/login/index${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}` }); }
