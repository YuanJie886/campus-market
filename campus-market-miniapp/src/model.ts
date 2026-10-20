import type { UploadedImage } from './images';
import { MAX_IMAGES } from './images';
export type { UploadedImage };
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
export const CONTACT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'REVOKED'] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];
/** received：我作为卖家收到的申请；sent：我作为买家发出的申请。 */
export type ContactRole = 'received' | 'sent';
/** 申请对象从不包含联系方式；unread 按查看者视角计算。 */
export interface ContactRequest {
  id: string; productId: string; productTitle: string; buyerId: string; sellerId: string;
  buyerNickname: string; sellerNickname: string; status: ContactStatus;
  createdAt: number; updatedAt: number; decidedAt: number | null; unread: boolean;
}
export interface ContactQuery { role: ContactRole; status?: ContactStatus; page?: number; size?: number }
export interface ContactPage { items: ContactRequest[]; total: number; page: number; size: number }
/** received：卖家未读的新申请；updates：买家未读的同意 / 拒绝 / 撤回同意。 */
export interface UnreadCount { received: number; updates: number; total: number }
export interface InspectionTemplate { items: { code: string; label: string; required: boolean }[] }
export interface Session { accessToken: string; expiresAtIso: string; user: User }
/** GET /v1/auth/wechat：enabled 表示服务端已配置微信登录；bound 表示当前登录账号已绑定微信（未登录时为 false）。 */
export interface WechatStatus { enabled: boolean; bound: boolean }
/** POST /v1/auth/wechat/login：已绑定直接是会话；未绑定返回 10 分钟、一次性的绑定票据（只放内存）。 */
export type WechatLoginResult = { bound: true; user: User } | { bound: false; bindTicket: string; expiresAt: number };
export interface PasswordResetInput { account: string; code: string; newPassword: string }
export interface DeletionInput { password: string; confirmation: string }
export interface DeletionResult { productsTakenDown: number; requestsClosed: number; membershipsEnded: number }
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
  contacts(query: ContactQuery): Promise<ContactPage>;
  decide(id: string, status: 'APPROVED' | 'REJECTED'): Promise<void>;
  /** 买家撤回待处理的申请；撤回后可以重新申请。 */
  withdraw(id: string): Promise<ContactRequest>;
  /** 卖家撤回已同意的申请；买家立即看不到联系方式，且不能再次申请。 */
  revoke(id: string): Promise<ContactRequest>;
  unreadCount(): Promise<UnreadCount>;
  markRead(role: ContactRole): Promise<UnreadCount>;
  template(category: Category): Promise<InspectionTemplate | null>;
  updateProfile(input: { nickname: string; campus: Campus; contact: string }): Promise<User>;
  report(id: string, reason: string): Promise<void>;
  /** 上传一张商品照片：ref（upload:<id>）放进商品 images，url 只用于显示。 */
  upload(path: string, onProgress?: (percent: number) => void): Promise<UploadedImage>;
  /** 商品 / 上传响应里的图片地址 → 可以直接放进 <Image> 的地址（REST：/v1/ 相对地址拼接口域名）。 */
  imageSrc(url: string): string;
  /** 商品响应里的图片地址 → 提交时用的引用（签名地址换回 upload:<id>）。 */
  imageRef(url: string): string;
  /** 阶段 3 账号生命周期（docs/account-lifecycle.md）。 */
  wechatStatus(): Promise<WechatStatus>;
  wechatLogin(code: string): Promise<WechatLoginResult>;
  wechatBind(bindTicket: string): Promise<void>;
  wechatUnbind(): Promise<void>;
  /** 当前会话保留，其他设备的会话全部结束。 */
  changePassword(currentPassword: string, newPassword: string): Promise<{ otherSessionsEnded: number }>;
  /** 公开接口：凭学校管理员签发的一次性重置码设新密码；成功后全部会话结束。 */
  resetPassword(input: PasswordResetInput): Promise<void>;
  /** 成功后本机会话立即结束。 */
  deleteAccount(input: DeletionInput): Promise<DeletionResult>;
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
  if (input.images.length < 1 || input.images.length > MAX_IMAGES || input.images.some((image) => !image)) return `请选择 1–${MAX_IMAGES} 张商品图片`;
  // 签名地址 1 小时就过期，后端也不接受：必须提交 upload:<id> 引用
  if (input.images.some((image) => image.startsWith('/v1/'))) return '图片地址无效，请重新上传';
  if (!input.contact.trim() || input.contact.length > 100) return '请填写 1–100 字的联系方式';
  return null;
}
