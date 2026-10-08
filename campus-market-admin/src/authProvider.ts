import type { AuthProvider } from 'react-admin';
import { acceptSession, clearSession, hasAccessToken, request } from './http';

export interface AdminIdentity {
    id: string; fullName: string; schoolId: string; role: string; permissions: string[];
}
export const getAdminIdentity = () => request<AdminIdentity>('/v1/admin/me');

export function permissionFor(resource: string, action: string): string | null {
    if (['list', 'show', 'read'].includes(action)) return `${resource}:read`;
    if (['edit', 'write'].includes(action)) return `${resource}:write`;
    return null;
}
export const authProvider: AuthProvider = {
    async login({ username, password }) {
        acceptSession(await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ account: username, password }) }));
        try { await getAdminIdentity(); }
        catch (error) {
            try { await request('/v1/auth/logout', { method: 'POST' }, false); } catch { /* 保留原始鉴权错误 */ }
            clearSession(); throw error;
        }
    },
    async logout() {
        // 初次打开或刷新会话失败时没有已登录的访问令牌。
        // 此时无需再等退出接口，否则后端不可用会阻断框架跳转到登录页。
        if (!hasAccessToken()) return;
        // 服务器退出失败时保留当前会话，让用户重试。
        try { await request('/v1/auth/logout', { method: 'POST' }, false); }
        catch (error) { if (!(error instanceof Error && 'status' in error && error.status === 401)) throw error; }
        clearSession();
    },
    async checkAuth() { await getAdminIdentity(); },
    async checkError(error) {
        if (error.status === 401) { clearSession(); throw error; }
    },
    async getIdentity() { return getAdminIdentity(); },
    async getPermissions() { return getAdminIdentity(); },
    async canAccess({ resource, action }) {
        const permission = permissionFor(resource, action);
        return permission !== null && (await getAdminIdentity()).permissions.includes(permission);
    },
};
