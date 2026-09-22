import type {
  Campus, Category, ChatMessage, Comment, Condition, Conversation, Favorite,
  Order, Product, ProductStatus, Review, SortKey, User,
} from '../types';

export interface ApiEnvelope<T> { code: number; data: T; message: string; requestId?: string }
export interface AuthSession { accessToken: string; expiresAtIso: string; user: User }
export interface LoginInput { account: string; password: string }
export interface RegisterInput { account: string; password: string; nickname: string; campus: Campus; contact?: string }
export interface ProfilePatch { nickname?: string; avatar?: string; campus?: Campus; contact?: string }
export interface ProductQuery { keyword?: string; category?: Category; campus?: Campus; condition?: Condition; minPrice?: number; maxPrice?: number; sort: SortKey; page: number; pageSize: number }
export interface ProductPage { items: Product[]; page: number; pageSize: number; total: number }
export type ProductCreateInput = Omit<Product, 'id'|'sellerId'|'status'|'views'|'createdAt'|'soldAt'> & { contact?: string }
export type ProductPatch = Partial<Pick<Product, 'title'|'description'|'price'|'category'|'condition'|'campus'|'images'|'contact'>>
export type CanonicalOrderStatus = 'PENDING_SELLER_CONFIRM'|'PENDING_MEETING'|'BUYER_CONFIRMED'|'SELLER_CONFIRMED'|'COMPLETED'|'CANCELLED'|'EXPIRED'|'DISPUTED'
export interface CreateOrderInput { productId: string; meetingPointId: string; meetingAtIso: string; contact?: string; idempotencyKey: string }
export interface OrderTransitionInput { to: CanonicalOrderStatus; confirmationCode?: string; reason?: string }
export interface ReviewInput { rating: number; comment: string }
export interface CommentInput { productId: string; content: string; parentId?: string | null }
export interface MeetingPoint { id: string; campus: Campus; name: string }
export interface CampusMarketApi {
  getUser(id: string): Promise<import('../types').PublicUser>;
  listMeetingPoints(): Promise<MeetingPoint[]>;
  markConversationRead(id: string): Promise<void>;
  login(input: LoginInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<AuthSession>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(patch: ProfilePatch): Promise<User>;
  logout(): Promise<void>;
  listProducts(query: ProductQuery): Promise<ProductPage>;
  getProduct(id: string): Promise<Product>;
  createProduct(input: ProductCreateInput): Promise<Product>;
  updateProduct(id: string, patch: ProductPatch): Promise<Product>;
  setProductStatus(id: string, status: ProductStatus): Promise<Product>;
  incrementProductViews(id: string): Promise<void>;
  listFavorites(): Promise<Favorite[]>;
  toggleFavorite(productId: string): Promise<boolean>;
  createOrder(input: CreateOrderInput): Promise<Order>;
  transitionOrder(id: string, input: OrderTransitionInput): Promise<Order>;
  listOrders(role: 'buyer'|'seller'|'all'): Promise<Order[]>;
  addReview(orderId: string, input: ReviewInput): Promise<Review>;
  listComments(productId: string): Promise<Comment[]>;
  addComment(input: CommentInput): Promise<Comment>;
  listConversations(): Promise<Conversation[]>;
  getOrCreateConversation(productId: string): Promise<Conversation>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  sendMessage(conversationId: string, content: string): Promise<ChatMessage>;
  getUnreadCount(): Promise<number>;
}
