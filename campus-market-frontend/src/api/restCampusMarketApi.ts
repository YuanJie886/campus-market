import type { CampusMarketApi, AuthSession, LoginInput, RegisterInput, ProfilePatch, ProductQuery, ProductPage, ProductCreateInput, ProductPatch, CommentInput, ContactRequest, ContactRequestPage, ContactRequestQuery, ContactRequestRole, ContactUnreadCounts } from './contracts';
import type { User, Product, Favorite, Comment, Conversation, ChatMessage, ProductStatus } from '../types';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { normalizeClientConfig, normalizeSchools } from './contracts';
import { authTokenStore } from '../utils/authTokenStore';
export class RestCampusMarketApi implements CampusMarketApi {
  constructor(private readonly transport: HttpTransport) {}
  // ---------------- 联系申请（阶段 1）：请求体只带接口列出的字段，未知字段后端一律 400 ----------------
  getContactRequest(productId: string) { return this.transport.get<ContactRequest | null>(`/v1/products/${encodeURIComponent(productId)}/contact-request`) }
  /** 请求体为空：身份、商品与卖家都由服务端决定 */
  requestContact(productId: string) { return this.transport.post<ContactRequest>(`/v1/products/${encodeURIComponent(productId)}/contact-request`) }
  listContactRequests(query: ContactRequestQuery = {}) {
    const params = new URLSearchParams();
    // 固定顺序，只下发调用方给出的参数（role 缺省时由服务端按 received 处理）
    for (const key of ['role', 'status', 'page', 'size'] as const) {
      const value = query[key];
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    return this.transport.get<ContactRequestPage>(`/v1/contact-requests${qs ? `?${qs}` : ''}`);
  }
  getContactRequestUnreadCount() { return this.transport.get<ContactUnreadCounts>('/v1/contact-requests/unread-count') }
  markContactRequestsRead(role: ContactRequestRole) { return this.transport.post<ContactUnreadCounts>('/v1/contact-requests/read', { role }) }
  decideContactRequest(id: string, status: 'APPROVED' | 'REJECTED') {
    return this.transport.post<ContactRequest>(`/v1/contact-requests/${encodeURIComponent(id)}/decision`, { status });
  }
  withdrawContactRequest(id: string) { return this.transport.post<ContactRequest>(`/v1/contact-requests/${encodeURIComponent(id)}/withdraw`) }
  revokeContactRequest(id: string) { return this.transport.post<ContactRequest>(`/v1/contact-requests/${encodeURIComponent(id)}/revoke`) }
  getUser(id: string): Promise<import('../types').PublicUser> { return this.transport.get(`/v1/users/${encodeURIComponent(id)}`) }
  /** GET /v1/schools（无需登录）：可见的学校与校区；响应逐项校验后再交给界面 */
  async getSchools(): Promise<import('./contracts').School[]> {
    return normalizeSchools(await this.transport.get<unknown>('/v1/schools'));
  }
  listBuildings(campus: import('../types').Campus, zone?: string): Promise<import('../types').Building[]> {
    const params = new URLSearchParams({ campus });
    if (zone) params.set('zone', zone);
    return this.transport.get<import('../types').Building[]>(`/v1/buildings?${params.toString()}`);
  }
  markConversationRead(id: string): Promise<void> { return this.transport.post(`/v1/conversations/${encodeURIComponent(id)}/read`) }
  login(input: LoginInput): Promise<AuthSession> { return this.transport.post<AuthSession>('/v1/auth/login', input).then((s) => { authTokenStore.setAccessToken(s.accessToken, s.expiresAtIso); return s }) }
  register(input: RegisterInput): Promise<AuthSession> { return this.transport.post<AuthSession>('/v1/auth/register', input).then((s) => { authTokenStore.setAccessToken(s.accessToken, s.expiresAtIso); return s }) }
  /** 刷新会话；Token 写入内存，绝不落任何持久化存储。credentials 由 HttpTransport 统一带上。 */
  refreshSession(): Promise<AuthSession | null> {
    return this.transport.post<AuthSession>('/v1/auth/refresh').then((s) => {
      authTokenStore.setAccessToken(s.accessToken, s.expiresAtIso);
      return s;
    });
  }
  getCurrentUser(): Promise<User | null> { return this.transport.get<User>('/v1/auth/me').catch((e) => { if ((e as { code?: number }).code === 401) return null; throw e }) }
  /** 头像若是响应里的签名地址（/v1/images/…），还原成 upload:<id> 引用再提交；其余字段与值原样 */
  updateProfile(patch: ProfilePatch): Promise<User> {
    const body = typeof patch.avatar === 'string' ? { ...patch, avatar: imageRefOf(patch.avatar) } : patch;
    return this.transport.patch<User>('/v1/auth/me', body);
  }
  // ---------------- 阶段 3：账号生命周期（请求体只带后端读取的字段） ----------------
  changePassword(input: { currentPassword: string; newPassword: string }) {
    return this.transport.post<import('./contracts').PasswordChangeResult>('/v1/auth/password',
      { currentPassword: input.currentPassword, newPassword: input.newPassword });
  }
  resetPasswordWithCode(input: import('./contracts').PasswordResetInput) {
    return this.transport.post<{ reset: boolean }>('/v1/auth/password-reset',
      { account: input.account, code: input.code, newPassword: input.newPassword });
  }
  /** 成功后服务端已结束全部会话并清除刷新 Cookie；内存里的访问令牌同时丢弃 */
  async deleteAccount(input: { password: string; confirmation: string }) {
    const result = await this.transport.post<import('./contracts').AccountDeletionResult>('/v1/auth/me/deletion',
      { password: input.password, confirmation: input.confirmation });
    authTokenStore.clearAccessToken();
    return result;
  }
  /** GET /v1/config（无需登录）。旧后端没有这个接口时 404，按默认规则（9 张、5 MB、JPEG / PNG、允许外部图片）处理 */
  async getClientConfig(): Promise<import('./contracts').ClientConfig> {
    try {
      return normalizeClientConfig(await this.transport.get<unknown>('/v1/config'));
    } catch (e) {
      if (e instanceof ApiError && (e.httpStatus === 404 || e.code === 404)) return normalizeClientConfig(null);
      throw e;
    }
  }
  // ---------------- 阶段 4：图片上传（multipart 字段 file；认证与 401 刷新与其他请求相同） ----------------
  uploadImage(file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.transport.upload<import('./contracts').UploadedImage>('/v1/images', form);
  }
  async logout(): Promise<void> { try { await this.transport.post('/v1/auth/logout') } finally { authTokenStore.clearAccessToken() } }
  listProducts(query: ProductQuery): Promise<ProductPage> { const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) }); return this.transport.get<ProductPage>(`/v1/products?${params.toString()}`) }
  getProduct(id: string): Promise<Product> { return this.transport.get<Product>(`/v1/products/${encodeURIComponent(id)}`) }
  feedProducts(query: import('./contracts').FeedQuery): Promise<import('./contracts').FeedPage> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      // null 表示「不限制」，与空串一样不下发；0 是合法价格，必须保留
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    return this.transport.get<import('./contracts').FeedPage>(`/v1/products/feed?${params.toString()}`);
  }
  // ---------------- 卖家声明（模块 3） ----------------
  getInspectionTemplate(category: import('../types').Category) {
    return this.transport.get<import('./contracts').InspectionTemplate | null>(
      `/v1/inspection-templates?category=${encodeURIComponent(category)}`);
  }
  listCourses(query: import('./contracts').CourseQuery) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return this.transport.get<import('./contracts').CoursePage>(`/v1/courses${qs ? `?${qs}` : ''}`);
  }
  getCourse(courseId: string) {
    return this.transport.get<import('./contracts').CourseDetail>(`/v1/courses/${encodeURIComponent(courseId)}`);
  }
  getCourseOffering(offeringId: string) {
    return this.transport.get<import('./contracts').OfferingDetail>(`/v1/course-offerings/${encodeURIComponent(offeringId)}`);
  }
  // ---------------- 圈子集市（模块 6） ----------------
  // 圈子 id 只出现在路径里；名称、成员资格与邀请码从不进入 URL query
  createCircle(input: import('./contracts').CircleInput) { return this.transport.post<import('./contracts').Circle>('/v1/circles', input) }
  listMyCircles() { return this.transport.get<import('./contracts').Circle[]>('/v1/circles/mine') }
  discoverCircles(q?: string) {
    return this.transport.get<import('./contracts').DiscoverableCircle[]>(`/v1/circles/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }
  getCircle(id: string) { return this.transport.get<import('./contracts').Circle | import('./contracts').DiscoverableCircle>(`/v1/circles/${encodeURIComponent(id)}`) }
  updateCircle(id: string, patch: Partial<import('./contracts').CircleInput>) {
    return this.transport.patch<import('./contracts').Circle>(`/v1/circles/${encodeURIComponent(id)}`, patch);
  }
  archiveCircle(id: string) { return this.transport.post<import('./contracts').Circle>(`/v1/circles/${encodeURIComponent(id)}/archive`, {}) }
  listCircleProducts(id: string, page = 1) {
    return this.transport.get<import('./contracts').FeedPage>(`/v1/circles/${encodeURIComponent(id)}/products?page=${page}`);
  }
  createCircleInvite(id: string, expiresInHours?: number) {
    return this.transport.post<import('./contracts').CircleInviteCreated>(`/v1/circles/${encodeURIComponent(id)}/invites`,
      expiresInHours ? { expiresInHours } : {});
  }
  listCircleInvites(id: string) { return this.transport.get<import('./contracts').CircleInvite[]>(`/v1/circles/${encodeURIComponent(id)}/invites`) }
  redeemCircleInvite(token: string) { return this.transport.post<import('./contracts').Circle>('/v1/circle-invites/redeem', { token }) }
  revokeCircleInvite(inviteId: string) {
    return this.transport.post<import('./contracts').CircleInvite>(`/v1/circle-invites/${encodeURIComponent(inviteId)}/revoke`, {});
  }
  listCircleMembers(id: string, page = 1, size = 20) {
    return this.transport.get<import('./contracts').CircleMemberPage>(`/v1/circles/${encodeURIComponent(id)}/members?page=${page}&size=${size}`);
  }
  changeCircleMemberRole(id: string, userId: string, role: import('./contracts').CircleRole) {
    return this.transport.patch<import('./contracts').CircleMemberPage>(`/v1/circles/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { role });
  }
  removeCircleMember(id: string, userId: string) {
    return this.transport.delete<{ userId: string; status: 'LEFT' | 'REMOVED' }>(`/v1/circles/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`);
  }
  // ---------------- 毕业季通用供给引擎（模块 5） ----------------
  createListingDraft(input: { draftType?: import('./contracts').ListingKind; payload?: import('./contracts').ListingPayload }) {
    return this.transport.post<import('./contracts').ListingDraft>('/v1/listing-drafts', withPayloadImageRefs(input));
  }
  listListingDrafts() { return this.transport.get<import('./contracts').ListingDraft[]>('/v1/listing-drafts') }
  listAssistingDrafts() { return this.transport.get<import('./contracts').ListingDraft[]>('/v1/listing-drafts/assisting') }
  getListingDraft(id: string) { return this.transport.get<import('./contracts').ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`) }
  updateListingDraft(id: string, input: { expectedVersion: number; payload?: import('./contracts').ListingPayload; status?: 'DRAFT' | 'READY' }) {
    return this.transport.patch<import('./contracts').ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`, withPayloadImageRefs(input));
  }
  discardListingDraft(id: string) { return this.transport.delete<import('./contracts').ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`) }
  createListingBatch(input: { draftIds?: string[] }) { return this.transport.post<import('./contracts').ListingBatch>('/v1/listing-batches', input) }
  listListingBatches() { return this.transport.get<import('./contracts').ListingBatchSummary[]>('/v1/listing-batches') }
  getListingBatch(id: string) { return this.transport.get<import('./contracts').ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`) }
  updateListingBatch(id: string, input: { expectedVersion: number; draftIds: string[] }) {
    return this.transport.patch<import('./contracts').ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`, input);
  }
  discardListingBatch(id: string) { return this.transport.delete<import('./contracts').ListingBatch>(`/v1/listing-batches/${encodeURIComponent(id)}`) }
  publishListingBatch(id: string, idempotencyKey: string) {
    return this.transport.post<import('./contracts').PublishBatchResult>(`/v1/listing-batches/${encodeURIComponent(id)}/publish`, undefined,
      { 'Idempotency-Key': idempotencyKey });
  }
  createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }) {
    return this.transport.post<import('./contracts').AssistInviteCreated>('/v1/listing-assist-invites', input);
  }
  listAssistInvites() { return this.transport.get<import('./contracts').AssistInvite[]>('/v1/listing-assist-invites') }
  /** 邀请码只出现在请求体里 */
  redeemAssistInvite(token: string) {
    return this.transport.post<import('./contracts').AssistInviteRedeemed>('/v1/listing-assist-invites/redeem', { token });
  }
  revokeAssistInvite(id: string) {
    return this.transport.post<import('./contracts').AssistInvite>(`/v1/listing-assist-invites/${encodeURIComponent(id)}/revoke`, {});
  }
  listAssistEvents(id: string) {
    return this.transport.get<import('./contracts').AssistEvent[]>(`/v1/listing-assist-invites/${encodeURIComponent(id)}/events`);
  }
  getTextbook(editionId: string, sort?: 'nearest' | 'latest') {
    return this.transport.get<import('./contracts').TextbookDetail>(
      `/v1/textbooks/${encodeURIComponent(editionId)}${sort ? `?sort=${sort}` : ''}`);
  }
  getTextbookByIsbn(isbn: string) {
    return this.transport.get<import('./contracts').TextbookEdition>(`/v1/textbooks/isbn/${encodeURIComponent(isbn)}`);
  }
  createTextbookSuggestion(input: import('./contracts').TextbookSuggestionInput) {
    return this.transport.post<import('./contracts').TextbookSuggestionResult>('/v1/textbook-suggestions', input);
  }
  listMyTextbookSuggestions() {
    return this.transport.get<import('./contracts').TextbookSuggestion[]>('/v1/textbook-suggestions/mine');
  }
  withdrawTextbookSuggestion(id: string) {
    return this.transport.delete<import('./contracts').TextbookSuggestion>(`/v1/textbook-suggestions/${encodeURIComponent(id)}`);
  }
  createDemandSubscription(input: import('./contracts').DemandConditions) {
    return this.transport.post<import('./contracts').DemandSubscribeResult>('/v1/demand-subscriptions', input);
  }
  listDemandSubscriptions() {
    return this.transport.get<import('./contracts').DemandSubscription[]>('/v1/demand-subscriptions');
  }
  updateDemandSubscription(id: string, patch: import('./contracts').DemandConditions & { active?: boolean }) {
    return this.transport.patch<import('./contracts').DemandSubscription>(`/v1/demand-subscriptions/${encodeURIComponent(id)}`, patch);
  }
  deleteDemandSubscription(id: string) {
    return this.transport.delete<import('./contracts').DemandSubscription>(`/v1/demand-subscriptions/${encodeURIComponent(id)}`);
  }
  listDemandMatches(page = 1, pageSize = 20) {
    return this.transport.get<import('./contracts').DemandMatchPage>(`/v1/demand-matches?page=${page}&pageSize=${pageSize}`);
  }
  async getDemandUnreadCount(): Promise<number> {
    return (await this.transport.get<{ count: number }>('/v1/demand-matches/unread-count')).count;
  }
  async markDemandMatchRead(id: string): Promise<number> {
    return (await this.transport.post<{ count: number }>(`/v1/demand-matches/${encodeURIComponent(id)}/read`)).count;
  }
  async dismissDemandMatch(id: string): Promise<number> {
    return (await this.transport.post<{ count: number }>(`/v1/demand-matches/${encodeURIComponent(id)}/dismiss`)).count;
  }
  createProduct(input: ProductCreateInput): Promise<Product> { return this.transport.post<Product>('/v1/products', withImageRefs(input)) }
  updateProduct(id: string, patch: ProductPatch): Promise<Product> { return this.transport.patch<Product>(`/v1/products/${encodeURIComponent(id)}`, withImageRefs(patch)) }
  setProductStatus(id: string, status: ProductStatus): Promise<Product> { return this.transport.post<Product>(`/v1/products/${encodeURIComponent(id)}/status`, { status }) }
  incrementProductViews(id: string): Promise<void> { return this.transport.post<void>(`/v1/products/${encodeURIComponent(id)}/view`) }
  listFavorites(): Promise<Favorite[]> { return this.transport.get<Favorite[]>('/v1/favorites') }
  setFavorite(productId: string, desired: boolean): Promise<boolean> {
    const path = `/v1/products/${encodeURIComponent(productId)}/favorite`;
    // 加收藏用幂等 PUT，取消收藏用 DELETE；两者重复调用结果都不变。
    return desired
      ? this.transport.put<{ active: boolean }>(path).then((r) => r.active)
      : this.transport.delete<{ active: boolean }>(path).then((r) => r.active);
  }
  listComments(productId: string): Promise<Comment[]> { return this.transport.get<Comment[]>(`/v1/products/${encodeURIComponent(productId)}/comments`) }
  addComment(input: CommentInput): Promise<Comment> { return this.transport.post<Comment>(`/v1/products/${encodeURIComponent(input.productId)}/comments`, { content: input.content, parentId: input.parentId }) }
  listConversations(): Promise<Conversation[]> { return this.transport.get<Conversation[]>('/v1/conversations') }
  getOrCreateConversation(productId: string): Promise<Conversation> { return this.transport.post<Conversation>('/v1/conversations', { productId }) }
  listMessages(conversationId: string): Promise<ChatMessage[]> { return this.transport.get<ChatMessage[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`) }
  /** 快捷消息列表（需登录）；旧后端没有 freeTextEnabled 时按 false 处理 */
  async listMessageTemplates(): Promise<import('./contracts').MessageTemplateList> {
    const raw = await this.transport.get<Partial<import('./contracts').MessageTemplateList> | null>('/v1/message-templates');
    return { freeTextEnabled: raw?.freeTextEnabled === true, templates: Array.isArray(raw?.templates) ? raw!.templates : [] };
  }
  /** 请求体只带一个字段：{ templateCode } 或 { content }，不会同时提交 */
  sendMessage(conversationId: string, input: import('./contracts').SendMessageInput): Promise<ChatMessage> {
    const body = 'templateCode' in input ? { templateCode: input.templateCode } : { content: input.content };
    return this.transport.post<ChatMessage>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, body);
  }
  getUnreadCount(): Promise<number> { return this.transport.get<{ count: number }>('/v1/messages/unread').then((r) => r.count) }
  // ---- 模块 7：可信治理 ----
  createModerationReport(input: import('./contracts').ModerationReportInput) {
    return this.transport.post<import('./contracts').MyModerationReport>('/v1/moderation-reports', input);
  }
  listMyModerationReports() { return this.transport.get<import('./contracts').MyModerationReport[]>('/v1/moderation-reports/mine') }
  getMyGovernance() { return this.transport.get<import('./contracts').MyGovernance>('/v1/me/governance') }
  submitAppeal(input: import('./contracts').AppealInput) { return this.transport.post<import('./contracts').MyAppealSummary>('/v1/me/appeals', input) }
  getStaffStatus() { return this.transport.get<import('./contracts').StaffStatus>('/v1/me/staff') }
  listModerationCases(query: import('./contracts').ModerationCaseQuery) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    const qs = params.toString();
    return this.transport.get<import('./contracts').ModerationCasePage>(`/v1/moderation/cases${qs ? `?${qs}` : ''}`);
  }
  getModerationCase(id: string) { return this.transport.get<import('./contracts').ModerationCaseDetail>(`/v1/moderation/cases/${encodeURIComponent(id)}`) }
  openModerationCase(input: { targetType: import('./contracts').ReportableTargetType; targetId: string }) {
    return this.transport.post<import('./contracts').ModerationCaseDetail>('/v1/moderation/cases', input);
  }
  claimModerationCase(id: string) {
    return this.transport.post<import('./contracts').ModerationCaseDetail>(`/v1/moderation/cases/${encodeURIComponent(id)}/claim`, {});
  }
  decideModerationCase(id: string, input: import('./contracts').ModerationDecisionInput) {
    return this.transport.post<import('./contracts').ModerationCaseDetail>(`/v1/moderation/cases/${encodeURIComponent(id)}/decision`, input);
  }
  listModerationAppeals(query: { status?: 'PENDING' | 'ACCEPTED' | 'REJECTED'; page?: number; size?: number }) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params.set(k, String(v));
    const qs = params.toString();
    return this.transport.get<import('./contracts').StaffAppealPage>(`/v1/moderation/appeals${qs ? `?${qs}` : ''}`);
  }
  decideModerationAppeal(id: string, input: import('./contracts').AppealDecisionInput) {
    return this.transport.post<import('./contracts').StaffAppeal>(`/v1/moderation/appeals/${encodeURIComponent(id)}/decision`, input);
  }
}

/**
 * 商品响应里的上传图片是短时签名地址（/v1/images/{id}?exp=…&sig=…，可能已按 API 基址补全），
 * 后端只接受 upload:<id> 引用或外部 http(s) 地址。编辑时把签名地址还原成引用；其他值原样提交。
 */
const SIGNED_IMAGE = /^(?:https?:\/\/[^/]+)?(?:\/[^?#]*)?\/v1\/images\/([0-9a-fA-F-]{36})(?:[?#].*)?$/;
export function imageRefOf(value: string): string {
  const match = SIGNED_IMAGE.exec(value);
  return match ? `upload:${match[1]}` : value;
}
function withImageRefs<T extends { images?: string[] }>(input: T): T {
  return input.images ? { ...input, images: input.images.map(imageRefOf) } : input;
}
/** 草稿响应里的上传图片同样是签名地址；保存草稿时同样还原成 upload:<id> 引用（其余字段原样） */
function withPayloadImageRefs<T extends { payload?: import('./contracts').ListingPayload }>(input: T): T {
  return input.payload ? { ...input, payload: withImageRefs(input.payload) } : input;
}
