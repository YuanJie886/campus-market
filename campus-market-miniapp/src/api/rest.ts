import type { MarketApi, Product, ProductInput, ProductPage, Query, User, ContactRequest, ContactPage, ContactQuery, ContactRole, InspectionTemplate, ProductStatus, Campus, Category, UnreadCount, WechatStatus, PasswordResetInput, DeletionInput, DeletionResult } from '../model';
import { CONTACT_STATUSES } from '../model';
import { ApiError, Transport } from './transport';
import { imageRefFromUrl, parseUploadedImage, resolveImageUrl } from '../images';

const INVALID = '服务响应异常，请稍后重试';
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
/** 后端申请对象 → 小程序模型；状态未知视为响应异常，缺省的新字段给出安全默认值。 */
export function parseContactRequest(raw: unknown): ContactRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || !CONTACT_STATUSES.includes(r.status as ContactRequest['status'])) throw new ApiError(INVALID, -1);
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  return {
    id: r.id, productId: text(r.productId), productTitle: text(r.productTitle), buyerId: text(r.buyerId), sellerId: text(r.sellerId),
    buyerNickname: text(r.buyerNickname), sellerNickname: text(r.sellerNickname), status: r.status as ContactRequest['status'],
    createdAt: count(r.createdAt), updatedAt: count(r.updatedAt), decidedAt: typeof r.decidedAt === 'number' ? r.decidedAt : null, unread: r.unread === true,
  };
}
/** GET /v1/contact-requests 返回 { items, total, page, size }。 */
export function parseContactPage(raw: unknown): ContactPage {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.items)) throw new ApiError(INVALID, -1);
  return { items: body.items.map(parseContactRequest), total: count(body.total), page: count(body.page) || 1, size: count(body.size) || body.items.length };
}
export function parseUnread(raw: unknown): UnreadCount {
  const body = (raw ?? {}) as Record<string, unknown>;
  const received = count(body.received), updates = count(body.updates);
  return { received, updates, total: typeof body.total === 'number' ? count(body.total) : received + updates };
}
/** GET /v1/auth/wechat 返回 { enabled, bound }；缺省一律按 false（不显示微信登录）。 */
export function parseWechatStatus(raw: unknown): WechatStatus {
  const body = (raw ?? {}) as Record<string, unknown>;
  return { enabled: body.enabled === true, bound: body.bound === true };
}
export function parseDeletion(raw: unknown): DeletionResult {
  const body = (raw ?? {}) as Record<string, unknown>;
  return { productsTakenDown: count(body.productsTakenDown), requestsClosed: count(body.requestsClosed), membershipsEnded: count(body.membershipsEnded) };
}
const requestPath = (id: string, action: string) => `/v1/contact-requests/${encodeURIComponent(id)}/${action}`;
export class RestApi implements MarketApi {
  private uid = '';
  constructor(private readonly transport: Transport) {}
  async restore() { const session = await this.transport.restore(); this.uid = session?.user.id ?? ''; return session?.user ?? null; }
  async login(account: string, password: string) { const user = await this.transport.login({ account: account.trim(), password }); this.uid = user.id; return user; }
  async register(input: { account: string; password: string; nickname: string; campus: Campus; contact: string }) { const user = await this.transport.login(input, true); this.uid = user.id; return user; }
  async logout() { try { await this.transport.logout(); } finally { this.uid = ''; } }
  list(query: Query) {
    const parameters = Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    return this.transport.request<ProductPage>(`/v1/products?${parameters}`);
  }
  detail(id: string) { return this.transport.request<Product>(`/v1/products/${encodeURIComponent(id)}`); }
  publicUser(id: string) { return this.transport.request<User>(`/v1/users/${encodeURIComponent(id)}`); }
  publish(input: ProductInput, id?: string) { return this.transport.request<Product>(id ? `/v1/products/${encodeURIComponent(id)}` : '/v1/products', id ? 'PATCH' : 'POST', input); }
  async myListings() {
    const result: Product[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.list({ sort: 'latest', page, pageSize: 100 });
      result.push(...batch.items.filter((p) => p.sellerId === this.uid));
      if (!batch.items.length || page * batch.pageSize >= batch.total) break;
    }
    return result;
  }
  async status(id: string, status: ProductStatus) { await this.transport.request(`/v1/products/${encodeURIComponent(id)}/status`, 'POST', { status }); }
  async favorites() { const values = await this.transport.request<{ productId: string }[]>('/v1/favorites'); return values.map((f) => f.productId); }
  async favorite(id: string, active: boolean) { await this.transport.request(`/v1/products/${encodeURIComponent(id)}/favorite`, active ? 'PUT' : 'DELETE'); }
  async requestContact(id: string) { return parseContactRequest(await this.transport.request<unknown>(`/v1/products/${encodeURIComponent(id)}/contact-request`, 'POST')); }
  async contactState(id: string) { const raw = await this.transport.request<unknown>(`/v1/products/${encodeURIComponent(id)}/contact-request`); return raw == null ? null : parseContactRequest(raw); }
  async contacts(query: ContactQuery) {
    const parameters = [['role', query.role], ['status', query.status], ['page', query.page], ['size', query.size]]
      .filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&');
    return parseContactPage(await this.transport.request<unknown>(`/v1/contact-requests?${parameters}`));
  }
  async decide(id: string, status: 'APPROVED' | 'REJECTED') { await this.transport.request(requestPath(id, 'decision'), 'POST', { status }); }
  async withdraw(id: string) { return parseContactRequest(await this.transport.request<unknown>(requestPath(id, 'withdraw'), 'POST')); }
  async revoke(id: string) { return parseContactRequest(await this.transport.request<unknown>(requestPath(id, 'revoke'), 'POST')); }
  async unreadCount() { return parseUnread(await this.transport.request<unknown>('/v1/contact-requests/unread-count')); }
  async markRead(role: ContactRole) { return parseUnread(await this.transport.request<unknown>('/v1/contact-requests/read', 'POST', { role })); }
  template(category: Category) { return this.transport.request<InspectionTemplate | null>(`/v1/inspection-templates?category=${encodeURIComponent(category)}`); }
  updateProfile(input: { nickname: string; campus: Campus; contact: string }) { return this.transport.request<User>('/v1/auth/me', 'PATCH', input); }
  async report(id: string, reason: string) { await this.transport.request('/v1/moderation-reports', 'POST', { targetType: 'PRODUCT', targetId: id, reasonCode: 'OTHER', note: reason }); }
  /** POST /v1/images（multipart 字段 file）；返回的 ref 放进商品 images，url 只用于显示。 */
  async upload(path: string, onProgress?: (percent: number) => void) { return parseUploadedImage(await this.transport.upload<unknown>('/v1/images', path, onProgress)); }
  imageSrc(url: string) { return resolveImageUrl(url, this.transport.origin); }
  imageRef(url: string) { return imageRefFromUrl(url, this.transport.origin); }
  // ---------- 阶段 3：账号生命周期（请求体与后端 JsonFieldPolicy 白名单逐字段一致，不带多余字段） ----------
  async wechatStatus() { return parseWechatStatus(await this.transport.request<unknown>('/v1/auth/wechat')); }
  async wechatLogin(code: string) { const result = await this.transport.wechatLogin(code); if (result.bound) this.uid = result.user.id; return result; }
  async wechatBind(bindTicket: string) { await this.transport.request('/v1/auth/wechat/bind', 'POST', { bindTicket }); }
  async wechatUnbind() { await this.transport.request('/v1/auth/wechat/unbind', 'POST'); }
  async changePassword(currentPassword: string, newPassword: string) {
    const body = await this.transport.request<Record<string, unknown> | null>('/v1/auth/password', 'POST', { currentPassword, newPassword });
    return { otherSessionsEnded: count(body?.otherSessionsEnded) };
  }
  async resetPassword(input: PasswordResetInput) {
    await this.transport.request('/v1/auth/password-reset', 'POST', { account: input.account.trim(), code: input.code.trim(), newPassword: input.newPassword }, false);
  }
  async deleteAccount(input: DeletionInput) {
    const raw = await this.transport.request<unknown>('/v1/auth/me/deletion', 'POST', { password: input.password, confirmation: input.confirmation });
    // 2xx 即已注销：后端已结束全部会话并清除刷新 Cookie；本机同步丢弃访问令牌与 Cookie
    this.transport.clear(); this.uid = '';
    return parseDeletion(raw);
  }
}
