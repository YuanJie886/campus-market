import type { CampusMarketApi, AuthSession, LoginInput, RegisterInput, ProfilePatch, ProductQuery, ProductPage, ProductCreateInput, ProductPatch, CreateOrderInput, OrderTransitionInput, ReviewInput, CommentInput } from './contracts';
import type { User, Product, Favorite, Order, Review, Comment, Conversation, ChatMessage, ProductStatus } from '../types';
import { HttpTransport } from './httpTransport';
import { authTokenStore } from '../utils/authTokenStore';
export class RestCampusMarketApi implements CampusMarketApi {
  constructor(private readonly transport: HttpTransport) {}
  getUser(id: string): Promise<import('../types').PublicUser> { return this.transport.get(`/v1/users/${encodeURIComponent(id)}`) }
  listMeetingPoints(): Promise<import('./contracts').MeetingPoint[]> { return this.transport.get('/v1/meeting-points') }
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
  updateProfile(patch: ProfilePatch): Promise<User> { return this.transport.patch<User>('/v1/auth/me', patch) }
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
  // ---------------- 可信面交（模块 3） ----------------
  getInspectionTemplate(category: import('../types').Category) {
    return this.transport.get<import('./contracts').InspectionTemplate | null>(
      `/v1/inspection-templates?category=${encodeURIComponent(category)}`);
  }
  getOrderFlow(orderId: string) {
    return this.transport.get<import('./contracts').OrderFlow>(`/v1/orders/${encodeURIComponent(orderId)}/flow`);
  }
  saveInspectionDraft(orderId: string, items: import('./contracts').InspectionResultInput[]) {
    return this.transport.put<import('./contracts').OrderFlow>(`/v1/orders/${encodeURIComponent(orderId)}/inspection`, { items });
  }
  submitInspection(orderId: string, items: import('./contracts').InspectionResultInput[]) {
    return this.transport.post<import('./contracts').OrderFlow>(`/v1/orders/${encodeURIComponent(orderId)}/inspection/submit`, { items });
  }
  proposeMeeting(orderId: string, input: import('./contracts').MeetingProposalInput) {
    return this.transport.post<import('./contracts').OrderFlow>(`/v1/orders/${encodeURIComponent(orderId)}/meeting-proposals`, input);
  }
  acceptMeeting(orderId: string, proposalId: string) {
    return this.transport.post<import('./contracts').OrderFlow>(
      `/v1/orders/${encodeURIComponent(orderId)}/meeting-proposals/${encodeURIComponent(proposalId)}/accept`);
  }
  rejectMeeting(orderId: string, proposalId: string) {
    return this.transport.post<import('./contracts').OrderFlow>(
      `/v1/orders/${encodeURIComponent(orderId)}/meeting-proposals/${encodeURIComponent(proposalId)}/reject`);
  }
  withdrawMeeting(orderId: string, proposalId: string) {
    return this.transport.post<import('./contracts').OrderFlow>(
      `/v1/orders/${encodeURIComponent(orderId)}/meeting-proposals/${encodeURIComponent(proposalId)}/withdraw`);
  }
  updatePresence(orderId: string, action: 'DEPART' | 'ARRIVE') {
    return this.transport.put<import('./contracts').OrderFlow>(`/v1/orders/${encodeURIComponent(orderId)}/presence`, { action });
  }
  getOwnTradeHistory() {
    return this.transport.get<import('./contracts').OwnTradeHistory>('/v1/me/trade-history');
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
    return this.transport.post<import('./contracts').ListingDraft>('/v1/listing-drafts', input);
  }
  listListingDrafts() { return this.transport.get<import('./contracts').ListingDraft[]>('/v1/listing-drafts') }
  listAssistingDrafts() { return this.transport.get<import('./contracts').ListingDraft[]>('/v1/listing-drafts/assisting') }
  getListingDraft(id: string) { return this.transport.get<import('./contracts').ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`) }
  updateListingDraft(id: string, input: { expectedVersion: number; payload?: import('./contracts').ListingPayload; status?: 'DRAFT' | 'READY' }) {
    return this.transport.patch<import('./contracts').ListingDraft>(`/v1/listing-drafts/${encodeURIComponent(id)}`, input);
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
  getPriceGuidance(query: import('./contracts').PriceGuidanceQuery) {
    const params = new URLSearchParams({ category: query.category });
    if (query.condition) params.set('condition', query.condition);
    if (query.textbookEditionId) params.set('textbookEditionId', query.textbookEditionId);
    return this.transport.get<import('./contracts').PriceGuidance>(`/v1/price-guidance?${params.toString()}`);
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
  getPublicTradeSummary(userId: string) {
    return this.transport.get<import('./contracts').PublicTradeSummary>(`/v1/users/${encodeURIComponent(userId)}/trade-summary`);
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
  createProduct(input: ProductCreateInput): Promise<Product> { return this.transport.post<Product>('/v1/products', input) }
  updateProduct(id: string, patch: ProductPatch): Promise<Product> { return this.transport.patch<Product>(`/v1/products/${encodeURIComponent(id)}`, patch) }
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
  createOrder(input: CreateOrderInput): Promise<Order> { return this.transport.post<Order>('/v1/orders', input, { 'Idempotency-Key': input.idempotencyKey }) }
  transitionOrder(id: string, input: OrderTransitionInput): Promise<Order> { return this.transport.post<Order>(`/v1/orders/${encodeURIComponent(id)}/transitions`, { ...input, to: input.to }) }
  listOrders(role: 'buyer'|'seller'|'all'): Promise<Order[]> { return this.transport.get<Order[]>(`/v1/orders?role=${role}`) }
  addReview(orderId: string, input: ReviewInput): Promise<Review> { return this.transport.post<Review>(`/v1/orders/${encodeURIComponent(orderId)}/reviews`, { rating: input.rating, comment: input.comment }) }
  listComments(productId: string): Promise<Comment[]> { return this.transport.get<Comment[]>(`/v1/products/${encodeURIComponent(productId)}/comments`) }
  addComment(input: CommentInput): Promise<Comment> { return this.transport.post<Comment>(`/v1/products/${encodeURIComponent(input.productId)}/comments`, { content: input.content, parentId: input.parentId }) }
  listConversations(): Promise<Conversation[]> { return this.transport.get<Conversation[]>('/v1/conversations') }
  getOrCreateConversation(productId: string): Promise<Conversation> { return this.transport.post<Conversation>('/v1/conversations', { productId }) }
  listMessages(conversationId: string): Promise<ChatMessage[]> { return this.transport.get<ChatMessage[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`) }
  sendMessage(conversationId: string, content: string): Promise<ChatMessage> { return this.transport.post<ChatMessage>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { content }) }
  getUnreadCount(): Promise<number> { return this.transport.get<{ count: number }>('/v1/messages/unread').then((r) => r.count) }
  // ---- 模块 7：交易承诺与可信治理 ----
  getOrderNoShow(orderId: string) {
    return this.transport.get<import('./contracts').OrderNoShowView>(`/v1/orders/${encodeURIComponent(orderId)}/no-show-reports`);
  }
  reportNoShow(orderId: string, input: { reasonCode: import('./contracts').NoShowReason; note?: string }) {
    return this.transport.post<import('./contracts').NoShowReport>(`/v1/orders/${encodeURIComponent(orderId)}/no-show-reports`, input);
  }
  acknowledgeNoShow(reportId: string, note?: string) {
    return this.transport.post<import('./contracts').NoShowReport>(`/v1/no-show-reports/${encodeURIComponent(reportId)}/acknowledge`, note ? { note } : {});
  }
  disputeNoShow(reportId: string, note: string) {
    return this.transport.post<import('./contracts').NoShowReport>(`/v1/no-show-reports/${encodeURIComponent(reportId)}/dispute`, { note });
  }
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
  openModerationCase(input: { targetType: import('./contracts').ModerationTargetType; targetId: string }) {
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
