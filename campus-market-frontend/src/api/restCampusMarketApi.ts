import type { CampusMarketApi, AuthSession, LoginInput, RegisterInput, ProfilePatch, ProductQuery, ProductPage, ProductCreateInput, ProductPatch, CreateOrderInput, OrderTransitionInput, ReviewInput, CommentInput } from './contracts';
import type { User, Product, Favorite, Order, Review, Comment, Conversation, ChatMessage, ProductStatus } from '../types';
import { HttpTransport } from './httpTransport';
import { TokenStore } from '../utils/tokenStore';
import { toCanonicalStatus } from './mapper';
export class RestCampusMarketApi implements CampusMarketApi {
  constructor(private readonly transport: HttpTransport, private readonly tokenStore = new TokenStore()) {}
  getUser(id: string): Promise<import('../types').PublicUser> { return this.transport.get(`/v1/users/${encodeURIComponent(id)}`) }
  listMeetingPoints(): Promise<import('./contracts').MeetingPoint[]> { return this.transport.get('/v1/meeting-points') }
  markConversationRead(id: string): Promise<void> { return this.transport.post(`/v1/conversations/${encodeURIComponent(id)}/read`) }
  login(input: LoginInput): Promise<AuthSession> { return this.transport.post<AuthSession>('/v1/auth/login', input).then((s) => { this.tokenStore.set({ accessToken: s.accessToken, expiresAtIso: s.expiresAtIso }); return s }) }
  register(input: RegisterInput): Promise<AuthSession> { return this.transport.post<AuthSession>('/v1/auth/register', input).then((s) => { this.tokenStore.set({ accessToken: s.accessToken, expiresAtIso: s.expiresAtIso }); return s }) }
  getCurrentUser(): Promise<User | null> { return this.transport.get<User>('/v1/auth/me').catch((e) => { if ((e as { code?: number }).code === 401) return null; throw e }) }
  updateProfile(patch: ProfilePatch): Promise<User> { return this.transport.patch<User>('/v1/auth/me', patch) }
  async logout(): Promise<void> { try { await this.transport.post('/v1/auth/logout') } finally { this.tokenStore.clear() } }
  listProducts(query: ProductQuery): Promise<ProductPage> { const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) }); return this.transport.get<ProductPage>(`/v1/products?${params.toString()}`) }
  getProduct(id: string): Promise<Product> { return this.transport.get<Product>(`/v1/products/${encodeURIComponent(id)}`) }
  createProduct(input: ProductCreateInput): Promise<Product> { return this.transport.post<Product>('/v1/products', input) }
  updateProduct(id: string, patch: ProductPatch): Promise<Product> { return this.transport.patch<Product>(`/v1/products/${encodeURIComponent(id)}`, patch) }
  setProductStatus(id: string, status: ProductStatus): Promise<Product> { return this.transport.post<Product>(`/v1/products/${encodeURIComponent(id)}/status`, { status }) }
  incrementProductViews(id: string): Promise<void> { return this.transport.post<void>(`/v1/products/${encodeURIComponent(id)}/view`) }
  listFavorites(): Promise<Favorite[]> { return this.transport.get<Favorite[]>('/v1/favorites') }
  toggleFavorite(productId: string): Promise<boolean> { return this.transport.put<{ active: boolean }>(`/v1/products/${encodeURIComponent(productId)}/favorite`).then((r) => r.active) }
  createOrder(input: CreateOrderInput): Promise<Order> { return this.transport.post<Order>('/v1/orders', input, { 'Idempotency-Key': input.idempotencyKey }) }
  transitionOrder(id: string, input: OrderTransitionInput): Promise<Order> { return this.transport.post<Order>(`/v1/orders/${encodeURIComponent(id)}/transitions`, { ...input, to: input.to }) }
  listOrders(role: 'buyer'|'seller'|'all'): Promise<Order[]> { return this.transport.get<Order[]>(`/v1/orders?role=${role}`) }
  addReview(orderId: string, input: ReviewInput): Promise<Review> { return this.transport.post<Review>(`/v1/orders/${encodeURIComponent(orderId)}/reviews`, input) }
  listComments(productId: string): Promise<Comment[]> { return this.transport.get<Comment[]>(`/v1/products/${encodeURIComponent(productId)}/comments`) }
  addComment(input: CommentInput): Promise<Comment> { return this.transport.post<Comment>(`/v1/products/${encodeURIComponent(input.productId)}/comments`, { content: input.content, parentId: input.parentId }) }
  listConversations(): Promise<Conversation[]> { return this.transport.get<Conversation[]>('/v1/conversations') }
  getOrCreateConversation(productId: string): Promise<Conversation> { return this.transport.post<Conversation>('/v1/conversations', { productId }) }
  listMessages(conversationId: string): Promise<ChatMessage[]> { return this.transport.get<ChatMessage[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`) }
  sendMessage(conversationId: string, content: string): Promise<ChatMessage> { return this.transport.post<ChatMessage>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { content }) }
  getUnreadCount(): Promise<number> { return this.transport.get<{ count: number }>('/v1/messages/unread').then((r) => r.count) }
}
