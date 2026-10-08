import type {
  Building, Campus, Category, ChatMessage, Comment, Condition, Conversation, Favorite,
  Order, Product, ProductStatus, Review, SortKey, User,
} from '../types';
import type { BuildingScope } from '../utils/geo';

export interface ApiEnvelope<T> { code: number; data: T; message: string; requestId?: string }
export interface AuthSession { accessToken: string; expiresAtIso: string; user: User }
export interface LoginInput { account: string; password: string }
export interface RegisterInput { account: string; password: string; nickname: string; campus: Campus; contact?: string }
/** dormBuildingId 显式传 null 表示清空——用户有权收回这条信息。 */
export interface ProfilePatch { nickname?: string; avatar?: string; campus?: Campus; contact?: string; dormBuildingId?: string | null }
export interface ProductQuery { keyword?: string; category?: Category; campus?: Campus; condition?: Condition; minPrice?: number; maxPrice?: number; sort: SortKey; page: number; pageSize: number }
export interface ProductPage { items: Product[]; page: number; pageSize: number; total: number }
export type ProductCreateInput = Omit<Product, 'id'|'sellerId'|'status'|'views'|'createdAt'|'soldAt'|'inspection'|'textbook'|'bundleItems'|'bundle'|'circles'> & {
  /** 模块 6：圈子可见时的目标圈子（1～5 个）；全校公开不提交 */
  circleIds?: string[];
  /** 模块 5：整套打包的明细（2～30 条）；单件不提交 */
  bundleItems?: BundleItemInput[];
  /** 模块 4：卖家按 ISBN 查到并主动确认的教材版本；只允许教材书籍分类 */
  textbookEditionId?: string | null;
  contact?: string;
  /** 受支持分类必须逐项声明；不支持的分类不提交 */
  inspection?: DisclosureInput[];
}
export type ProductPatch = Partial<Pick<Product, 'title'|'description'|'price'|'originalPrice'|'category'|'condition'|'campus'|'images'|'contact'>> & {
  buildingId?: string | null;
  /** 验货声明。切换到受支持分类时必须提供；分类不变时提供则整体替换 */
  inspection?: DisclosureInput[];
  /** 模块 4：换绑教材版本；null 解除关联；省略则保持不变（切离教材分类时服务端自动解除） */
  textbookEditionId?: string | null;
  /** 模块 5：整套打包的明细整体替换（仍需 2～30 条）；单件与打包不能互相切换 */
  bundleItems?: BundleItemInput[];
  /** 模块 6：可见范围与目标圈子（整体替换） */
  visibility?: ProductVisibility;
  circleIds?: string[];
}

/* ---------------------------- 圈子集市（模块 6） ---------------------------- */

export type ProductVisibility = 'PUBLIC' | 'CIRCLE_ONLY';
export type CircleType = 'CLASS' | 'CLUB' | 'INTEREST' | 'OTHER';
export type CircleVisibility = 'PRIVATE' | 'DISCOVERABLE';
export type CircleRole = 'OWNER' | 'MODERATOR' | 'MEMBER';
export const CIRCLE_MAX_PER_PRODUCT = 5;
/** 商品上的圈子标签 */
export interface CircleLabel { id: string; name: string; type: CircleType }
/** 成员看到的圈子资料。所有圈子都是用户创建的（userCreated 恒为 true），不存在官方认证的圈子 */
export interface Circle {
  id: string; type: CircleType; name: string; description: string; visibility: CircleVisibility;
  status: 'ACTIVE' | 'ARCHIVED'; userCreated: true; joined: true; myRole: CircleRole; createdAt: number;
}
/** 非成员能看到的可发现圈子：只有名称、简介、类型与「用户创建」标识 */
export interface DiscoverableCircle { id: string; type: CircleType; name: string; description: string; userCreated: true; joined: boolean }
/** 管理所需的最小成员投影：没有账号、联系方式或宿舍楼 */
export interface CircleMember { userId: string; nickname: string; avatar: string; role: CircleRole; joinedAt: number }
/** 6.1C：成员分页（默认 20、最大 100；角色优先级 → 加入时间 → userId 稳定排序） */
export interface CircleMemberPage { items: CircleMember[]; total: number; page: number; size: number }
export const CIRCLE_MEMBER_LIMIT = 1000;
export interface CircleInvite { id: string; status: 'PENDING' | 'REDEEMED' | 'REVOKED' | 'EXPIRED'; expiresAt: number; createdAt: number }
/** 邀请码只在创建响应里出现一次，服务端只保存哈希 */
export interface CircleInviteCreated { invite: CircleInvite; token: string }
export interface CircleInput { type: CircleType; name: string; description?: string; visibility?: CircleVisibility }

/* ---------------------------- 毕业季通用供给引擎（模块 5） ---------------------------- */

export type ListingKind = 'SINGLE' | 'BUNDLE';
/** 整套打包的一条明细。明细不是商品：没有自己的价格、订单或需求匹配。 */
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
  /** 只有所有者能填写与读取 */
  contact?: string; buildingId?: string | null; inspection?: DisclosureInput[]; textbookEditionId?: string | null;
  bundleItems?: BundleItemInput[];
  /** 模块 6：可见范围。协助人不能修改 */
  visibility?: ProductVisibility | string; circleIds?: string[];
}
export interface ListingDraft {
  id: string; draftType: ListingKind; status: DraftStatus; version: number; payload: ListingPayload;
  /** 当前请求者的身份：所有者或协助人 */
  access: 'OWNER' | 'ASSISTANT';
  /** 最后一次保存是否来自协助人 */
  editedByAssistant: boolean;
  batchId: string | null; publishedProductId: string | null; expiresAt: number; createdAt: number; updatedAt: number;
}
export type ListingValidationCode = 'VALID' | 'MISSING_FIELD' | 'INVALID_CATEGORY' | 'INVALID_PRICE' | 'INVALID_FIELD'
  | 'INVALID_BUILDING' | 'INVALID_INSPECTION' | 'INVALID_TEXTBOOK' | 'INVALID_BUNDLE' | 'INVALID_CIRCLE' | 'DRAFT_CLOSED';
export interface ListingValidation { code: ListingValidationCode; field: string | null; message: string | null }
export interface ListingBatchItem { position: number; draft: ListingDraft; productId: string | null; validation?: ListingValidation }
export type BatchStatus = 'OPEN' | 'PUBLISHED' | 'DISCARDED';
export interface ListingBatch {
  id: string; status: BatchStatus; version: number; items: ListingBatchItem[]; allValid: boolean;
  /** 有协助人整理过其中的内容：发布页必须如实标明 */
  assisted: boolean; createdAt: number; publishedAt: number | null;
}
export interface ListingBatchSummary { id: string; status: BatchStatus; version: number; itemCount: number; createdAt: number; publishedAt: number | null }
export interface PublishBatchResult { batchId: string; productIds: string[]; publishedCount: number; replayed: boolean }
/** 整批发布被拒时 ApiError.details.items 的每一项 */
export interface BatchPublishProblem extends ListingValidation { position: number; draftId: string }
export type AssistInviteStatus = 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export interface AssistInvite {
  id: string; scope: 'DRAFT' | 'BATCH'; draftId: string | null; batchId: string | null; status: AssistInviteStatus;
  assistantNickname: string | null; expiresAt: number; createdAt: number;
}
/** 邀请码只在创建响应里出现这一次，服务端只保存它的哈希 */
export interface AssistInviteCreated { invite: AssistInvite; token: string }
export interface AssistInviteRedeemed { inviteId: string; drafts: ListingDraft[] }
export type AssistEventCode = 'INVITE_CREATED' | 'INVITE_REDEEMED' | 'INVITE_REVOKED' | 'ASSIST_DRAFT_EDITED' | 'PUBLISHED_AFTER_ASSIST';
export interface AssistEvent { code: AssistEventCode; byOwner: boolean; draftId: string | null; at: number }
export interface PriceGuidanceQuery { category: Category; condition?: Condition; textbookEditionId?: string }
export interface PriceGuidance {
  basis: { category: Category; condition: Condition | null; textbookEditionId: string | null };
  minimumSample: number; note: string; sufficient: boolean;
  /** 样本数的下界档位；样本不足时为 null（连样本数都不给） */
  sampleCount: number | null; sampleCountIsLowerBound?: boolean;
  median?: number; lowerQuartile?: number; upperQuartile?: number;
  /** YYYY-MM */
  periodStart?: string; periodEnd?: string;
}
/** 固定说明文字，与后端 PriceGuidanceService.NOTE 一致 */
export const PRICE_GUIDANCE_NOTE = '这是校内历史已完成交易的统计参考，不是平台估价或成交保证。';
export const PRICE_GUIDANCE_MIN_SAMPLE = 8;

/* ---------------------------- 课程教材图谱（模块 4） ---------------------------- */

export type Term = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
export type TextbookUsage = 'REQUIRED' | 'RECOMMENDED' | 'REFERENCE';

export interface CourseSummary {
  id: string; courseCode: string | null; name: string; department: string | null;
  /** 演示目录：界面必须如实标注，不冒充学校教务数据 */
  isDemo: boolean;
  offeringCount?: number; textbookCount?: number;
}
export interface CoursePage { items: CourseSummary[]; total: number; page: number; pageSize: number }
export interface CourseQuery { q?: string; term?: Term; academicYear?: string; campus?: Campus; page?: number; pageSize?: number }

export interface TextbookEdition {
  id: string; isbn: string | null; isbn10: string | null; title: string; subtitle: string | null;
  authors: string[]; publisher: string; editionLabel: string; publishedYear: number | null;
  coverUrl: string | null; isDemo: boolean;
  /** 本校当前在售数量（聚合数字，不含任何买卖双方信息） */
  onSaleCount: number;
}
export interface CourseTextbook { usageType: TextbookUsage; edition: TextbookEdition }
export interface CourseOffering {
  id: string; courseId: string; academicYear: string; term: Term;
  instructorName: string | null; campusId: Campus | null; textbooks: CourseTextbook[];
}
export interface CourseDetail extends CourseSummary { offerings: CourseOffering[] }
export interface OfferingDetail extends CourseOffering {
  course: { id: string; name: string; courseCode: string | null; isDemo: boolean };
}
export interface TextbookCourseRef {
  courseId: string; courseName: string; courseCode: string | null; offeringId: string;
  academicYear: string; term: Term; instructorName: string | null; usageType: TextbookUsage;
}
export interface OtherEdition {
  id: string; isbn: string | null; title: string; editionLabel: string; publisher: string;
  publishedYear: number | null; onSaleCount: number;
}
/** 教材详情：精确版本与「其他版本」的在售商品分两个字段，前端也必须分区展示 */
export interface TextbookDetail extends TextbookEdition {
  courses: TextbookCourseRef[];
  listingSort: 'nearest' | 'latest';
  listings: FeedProduct[];
  otherEditions: OtherEdition[];
  otherEditionListings: FeedProduct[];
}
/** 商品卡片上的教材版本（关联时的快照） */
export interface ProductTextbook {
  editionId: string; isbn: string | null; title: string; editionLabel: string; publisher: string; courseNames: string[];
}
/** 教材建议：只提交这些字段；状态、提交人、学校、时间都由服务端决定 */
export interface TextbookSuggestionInput {
  courseOfferingId: string;
  textbookEditionId?: string;
  isbn?: string; title?: string; authors?: string; publisher?: string; editionLabel?: string; publishedYear?: number;
  usageType?: TextbookUsage; note?: string;
}
export interface TextbookSuggestion {
  id: string; courseOfferingId: string; courseName: string; academicYear: string; term: Term;
  textbookEditionId: string | null; editionTitle: string | null; editionEditionLabel: string | null;
  isbn: string | null; title: string | null; authors: string | null; publisher: string | null;
  editionLabel: string | null; publishedYear: number | null; usageType: TextbookUsage; note: string | null;
  /** 只有待审核与已撤回：不存在「已认证」，也没有审核进度 */
  status: 'PENDING' | 'WITHDRAWN';
  createdAt: number;
}
export interface TextbookSuggestionResult { outcome: 'CREATED' | 'EXISTING'; suggestion: TextbookSuggestion }

/* ---------------------------- 可信面交（模块 3） ---------------------------- */

/** 卖家对条目的声明（机器码）。中文只在 utils/trustedFlow 映射。 */
export type DeclaredCondition = 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE';
/** 买家现场结果（机器码）。 */
export type BuyerResult = 'MATCH' | 'MISMATCH' | 'NOT_CHECKABLE';

export interface InspectionTemplateItem { code: string; label: string; description: string; required: boolean }
export interface InspectionTemplate { category: Category; version: number; title: string; items: InspectionTemplateItem[] }

/** 发布 / 编辑时提交的声明条目。只有这三个字段，服务端字段一律不提交。 */
export interface DisclosureInput { itemCode: string; condition: DeclaredCondition; note?: string }

/** 商品详情中的卖家当前声明。 */
export interface ProductDisclosure extends Omit<InspectionTemplate, 'items'> {
  items: Array<InspectionTemplateItem & { condition: DeclaredCondition | null; note: string }>;
}

export type InspectionStatus = 'LEGACY_NONE' | 'NOT_PROVIDED' | 'PENDING' | 'SUBMITTED' | 'NEEDS_RESOLUTION';

export interface OrderInspectionItem {
  code: string; label: string; description: string; required: boolean;
  sellerCondition: DeclaredCondition | null; sellerNote: string;
  buyerResult: BuyerResult | null; buyerNote: string; checkedAtIso: string | null;
}

export interface OrderInspection {
  status: InspectionStatus;
  templateTitle?: string | null; templateVersion?: number | null;
  hasMismatch?: boolean; submittedAtIso?: string | null;
  items: OrderInspectionItem[];
}

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'SUPERSEDED';

export interface MeetingProposal {
  id: string; proposedBy: 'BUYER' | 'SELLER'; mine: boolean;
  meetingPointId: string; meetingPointName: string;
  startsAtIso: string; endsAtIso: string; note: string;
  status: ProposalStatus; revision: number | null;
  createdAtIso: string; respondedAtIso: string | null;
}

export type PresenceStatus = 'NOT_STARTED' | 'DEPARTED' | 'ARRIVED';
export interface PresenceState { status: PresenceStatus; departedAtIso: string | null; arrivedAtIso: string | null }

export interface FlowEvent { code: string; actor: 'BUYER' | 'SELLER' | 'SYSTEM'; meetingRevision: number | null; atIso: string }

/** 订单流程视图：只有订单双方可见，不含确认码与联系方式。 */
export interface OrderFlow {
  /** 模块 7：订单双方看到的取消事实；未取消为 null */
  cancellation?: OrderCancellation | null;
  orderId: string;
  status: CanonicalOrderStatus;
  role: 'BUYER' | 'SELLER';
  agreement: {
    revision: number; meetingPointId: string; meetingPointName: string | null;
    startsAtIso: string; endsAtIso: string | null; confirmed: boolean;
    /** 7.1A：当前版本有接受时冻结的完整档期快照；旧原始预约为 false（可通过改约确认一个完整档期） */
    explicitSlot?: boolean;
  };
  proposals: MeetingProposal[];
  presence: { revision: number; me: PresenceState; counterpart: PresenceState };
  inspection: OrderInspection;
  /** 服务端计算：买家此刻确认面交是否会被放行。前端只读，不复制条件 */
  buyerConfirmAllowed: boolean;
  buyerConfirmBlockReason: BuyerConfirmBlockReason | null;
  currentMeetingStatus: MeetingStatus;
  timeline: FlowEvent[];
}

/** 买家确认面交的阻断原因（机器码）。中文只在 utils/trustedFlow 映射。 */
export type BuyerConfirmBlockReason =
  | 'INSPECTION_REQUIRED' | 'INSPECTION_MISMATCH' | 'ORDER_NOT_IN_MEETING' | 'ORDER_TERMINAL' | 'ALREADY_CONFIRMED';
/** 面交安排状态：卖家未接受 / 已有正式档期 / 改约待回应 / 不再约时间 */
export type MeetingStatus = 'AWAITING_SELLER' | 'CONFIRMED' | 'RESCHEDULE_PENDING' | 'CLOSED';

/** 订单列表里的流程摘要（3.8A）：与订单同一次请求返回，不需要逐单请求流程详情。 */
export interface OrderFlowSummary {
  inspectionRequired: boolean;
  inspectionStatus: InspectionStatus;
  buyerConfirmAllowed: boolean;
  buyerConfirmBlockReason: BuyerConfirmBlockReason | null;
  currentMeetingStatus: MeetingStatus;
  myPresenceStatus: PresenceStatus;
  counterpartyPresenceStatus: PresenceStatus;
}

export interface InspectionResultInput { itemCode: string; result: BuyerResult | null; note?: string }
export interface MeetingProposalInput { meetingPointId: string; startsAtIso: string; endsAtIso: string; note?: string }

export interface OwnTradeHistory {
  completed: number; completedAsBuyer: number; completedAsSeller: number;
  cancelled: number; expired: number; disputed: number; active: number;
  recent: Array<{ orderId: string; productTitle: string; role: 'BUYER' | 'SELLER'; status: CanonicalOrderStatus; updatedAt: number }>;
}

/** 公共履历：只有聚合数字。averageRating 在评价少于 3 条时为 null。 */
export interface PublicTradeSummary { completedCount: number; joinedAt: number; reviewCount: number; averageRating: number | null }

/** 楼栋集市 feed 的查询。scope 缺省为 SCHOOL，即普通浏览。 */
export interface FeedQuery {
  keyword?: string; category?: Category; condition?: Condition;
  minPrice?: number; maxPrice?: number;
  /** 'nearest' 需要用户已设置宿舍楼 */
  sort: SortKey | 'nearest';
  scope: BuildingScope;
  page: number; pageSize: number;
}

/** feed 中的商品，附带相对当前用户宿舍楼的近似位置信息。 */
export interface FeedProduct extends Product {
  sameBuilding: boolean;
  /** 直线估算，非导航距离；无法计算时为 null */
  approximateDistanceMeters: number | null;
  /** 约几分钟步行；同楼栋与无坐标时为 null */
  approximateWalkMinutes: number | null;
}

/**
 * feed 响应。effectiveScope 可能因自动降级而与 requestedScope 不同——
 * 这正是需要单独一个响应结构、而不是往旧列表接口里塞字段的原因。
 */
export interface FeedPage {
  requestedScope: BuildingScope;
  effectiveScope: BuildingScope;
  effectiveScopeLabel: string;
  fallbackApplied: boolean;
  /** 机器可读原因码；无降级时为 null */
  fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE' | 'NO_RESULTS_IN_ANY_SCOPE' | null;
  items: FeedProduct[];
  page: number;
  pageSize: number;
  total: number;
}
export type CanonicalOrderStatus = 'PENDING_SELLER_CONFIRM'|'PENDING_MEETING'|'BUYER_CONFIRMED'|'SELLER_CONFIRMED'|'COMPLETED'|'CANCELLED'|'EXPIRED'|'DISPUTED'
/** 7.1A：meetingEndsAtIso 明确的结束时间（15～120 分钟）；不提交时服务端写入默认 60 分钟并返回，界面总是明确展示 */
export interface CreateOrderInput { productId: string; meetingPointId: string; meetingAtIso: string; meetingEndsAtIso?: string; contact?: string; idempotencyKey: string }
export const SLOT_DEFAULT_MINUTES = 60;
export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 120;
export interface OrderTransitionInput {
  to: CanonicalOrderStatus; confirmationCode?: string; reason?: string;
  /** 模块 7：取消时的结构化原因。卖家确认之后的取消必须提供；「其他」必须附一句说明 */
  reasonCode?: CancellationReason; note?: string;
}

/* ------------------------- 交易承诺与可信治理（模块 7） ------------------------- */

/** 取消所处阶段，由服务端根据订单状态、档期版本与到达记录判定，客户端不能提交 */
export type CancellationPhase = 'BEFORE_SELLER_CONFIRM' | 'AFTER_SELLER_CONFIRM' | 'AFTER_MEETING_AGREED' | 'AFTER_ARRIVAL_REPORTED' | 'INSPECTION_MISMATCH';
export type CancellationReason = 'CHANGED_MIND' | 'SCHEDULE_CONFLICT' | 'ITEM_UNAVAILABLE' | 'CONDITION_MISMATCH' | 'COUNTERPART_UNRESPONSIVE' | 'OTHER';
export const CANCELLATION_REASONS: readonly CancellationReason[] = ['CHANGED_MIND', 'SCHEDULE_CONFLICT', 'ITEM_UNAVAILABLE', 'CONDITION_MISMATCH', 'COUNTERPART_UNRESPONSIVE', 'OTHER'];
export const CANCELLATION_NOTE_MAX = 200;
/** 订单双方看到的取消事实（公共履历里没有这一项） */
export interface OrderCancellation { phase: CancellationPhase; reasonCode: CancellationReason | null; note: string | null; byMe: boolean; createdAt: number }

export type NoShowStatus = 'PENDING' | 'ACKNOWLEDGED' | 'DISPUTED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED';
export type NoShowReason = 'DID_NOT_ARRIVE' | 'ARRIVED_TOO_LATE' | 'UNREACHABLE_AT_MEETING' | 'OTHER';
export const NO_SHOW_REASONS: readonly NoShowReason[] = ['DID_NOT_ARRIVE', 'ARRIVED_TOO_LATE', 'UNREACHABLE_AT_MEETING', 'OTHER'];
/** 档期结束后多久才能报告爽约（分钟），以及可以报告的期限（天） */
export const NO_SHOW_GRACE_MINUTES = 15;
export const NO_SHOW_REPORT_WINDOW_DAYS = 7;
export interface NoShowReport {
  id: string; orderId: string; meetingRevision: number; status: NoShowStatus; reasonCode: NoShowReason;
  note: string | null; responseNote: string | null;
  /** 我是报告人 / 报告针对我 */
  byMe: boolean; aboutMe: boolean;
  createdAt: number; respondedAt: number | null; decidedAt: number | null;
  /** 被报告的一方可以承认或提出异议（仅 PENDING） */
  canRespond: boolean;
  /** 报告人可以请平台工作人员复核（PENDING 且尚未提交复核） */
  canEscalate: boolean;
}
/** 能否报告爽约：不能时给出机器码，界面只做展示 */
export interface NoShowEligibility {
  canReport: boolean;
  code: 'OK' | 'NO_AGREED_MEETING' | 'NO_EXPLICIT_SLOT' | 'TOO_EARLY' | 'WINDOW_CLOSED' | 'MET' | 'CANCELLED_BEFORE_MEETING' | 'ALREADY_REPORTED';
  reportableAt: number | null; deadline: number | null;
  /** 7.1A：判断所依据的、接受时冻结的档期快照；没有快照时为 null（不推断结束时间） */
  slot?: { revision: number; startsAt: number; endsAt: number; agreedAt: number } | null;
}
export interface OrderNoShowView { reports: NoShowReport[]; eligibility: NoShowEligibility }

export type ModerationTargetType = 'PRODUCT' | 'USER' | 'CIRCLE' | 'COMMENT' | 'MESSAGE' | 'ORDER' | 'NO_SHOW';
export type ModerationReportReason = 'PROHIBITED_ITEM' | 'MISLEADING' | 'FRAUD_SUSPECTED' | 'HARASSMENT' | 'SPAM' | 'IMPERSONATION' | 'NO_SHOW_REVIEW' | 'OTHER';
export const MODERATION_REPORT_REASONS: readonly ModerationReportReason[] = ['PROHIBITED_ITEM', 'MISLEADING', 'FRAUD_SUSPECTED', 'HARASSMENT', 'SPAM', 'IMPERSONATION', 'OTHER'];
export const MODERATION_NOTE_MAX = 500;
export interface ModerationReportInput { targetType: ModerationTargetType; targetId: string; reasonCode: ModerationReportReason; note?: string }
/** 举报人自己看到的状态摘要：不含处理细节、工作人员身份或被举报人的处罚 */
export interface MyModerationReport {
  id: string; targetType: ModerationTargetType; targetId: string; reasonCode: ModerationReportReason; createdAt: number;
  status: 'RECEIVED' | 'UNDER_REVIEW' | 'CLOSED';
  outcome: 'ACTION_TAKEN' | 'NO_ACTION' | null;
  /** 7.1C：本校暂时没有可以回避利益冲突的工作人员，案件保持待处理（不会被自动驳回） */
  awaitingEligibleStaff?: boolean;
}

export type RestrictionScope = 'BOOKING' | 'PUBLISHING' | 'CIRCLE_CREATION';
/** 用户限制最长 30 天；自动规则见文档（30 天内第 2 次确认爽约 24 小时、第 3 次起 72 小时） */
export const RESTRICTION_MAX_HOURS = 720;
export interface MyAppealSummary {
  id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: number; decidedAt: number | null;
  /** 7.1C：本校暂时没有可以回避的工作人员，申诉保持待处理（不会被自动驳回） */
  awaitingEligibleStaff?: boolean;
}
/** 7.1B：自动限制来源统一为 SYSTEM_RULE（按公开规则），人工限制为 CASE */
export type RestrictionSource = 'CASE' | 'SYSTEM_RULE';
export const NO_SHOW_RULE_VERSION = 'NO_SHOW_V1';
export interface RestrictionCorrection { outcome: 'SHORTENED' | 'REVOKED'; remainingCount: number; previousEndsAt: number; newEndsAt: number; createdAt: number }
export interface MyRestriction {
  id: string; scope: RestrictionScope; source: RestrictionSource; reasonCode: string;
  startsAt: number; endsAt: number; active: boolean; revokedAt: number | null;
  appeal: MyAppealSummary | null; canAppeal: boolean;
  /** 7.1B：规则版本（仅 SYSTEM_RULE）、决定时间、撤销原因、所依据的确认（只有时间）与追加的纠正记录 */
  ruleVersion?: string | null; decidedAt?: number; revokeReason?: 'APPEAL_ACCEPTED' | 'STAFF_CORRECTION' | 'RULE_RECOMPUTED' | null;
  basis?: Array<{ confirmedAt: number; stillConfirmed: boolean }>;
  corrections?: RestrictionCorrection[];
}
/** 与我有关、可以申诉的处理（商品 / 评论隐藏、私信隔离、工作人员确认的爽约），不含举报人或工作人员身份 */
export type MyNoticeActionCode = 'HIDE_PRODUCT' | 'HIDE_COMMENT' | 'QUARANTINE_MESSAGE' | 'CONFIRM_NO_SHOW';
export interface MyModerationNotice {
  actionId: string; actionCode: MyNoticeActionCode; targetId: string; targetLabel: string; reasonCode: string;
  createdAt: number; active: boolean; appeal: MyAppealSummary | null; canAppeal: boolean;
}
export interface MyGovernance {
  restrictions: MyRestriction[];
  notices: MyModerationNotice[];
  /** 30 天内已确认爽约的提醒（第 1 次只提醒，不限制） */
  noShowWarning: { confirmedCount: number; windowDays: number } | null;
}
export interface AppealInput { restrictionId?: string; actionId?: string; reason: string }
export const APPEAL_REASON_MAX = 500;

export type StaffRole = 'MODERATOR' | 'SENIOR_MODERATOR';
export interface StaffStatus { staff: boolean; role: StaffRole | null }
export type ModerationCaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'APPEALED';
export type ModerationActionCode = 'HIDE_PRODUCT' | 'RESTORE_PRODUCT' | 'ARCHIVE_CIRCLE' | 'RESTRICT_BOOKING' | 'RESTRICT_PUBLISHING'
  | 'RESTRICT_CIRCLE_CREATION' | 'CONFIRM_NO_SHOW' | 'REJECT_NO_SHOW' | 'NO_ACTION'
  | 'HIDE_COMMENT' | 'RESTORE_COMMENT' | 'QUARANTINE_MESSAGE' | 'RELEASE_MESSAGE';
/** 7.1C：工作人员利益冲突原因码（后端数据库函数判断；403 details.reason） */
export type ConflictReason = 'SELF_TARGET' | 'OWN_CONTENT' | 'OWN_CONVERSATION' | 'OWN_ORDER' | 'OWN_REPORT' | 'OWN_ACTION';
export type ModerationDecisionReason = 'POLICY_VIOLATION' | 'PROHIBITED_ITEM' | 'HARASSMENT' | 'FRAUD_RISK' | 'CONFIRMED_NO_SHOW'
  | 'INSUFFICIENT_EVIDENCE' | 'APPEAL_ACCEPTED' | 'APPEAL_REJECTED' | 'DUPLICATE' | 'OTHER';
export const MODERATION_DECISION_REASONS: readonly ModerationDecisionReason[] = ['POLICY_VIOLATION', 'PROHIBITED_ITEM', 'HARASSMENT', 'FRAUD_RISK', 'CONFIRMED_NO_SHOW', 'INSUFFICIENT_EVIDENCE', 'DUPLICATE', 'OTHER'];
export interface ModerationCaseQuery { status?: ModerationCaseStatus; targetType?: ModerationTargetType; page?: number; size?: number }
export interface ModerationCaseSummary {
  id: string; targetType: ModerationTargetType; targetId: string; status: ModerationCaseStatus;
  reportCount: number; createdAt: number; updatedAt: number; assignedToMe: boolean; assigned: boolean;
  resolutionCode: ModerationActionCode | null;
}
export interface ModerationCasePage { items: ModerationCaseSummary[]; total: number; page: number; size: number }
/** 目标摘要：只有处理所需的最少字段，没有联系方式、确认码、账号或会话全文 */
export type ModerationTarget = { type: ModerationTargetType; exists: boolean; label: string; fields: Record<string, string | number | boolean | null> };
export interface ModerationCaseDetail extends ModerationCaseSummary {
  target: ModerationTarget;
  reports: Array<{ id: string; reasonCode: ModerationReportReason; note: string | null; snapshot: string | null; createdAt: number }>;
  actions: Array<{ id: string; actionCode: string; reasonCode: string; note: string | null; createdAt: number; byMe: boolean; expiresAt: number | null; effective: boolean }>;
  /** 爽约复核：订单档期、双方到达记录（手动声明，不是定位）、报告与回应 */
  noShow: { report: NoShowReport; meeting: { startsAt: number; endsAt: number | null; revision: number; explicit?: boolean }; presence: Array<{ party: 'REPORTER' | 'REPORTED'; status: string; at: number | null }> } | null;
  /** 当前工作人员可以执行的动作（按目标类型、案件状态与角色计算） */
  allowedActions: ModerationActionCode[];
  /** 结案响应带上本次请求的 requestId（审计可追溯）；读取详情时没有 */
  requestId?: string;
}
export interface ModerationDecisionInput { action: ModerationActionCode; reasonCode: ModerationDecisionReason; note?: string; durationHours?: number }
export interface StaffAppeal {
  id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; reason: string; createdAt: number; decidedAt: number | null;
  subject: { kind: 'RESTRICTION'; scope: RestrictionScope; endsAt: number; active: boolean; sourceType?: RestrictionSource; ruleVersion?: string | null }
    | { kind: 'ACTION'; actionCode: string; targetId: string };
  caseId: string | null; decidable: boolean;
  requestId?: string;
}
export interface StaffAppealPage { items: StaffAppeal[]; total: number; page: number; size: number }
export interface AppealDecisionInput { accept: boolean; reasonCode: 'APPEAL_ACCEPTED' | 'APPEAL_REJECTED'; note?: string }
export interface ReviewInput { rating: number; comment: string }
export interface CommentInput { productId: string; content: string; parentId?: string | null }
/* ------------------------------ 需求雷达 ------------------------------ */

/** 创建 / 修改订阅时客户端可提交的条件。身份、学校、指纹一律由服务端决定。 */
export interface DemandConditions {
  keyword?: string | null;
  category?: Category | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  /** 缺省为 SCHOOL */
  geoScope?: BuildingScope;
  campusId?: Campus | null;
  /** BUILDING / ZONE 的锚点楼栋；省略时使用本人宿舍楼 */
  buildingId?: string | null;
  /** 模块 4：精确教材版本订阅（按版本 id 匹配，不带关键词；创建后不可修改） */
  textbookEditionId?: string | null;
  /** 模块 6：圈子范围订阅（只有在籍成员可以创建；范围固定为这个圈子；创建后不可修改） */
  circleId?: string | null;
}

export interface DemandSubscription {
  id: string;
  keyword: string | null;
  category: Category | null;
  minPrice: number | null;
  maxPrice: number | null;
  geoScope: BuildingScope;
  campusId: Campus | null;
  buildingId: string | null;
  /** 由锚点楼栋推导，仅用于展示 */
  zone: string | null;
  buildingName: string | null;
  /** 模块 4：精确教材版本订阅的版本摘要；普通订阅为 null */
  textbook?: { id: string; isbn: string | null; title: string; editionLabel: string; publisher?: string } | null;
  /** 模块 6：圈子范围订阅写明具体圈子；普通订阅为 null */
  circle?: { id: string; name: string | null } | null;
  active: boolean;
  matchCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 创建结果：CREATED 新建、EXISTING 已有同条件订阅、REACTIVATED 重新启用了已停用的同条件订阅。 */
export interface DemandSubscribeResult {
  outcome: 'CREATED' | 'EXISTING' | 'REACTIVATED';
  subscription: DemandSubscription;
}

/** 理由码。服务端可能新增前端尚不认识的码，因此允许任意字符串，由 reasonLabel 安全降级。 */
export type DemandReasonCode = import('../utils/demand').ReasonCode | (string & {});

export interface DemandMatch {
  id: string;
  /** 仅用于排序与调试，界面不展示 */
  score: number;
  /** 服务端给出的展示档位；前端不得由 score 自行推导 */
  tier: import('../utils/demand').MatchTier;
  reasonCodes: DemandReasonCode[];
  read: boolean;
  /** 仍可预约：未失效且商品在售 */
  valid: boolean;
  invalidReason: 'NO_LONGER_MATCHES' | 'NOT_ON_SALE' | null;
  createdAt: number;
  product: Product;
  subscription: Omit<DemandSubscription, 'active' | 'matchCount' | 'createdAt' | 'updatedAt'>;
}

export interface DemandMatchPage { items: DemandMatch[]; total: number; page: number; pageSize: number }

export interface MeetingPoint {
  id: string; campus: Campus; name: string; latitude?: number | null; longitude?: number | null;
  /** V5：停用的面交点仍会返回（历史订单要显示名称），但不能用于新的预约或提议 */
  active?: boolean;
}
export interface CampusMarketApi {
  getUser(id: string): Promise<import('../types').PublicUser>;
  listMeetingPoints(): Promise<MeetingPoint[]>;
  /** 某校区的可选楼栋。公共参考数据，未登录也可读。 */
  listBuildings(campus: Campus, zone?: string): Promise<Building[]>;
  markConversationRead(id: string): Promise<void>;
  login(input: LoginInput): Promise<AuthSession>;
  register(input: RegisterInput): Promise<AuthSession>;
  /**
   * 用 HttpOnly refresh Cookie 换取新的 Access Token（REST）。
   * Access Token 只进内存；Mock 模式下为演示登录态的空操作。
   */
  refreshSession(): Promise<AuthSession | null>;
  getCurrentUser(): Promise<User | null>;
  updateProfile(patch: ProfilePatch): Promise<User>;
  logout(): Promise<void>;
  listProducts(query: ProductQuery): Promise<ProductPage>;
  /** 楼栋集市 feed：范围自动降级与最近排序。旧的 listProducts 保持原样。 */
  feedProducts(query: FeedQuery): Promise<FeedPage>;
  /** 某分类的当前验货模板；不支持的分类返回 null。 */
  getInspectionTemplate(category: Category): Promise<InspectionTemplate | null>;
  getOrderFlow(orderId: string): Promise<OrderFlow>;
  saveInspectionDraft(orderId: string, items: InspectionResultInput[]): Promise<OrderFlow>;
  /** 最终提交；提交后记录不可修改。存在不一致时订单进入 DISPUTED。 */
  submitInspection(orderId: string, items: InspectionResultInput[]): Promise<OrderFlow>;
  proposeMeeting(orderId: string, input: MeetingProposalInput): Promise<OrderFlow>;
  acceptMeeting(orderId: string, proposalId: string): Promise<OrderFlow>;
  rejectMeeting(orderId: string, proposalId: string): Promise<OrderFlow>;
  withdrawMeeting(orderId: string, proposalId: string): Promise<OrderFlow>;
  /** 本人手动声明，不是定位。时间由服务端生成。 */
  updatePresence(orderId: string, action: 'DEPART' | 'ARRIVE'): Promise<OrderFlow>;
  getOwnTradeHistory(): Promise<OwnTradeHistory>;
  getPublicTradeSummary(userId: string): Promise<PublicTradeSummary>;
  // ---- 圈子集市（模块 6）：均需登录；无权访问与不存在一律 404 ----
  createCircle(input: CircleInput): Promise<Circle>;
  listMyCircles(): Promise<Circle[]>;
  discoverCircles(q?: string): Promise<DiscoverableCircle[]>;
  getCircle(id: string): Promise<Circle | DiscoverableCircle>;
  updateCircle(id: string, patch: Partial<CircleInput>): Promise<Circle>;
  archiveCircle(id: string): Promise<Circle>;
  listCircleProducts(id: string, page?: number): Promise<FeedPage>;
  createCircleInvite(id: string, expiresInHours?: number): Promise<CircleInviteCreated>;
  listCircleInvites(id: string): Promise<CircleInvite[]>;
  /** 邀请码只放在请求体里 */
  redeemCircleInvite(token: string): Promise<Circle>;
  revokeCircleInvite(inviteId: string): Promise<CircleInvite>;
  listCircleMembers(id: string, page?: number, size?: number): Promise<CircleMemberPage>;
  /** 返回第一页成员 */
  changeCircleMemberRole(id: string, userId: string, role: CircleRole): Promise<CircleMemberPage>;
  /** 删除自己即退出；删除他人即移除 */
  removeCircleMember(id: string, userId: string): Promise<{ userId: string; status: 'LEFT' | 'REMOVED' }>;
  // ---- 毕业季通用供给引擎（模块 5）：均需登录，身份只取自认证 ----
  createListingDraft(input: { draftType?: ListingKind; payload?: ListingPayload }): Promise<ListingDraft>;
  listListingDrafts(): Promise<ListingDraft[]>;
  /** 我作为协助人可以编辑的草稿（不含所有者联系方式） */
  listAssistingDrafts(): Promise<ListingDraft[]>;
  getListingDraft(id: string): Promise<ListingDraft>;
  /** 乐观锁：expectedVersion 必须等于读到的版本，否则 409（details.currentVersion） */
  updateListingDraft(id: string, input: { expectedVersion: number; payload?: ListingPayload; status?: 'DRAFT' | 'READY' }): Promise<ListingDraft>;
  discardListingDraft(id: string): Promise<ListingDraft>;
  createListingBatch(input: { draftIds?: string[] }): Promise<ListingBatch>;
  listListingBatches(): Promise<ListingBatchSummary[]>;
  getListingBatch(id: string): Promise<ListingBatch>;
  updateListingBatch(id: string, input: { expectedVersion: number; draftIds: string[] }): Promise<ListingBatch>;
  discardListingBatch(id: string): Promise<ListingBatch>;
  /** 全部成功或全部不发布；同一个幂等键重复提交返回同一结果 */
  publishListingBatch(id: string, idempotencyKey: string): Promise<PublishBatchResult>;
  createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }): Promise<AssistInviteCreated>;
  listAssistInvites(): Promise<AssistInvite[]>;
  /** 邀请码只放在请求体里，不进入 URL */
  redeemAssistInvite(token: string): Promise<AssistInviteRedeemed>;
  revokeAssistInvite(id: string): Promise<AssistInvite>;
  listAssistEvents(id: string): Promise<AssistEvent[]>;
  getPriceGuidance(query: PriceGuidanceQuery): Promise<PriceGuidance>;
  // ---- 课程教材图谱（模块 4）：均需登录，学校由服务端从本人校区推导 ----
  listCourses(query: CourseQuery): Promise<CoursePage>;
  getCourse(courseId: string): Promise<CourseDetail>;
  getCourseOffering(offeringId: string): Promise<OfferingDetail>;
  getTextbook(editionId: string, sort?: 'nearest' | 'latest'): Promise<TextbookDetail>;
  getTextbookByIsbn(isbn: string): Promise<TextbookEdition>;
  createTextbookSuggestion(input: TextbookSuggestionInput): Promise<TextbookSuggestionResult>;
  listMyTextbookSuggestions(): Promise<TextbookSuggestion[]>;
  withdrawTextbookSuggestion(id: string): Promise<TextbookSuggestion>;
  /** 需求雷达：订阅幂等，同条件返回原订阅。 */
  createDemandSubscription(input: DemandConditions): Promise<DemandSubscribeResult>;
  listDemandSubscriptions(): Promise<DemandSubscription[]>;
  updateDemandSubscription(id: string, patch: DemandConditions & { active?: boolean }): Promise<DemandSubscription>;
  /** 软停用：历史匹配仍然保留。 */
  deleteDemandSubscription(id: string): Promise<DemandSubscription>;
  listDemandMatches(page?: number, pageSize?: number): Promise<DemandMatchPage>;
  getDemandUnreadCount(): Promise<number>;
  markDemandMatchRead(id: string): Promise<number>;
  dismissDemandMatch(id: string): Promise<number>;
  getProduct(id: string): Promise<Product>;
  createProduct(input: ProductCreateInput): Promise<Product>;
  updateProduct(id: string, patch: ProductPatch): Promise<Product>;
  setProductStatus(id: string, status: ProductStatus): Promise<Product>;
  incrementProductViews(id: string): Promise<void>;
  listFavorites(): Promise<Favorite[]>;
  /**
   * 幂等设置收藏状态。desired=true 走 PUT，false 走 DELETE。
   * 底层 API 不再自行 toggle——那会让网络重试把用户刚加的收藏删掉。
   */
  setFavorite(productId: string, desired: boolean): Promise<boolean>;
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
  // ---- 交易承诺与可信治理（模块 7）：均需登录 ----
  getOrderNoShow(orderId: string): Promise<OrderNoShowView>;
  reportNoShow(orderId: string, input: { reasonCode: NoShowReason; note?: string }): Promise<NoShowReport>;
  acknowledgeNoShow(reportId: string, note?: string): Promise<NoShowReport>;
  disputeNoShow(reportId: string, note: string): Promise<NoShowReport>;
  createModerationReport(input: ModerationReportInput): Promise<MyModerationReport>;
  listMyModerationReports(): Promise<MyModerationReport[]>;
  getMyGovernance(): Promise<MyGovernance>;
  submitAppeal(input: AppealInput): Promise<MyAppealSummary>;
  /** 是否为本校平台工作人员：每次都由服务端从数据库读取 */
  getStaffStatus(): Promise<StaffStatus>;
  // ---- 工作人员（只处理本校；非工作人员 403） ----
  listModerationCases(query: ModerationCaseQuery): Promise<ModerationCasePage>;
  getModerationCase(id: string): Promise<ModerationCaseDetail>;
  openModerationCase(input: { targetType: ModerationTargetType; targetId: string }): Promise<ModerationCaseDetail>;
  claimModerationCase(id: string): Promise<ModerationCaseDetail>;
  decideModerationCase(id: string, input: ModerationDecisionInput): Promise<ModerationCaseDetail>;
  listModerationAppeals(query: { status?: 'PENDING' | 'ACCEPTED' | 'REJECTED'; page?: number; size?: number }): Promise<StaffAppealPage>;
  decideModerationAppeal(id: string, input: AppealDecisionInput): Promise<StaffAppeal>;
}
