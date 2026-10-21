import type { Session, WechatLoginResult } from '../model';
import { uploadErrorMessage } from '../images';
export interface Envelope<T> { code: number; data: T; message: string }
export interface Response { statusCode: number; data: unknown; header?: Record<string, unknown>; cookies?: string[] }
export type RequestPort = (input: { url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; data?: unknown; header: Record<string, string>; timeout: number }) => Promise<Response>;
/** multipart 上传（小程序 Taro.uploadFile）：只带 Authorization，不带 Cookie；响应体是字符串。 */
export type UploadPort = (input: { url: string; filePath: string; name: string; header: Record<string, string>; timeout: number }, onProgress?: (percent: number) => void) => Promise<{ statusCode: number; data: unknown }>;
/** details：后端错误 envelope 的 data（例如整批发布被拒时的逐项原因 items、版本冲突时的 currentVersion）。 */
export class ApiError extends Error { constructor(message: string, readonly code: number, readonly details?: unknown) { super(message); } }
/**
 * 交换凭据的认证接口：401 表示账号、密码或凭证本身无效，不刷新、不结束会话。
 * 其余 /v1/auth/ 接口（资料、修改密码、注销、微信绑定状态与绑定）携带访问令牌，令牌过期时和业务接口一样刷新一次。
 */
const CREDENTIAL_EXCHANGE = /^\/v1\/auth\/(?:login|register|refresh|logout|password-reset|wechat\/login)(?:\?|$)/;
const sessionBound = (path: string) => !CREDENTIAL_EXCHANGE.test(path);
const INVALID = '服务响应异常，请稍后重试';

/** Native cookies are scoped to this API origin and held only in memory. */
export class Transport {
  private token = '';
  private cookie = '';
  private generation = 0;
  private refreshPromise: Promise<void> | null = null;
  constructor(private readonly requestPort: RequestPort, private readonly baseUrl: string, private readonly nativeCookies: boolean, private readonly onExpired: () => void = () => {}, private readonly uploadPort?: UploadPort) {}
  /** 接口域名（不带结尾斜杠），用于拼接相对的签名图片地址。 */
  get origin() { return this.baseUrl.replace(/\/$/, ''); }
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
  /** extraHeaders：只用于少数接口需要的请求头（例如整批发布的 Idempotency-Key），不能覆盖认证头。 */
  async request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET', data?: unknown, retry = true, extraHeaders?: Record<string, string>): Promise<T> {
    const generation = this.generation;
    const header: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', ...(extraHeaders ?? {}) };
    if (this.token) header.Authorization = `Bearer ${this.token}`;
    if (this.nativeCookies && this.cookie && path.startsWith('/v1/auth/')) header.Cookie = this.cookie;
    let response: Response;
    try { response = await this.requestPort({ url: `${this.origin}${path}`, method, data, header, timeout: 15000 }); }
    catch { throw new ApiError('网络连接失败，请检查网络后重试', -1); }
    if (generation === this.generation) this.capture(response);
    if (response.statusCode === 401 && retry && sessionBound(path)) {
      if ((header.Authorization ?? '') === this.authorization) await this.refresh();
      return this.request<T>(path, method, data, false, extraHeaders);
    }
    const body = response.data as Partial<Envelope<T>> | null;
    if (generation === this.generation && response.statusCode === 401 && sessionBound(path)) { this.clear(); this.onExpired(); }
    if (response.statusCode >= 400 || !body || typeof body.code !== 'number' || body.code !== 0) {
      const message = response.statusCode === 429 ? '操作太频繁，请稍后重试' : body?.message || INVALID;
      const details = body && body.data !== null && typeof body.data === 'object' ? body.data : undefined;
      throw new ApiError(message, response.statusCode === 401 ? 401 : body?.code ?? response.statusCode, details);
    }
    return body.data as T;
  }
  /**
   * multipart 上传（POST，字段 file）：与 request 相同的会话规则——带当前访问令牌；401 时与其他请求共用一次刷新，再重试一次；
   * 重试仍 401 结束会话。错误：413「图片不能超过 5 MB」、429 限流、400 等原样显示后端文案。
   */
  async upload<T>(path: string, filePath: string, onProgress?: (percent: number) => void, retry = true): Promise<T> {
    if (!this.uploadPort) throw new ApiError('当前环境不支持上传图片', -1);
    const generation = this.generation;
    const header: Record<string, string> = {};
    if (this.token) header.Authorization = `Bearer ${this.token}`;
    let statusCode: number, raw: unknown;
    try { ({ statusCode, data: raw } = await this.uploadPort({ url: `${this.origin}${path}`, filePath, name: 'file', header, timeout: 60000 }, onProgress)); }
    catch { throw new ApiError('网络连接失败，请检查网络后重试', -1); }
    if (statusCode === 401 && retry) {
      if ((header.Authorization ?? '') === this.authorization) await this.refresh();
      return this.upload<T>(path, filePath, onProgress, false);
    }
    let body: Partial<Envelope<T>> | null = null;
    try { body = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw as Partial<Envelope<T>> | null; } catch { body = null; }
    if (generation === this.generation && statusCode === 401) { this.clear(); this.onExpired(); }
    if (statusCode >= 400 || !body || typeof body !== 'object' || body.code !== 0) {
      if (statusCode < 400) throw new ApiError(INVALID, -1);
      throw new ApiError(statusCode === 401 ? body?.message || '登录已失效，请重新登录' : uploadErrorMessage(statusCode, body), statusCode);
    }
    return body.data as T;
  }
  async restore(): Promise<Session | null> {
    if (!this.canRestore) return null;
    try { const session = await this.request<Session>('/v1/auth/refresh', 'POST', undefined, false); this.setSession(session); return session; }
    catch (error) { if (error instanceof ApiError && error.code === 401) { this.clear(); return null; } throw error; }
  }
  async login(data: unknown, register = false) { const session = await this.request<Session>(`/v1/auth/${register ? 'register' : 'login'}`, 'POST', data, false); this.setSession(session); return session.user; }
  /**
   * 微信登录：已绑定时响应就是一次普通会话（同密码登录：访问令牌 + Set-Cookie 里的刷新 Cookie，由 request 统一捕获）；
   * 未绑定时只返回绑定票据，不建立会话。票据交给调用方放在内存里，这里不保存。
   */
  async wechatLogin(code: string): Promise<WechatLoginResult> {
    const body = (await this.request<Record<string, unknown> | null>('/v1/auth/wechat/login', 'POST', { code }, false)) ?? {};
    if (body.bound === true && typeof body.accessToken === 'string' && body.accessToken && body.user && typeof (body.user as { id?: unknown }).id === 'string') {
      const session: Session = { accessToken: body.accessToken, expiresAtIso: typeof body.expiresAtIso === 'string' ? body.expiresAtIso : '', user: body.user as Session['user'] };
      this.setSession(session);
      return { bound: true, user: session.user };
    }
    if (body.bound === false && typeof body.bindTicket === 'string' && body.bindTicket) {
      return { bound: false, bindTicket: body.bindTicket, expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : 0 };
    }
    throw new ApiError(INVALID, -1);
  }
  async logout() { try { await this.request('/v1/auth/logout', 'POST', undefined, false); } finally { this.clear(); } }
  get authorization() { return this.token ? `Bearer ${this.token}` : ''; }
}
