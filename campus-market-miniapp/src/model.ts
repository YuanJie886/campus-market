export const CATEGORIES = ['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他'] as const;
export const CAMPUSES = ['东校区', '西校区', '南校区', '北校区'] as const;
export const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'] as const;
export type Category = typeof CATEGORIES[number];
export type Campus = typeof CAMPUSES[number];
export type Condition = typeof CONDITIONS[number];
export type ProductStatus = '在售' | '已售出' | '已下架';
export type Sort = 'latest' | 'priceAsc' | 'priceDesc' | 'views';
export interface User { id: string; account?: string; nickname: string; campus: Campus; contact?: string; avatar?: string }
export interface Product {
  id: string; title: string; description: string; price: number; originalPrice?: number;
  category: Category; condition: Condition; campus: Campus; images: string[];
  sellerId: string; contact: string; contactPublic?: boolean; status: ProductStatus;
  createdAt: number; views: number; buildingName?: string | null;
  listingKind?: 'SINGLE' | 'BUNDLE';
  inspection?: { items: { code: string; condition: string; note: string | null; label: string }[] } | null;
}
export interface ProductInput {
  title: string; description: string; price: number; originalPrice?: number; category: Category;
  condition: Condition; campus: Campus; images: string[]; contact: string; contactPublic: boolean;
  inspection?: { itemCode: string; condition: 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE'; note?: string }[];
}
export interface Query {
  keyword?: string; category?: Category; campus?: Campus; condition?: Condition;
  minPrice?: number; maxPrice?: number; sort: Sort; page: number; pageSize: number;
}
export interface ProductPage { items: Product[]; total: number; page: number; pageSize: number }
export interface ContactRequest {
  id: string; productId: string; productTitle: string; buyerId: string; sellerId: string;
  buyerNickname: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: number; updatedAt: number;
}
export interface InspectionTemplate { items: { code: string; label: string; required: boolean }[] }
export interface Session { accessToken: string; expiresAtIso: string; user: User }
export interface MarketApi {
  restore(): Promise<User | null>;
  login(account: string, password: string): Promise<User>;
  register(input: { account: string; password: string; nickname: string; campus: Campus; contact: string }): Promise<User>;
  logout(): Promise<void>;
  list(query: Query): Promise<ProductPage>;
  detail(id: string): Promise<Product>;
  publicUser(id: string): Promise<User>;
  publish(input: ProductInput, id?: string): Promise<Product>;
  myListings(): Promise<Product[]>;
  status(id: string, status: ProductStatus): Promise<void>;
  favorites(): Promise<string[]>;
  favorite(id: string, active: boolean): Promise<void>;
  requestContact(id: string): Promise<ContactRequest>;
  contactState(id: string): Promise<ContactRequest | null>;
  contacts(): Promise<ContactRequest[]>;
  decide(id: string, status: 'APPROVED' | 'REJECTED'): Promise<void>;
  template(category: Category): Promise<InspectionTemplate | null>;
  updateProfile(input: { nickname: string; campus: Campus; contact: string }): Promise<User>;
  report(id: string, reason: string): Promise<void>;
  upload(path: string): Promise<string>;
}
export const CATEGORY_EMOJI: Record<Category, string> = {
  数码电子: '🎧', 教材书籍: '📚', 生活用品: '💡', 服饰鞋包: '👜', 运动户外: '🚲', 其他: '📦',
};
// WXSS 的选择器使用 ASCII 标识；分类展示文案仍使用中文。
export const CATEGORY_STYLE: Record<Category, string> = {
  数码电子: 'electronics', 教材书籍: 'books', 生活用品: 'home',
  服饰鞋包: 'fashion', 运动户外: 'outdoor', 其他: 'other',
};
export const money = (value: number) => value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
export function timeAgo(time: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
export function validateProduct(input: ProductInput): string | null {
  if (!input.title.trim() || input.title.trim().length > 100) return '请填写 1–100 字的商品名称';
  if (!input.description.trim() || input.description.trim().length > 4000) return '请填写 1–4000 字的商品描述';
  if (!Number.isFinite(input.price) || input.price <= 0) return '请输入大于 0 的价格';
  if (input.originalPrice !== undefined && (!Number.isFinite(input.originalPrice) || input.originalPrice < 0)) return '原价必须为非负数';
  if (!CATEGORIES.includes(input.category) || !CONDITIONS.includes(input.condition) || !CAMPUSES.includes(input.campus)) return '请选择有效的分类、成色和校区';
  if (input.images.length < 1 || input.images.length > 5 || input.images.some((image) => !image)) return '请选择 1–5 张商品图片';
  if (!input.contact.trim() || input.contact.length > 100) return '请填写 1–100 字的联系方式';
  return null;
}
