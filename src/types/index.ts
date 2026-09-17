/**
 * 领域模型类型定义。
 * 全站共享，所有模块均从此处导入类型，避免重复定义。
 */

/* ------------------------------ 枚举与常量 ------------------------------ */

export type Category =
  | '数码电子'
  | '教材书籍'
  | '生活用品'
  | '服饰鞋包'
  | '运动户外'
  | '其他';

export const CATEGORIES: Category[] = [
  '数码电子',
  '教材书籍',
  '生活用品',
  '服饰鞋包',
  '运动户外',
  '其他',
];

export type Condition =
  | '全新'
  | '几乎全新'
  | '轻微使用痕迹'
  | '明显使用痕迹';

export const CONDITIONS: Condition[] = [
  '全新',
  '几乎全新',
  '轻微使用痕迹',
  '明显使用痕迹',
];

export type Campus = '东校区' | '西校区' | '南校区' | '北校区';

export const CAMPUSES: Campus[] = ['东校区', '西校区', '南校区', '北校区'];

export type ProductStatus = '在售' | '已售出' | '已下架';

export const PRODUCT_STATUSES: ProductStatus[] = ['在售', '已售出', '已下架'];

export type OrderStatus = '待确认' | '交易中' | '已完成' | '已取消';

export const ORDER_STATUSES: OrderStatus[] = [
  '待确认',
  '交易中',
  '已完成',
  '已取消',
];

/* -------------------------------- 实体 -------------------------------- */

export interface User {
  id: string;
  /** 学号或手机号 */
  account: string;
  /** 演示用途，明文存储 */
  password: string;
  nickname: string;
  avatar: string;
  campus: Campus;
  contact: string;
  createdAt: number;
}

export interface Product {
  id: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: Category;
  condition: Condition;
  campus: Campus;
  images: string[];
  contact: string;
  sellerId: string;
  status: ProductStatus;
  views: number;
  createdAt: number;
  soldAt?: number;
}

export interface Review {
  rating: number;
  comment: string;
  createdAt: number;
}

export interface Order {
  id: string;
  productId: string;
  buyerId: string;
  sellerId: string;
  price: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  /** 买家对卖家的评价 */
  buyerReview?: Review;
  /** 卖家对买家的评价 */
  sellerReview?: Review;
}

export interface Comment {
  id: string;
  productId: string;
  userId: string;
  content: string;
  createdAt: number;
  /** 若为回复，指向父评论 id */
  parentId: string | null;
}

export interface Favorite {
  id: string;
  userId: string;
  productId: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  productId: string;
  buyerId: string;
  sellerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: number;
}

/* ------------------------------ 状态容器 ------------------------------ */

export interface MarketState {
  products: Product[];
  orders: Order[];
  comments: Comment[];
  favorites: Favorite[];
  conversations: Conversation[];
  messages: ChatMessage[];
}

export interface AuthState {
  users: User[];
  currentUserId: string | null;
}

/* ------------------------------ 输入模型 ------------------------------ */

export interface ProductInput {
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: Category;
  condition: Condition;
  campus: Campus;
  images: string[];
  contact: string;
  sellerId: string;
}

export interface RegisterInput {
  account: string;
  password: string;
  nickname: string;
  campus: Campus;
  contact: string;
}

/* ------------------------------ 筛选排序 ------------------------------ */

export type SortKey = 'latest' | 'priceAsc' | 'priceDesc' | 'views';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'latest', label: '最新发布' },
  { value: 'priceAsc', label: '价格从低到高' },
  { value: 'priceDesc', label: '价格从高到低' },
  { value: 'views', label: '最多浏览' },
];

export interface FilterState {
  keyword: string;
  category: Category | '全部';
  campus: Campus | '全部';
  condition: Condition | '全部';
  minPrice: number | '';
  maxPrice: number | '';
  sort: SortKey;
}

export const DEFAULT_FILTER: FilterState = {
  keyword: '',
  category: '全部',
  campus: '全部',
  condition: '全部',
  minPrice: '',
  maxPrice: '',
  sort: 'latest',
};
