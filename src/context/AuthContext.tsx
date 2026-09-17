import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { AuthState, RegisterInput, User } from '../types';
import { loadState, saveState, STORAGE_KEYS } from '../utils/storage';
import { uid } from '../utils/id';
import { seedUsers, DEMO_ACCOUNT, DEMO_PASSWORD } from '../data/seed';

/** 用户认证上下文：注册 / 登录 / 退出 / 编辑资料 */

interface AuthContextValue {
  users: User[];
  currentUser: User | null;
  isAuthenticated: boolean;
  login: (account: string, password: string) => { ok: boolean; message: string };
  register: (input: RegisterInput) => { ok: boolean; message: string };
  logout: () => void;
  updateProfile: (patch: Partial<Omit<User, 'id' | 'password'>>) => void;
  getUser: (id: string | null | undefined) => User | undefined;
  demoLogin: () => { ok: boolean; message: string };
  resetAuth: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildInitialState(): AuthState {
  return { users: seedUsers.map((u) => ({ ...u })), currentUserId: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    loadState<AuthState>(STORAGE_KEYS.auth, buildInitialState()),
  );

  useEffect(() => {
    saveState(STORAGE_KEYS.auth, state);
  }, [state]);

  const currentUser = useMemo<User | null>(
    () => state.users.find((u) => u.id === state.currentUserId) ?? null,
    [state.users, state.currentUserId],
  );

  const getUser = useCallback(
    (id: string | null | undefined): User | undefined => {
      if (!id) return undefined;
      return state.users.find((u) => u.id === id);
    },
    [state.users],
  );

  const login = useCallback(
    (account: string, password: string): { ok: boolean; message: string } => {
      const acc = account.trim();
      if (!acc || !password) {
        return { ok: false, message: '请输入账号和密码' };
      }
      const found = state.users.find(
        (u) => u.account === acc || u.contact === acc,
      );
      if (!found) {
        return { ok: false, message: '账号不存在，请先注册' };
      }
      if (found.password !== password) {
        return { ok: false, message: '密码错误，请重新输入' };
      }
      setState((prev) => ({ ...prev, currentUserId: found.id }));
      return { ok: true, message: `欢迎回来，${found.nickname}` };
    },
    [state.users],
  );

  const demoLogin = useCallback((): { ok: boolean; message: string } => {
    return login(DEMO_ACCOUNT, DEMO_PASSWORD);
  }, [login]);

  const register = useCallback(
    (input: RegisterInput): { ok: boolean; message: string } => {
      const account = input.account.trim();
      const nickname = input.nickname.trim();
      if (!account) return { ok: false, message: '请输入学号或手机号' };
      if (!input.password || input.password.length < 6) {
        return { ok: false, message: '密码至少 6 位' };
      }
      if (!nickname) return { ok: false, message: '请输入昵称' };
      if (state.users.some((u) => u.account === account)) {
        return { ok: false, message: '该账号已注册，请直接登录' };
      }
      const newUser: User = {
        id: uid('u'),
        account,
        password: input.password,
        nickname,
        avatar: `https://picsum.photos/seed/${encodeURIComponent(account)}/200/200`,
        campus: input.campus,
        contact: input.contact.trim() || account,
        createdAt: Date.now(),
      };
      setState((prev) => ({
        users: [...prev.users, newUser],
        currentUserId: newUser.id,
      }));
      return { ok: true, message: '注册成功，已自动登录' };
    },
    [state.users],
  );

  const logout = useCallback(() => {
    setState((prev) => ({ ...prev, currentUserId: null }));
  }, []);

  const updateProfile = useCallback(
    (patch: Partial<Omit<User, 'id' | 'password'>>) => {
      setState((prev) => {
        if (!prev.currentUserId) return prev;
        return {
          ...prev,
          users: prev.users.map((u) =>
            u.id === prev.currentUserId ? { ...u, ...patch } : u,
          ),
        };
      });
    },
    [],
  );

  const resetAuth = useCallback(() => {
    setState(buildInitialState());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      users: state.users,
      currentUser,
      isAuthenticated: Boolean(currentUser),
      login,
      register,
      logout,
      updateProfile,
      getUser,
      demoLogin,
      resetAuth,
    }),
    [
      state.users,
      currentUser,
      login,
      register,
      logout,
      updateProfile,
      getUser,
      demoLogin,
      resetAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 使用认证上下文 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return ctx;
}

export { DEMO_ACCOUNT, DEMO_PASSWORD };
