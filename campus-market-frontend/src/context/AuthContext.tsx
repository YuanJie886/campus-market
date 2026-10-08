import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { User, PublicUser, RegisterInput } from "../types";
import type { ProfilePatch } from "../api/contracts";
import { getApiClient } from "../api/client";
import { authTokenStore, purgeLegacyAuthTokens } from "../utils/authTokenStore";
import {
  cancelScheduledRefresh,
  recoverSession,
  scheduleProactiveRefresh,
  type RecoveryOutcome,
} from "../utils/sessionRecovery";
import { useNotify } from "./NotificationContext";
import { DEMO_ACCOUNT, DEMO_PASSWORD } from "../data/seed";
import { toUserMessage } from '../api/errors';
import { clearPendingInvite } from '../utils/pendingInvite';
function useAuthState() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const requested = useRef(new Set<string>());
  const { error } = useNotify();
  /** 启动恢复的结果；用于区分「未登录」与「认证服务暂时不可用」。 */
  const [authStatus, setAuthStatus] = useState<RecoveryOutcome["kind"]>("anonymous");
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  /** 主动刷新：过期前换新 Token，成功后重排下一次。 */
  const refreshNow = useCallback(async () => {
    await getApiClient().refreshSession();
    scheduleProactiveRefresh(refreshNow);
  }, []);

  useEffect(() => {
    let active = true;
    // Access Token 已改为纯内存；启动时先清掉历史遗留的持久化 Token（幂等，只删已知认证 key）
    purgeLegacyAuthTokens();

    (async () => {
      const outcome = await recoverSession(() => getApiClient().refreshSession());
      if (!active) return;
      setAuthStatus(outcome.kind);

      if (outcome.kind === "authenticated") {
        try {
          const user = await getApiClient().getCurrentUser();
          if (!active) return;
          setCurrentUser(user);
          setUsers(user ? [user] : []);
          scheduleProactiveRefresh(refreshNow);
        } catch (e) {
          if (active) setAuthNotice(toUserMessage(e));
        }
      } else if (outcome.kind === "rate-limited") {
        // 429：认证服务在限流。给出可理解的等待提示，绝不立即循环重试。
        setAuthNotice(`认证请求过于频繁，请约 ${outcome.retryAfterSeconds} 秒后重试`);
      } else if (outcome.kind === "unavailable") {
        // 与「未登录」严格区分：不伪造登录态，也不把服务故障说成未登录。
        setAuthNotice(outcome.message);
      }
      // anonymous 是正常路径（没有有效 refresh Cookie），不提示错误

      if (active) setLoading(false);
    })();

    return () => {
      active = false;
      cancelScheduledRefresh();
    };
  }, [refreshNow]);
  const loadUsers = useCallback(async (ids: string[]) => {
    const fresh = [...new Set(ids)].filter(
      (id) => id && !requested.current.has(id),
    );
    fresh.forEach((id) => requested.current.add(id));
    const result = await Promise.all(
      fresh.map(async (id) => {
        try {
          return await getApiClient().getUser(id);
        } catch {
          requested.current.delete(id);
          return null;
        }
      }),
    );
    setUsers((prev) => {
      const byId = new Map(prev.map((u) => [u.id, u]));
      result.forEach((u) => {
        if (u) byId.set(u.id, u);
      });
      return [...byId.values()];
    });
  }, []);
  const login = async (account: string, password: string) => {
    try {
      const s = await getApiClient().login({ account, password });
      setCurrentUser(s.user);
      setUsers([s.user]);
      setAuthStatus("authenticated");
      setAuthNotice(null);
      scheduleProactiveRefresh(refreshNow);
      requested.current.clear();
      return { ok: true, message: `欢迎回来，${s.user.nickname}` };
    } catch (e) {
      return { ok: false, message: toUserMessage(e) };
    }
  };
  const register = async (input: RegisterInput) => {
    try {
      const s = await getApiClient().register(input);
      setCurrentUser(s.user);
      setUsers([s.user]);
      setAuthStatus("authenticated");
      setAuthNotice(null);
      scheduleProactiveRefresh(refreshNow);
      requested.current.clear();
      return { ok: true, message: "注册成功，已登录" };
    } catch (e) {
      return { ok: false, message: toUserMessage(e) };
    }
  };
  const logout = async () => {
    try {
      await getApiClient().logout();
    } catch (e) {
      error(toUserMessage(e));
    } finally {
      authTokenStore.clearAccessToken();
      cancelScheduledRefresh();
      // 6.1B：退出登录时清除内存里暂存的圈子邀请码
      clearPendingInvite();
      setCurrentUser(null);
      setUsers([]);
      setAuthStatus("anonymous");
      setAuthNotice(null);
      requested.current.clear();
    }
  };
  const updateProfile = async (patch: ProfilePatch) => {
    const u = await getApiClient().updateProfile(patch);
    setCurrentUser(u);
    setUsers((prev) => [...prev.filter((x) => x.id !== u.id), u]);
  };
  return {
    users,
    currentUser,
    loading,
    authInitializing: loading,
    authStatus,
    authNotice,
    isAuthenticated: !!currentUser,
    login,
    register,
    logout,
    updateProfile,
    loadUsers,
    getUser: (id: string | null | undefined) => users.find((u) => u.id === id),
    demoLogin: () => login(DEMO_ACCOUNT, DEMO_PASSWORD),
    resetAuth: logout,
  };
}
const AuthContext = createContext<ReturnType<typeof useAuthState> | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={useAuthState()}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("缺少 AuthProvider");
  return ctx;
}
export { DEMO_ACCOUNT, DEMO_PASSWORD };
