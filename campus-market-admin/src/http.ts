import { HttpError } from './HttpError';

interface Session { accessToken: string; expiresAtIso: string }
let token: string | null = null;
let refreshFlight: Promise<void> | null = null;

export function clearSession() { token = null; }
export function acceptSession(session: Session) { token = session.accessToken; }
export function hasAccessToken() { return token !== null; }

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(path, { ...init, headers, credentials: 'include', signal: controller.signal });
        if (response.status === 401 && retry && !path.startsWith('/v1/auth/')) {
            await refreshSession();
            return await request<T>(path, init, false);
        }
        let envelope: { code: number; data: T; message: string; requestId?: string };
        try { envelope = await response.json(); }
        catch { throw new HttpError('后端未返回有效 JSON，请检查服务与代理配置', response.status || 502); }
        if (!response.ok || envelope.code !== 0) {
            throw new HttpError(envelope.message || '请求失败', response.status, { ...envelope, retryAfter: response.headers.get('Retry-After') });
        }
        return envelope.data;
    } finally { clearTimeout(timer); }
}

export function refreshSession(): Promise<void> {
    if (!refreshFlight) {
        const task = async () => acceptSession(await request<Session>('/v1/auth/refresh', { method: 'POST' }, false));
        // 与商城前台使用同一个锁，防止刷新 Cookie 轮换发生跨页面竞争。
        const run = async () => {
            if (navigator.locks) await navigator.locks.request('campus-market-refresh', task);
            else await task();
        };
        refreshFlight = run()
            .catch(error => { if (error.status === 401) clearSession(); throw error; })
            .finally(() => { refreshFlight = null; });
    }
    return refreshFlight;
}
