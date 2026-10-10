/**
 * 领域模型类型定义。
 * 全站共享，所有模块均从此处导入类型，避免重复定义。
 */

/* ------------------------------ API 契约基础类型 ------------------------------ */

export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message: string;
  requestId?: string;
}
export interface ApiErrorShape {
  code: number;
  message: string;
  details?: unknown;
  requestId?: string;
}
export type CanonicalOrderStatus =
  | "PENDING_SELLER_CONFIRM"
  | "PENDING_MEETING"
  | "BUYER_CONFIRMED"
  | "SELLER_CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "DISPUTED";

/* ------------------------------ 枚举与常量 ------------------------------ */

export type Category =
  "数码电子" | "教材书籍" | "生活用品" | "服饰鞋包" | "运动户外" | "其他";

export const CATEGORIES: Category[] = [
  "数码电子",
  "教材书籍",
  "生活用品",
  "服饰鞋包",
  "运动户外",
  "其他",
];

export type Condition = "全新" | "几乎全新" | "轻微使用痕迹" | "明显使用痕迹";

export const CONDITIONS: Condition[] = [
  "全新",
  "几乎全新",
  "轻微使用痕迹",
  "明显使用痕迹",
];

export type Campus = "东校区" | "西校区" | "南校区" | "北校区";

export const CAMPUSES: Campus[] = ["东校区", "西校区", "南校区", "北校区"];

export type ProductStatus = "在售" | "已售出" | "已下架" | "预约中";

export const PRODUCT_STATUSES: ProductStatus[] = [
  "在售",
  "已售出",
  "已下架",
  "预约中",
];

export type OrderStatus = "待确认" | "交易中" | "已完成" | "已取消";

export const ORDER_STATUSES: OrderStatus[] = [
  "待确认",
  "交易中",
  "已完成",
  "已取消",
];

/* -------------------------------- 实体 -------------------------------- */

/**
 * 楼栋。公共参考数据，不含任何住户信息。
 *
 * <p>坐标是楼栋的公共中心点，用于校园示意地图与近似距离估算，
 * 不是房间位置，更不是任何人的实时位置。
 */
export interface Building {
  id: string;
  campusId: Campus;
  /** 园区，例如「沁园」 */
  zone: string;
  /** 楼栋名，例如「3号楼」 */
  name: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface User {
  id: string;
  /** 学号或手机号 */
  account: string;
  /** 仅离线演示适配器使用，真实 API 不返回密码 */
  password?: string;
  nickname: string;
  avatar: string;
  campus: Campus;
  contact: string;
  /**
   * 宿舍楼。<b>仅本人可见</b>：它比校区精确得多，一旦出现在公共投影里，
   * 别人就能从一条留言推出某位同学住哪栋楼。用户可以不填，系统绝不推断。
   */
  dormBuildingId?: string | null;
  createdAt: number;
}

/** 公共用户投影。除了密码与联系方式，宿舍楼同样被剔除。 */
export type PublicUser = Omit<User, "password" | "account" | "contact" | "dormBuildingId">;

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
  contactPublic?: boolean;
  sellerId: string;
  status: ProductStatus;
  views: number;
  createdAt: number;
  soldAt?: number;
  meetupPoint?: string;
  /** 取货楼栋。可为空：公共地点交易与旧商品都没有楼栋。 */
  buildingId?: string | null;
  /** 取货楼栋名，由后端 JOIN 得出，仅用于展示。 */
  buildingName?: string | null;
  /** 取货楼栋所在园区，仅用于展示。 */
  buildingZone?: string | null;
  /** 卖家的结构化验货声明（仅商品详情返回）；旧商品或不支持的分类为 null */
  inspection?: import("../../src/api/contracts").ProductDisclosure | null;
  /** 模块 4：关联的教材版本（关联时的快照）；未关联为 null，旧数据可能没有这个字段 */
  textbook?: import("../../src/api/contracts").ProductTextbook | null;
  /** 模块 5：单件 / 整套打包。旧数据没有这个字段，按 SINGLE 处理 */
  listingKind?: import("../../src/api/contracts").ListingKind;
  /** 模块 5：整套打包的明细（仅商品详情返回）。明细不是可单独购买的商品 */
  bundleItems?: import("../../src/api/contracts").BundleItem[];
  /** 模块 5：整套打包的摘要（列表卡片与详情都返回）；单件为 null */
  bundle?: import("../../src/api/contracts").BundleSummary | null;
  /** 模块 6：全校公开 / 圈子可见。旧数据没有这个字段，按 PUBLIC 处理 */
  visibility?: import("../../src/api/contracts").ProductVisibility;
  /** 模块 7：被平台治理隐藏（只有卖家本人看得到这件商品与这个标记）；Mock 内部同时记录时间 */
  moderationHidden?: boolean;
  moderationHiddenAt?: number | null;
  moderationHiddenActionId?: string | null;
  /** 模块 6：圈子标签——只包含当前查看者自己也在籍的圈子（卖家本人看到全部）；公开商品为空 */
  circles?: import("../../src/api/contracts").CircleLabel[];
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
  canonicalStatus?: CanonicalOrderStatus;
  /**
   * 该订单的 canonicalStatus 是由旧的中文文案「交易中」推断出来的。
   * 「交易中」同时对应 PENDING_MEETING / BUYER_CONFIRMED / SELLER_CONFIRMED / DISPUTED，
   * 迁移只能保守地取最靠前的一个，界面应提示用户核对，而非当作确定事实。
   */
  legacyStatusAmbiguous?: boolean;
  meetingPointId?: string;
  meetingAtIso?: string;
  contact?: string;
  confirmationCode?: string;
  expiresAtIso?: string;
  /** 当前协议的结束时间。7.1A 起新预约下单时就明确写入（默认 60 分钟）；V11 之前的原始预约为空，不推断 */
  meetingEndsAtIso?: string | null;
  /** 7.1A：当前档期版本已有双方确认、接受时冻结的完整快照（服务端计算） */
  slotAgreed?: boolean;
  /** 当前协议版本：0 为下单时的原始预约，改约被接受后递增 */
  meetingRevision?: number;
  /** 离线 Mock 内部使用的确认码错误次数，与后端 code_attempts 语义一致；REST 不返回 */
  codeAttempts?: number;
  /** 模块 5：下单时写入的成交价快照（离线 Mock 内部使用，对应后端 orders.price_snapshot）；旧订单为空 */
  priceSnapshot?: number | null;
  currency?: "CNY" | null;
  /** 5.7（Mock v8）：下单时冻结的统计维度，之后不可修改；旧订单为空，不回填 */
  schoolIdSnapshot?: string | null;
  categorySnapshot?: Category | null;
  conditionSnapshot?: Condition | null;
  listingKindSnapshot?: "SINGLE" | "BUNDLE" | null;
  textbookEditionIdSnapshot?: string | null;
  /** 模块 6（Mock v9）：下单瞬间商品是否仅圈子可见；旧订单为空 */
  visibilitySnapshot?: "PUBLIC" | "CIRCLE_ONLY" | null;
  /** 服务端给出的流程摘要（3.8A）。旧缓存数据可能没有，界面据此保守处理 */
  flow?: import("../../src/api/contracts").OrderFlowSummary;
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
  /** 7.1E：被平台隐藏（正文对任何人都不返回）；hiddenForAuthor = 我是作者，界面给出可申诉的提示 */
  moderationHidden?: boolean;
  hiddenForAuthor?: boolean;
  /** 离线 Mock 内部：隐藏时间与造成隐藏的动作（REST 不返回） */
  moderationHiddenAt?: number | null;
  moderationHiddenActionId?: string | null;
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
  /** 7.1E：这一条被平台隔离（正文不返回，只显示占位）；会话与其他消息照常 */
  quarantined?: boolean;
  /** 离线 Mock 内部：隔离时间与动作（REST 不返回） */
  moderationQuarantinedAt?: number | null;
  moderationQuarantineActionId?: string | null;
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
  /** 取货楼栋；null 表示不指定 */
  buildingId?: string | null;
  /** 验货声明（受支持分类必填） */
  inspection?: import("../../src/api/contracts").DisclosureInput[];
  /** 模块 4：卖家主动确认的教材版本 id；不提交表示不关联教材目录 */
  textbookEditionId?: string | null;
  /** 模块 5：整套打包（省略即单件） */
  listingKind?: import("../../src/api/contracts").ListingKind;
  bundleItems?: import("../../src/api/contracts").BundleItemInput[];
  /** 模块 6：可见范围（省略即全校公开） */
  visibility?: import("../../src/api/contracts").ProductVisibility;
  circleIds?: string[];
  images: string[];
  contact: string;
  contactPublic?: boolean;
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

export type SortKey = "latest" | "priceAsc" | "priceDesc" | "views";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "latest", label: "最新发布" },
  { value: "priceAsc", label: "价格从低到高" },
  { value: "priceDesc", label: "价格从高到低" },
  { value: "views", label: "最多浏览" },
];

export interface FilterState {
  keyword: string;
  category: Category | "全部";
  campus: Campus | "全部";
  condition: Condition | "全部";
  minPrice: number | "";
  maxPrice: number | "";
  sort: SortKey;
}

export const DEFAULT_FILTER: FilterState = {
  keyword: "",
  category: "全部",
  campus: "全部",
  condition: "全部",
  minPrice: "",
  maxPrice: "",
  sort: "latest",
};
