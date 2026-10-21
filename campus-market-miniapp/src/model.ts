import type { UploadedImage } from './images';
import { MAX_IMAGES } from './images';
export type { UploadedImage };
export const CATEGORIES = ['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他'] as const;
export const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'] as const;
export type Category = typeof CATEGORIES[number];
/** 校区 id（来自 GET /v1/schools）；新学校的 id 带命名空间（例如 aust-huainan），显示时一律用 campusLabel 换成名称。 */
export type Campus = string;
/** GET /v1/schools：可见、启用的学校与校区。 */
export interface SchoolCampus { id: Campus; name: string; hasBuildings: boolean }
export interface School { id: string; name: string; shortName: string; campuses: SchoolCampus[] }
export type Condition = typeof CONDITIONS[number];
export type ProductStatus = '在售' | '已售出' | '已下架';
export type Sort = 'latest' | 'priceAsc' | 'priceDesc' | 'views';
/** dormBuildingId：宿舍楼，只有本人可见（公共用户接口不返回）。 */
export interface User { id: string; account?: string; nickname: string; campus: Campus; contact?: string; avatar?: string; dormBuildingId?: string | null }
/** PATCH /v1/auth/me 的请求体（与 Web ProfilePatch 一致）；dormBuildingId 显式传 null 表示清空。 */
export interface ProfileInput { nickname: string; campus: Campus; contact: string; avatar?: string; dormBuildingId?: string | null }
/** GET /v1/buildings?campus=…：园区 → 楼栋。 */
export interface Building { id: string; campusId: Campus; zone: string; name: string }

// ---------------- 留言（商品详情） ----------------
/** 被平台隐藏的留言对任何人都不返回正文；hiddenForAuthor = 我是作者，界面给出可申诉的提示。 */
export interface Comment {
  id: string; productId: string; userId: string; content: string; createdAt: number;
  parentId: string | null; moderationHidden: boolean; hiddenForAuthor: boolean;
}

// ---------------- 私信（阶段 1：只能发送预设的快捷消息） ----------------
export interface Conversation { id: string; productId: string; buyerId: string; sellerId: string; createdAt: number; updatedAt: number }
export type TemplateRole = 'BUYER' | 'SELLER' | 'ANY';
export interface MessageTemplate { code: string; text: string; role: TemplateRole }
/** GET /v1/message-templates：freeTextEnabled 为 false 时只能发送快捷消息。 */
export interface MessageTemplates { freeTextEnabled: boolean; templates: MessageTemplate[] }
/** templateCode 为 null 表示旧版自由文字消息（仍然照常显示）；quarantined 表示这一条被平台隔离（正文不返回）。 */
export interface ChatMessage { id: string; conversationId: string; senderId: string; content: string; createdAt: number; quarantined: boolean; templateCode: string | null }
/** 请求体二选一：快捷消息只发 templateCode；自由文字（仅在开通时）只发 content。 */
export type SendMessageInput = { templateCode: string } | { content: string };

// ---------------- 可信治理（用户侧，与 Web contracts.ts 同形） ----------------
export type ReportTargetType = 'PRODUCT' | 'USER' | 'CIRCLE' | 'COMMENT' | 'MESSAGE';
/** ORDER / NO_SHOW 只出现在历史记录里（站内交易已停用）。 */
export type ModerationTargetType = ReportTargetType | 'ORDER' | 'NO_SHOW';
export const REPORT_REASONS = ['PROHIBITED_ITEM', 'MISLEADING', 'FRAUD_SUSPECTED', 'HARASSMENT', 'SPAM', 'IMPERSONATION', 'OTHER'] as const;
export type ReportReason = typeof REPORT_REASONS[number];
/** 历史举报原因：爽约复核（只用于展示历史记录）。 */
export type LegacyReportReason = 'NO_SHOW_REVIEW';
export interface ReportInput { targetType: ReportTargetType; targetId: string; reasonCode: ReportReason; note?: string }
export interface MyReport {
  id: string; targetType: ModerationTargetType; targetId: string; reasonCode: ReportReason | LegacyReportReason; createdAt: number;
  status: 'RECEIVED' | 'UNDER_REVIEW' | 'CLOSED'; outcome: 'ACTION_TAKEN' | 'NO_ACTION' | null; awaitingEligibleStaff?: boolean;
}
/** BOOKING 是历史上的「预约新订单」限制：不能再新建，到期前与「申请联系方式」限制效果相同。 */
export type RestrictionScope = 'CONTACT' | 'PUBLISHING' | 'CIRCLE_CREATION' | 'BOOKING';
export type RestrictionSource = 'CASE' | 'SYSTEM_RULE';
export type RevokeReason = 'APPEAL_ACCEPTED' | 'STAFF_CORRECTION' | 'RULE_RECOMPUTED' | 'RULE_RETIRED';
export interface AppealSummary { id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: number; decidedAt: number | null; awaitingEligibleStaff?: boolean }
export interface MyRestriction {
  id: string; scope: RestrictionScope; source: RestrictionSource; reasonCode: string;
  startsAt: number; endsAt: number; active: boolean; revokedAt: number | null; revokeReason?: RevokeReason | null;
  appeal: AppealSummary | null; canAppeal: boolean;
}
export type NoticeActionCode = 'HIDE_PRODUCT' | 'HIDE_COMMENT' | 'QUARANTINE_MESSAGE' | 'CONFIRM_NO_SHOW';
export interface MyNotice {
  actionId: string; actionCode: NoticeActionCode; targetId: string; targetLabel: string; reasonCode: string;
  createdAt: number; active: boolean; appeal: AppealSummary | null; canAppeal: boolean;
}
export interface MyGovernance { restrictions: MyRestriction[]; notices: MyNotice[] }
/** restrictionId 与 actionId 二选一。 */
export type AppealInput = { restrictionId: string; reason: string } | { actionId: string; reason: string };
export interface Product {
  id: string; title: string; description: string; price: number; originalPrice?: number;
  category: Category; condition: Condition; campus: Campus; images: string[];
  sellerId: string; contact: string; contactPublic?: boolean; status: ProductStatus;
  createdAt: number; views: number; buildingName?: string | null;
  listingKind?: 'SINGLE' | 'BUNDLE';
  /** 被平台隐藏（只有卖家本人还能看到这件商品）。 */
  moderationHidden?: boolean;
  inspection?: { items: { code: string; condition: string; note: string | null; label: string }[] } | null;
  /** 取货楼栋（商品自己的，不是卖家的宿舍楼）；没有时只显示校区。 */
  buildingId?: string | null; buildingZone?: string | null;
  /** 圈子可见：只有所选圈子的在籍成员和卖家本人能看到。 */
  visibility?: ProductVisibility; circles?: CircleLabel[] | null;
  /** 卖家发布时确认的教材版本快照。 */
  textbook?: ProductTextbook | null;
  /** 整套打包的汇总（列表）与明细（详情）。 */
  bundle?: BundleSummary | null; bundleItems?: BundleItem[] | null;
}
export type DeclaredCondition = 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE';
export interface ProductInput {
  title: string; description: string; price: number; originalPrice?: number; category: Category;
  condition: Condition; campus: Campus; images: string[]; contact: string; contactPublic: boolean;
  inspection?: { itemCode: string; condition: DeclaredCondition; note?: string }[];
  /** 取货楼栋：null 表示不指定（编辑时显式提交，避免「只改校区」的 400）。 */
  buildingId?: string | null;
  /** 单件 / 整套打包（发布后不能互相切换）；整套打包带 2～30 条明细。 */
  listingKind?: ListingKind; bundleItems?: BundleItemInput[];
  /** 可见范围：默认全校公开；圈子可见需要 1～5 个本人在籍的圈子。 */
  visibility?: ProductVisibility; circleIds?: string[];
  /** 教材版本：只有教材书籍分类；null 表示解除关联（编辑时）。 */
  textbookEditionId?: string | null;
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
/** 注册请求体（后端白名单）：inviteCode 只在需要邀请码时出现。 */
export interface RegisterInput { account: string; password: string; nickname: string; campus: Campus; contact: string; inviteCode?: string }
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
  /** POST /v1/auth/register；inviteCode 只在 GET /v1/config 的 registration.inviteRequired 为 true 时发送。 */
  register(input: RegisterInput): Promise<User>;
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
  /** GET /v1/auth/me：本人完整资料（含头像与只有本人可见的宿舍楼）。 */
  me(): Promise<User>;
  updateProfile(input: ProfileInput): Promise<User>;
  buildings(campus: Campus): Promise<Building[]>;
  /** GET /v1/schools（无需登录）：可见、启用的学校与校区。 */
  schools(): Promise<School[]>;
  /** POST /v1/moderation-reports：商品 / 用户 / 留言 / 私信。 */
  report(input: ReportInput): Promise<MyReport>;
  myReports(): Promise<MyReport[]>;
  myGovernance(): Promise<MyGovernance>;
  appeal(input: AppealInput): Promise<AppealSummary>;
  comments(productId: string): Promise<Comment[]>;
  addComment(productId: string, content: string, parentId: string | null): Promise<Comment>;
  conversations(): Promise<Conversation[]>;
  /** 买家对某件商品的会话：已有则返回原会话。 */
  openConversation(productId: string): Promise<Conversation>;
  messages(conversationId: string): Promise<ChatMessage[]>;
  sendMessage(conversationId: string, input: SendMessageInput): Promise<ChatMessage>;
  markConversationRead(conversationId: string): Promise<void>;
  messageUnread(): Promise<number>;
  messageTemplates(): Promise<MessageTemplates>;
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

  // ---------------- 与 Web 对齐（第二部分） ----------------
  /** GET /v1/config（无需登录）；旧后端 404 时用默认值。 */
  clientConfig(): Promise<ClientConfig>;
  /** 楼栋集市 feed：只有「本楼」会自动放宽范围。 */
  feed(query: FeedQuery): Promise<FeedPage>;
  // 圈子：无权访问与不存在一律 404
  createCircle(input: CircleInput): Promise<Circle>;
  myCircles(): Promise<Circle[]>;
  discoverCircles(q?: string): Promise<DiscoverableCircle[]>;
  circle(id: string): Promise<Circle | DiscoverableCircle>;
  updateCircle(id: string, patch: Partial<CircleInput>): Promise<Circle>;
  archiveCircle(id: string): Promise<Circle>;
  circleProducts(id: string, page?: number): Promise<FeedPage>;
  createCircleInvite(id: string, expiresInHours?: number): Promise<CircleInviteCreated>;
  circleInvites(id: string): Promise<CircleInvite[]>;
  /** 邀请码只放在请求体里。 */
  redeemCircleInvite(token: string): Promise<Circle>;
  revokeCircleInvite(inviteId: string): Promise<CircleInvite>;
  circleMembers(id: string, page?: number, size?: number): Promise<CircleMemberPage>;
  changeCircleMemberRole(id: string, userId: string, role: CircleRole): Promise<CircleMemberPage>;
  /** 删除自己即退出；删除他人即移除。 */
  removeCircleMember(id: string, userId: string): Promise<{ userId: string; status: 'LEFT' | 'REMOVED' }>;
  // 毕业季快速发布：草稿、批次、协助整理
  createDraft(input: { draftType?: ListingKind; payload?: ListingPayload }): Promise<ListingDraft>;
  drafts(): Promise<ListingDraft[]>;
  assistingDrafts(): Promise<ListingDraft[]>;
  draft(id: string): Promise<ListingDraft>;
  /** 乐观锁：expectedVersion 必须等于读到的版本，否则 409（details.currentVersion）。 */
  updateDraft(id: string, input: { expectedVersion: number; payload?: ListingPayload; status?: 'DRAFT' | 'READY' }): Promise<ListingDraft>;
  discardDraft(id: string): Promise<ListingDraft>;
  createBatch(input: { draftIds?: string[] }): Promise<ListingBatch>;
  batches(): Promise<ListingBatchSummary[]>;
  batch(id: string): Promise<ListingBatch>;
  updateBatch(id: string, input: { expectedVersion: number; draftIds: string[] }): Promise<ListingBatch>;
  discardBatch(id: string): Promise<ListingBatch>;
  /** 全部成功或全部不发布；同一个幂等键重复提交返回同一结果。 */
  publishBatch(id: string, idempotencyKey: string): Promise<PublishBatchResult>;
  createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }): Promise<AssistInviteCreated>;
  assistInvites(): Promise<AssistInvite[]>;
  redeemAssistInvite(token: string): Promise<AssistInviteRedeemed>;
  revokeAssistInvite(id: string): Promise<AssistInvite>;
  // 课程教材
  courses(query: CourseQuery): Promise<CoursePage>;
  course(id: string): Promise<CourseDetail>;
  textbook(editionId: string, sort?: 'nearest' | 'latest'): Promise<TextbookDetail>;
  textbookByIsbn(isbn: string): Promise<TextbookEdition>;
  createTextbookSuggestion(input: TextbookSuggestionInput): Promise<TextbookSuggestionResult>;
  myTextbookSuggestions(): Promise<TextbookSuggestion[]>;
  withdrawTextbookSuggestion(id: string): Promise<TextbookSuggestion>;
  // 需求订阅
  createSubscription(input: DemandConditions): Promise<DemandSubscribeResult>;
  subscriptions(): Promise<DemandSubscription[]>;
  updateSubscription(id: string, patch: DemandConditions & { active?: boolean }): Promise<DemandSubscription>;
  /** 软停用：历史匹配仍然保留。 */
  deleteSubscription(id: string): Promise<DemandSubscription>;
  demandMatches(page?: number, pageSize?: number): Promise<DemandMatchPage>;
  demandUnread(): Promise<number>;
  /** 返回新的未读数。 */
  markDemandRead(id: string): Promise<number>;
  dismissDemandMatch(id: string): Promise<number>;
}

// ---------------- 客户端配置 ----------------
/** registration.inviteRequired：试点期只能凭学校工作人员发放的邀请码注册（缺失时按 false）。 */
export interface ClientConfig { images: { maxCount: number; maxBytes: number; accept: string[]; externalAllowed: boolean }; registration: { inviteRequired: boolean } }
export const DEFAULT_CLIENT_CONFIG: ClientConfig = { images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: true }, registration: { inviteRequired: false } };
/** 逐项校验：缺失或类型不对的字段回落到默认值（与 Web normalizeClientConfig 一致）。 */
export function normalizeClientConfig(raw: unknown): ClientConfig {
  const fallback = DEFAULT_CLIENT_CONFIG.images;
  const images = (raw && typeof raw === 'object' ? (raw as { images?: unknown }).images : undefined) as Record<string, unknown> | undefined;
  const registration = (raw && typeof raw === 'object' ? (raw as { registration?: unknown }).registration : undefined) as Record<string, unknown> | null | undefined;
  const positiveInt = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : d);
  const accept = Array.isArray(images?.accept) && (images!.accept as unknown[]).length > 0 && (images!.accept as unknown[]).every((t) => typeof t === 'string' && t.startsWith('image/'))
    ? [...images!.accept as string[]] : [...fallback.accept];
  return { images: { maxCount: positiveInt(images?.maxCount, fallback.maxCount), maxBytes: positiveInt(images?.maxBytes, fallback.maxBytes), accept,
    externalAllowed: typeof images?.externalAllowed === 'boolean' ? images.externalAllowed : fallback.externalAllowed },
    // 只有明确为 true 才要求邀请码；缺失或类型不对都按 false（与后端契约一致）
    registration: { inviteRequired: registration?.inviteRequired === true } };
}

// ---------------- 楼栋集市 ----------------
/** 与后端 BuildingScope 一一对应；只有 BUILDING 会自动放宽。 */
export type BuildingScope = 'BUILDING' | 'ZONE' | 'CAMPUS' | 'SCHOOL';
export interface FeedQuery {
  keyword?: string; category?: Category; condition?: Condition; minPrice?: number; maxPrice?: number;
  sort: Sort | 'nearest'; scope: BuildingScope; page: number; pageSize: number;
}
export interface FeedProduct extends Product { sameBuilding: boolean; approximateDistanceMeters: number | null; approximateWalkMinutes: number | null }
export interface FeedPage {
  requestedScope: BuildingScope; effectiveScope: BuildingScope; effectiveScopeLabel: string; fallbackApplied: boolean;
  fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE' | 'NO_RESULTS_IN_ANY_SCOPE' | null;
  items: FeedProduct[]; page: number; pageSize: number; total: number;
}

// ---------------- 圈子 ----------------
export type ProductVisibility = 'PUBLIC' | 'CIRCLE_ONLY';
export type CircleType = 'CLASS' | 'CLUB' | 'INTEREST' | 'OTHER';
export type CircleVisibility = 'PRIVATE' | 'DISCOVERABLE';
export type CircleRole = 'OWNER' | 'MODERATOR' | 'MEMBER';
export const CIRCLE_MAX_PER_PRODUCT = 5;
export const CIRCLE_MEMBER_LIMIT = 1000;
export interface CircleLabel { id: string; name: string; type: CircleType }
/** 成员看到的圈子：所有圈子都是用户创建的，不存在官方认证的圈子。 */
export interface Circle { id: string; type: CircleType; name: string; description: string; visibility: CircleVisibility; status: 'ACTIVE' | 'ARCHIVED'; userCreated: true; joined: true; myRole: CircleRole; createdAt: number }
/** 非成员只能看到可发现圈子的名称、简介与类型。 */
export interface DiscoverableCircle { id: string; type: CircleType; name: string; description: string; userCreated: true; joined: boolean }
/** 管理所需的最小成员投影：没有账号、联系方式或宿舍楼。 */
export interface CircleMember { userId: string; nickname: string; avatar: string; role: CircleRole; joinedAt: number }
export interface CircleMemberPage { items: CircleMember[]; total: number; page: number; size: number }
export interface CircleInvite { id: string; status: 'PENDING' | 'REDEEMED' | 'REVOKED' | 'EXPIRED'; expiresAt: number; createdAt: number }
/** 邀请码只在创建响应里出现一次。 */
export interface CircleInviteCreated { invite: CircleInvite; token: string }
export interface CircleInput { type: CircleType; name: string; description?: string; visibility?: CircleVisibility }

// ---------------- 毕业季快速发布 ----------------
export type ListingKind = 'SINGLE' | 'BUNDLE';
export interface BundleItemInput { itemCode?: string; name: string; category: Category; condition: Condition; quantity: number; note?: string | null }
export interface BundleItem { itemCode: string; name: string; category: Category; condition: Condition; quantity: number; note: string | null; sortOrder: number }
export interface BundleSummary { itemCount: number; totalQuantity: number; categoryCount: number }
export const BUNDLE_MIN_ITEMS = 2;
export const BUNDLE_MAX_ITEMS = 30;
export const BATCH_MAX_ITEMS = 20;
export type DraftStatus = 'DRAFT' | 'READY' | 'PUBLISHED' | 'DISCARDED' | 'EXPIRED';
/** 草稿内容：商品字段的白名单子集，允许不完整。 */
export interface ListingPayload {
  title?: string; description?: string; price?: number | string; originalPrice?: number | string | null;
  category?: Category | string; condition?: Condition | string; campus?: Campus | string; images?: string[];
  contact?: string; contactPublic?: boolean; buildingId?: string | null; inspection?: ProductInput['inspection']; textbookEditionId?: string | null;
  bundleItems?: BundleItemInput[]; visibility?: ProductVisibility | string; circleIds?: string[];
}
export interface ListingDraft {
  id: string; draftType: ListingKind; status: DraftStatus; version: number; payload: ListingPayload;
  access: 'OWNER' | 'ASSISTANT'; editedByAssistant: boolean;
  batchId: string | null; publishedProductId: string | null; expiresAt: number; createdAt: number; updatedAt: number;
}
export type ListingValidationCode = 'VALID' | 'MISSING_FIELD' | 'INVALID_CATEGORY' | 'INVALID_PRICE' | 'INVALID_FIELD'
  | 'INVALID_BUILDING' | 'INVALID_INSPECTION' | 'INVALID_TEXTBOOK' | 'INVALID_BUNDLE' | 'INVALID_CIRCLE' | 'DRAFT_CLOSED';
export interface ListingValidation { code: ListingValidationCode; field: string | null; message: string | null }
export interface ListingBatchItem { position: number; draft: ListingDraft; productId: string | null; validation?: ListingValidation }
export type BatchStatus = 'OPEN' | 'PUBLISHED' | 'DISCARDED';
export interface ListingBatch { id: string; status: BatchStatus; version: number; items: ListingBatchItem[]; allValid: boolean; assisted: boolean; createdAt: number; publishedAt: number | null }
export interface ListingBatchSummary { id: string; status: BatchStatus; version: number; itemCount: number; createdAt: number; publishedAt: number | null }
export interface PublishBatchResult { batchId: string; productIds: string[]; publishedCount: number; replayed: boolean }
/** 整批发布被拒时 ApiError.details.items 的每一项。 */
export interface BatchPublishProblem extends ListingValidation { position: number; draftId: string }
export type AssistInviteStatus = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export interface AssistInvite { id: string; scope: 'DRAFT' | 'BATCH'; draftId: string | null; batchId: string | null; status: AssistInviteStatus; assistantNickname: string | null; expiresAt: number; createdAt: number }
export interface AssistInviteCreated { invite: AssistInvite; token: string }
export interface AssistInviteRedeemed { inviteId: string; drafts: ListingDraft[] }

// ---------------- 课程教材 ----------------
export type Term = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
export type TextbookUsage = 'REQUIRED' | 'RECOMMENDED' | 'REFERENCE';
export interface CourseSummary { id: string; courseCode: string | null; name: string; department: string | null; isDemo: boolean; offeringCount?: number; textbookCount?: number }
export interface CoursePage { items: CourseSummary[]; total: number; page: number; pageSize: number }
export interface CourseQuery { q?: string; term?: Term; academicYear?: string; campus?: Campus; page?: number; pageSize?: number }
export interface TextbookEdition {
  id: string; isbn: string | null; isbn10: string | null; title: string; subtitle: string | null; authors: string[]; publisher: string;
  editionLabel: string; publishedYear: number | null; coverUrl: string | null; isDemo: boolean; onSaleCount: number;
}
export interface CourseTextbook { usageType: TextbookUsage; edition: TextbookEdition }
export interface CourseOffering { id: string; courseId: string; academicYear: string; term: Term; instructorName: string | null; campusId: Campus | null; textbooks: CourseTextbook[] }
export interface CourseDetail extends CourseSummary { offerings: CourseOffering[] }
export interface TextbookCourseRef { courseId: string; courseName: string; courseCode: string | null; offeringId: string; academicYear: string; term: Term; instructorName: string | null; usageType: TextbookUsage }
export interface OtherEdition { id: string; isbn: string | null; title: string; editionLabel: string; publisher: string; publishedYear: number | null; onSaleCount: number }
/** 精确版本与其他版本的在售商品分两个字段，界面也分区展示。 */
export interface TextbookDetail extends TextbookEdition { courses: TextbookCourseRef[]; listingSort: 'nearest' | 'latest'; listings: FeedProduct[]; otherEditions: OtherEdition[]; otherEditionListings: FeedProduct[] }
export interface ProductTextbook { editionId: string; isbn: string | null; title: string; editionLabel: string; publisher: string; courseNames: string[] }
/** 只提交这些字段；状态、提交人、学校、时间都由服务端决定。 */
export interface TextbookSuggestionInput {
  courseOfferingId: string; textbookEditionId?: string; isbn?: string; title?: string; authors?: string; publisher?: string;
  editionLabel?: string; publishedYear?: number; usageType?: TextbookUsage; note?: string;
}
export interface TextbookSuggestion {
  id: string; courseOfferingId: string; courseName: string; academicYear: string; term: Term; textbookEditionId: string | null;
  editionTitle: string | null; editionEditionLabel: string | null; isbn: string | null; title: string | null; authors: string | null;
  publisher: string | null; editionLabel: string | null; publishedYear: number | null; usageType: TextbookUsage; note: string | null;
  status: 'PENDING' | 'WITHDRAWN'; createdAt: number;
}
export interface TextbookSuggestionResult { outcome: 'CREATED' | 'EXISTING'; suggestion: TextbookSuggestion }

// ---------------- 需求订阅 ----------------
/** 身份、学校、指纹一律由服务端决定。 */
export interface DemandConditions {
  keyword?: string | null; category?: Category | null; minPrice?: number | null; maxPrice?: number | null;
  geoScope?: BuildingScope; campusId?: Campus | null; buildingId?: string | null;
  textbookEditionId?: string | null; circleId?: string | null;
}
export interface DemandSubscription {
  id: string; keyword: string | null; category: Category | null; minPrice: number | null; maxPrice: number | null;
  geoScope: BuildingScope; campusId: Campus | null; buildingId: string | null; zone: string | null; buildingName: string | null;
  textbook?: { id: string; isbn: string | null; title: string; editionLabel: string; publisher?: string } | null;
  circle?: { id: string; name: string | null } | null;
  active: boolean; matchCount: number; createdAt: number; updatedAt: number;
}
export interface DemandSubscribeResult { outcome: 'CREATED' | 'EXISTING' | 'REACTIVATED'; subscription: DemandSubscription }
export interface DemandMatch {
  id: string; score: number; tier: string; reasonCodes: string[]; read: boolean; valid: boolean;
  invalidReason: 'NO_LONGER_MATCHES' | 'NOT_ON_SALE' | null; createdAt: number; product: Product;
  subscription: Omit<DemandSubscription, 'active' | 'matchCount' | 'createdAt' | 'updatedAt'>;
}
export interface DemandMatchPage { items: DemandMatch[]; total: number; page: number; pageSize: number }
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
export function validateProduct(input: ProductInput, maxImages = MAX_IMAGES): string | null {
  if (!input.title.trim() || input.title.trim().length > 100) return '请填写 1–100 字的商品名称';
  if (!input.description.trim() || input.description.trim().length > 4000) return '请填写 1–4000 字的商品描述';
  if (!Number.isFinite(input.price) || input.price <= 0) return '请输入大于 0 的价格';
  if (input.originalPrice !== undefined && (!Number.isFinite(input.originalPrice) || input.originalPrice < 0)) return '原价必须为非负数';
  if (!CATEGORIES.includes(input.category) || !CONDITIONS.includes(input.condition) || typeof input.campus !== 'string' || !input.campus.trim()) return '请选择有效的分类、成色和校区';
  if (input.images.length < 1 || input.images.length > maxImages || input.images.some((image) => !image)) return `请选择 1–${maxImages} 张商品图片`;
  // 签名地址 1 小时就过期，后端也不接受：必须提交 upload:<id> 引用
  if (input.images.some((image) => image.startsWith('/v1/'))) return '图片地址无效，请重新上传';
  if (!input.contact.trim() || input.contact.length > 100) return '请填写 1–100 字的联系方式';
  return null;
}
