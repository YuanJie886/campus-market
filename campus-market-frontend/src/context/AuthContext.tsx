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
import { TokenStore } from "../utils/tokenStore";
import { useNotify } from "./NotificationContext";
import { DEMO_ACCOUNT, DEMO_PASSWORD } from "../data/seed";
function useAuthState() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const requested = useRef(new Set<string>());
  const { error } = useNotify();
  useEffect(() => {
    let active = true;
    getApiClient()
      .getCurrentUser()
      .then((user) => {
        if (active) {
          setCurrentUser(user);
          setUsers(user ? [user] : []);
        }
      })
      .catch((e) => error(e.message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
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
      requested.current.clear();
      return { ok: true, message: `欢迎回来，${s.user.nickname}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };
  const register = async (input: RegisterInput) => {
    try {
      const s = await getApiClient().register(input);
      setCurrentUser(s.user);
      setUsers([s.user]);
      requested.current.clear();
      return { ok: true, message: "注册成功，已登录" };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };
  const logout = async () => {
    try {
      await getApiClient().logout();
    } catch (e) {
      error((e as Error).message);
    } finally {
      new TokenStore().clear();
      setCurrentUser(null);
      setUsers([]);
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
