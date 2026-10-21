import type { MarketApi, Product, ProductInput, ProductPage, Query, User, ContactRequest, ContactPage, ContactQuery, ContactRole, InspectionTemplate, ProductStatus, Campus, Category, UnreadCount, WechatStatus, PasswordResetInput, DeletionInput, DeletionResult, ProfileInput, Building, ReportInput, MyReport, MyGovernance, AppealInput, AppealSummary, Comment, Conversation, ChatMessage, SendMessageInput, MessageTemplates, MessageTemplate,
  ClientConfig, FeedPage, FeedQuery, Circle, CircleInput, CircleInvite, CircleInviteCreated, CircleMemberPage, CircleRole, DiscoverableCircle,
  ListingDraft, ListingKind, ListingPayload, ListingBatch, ListingBatchSummary, PublishBatchResult, AssistInvite, AssistInviteCreated, AssistInviteRedeemed,
  CourseQuery, CoursePage, CourseDetail, TextbookDetail, TextbookEdition, TextbookSuggestionInput, TextbookSuggestionResult, TextbookSuggestion,
  DemandConditions, DemandSubscribeResult, DemandSubscription, DemandMatchPage } from '../model';
import { CONTACT_STATUSES, normalizeClientConfig } from '../model';
import { ApiError, Transport } from './transport';
import { imageRefFromUrl, parseUploadedImage, resolveImageUrl } from '../images';
import { parseSchools } from '../schools';

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
const str = (value: unknown) => typeof value === 'string' ? value : '';
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const list = (raw: unknown) => { if (!Array.isArray(raw)) throw new ApiError(INVALID, -1); return raw as unknown[]; };
/** 留言：被隐藏的正文为空；缺省的治理字段按「未隐藏」处理。 */
export function parseComment(raw: unknown): Comment {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string') throw new ApiError(INVALID, -1);
  return { id: r.id, productId: str(r.productId), userId: str(r.userId), content: str(r.content), createdAt: time(r.createdAt),
    parentId: typeof r.parentId === 'string' && r.parentId ? r.parentId : null, moderationHidden: r.moderationHidden === true, hiddenForAuthor: r.hiddenForAuthor === true };
}
export function parseConversation(raw: unknown): Conversation {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string') throw new ApiError(INVALID, -1);
  return { id: r.id, productId: str(r.productId), buyerId: str(r.buyerId), sellerId: str(r.sellerId), createdAt: time(r.createdAt), updatedAt: time(r.updatedAt) };
}
/** 私信：templateCode 缺省或 null 表示旧版自由文字消息（照常显示）。 */
export function parseMessage(raw: unknown): ChatMessage {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string') throw new ApiError(INVALID, -1);
  return { id: r.id, conversationId: str(r.conversationId), senderId: str(r.senderId), content: str(r.content), createdAt: time(r.createdAt),
    quarantined: r.quarantined === true, templateCode: typeof r.templateCode === 'string' && r.templateCode ? r.templateCode : null };
}
const ROLES = ['BUYER', 'SELLER', 'ANY'];
/** GET /v1/message-templates：freeTextEnabled 缺省为 false；格式不对的模板丢弃。 */
export function parseTemplates(raw: unknown): MessageTemplates {
  const body = (raw ?? {}) as Record<string, unknown>;
  const templates = (Array.isArray(body.templates) ? body.templates : []).filter((t): t is MessageTemplate => {
    const x = (t ?? {}) as Record<string, unknown>;
    return typeof x.code === 'string' && !!x.code && typeof x.text === 'string' && ROLES.includes(x.role as string);
  }).map((t) => ({ code: t.code, text: t.text, role: t.role }));
  return { freeTextEnabled: body.freeTextEnabled === true, templates };
}
/** GET /v1/me/governance：缺省的列表按空处理。 */
export function parseGovernance(raw: unknown): MyGovernance {
  const body = (raw ?? {}) as Record<string, unknown>;
  return { restrictions: Array.isArray(body.restrictions) ? body.restrictions as MyGovernance['restrictions'] : [], notices: Array.isArray(body.notices) ? body.notices as MyGovernance['notices'] : [] };
}
const conversationPath = (id: string, action = '') => `/v1/conversations/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
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
  me() { return this.transport.request<User>('/v1/auth/me'); }
  /** 请求体只带 Web ProfilePatch 的字段；没有给出的可选字段不发送。 */
  updateProfile(input: ProfileInput) {
    const body: Record<string, unknown> = { nickname: input.nickname, campus: input.campus, contact: input.contact };
    if (input.avatar !== undefined) body.avatar = input.avatar;
    if (input.dormBuildingId !== undefined) body.dormBuildingId = input.dormBuildingId;
    return this.transport.request<User>('/v1/auth/me', 'PATCH', body);
  }
  async buildings(campus: Campus) { return list(await this.transport.request<unknown>(`/v1/buildings?campus=${encodeURIComponent(campus)}`)) as Building[]; }
  /** GET /v1/schools（公开）：格式不对视为响应异常。 */
  async schools() { try { return parseSchools(await this.transport.request<unknown>('/v1/schools')); } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(INVALID, -1); } }
  // ---------- 可信治理（用户侧）：请求体只带白名单字段 ----------
  report(input: ReportInput) {
    const body: Record<string, unknown> = { targetType: input.targetType, targetId: input.targetId, reasonCode: input.reasonCode };
    if (input.note) body.note = input.note;
    return this.transport.request<MyReport>('/v1/moderation-reports', 'POST', body);
  }
  async myReports() { return list(await this.transport.request<unknown>('/v1/moderation-reports/mine')) as MyReport[]; }
  async myGovernance() { return parseGovernance(await this.transport.request<unknown>('/v1/me/governance')); }
  appeal(input: AppealInput) {
    const body = 'restrictionId' in input ? { restrictionId: input.restrictionId, reason: input.reason } : { actionId: input.actionId, reason: input.reason };
    return this.transport.request<AppealSummary>('/v1/me/appeals', 'POST', body);
  }
  // ---------- 留言 ----------
  async comments(productId: string) { return list(await this.transport.request<unknown>(`/v1/products/${encodeURIComponent(productId)}/comments`)).map(parseComment); }
  async addComment(productId: string, content: string, parentId: string | null) {
    return parseComment(await this.transport.request<unknown>(`/v1/products/${encodeURIComponent(productId)}/comments`, 'POST', { content, parentId }));
  }
  // ---------- 私信（阶段 1：快捷消息） ----------
  async conversations() { return list(await this.transport.request<unknown>('/v1/conversations')).map(parseConversation); }
  async openConversation(productId: string) { return parseConversation(await this.transport.request<unknown>('/v1/conversations', 'POST', { productId })); }
  async messages(conversationId: string) { return list(await this.transport.request<unknown>(conversationPath(conversationId, 'messages'))).map(parseMessage); }
  /** 快捷消息只发 { templateCode }；自由文字只发 { content }。 */
  async sendMessage(conversationId: string, input: SendMessageInput) {
    const body = 'templateCode' in input ? { templateCode: input.templateCode } : { content: input.content };
    return parseMessage(await this.transport.request<unknown>(conversationPath(conversationId, 'messages'), 'POST', body));
  }
  async markConversationRead(conversationId: string) { await this.transport.request(conversationPath(conversationId, 'read'), 'POST'); }
  async messageUnread() { return count(((await this.transport.request<Record<string, unknown> | null>('/v1/messages/unread')) ?? {}).count); }
  async messageTemplates() { return parseTemplates(await this.transport.request<unknown>('/v1/message-templates')); }
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

  // ---------- 与 Web 对齐（第二部分）：路径与请求体与 Web restCampusMarketApi 逐条一致 ----------
  /** GET /v1/config（无需登录）；旧后端没有这个接口（404）时按默认规则处理。 */
  async clientConfig(): Promise<ClientConfig> {
    try { return normalizeClientConfig(await this.transport.request<unknown>('/v1/config')); }
    catch (e) { if (e instanceof ApiError && e.code === 404) return normalizeClientConfig(null); throw e; }
  }
  /** null / 空串表示「不限制」，不下发；0 是合法价格，保留。 */
  feed(query: FeedQuery) { return this.transport.request<FeedPage>(`/v1/products/feed?${queryString(query as unknown as Record<string, unknown>)}`); }
  // 圈子：id 只出现在路径里；名称、成员资格与邀请码从不进入 URL query
  createCircle(input: CircleInput) { return this.transport.request<Circle>('/v1/circles', 'POST', pick(input, ['type', 'name', 'description', 'visibility'])); }
  async myCircles() { return list(await this.transport.request<unknown>('/v1/circles/mine')) as Circle[]; }
  async discoverCircles(q?: string) { return list(await this.transport.request<unknown>(`/v1/circles/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`)) as DiscoverableCircle[]; }
  circle(id: string) { return this.transport.request<Circle | DiscoverableCircle>(circlePath(id)); }
  updateCircle(id: string, patch: Partial<CircleInput>) { return this.transport.request<Circle>(circlePath(id), 'PATCH', pick(patch, ['type', 'name', 'description', 'visibility'])); }
  archiveCircle(id: string) { return this.transport.request<Circle>(circlePath(id, 'archive'), 'POST', {}); }
  circleProducts(id: string, page = 1) { return this.transport.request<FeedPage>(`${circlePath(id, 'products')}?page=${page}`); }
  createCircleInvite(id: string, expiresInHours?: number) { return this.transport.request<CircleInviteCreated>(circlePath(id, 'invites'), 'POST', expiresInHours ? { expiresInHours } : {}); }
  async circleInvites(id: string) { return list(await this.transport.request<unknown>(circlePath(id, 'invites'))) as CircleInvite[]; }
  /** 邀请码只放在请求体里。 */
  redeemCircleInvite(token: string) { return this.transport.request<Circle>('/v1/circle-invites/redeem', 'POST', { token }); }
  revokeCircleInvite(inviteId: string) { return this.transport.request<CircleInvite>(`/v1/circle-invites/${encodeURIComponent(inviteId)}/revoke`, 'POST', {}); }
  circleMembers(id: string, page = 1, size = 20) { return this.transport.request<CircleMemberPage>(`${circlePath(id, 'members')}?page=${page}&size=${size}`); }
  changeCircleMemberRole(id: string, userId: string, role: CircleRole) { return this.transport.request<CircleMemberPage>(`${circlePath(id, 'members')}/${encodeURIComponent(userId)}`, 'PATCH', { role }); }
  removeCircleMember(id: string, userId: string) { return this.transport.request<{ userId: string; status: 'LEFT' | 'REMOVED' }>(`${circlePath(id, 'members')}/${encodeURIComponent(userId)}`, 'DELETE'); }
  // 毕业季快速发布：草稿响应里的上传图片是签名地址，保存时换回 upload:<id>
  createDraft(input: { draftType?: ListingKind; payload?: ListingPayload }) { return this.transport.request<ListingDraft>('/v1/listing-drafts', 'POST', this.payloadRefs(pick(input, ['draftType', 'payload']))); }
  async drafts() { return list(await this.transport.request<unknown>('/v1/listing-drafts')) as ListingDraft[]; }
  async assistingDrafts() { return list(await this.transport.request<unknown>('/v1/listing-drafts/assisting')) as ListingDraft[]; }
  draft(id: string) { return this.transport.request<ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`); }
  updateDraft(id: string, input: { expectedVersion: number; payload?: ListingPayload; status?: 'DRAFT' | 'READY' }) {
    return this.transport.request<ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`, 'PATCH', this.payloadRefs(pick(input, ['expectedVersion', 'payload', 'status'])));
  }
  discardDraft(id: string) { return this.transport.request<ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`, 'DELETE'); }
  createBatch(input: { draftIds?: string[] }) { return this.transport.request<ListingBatch>('/v1/listing-batches', 'POST', pick(input, ['draftIds'])); }
  async batches() { return list(await this.transport.request<unknown>('/v1/listing-batches')) as ListingBatchSummary[]; }
  batch(id: string) { return this.transport.request<ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`); }
  updateBatch(id: string, input: { expectedVersion: number; draftIds: string[] }) { return this.transport.request<ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`, 'PATCH', pick(input, ['expectedVersion', 'draftIds'])); }
  discardBatch(id: string) { return this.transport.request<ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`, 'DELETE'); }
  /** 请求体为空；幂等键只放在 Idempotency-Key 请求头里。 */
  publishBatch(id: string, idempotencyKey: string) {
    return this.transport.request<PublishBatchResult>(`/v1/listing-batches/${encodeURIComponent(id)}/publish`, 'POST', undefined, true, { 'Idempotency-Key': idempotencyKey });
  }
  createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }) { return this.transport.request<AssistInviteCreated>('/v1/listing-assist-invites', 'POST', pick(input, ['draftId', 'batchId', 'expiresInHours'])); }
  async assistInvites() { return list(await this.transport.request<unknown>('/v1/listing-assist-invites')) as AssistInvite[]; }
  /** 邀请码只出现在请求体里。 */
  redeemAssistInvite(token: string) { return this.transport.request<AssistInviteRedeemed>('/v1/listing-assist-invites/redeem', 'POST', { token }); }
  revokeAssistInvite(id: string) { return this.transport.request<AssistInvite>(`/v1/listing-assist-invites/${encodeURIComponent(id)}/revoke`, 'POST', {}); }
  // 课程教材：学校由服务端从本人校区推导
  courses(query: CourseQuery) { const qs = queryString(query as Record<string, unknown>); return this.transport.request<CoursePage>(`/v1/courses${qs ? `?${qs}` : ''}`); }
  course(id: string) { return this.transport.request<CourseDetail>(`/v1/courses/${encodeURIComponent(id)}`); }
  textbook(editionId: string, sort?: 'nearest' | 'latest') { return this.transport.request<TextbookDetail>(`/v1/textbooks/${encodeURIComponent(editionId)}${sort ? `?sort=${sort}` : ''}`); }
  textbookByIsbn(isbn: string) { return this.transport.request<TextbookEdition>(`/v1/textbooks/isbn/${encodeURIComponent(isbn)}`); }
  createTextbookSuggestion(input: TextbookSuggestionInput) {
    return this.transport.request<TextbookSuggestionResult>('/v1/textbook-suggestions', 'POST', pick(input, ['courseOfferingId', 'textbookEditionId', 'isbn', 'title', 'authors', 'publisher', 'editionLabel', 'publishedYear', 'usageType', 'note']));
  }
  async myTextbookSuggestions() { return list(await this.transport.request<unknown>('/v1/textbook-suggestions/mine')) as TextbookSuggestion[]; }
  withdrawTextbookSuggestion(id: string) { return this.transport.request<TextbookSuggestion>(`/v1/textbook-suggestions/${encodeURIComponent(id)}`, 'DELETE'); }
  // 需求订阅
  createSubscription(input: DemandConditions) { return this.transport.request<DemandSubscribeResult>('/v1/demand-subscriptions', 'POST', pick(input, DEMAND_FIELDS)); }
  async subscriptions() { return list(await this.transport.request<unknown>('/v1/demand-subscriptions')) as DemandSubscription[]; }
  /** 教材版本与圈子创建后不可修改：PATCH 不带这两个字段。 */
  updateSubscription(id: string, patch: DemandConditions & { active?: boolean }) {
    return this.transport.request<DemandSubscription>(`/v1/demand-subscriptions/${encodeURIComponent(id)}`, 'PATCH', pick(patch, [...DEMAND_PATCH_FIELDS, 'active']));
  }
  deleteSubscription(id: string) { return this.transport.request<DemandSubscription>(`/v1/demand-subscriptions/${encodeURIComponent(id)}`, 'DELETE'); }
  demandMatches(page = 1, pageSize = 20) { return this.transport.request<DemandMatchPage>(`/v1/demand-matches?page=${page}&pageSize=${pageSize}`); }
  async demandUnread() { return count(((await this.transport.request<Record<string, unknown> | null>('/v1/demand-matches/unread-count')) ?? {}).count); }
  async markDemandRead(id: string) { return count(((await this.transport.request<Record<string, unknown> | null>(`/v1/demand-matches/${encodeURIComponent(id)}/read`, 'POST')) ?? {}).count); }
  async dismissDemandMatch(id: string) { return count(((await this.transport.request<Record<string, unknown> | null>(`/v1/demand-matches/${encodeURIComponent(id)}/dismiss`, 'POST')) ?? {}).count); }
  /** 草稿 payload 里的签名图片地址换回 upload:<id> 引用，其余字段原样。 */
  private payloadRefs<T extends { payload?: ListingPayload }>(input: T): T {
    if (!input.payload || !Array.isArray(input.payload.images)) return input;
    return { ...input, payload: { ...input.payload, images: input.payload.images.map((url) => this.imageRef(url)) } };
  }
}
const circlePath = (id: string, action = '') => `/v1/circles/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
const DEMAND_PATCH_FIELDS = ['keyword', 'category', 'minPrice', 'maxPrice', 'geoScope', 'campusId', 'buildingId'];
const DEMAND_FIELDS = [...DEMAND_PATCH_FIELDS, 'textbookEditionId', 'circleId'];
/** 请求体只带白名单字段（后端未知字段一律 400），值为 undefined 的不发送。 */
function pick<T extends object>(input: T, keys: readonly string[]): T {
  const body: Record<string, unknown> = {};
  for (const key of keys) { const value = (input as Record<string, unknown>)[key]; if (value !== undefined) body[key] = value; }
  return body as T;
}
function queryString(query: Record<string, unknown>) {
  return Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}
