import type { Session } from '../model';
export interface Envelope<T> { code: number; data: T; message: string }
export interface Response { statusCode: number; data: unknown; header?: Record<string, unknown>; cookies?: string[] }
export type RequestPort = (input: { url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; data?: unknown; header: Record<string, string>; timeout: number }) => Promise<Response>;
export class ApiError extends Error { constructor(message: string, readonly code: number) { super(message); } }

/** Native cookies are scoped to this API origin and held only in memory. */
export class Transport {
  private token = '';
  private cookie = '';
  private generation = 0;
  private refreshPromise: Promise<void> | null = null;
  constructor(private readonly requestPort: RequestPort, private readonly baseUrl: string, private readonly nativeCookies: boolean, private readonly onExpired: () => void = () => {}) {}
  setSession(session: Session) { this.token = session.accessToken; }
  clear() { this.generation++; this.token = ''; this.cookie = ''; }
  get canRestore() { return !this.nativeCookies || Boolean(this.cookie); }
  private capture(response: Response) {
    if (!this.nativeCookies) return;
    const header = Object.entries(response.header ?? {}).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1];
    const entries = response.cookies ?? (typeof header === 'string' ? [header] : []);
    for (const entry of entries) {
      const match = entry.match(/(?:^|,\s*)cm_refresh=([^;,\s]*)/);
      if (match) this.cookie = match[1] ? `cm_refresh=${match[1]}` : '';
    }
  }
  private refresh(): Promise<void> {
    if (!this.refreshPromise) {
      const generation = this.generation;
      this.refreshPromise = this.request<Session>('/v1/auth/refresh', 'POST', undefined, false)
        .then((session) => { if (generation === this.generation) this.setSession(session); })
        .catch((error) => { if (generation === this.generation && error instanceof ApiError && error.code === 401) { this.clear(); this.onExpired(); } throw error; })
        .finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }
  async request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', data?: unknown, retry = true): Promise<T> {
    const generation = this.generation;
    const header: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (this.token) header.Authorization = `Bearer ${this.token}`;
    if (this.nativeCookies && this.cookie && path.startsWith('/v1/auth/')) header.Cookie = this.cookie;
    let response: Response;
    try { response = await this.requestPort({ url: `${this.baseUrl.replace(/\/$/, '')}${path}`, method, data, header, timeout: 15000 }); }
    catch { throw new ApiError('网络连接失败，请检查网络后重试', -1); }
    if (generation === this.generation) this.capture(response);
    if (response.statusCode === 401 && retry && !path.startsWith('/v1/auth/')) {
      if ((header.Authorization ?? '') === this.authorization) await this.refresh();
      return this.request<T>(path, method, data, false);
    }
    const body = response.data as Partial<Envelope<T>> | null;
    if (generation === this.generation && response.statusCode === 401 && !path.startsWith('/v1/auth/')) { this.clear(); this.onExpired(); }
    if (response.statusCode >= 400 || !body || typeof body.code !== 'number' || body.code !== 0) {
      const message = response.statusCode === 429 ? '操作太频繁，请稍后重试' : body?.message || '服务响应异常，请稍后重试';
      throw new ApiError(message, response.statusCode === 401 ? 401 : body?.code ?? response.statusCode);
    }
    return body.data as T;
  }
  async restore(): Promise<Session | null> {
    if (!this.canRestore) return null;
    try { const session = await this.request<Session>('/v1/auth/refresh', 'POST', undefined, false); this.setSession(session); return session; }
    catch (error) { if (error instanceof ApiError && error.code === 401) { this.clear(); return null; } throw error; }
  }
  async login(data: unknown, register = false) { const session = await this.request<Session>(`/v1/auth/${register ? 'register' : 'login'}`, 'POST', data, false); this.setSession(session); return session.user; }
  async logout() { try { await this.request('/v1/auth/logout', 'POST', undefined, false); } finally { this.clear(); } }
  get authorization() { return this.token ? `Bearer ${this.token}` : ''; }
}
