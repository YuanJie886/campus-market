import type {
  Building, Campus, Category, ChatMessage, Comment, Condition, Conversation, Favorite,
  Product, ProductStatus, SortKey, User,
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
export type ProductPatch = Partial<Pick<Product, 'title'|'description'|'price'|'originalPrice'|'category'|'condition'|'campus'|'images'|'contact'|'contactPublic'>> & {
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
  contact?: string; contactPublic?: boolean; buildingId?: string | null; inspection?: DisclosureInput[]; textbookEditionId?: string | null;
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

/* ---------------------------- 卖家声明（模块 3） ---------------------------- */

/** 卖家对条目的声明（机器码）。中文只在 utils/trustedFlow 映射。 */
export type DeclaredCondition = 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE';

export interface InspectionTemplateItem { code: string; label: string; description: string; required: boolean }
export interface InspectionTemplate { category: Category; version: number; title: string; items: InspectionTemplateItem[] }

/** 发布 / 编辑时提交的声明条目。只有这三个字段，服务端字段一律不提交。 */
export interface DisclosureInput { itemCode: string; condition: DeclaredCondition; note?: string }

/** 商品详情中的卖家当前声明。 */
export interface ProductDisclosure extends Omit<InspectionTemplate, 'items'> {
  items: Array<InspectionTemplateItem & { condition: DeclaredCondition | null; note: string }>;
}

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
/* ------------------------------- 可信治理（模块 7） ------------------------------- */

/** 案件对象类型。ORDER / NO_SHOW 只出现在历史案件里（站内交易已停用，V16 起不能再举报或立案） */
export type ModerationTargetType = ReportableTargetType | 'ORDER' | 'NO_SHOW';
/** 可以举报 / 立案的对象（后端 ModerationService.TARGETS） */
export type ReportableTargetType = 'PRODUCT' | 'USER' | 'CIRCLE' | 'COMMENT' | 'MESSAGE';
export const MODERATION_REPORT_TARGETS: readonly ReportableTargetType[] = ['PRODUCT', 'USER', 'CIRCLE', 'COMMENT', 'MESSAGE'];
/** 历史案件只读：界面不提供领取或处理 */
export const HISTORICAL_TARGET_TYPES: readonly ModerationTargetType[] = ['ORDER', 'NO_SHOW'];
export type ModerationReportReason = 'PROHIBITED_ITEM' | 'MISLEADING' | 'FRAUD_SUSPECTED' | 'HARASSMENT' | 'SPAM' | 'IMPERSONATION' | 'OTHER';
/** 历史举报原因：爽约复核（已停用，只用于展示历史记录） */
export type LegacyReportReason = 'NO_SHOW_REVIEW';
export const MODERATION_REPORT_REASONS: readonly ModerationReportReason[] = ['PROHIBITED_ITEM', 'MISLEADING', 'FRAUD_SUSPECTED', 'HARASSMENT', 'SPAM', 'IMPERSONATION', 'OTHER'];
export const MODERATION_NOTE_MAX = 500;
export interface ModerationReportInput { targetType: ReportableTargetType; targetId: string; reasonCode: ModerationReportReason; note?: string }
/** 举报人自己看到的状态摘要：不含处理细节、工作人员身份或被举报人的处罚 */
export interface MyModerationReport {
  id: string; targetType: ModerationTargetType; targetId: string; reasonCode: ModerationReportReason | LegacyReportReason; createdAt: number;
  status: 'RECEIVED' | 'UNDER_REVIEW' | 'CLOSED';
  outcome: 'ACTION_TAKEN' | 'NO_ACTION' | null;
  /** 7.1C：本校暂时没有可以回避利益冲突的工作人员，案件保持待处理（不会被自动驳回） */
  awaitingEligibleStaff?: boolean;
}

/**
 * 限制范围。CONTACT = 申请联系方式（阶段 1 新增）；BOOKING 是历史上的「预约新订单」限制：
 * 不能再新建，但到期前同样拦截联系申请（后端 GovernanceMapper.selectActiveRestriction）。
 */
export type RestrictionScope = 'CONTACT' | 'PUBLISHING' | 'CIRCLE_CREATION' | 'BOOKING';
/** 用户限制最长 30 天；只来自工作人员在案件里的决定（爽约自动规则已随站内交易停用） */
export const RESTRICTION_MAX_HOURS = 720;
export interface MyAppealSummary {
  id: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: number; decidedAt: number | null;
  /** 7.1C：本校暂时没有可以回避的工作人员，申诉保持待处理（不会被自动驳回） */
  awaitingEligibleStaff?: boolean;
}
/** CASE = 工作人员的处理；SYSTEM_RULE 只出现在历史记录里（已停用的爽约自动规则，V16 全部撤销） */
export type RestrictionSource = 'CASE' | 'SYSTEM_RULE';
export interface RestrictionCorrection { outcome: 'SHORTENED' | 'REVOKED'; remainingCount: number; previousEndsAt: number; newEndsAt: number; createdAt: number }
/** RULE_RETIRED：爽约规则停用时（V16）撤销的自动限制 */
export type RevokeReason = 'APPEAL_ACCEPTED' | 'STAFF_CORRECTION' | 'RULE_RECOMPUTED' | 'RULE_RETIRED';
export interface MyRestriction {
  id: string; scope: RestrictionScope; source: RestrictionSource; reasonCode: string;
  startsAt: number; endsAt: number; active: boolean; revokedAt: number | null;
  appeal: MyAppealSummary | null; canAppeal: boolean;
  /** 7.1B：规则版本（仅历史 SYSTEM_RULE）、决定时间、撤销原因、所依据的确认（只有时间）与追加的纠正记录 */
  ruleVersion?: string | null; decidedAt?: number; revokeReason?: RevokeReason | null;
  basis?: Array<{ confirmedAt: number; stillConfirmed: boolean }>;
  corrections?: RestrictionCorrection[];
}
/**
 * 与我有关的处理（商品 / 评论隐藏、私信隔离），不含举报人或工作人员身份。
 * CONFIRM_NO_SHOW 只是历史记录：服务端返回 active=false、canAppeal=false。
 */
export type MyNoticeActionCode = 'HIDE_PRODUCT' | 'HIDE_COMMENT' | 'QUARANTINE_MESSAGE' | 'CONFIRM_NO_SHOW';
export interface MyModerationNotice {
  actionId: string; actionCode: MyNoticeActionCode; targetId: string; targetLabel: string; reasonCode: string;
  createdAt: number; active: boolean; appeal: MyAppealSummary | null; canAppeal: boolean;
}
export interface MyGovernance {
  restrictions: MyRestriction[];
  notices: MyModerationNotice[];
}
export interface AppealInput { restrictionId?: string; actionId?: string; reason: string }
export const APPEAL_REASON_MAX = 500;

export type StaffRole = 'MODERATOR' | 'SENIOR_MODERATOR' | 'SCHOOL_ADMIN' | 'AUDITOR';
export interface StaffStatus { staff: boolean; role: StaffRole | null }
export type ModerationCaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED' | 'APPEALED';
/** 现在可以提交的处理动作（后端 StaffModerationService.ACTIONS） */
export type ModerationActionCode = 'HIDE_PRODUCT' | 'RESTORE_PRODUCT' | 'ARCHIVE_CIRCLE' | 'RESTRICT_CONTACT' | 'RESTRICT_PUBLISHING'
  | 'RESTRICT_CIRCLE_CREATION' | 'NO_ACTION'
  | 'HIDE_COMMENT' | 'RESTORE_COMMENT' | 'QUARANTINE_MESSAGE' | 'RELEASE_MESSAGE';
/** 只出现在历史处理记录 / 历史结案结果里的动作：不再提供，也不再被接受 */
export type HistoricalActionCode = 'RESTRICT_BOOKING' | 'CONFIRM_NO_SHOW' | 'REJECT_NO_SHOW';
/** 7.1C：工作人员利益冲突原因码（后端数据库函数判断；403 details.reason） */
/** CONTACT_PARTY（阶段 2，V17）：申请过这件商品联系方式的工作人员回避该商品的案件 */
export type ConflictReason = 'SELF_TARGET' | 'OWN_CONTENT' | 'OWN_CONVERSATION' | 'OWN_ORDER' | 'OWN_REPORT' | 'OWN_ACTION' | 'CONTACT_PARTY';
export type ModerationDecisionReason = 'POLICY_VIOLATION' | 'PROHIBITED_ITEM' | 'HARASSMENT' | 'FRAUD_RISK'
  | 'INSUFFICIENT_EVIDENCE' | 'APPEAL_ACCEPTED' | 'APPEAL_REJECTED' | 'DUPLICATE' | 'OTHER';
/** 历史处理原因：爽约属实（已停用，只用于展示历史记录） */
export type LegacyDecisionReason = 'CONFIRMED_NO_SHOW';
export const MODERATION_DECISION_REASONS: readonly ModerationDecisionReason[] = ['POLICY_VIOLATION', 'PROHIBITED_ITEM', 'HARASSMENT', 'FRAUD_RISK', 'INSUFFICIENT_EVIDENCE', 'DUPLICATE', 'OTHER'];
export interface ModerationCaseQuery { status?: ModerationCaseStatus; targetType?: ModerationTargetType; page?: number; size?: number }
export interface ModerationCaseSummary {
  id: string; targetType: ModerationTargetType; targetId: string; status: ModerationCaseStatus;
  reportCount: number; createdAt: number; updatedAt: number; assignedToMe: boolean; assigned: boolean;
  resolutionCode: ModerationActionCode | HistoricalActionCode | null;
}
export interface ModerationCasePage { items: ModerationCaseSummary[]; total: number; page: number; size: number }
/** 目标摘要：只有处理所需的最少字段，没有联系方式、账号或会话全文 */
export type ModerationTarget = { type: ModerationTargetType; exists: boolean; label: string; fields: Record<string, string | number | boolean | null> };
export interface ModerationCaseDetail extends ModerationCaseSummary {
  target: ModerationTarget;
  reports: Array<{ id: string; reasonCode: ModerationReportReason | LegacyReportReason; note: string | null; snapshot: string | null; createdAt: number }>;
  actions: Array<{ id: string; actionCode: string; reasonCode: string; note: string | null; createdAt: number; byMe: boolean; expiresAt: number | null; effective: boolean }>;
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
  /** 仍然有效：未失效且商品在售 */
  valid: boolean;
  invalidReason: 'NO_LONGER_MATCHES' | 'NOT_ON_SALE' | null;
  createdAt: number;
  product: Product;
  subscription: Omit<DemandSubscription, 'active' | 'matchCount' | 'createdAt' | 'updatedAt'>;
}

export interface DemandMatchPage { items: DemandMatch[]; total: number; page: number; pageSize: number }

/* ------------------------------ 联系申请（阶段 1） ------------------------------ */

/**
 * PENDING → APPROVED / REJECTED（卖家）/ WITHDRAWN（买家撤回）；APPROVED → REVOKED（卖家撤回同意）；
 * WITHDRAWN → PENDING（买家重新申请，同一条记录）。REJECTED、REVOKED 是终态，再次申请 409。
 */
export type ContactRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'REVOKED';
export const CONTACT_REQUEST_STATUSES: readonly ContactRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'REVOKED'];
/** received = 我作为卖家收到的；sent = 我作为买家发出的 */
export type ContactRequestRole = 'received' | 'sent';
/** 列表每页最多 50 条（后端 size 1～50，默认 20） */
export const CONTACT_REQUEST_PAGE_MAX = 50;
/** 同一用户每小时最多发起 20 次新申请（超限 429）；对同一件商品的重复请求不计数 */
export const CONTACT_REQUEST_HOURLY_LIMIT = 20;
/** 申请对象。从不包含联系方式：联系方式只出现在商品详情的 contact 字段，由服务端判断 */
export interface ContactRequest {
  id: string; productId: string; buyerId: string; sellerId: string;
  status: ContactRequestStatus; createdAt: number; updatedAt: number;
  /** 卖家同意 / 拒绝 / 撤回同意的时间；待处理与已撤回为 null */
  decidedAt: number | null;
  productTitle: string; buyerNickname: string; sellerNickname: string;
  /** 按查看者视角计算：卖家 = 未看过的待处理申请；买家 = 未看过的同意 / 拒绝 / 撤回同意 */
  unread: boolean;
}
export interface ContactRequestQuery { role?: ContactRequestRole; status?: ContactRequestStatus; page?: number; size?: number }
export interface ContactRequestPage { items: ContactRequest[]; total: number; page: number; size: number }
/** received = 卖家未读的新申请；updates = 买家未读的同意 / 拒绝 / 撤回同意 */
export interface ContactUnreadCounts { received: number; updates: number; total: number }

// ---------------- 阶段 3：账号生命周期（docs/account-lifecycle.md） ----------------
/** 后端 AccountService：新密码 8～72 位（服务端会去掉首尾空白后再计长度） */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
/** 注销确认语，必须逐字输入 */
export const ACCOUNT_DELETION_CONFIRMATION = '确认注销';
/** 重置失败的统一提示：不透露账号是否存在、码是否过期或错误次数 */
export const PASSWORD_RESET_FAILURE = '账号或重置码无效或已过期';
/** POST /v1/auth/password 的响应：当前会话保留，其他设备的会话数 */
export interface PasswordChangeResult { changed: boolean; otherSessionsEnded: number }
/** POST /v1/auth/password-reset 的请求体（只有这三个字段，未知字段 400） */
export interface PasswordResetInput { account: string; code: string; newPassword: string }
/** POST /v1/auth/me/deletion 的响应 */
export interface AccountDeletionResult { deleted: boolean; productsTakenDown: number; requestsClosed: number; membershipsEnded: number }

// ---------------- 阶段 4：图片上传与内容安全（docs/images-and-content-safety.md） ----------------
/** 单张上限 5 MB（后端 ImageService.MAX_BYTES） */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 只接受 JPEG / PNG（服务端按文件头再判断一次） */
export const IMAGE_ACCEPT = 'image/jpeg,image/png';
/** 413 的提示，与后端一致 */
export const IMAGE_TOO_LARGE = '图片不能超过 5 MB';
/** 商品里保存的上传图片引用前缀：upload:<id> */
export const UPLOAD_REF_PREFIX = 'upload:';
/** 内容安全拦截的统一提示（不提示命中了哪个词） */
export const CONTENT_BLOCKED_MESSAGE = '内容可能包含违规信息，请修改后再提交';
/** POST /v1/images 的响应：ref 写进商品的 images；url 是短时签名地址（相对路径，1 小时），只用于显示 */
export interface UploadedImage { id: string; ref: string; url: string; width: number; height: number }

/**
 * GET /v1/config（无需登录）：客户端可用的图片规则与私信是否开放文字（messages.freeTextEnabled）。旧后端没有这个接口（404）时使用 DEFAULT_CLIENT_CONFIG。
 * externalAllowed=false 时后端拒绝新的外部 http(s) 图片地址（400）；编辑已有商品时原有的外部图片可以保留。
 */
export interface ImageConfig { maxCount: number; maxBytes: number; accept: string[]; externalAllowed: boolean }
/** 私信：freeTextEnabled=false 时只能发送预设的快捷消息（旧后端没有这个字段：按 false 处理） */
export interface MessagesConfig { freeTextEnabled: boolean }
export interface ClientConfig { images: ImageConfig; messages: MessagesConfig }
export const DEFAULT_CLIENT_CONFIG: ClientConfig = Object.freeze({
  images: Object.freeze({ maxCount: 9, maxBytes: IMAGE_MAX_BYTES, accept: ['image/jpeg', 'image/png'], externalAllowed: true }),
  messages: Object.freeze({ freeTextEnabled: false }),
}) as ClientConfig;
/** 服务端返回的配置逐项校验：缺失或类型不对的字段回落到默认值（不信任半截响应） */
export function normalizeClientConfig(raw: unknown): ClientConfig {
  const fallback = DEFAULT_CLIENT_CONFIG.images;
  const images = (raw && typeof raw === 'object' ? (raw as { images?: unknown }).images : undefined) as Partial<Record<keyof ImageConfig, unknown>> | undefined;
  const messages = (raw && typeof raw === 'object' ? (raw as { messages?: unknown }).messages : undefined) as Partial<Record<keyof MessagesConfig, unknown>> | null | undefined;
  const positiveInt = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : d);
  const accept = Array.isArray(images?.accept) && images!.accept.length > 0 && images!.accept.every((t) => typeof t === 'string' && t.startsWith('image/'))
    ? [...images!.accept as string[]] : [...fallback.accept];
  return {
    images: {
      maxCount: positiveInt(images?.maxCount, fallback.maxCount),
      maxBytes: positiveInt(images?.maxBytes, fallback.maxBytes),
      accept,
      externalAllowed: typeof images?.externalAllowed === 'boolean' ? images.externalAllowed : fallback.externalAllowed,
    },
    // 只有明确的 true 才开放文字私信：缺失、null 或类型不对一律按 false（宁可少一个输入框，也不提供一定会被拒绝的输入）
    messages: { freeTextEnabled: messages != null && typeof messages === 'object' && messages.freeTextEnabled === true },
  };
}

/* ------------------------------ 私信快捷消息 ------------------------------ */

/** BUYER_* 只能由会话的买家发送，SELLER_* 只能由卖家发送，ANY_* 双方都可以 */
export type MessageTemplateRole = 'BUYER' | 'SELLER' | 'ANY';
export interface MessageTemplate { code: string; text: string; role: MessageTemplateRole }
/** GET /v1/message-templates（需登录）：按服务端给出的顺序展示 */
export interface MessageTemplateList { freeTextEnabled: boolean; templates: MessageTemplate[] }
/** POST /v1/conversations/{id}/messages 的请求体：快捷消息与文字只能二选一（文字只在 freeTextEnabled=true 时可用） */
export type SendMessageInput = { templateCode: string } | { content: string };
/** 当前用户在这个会话里能发送的快捷消息：买家看 BUYER + ANY，卖家看 SELLER + ANY；顺序不变 */
export function templatesForRole(templates: readonly MessageTemplate[], role: 'BUYER' | 'SELLER'): MessageTemplate[] {
  return templates.filter((t) => t.role === role || t.role === 'ANY');
}

export interface CampusMarketApi {
  /** 客户端配置（图片张数、大小、类型与是否允许外部图片）；旧后端 404 时返回默认值 */
  getClientConfig(): Promise<ClientConfig>;
  /** 本人对该商品的申请，尚未申请时为 null */
  getContactRequest(productId: string): Promise<ContactRequest | null>;
  /** 新建、幂等返回（PENDING / APPROVED）或撤回后重新申请；请求体为空 */
  requestContact(productId: string): Promise<ContactRequest>;
  /** 分页列表：role 默认 received，按最近变化倒序 */
  listContactRequests(query?: ContactRequestQuery): Promise<ContactRequestPage>;
  getContactRequestUnreadCount(): Promise<ContactUnreadCounts>;
  /** 把该角色的未读标记为已读，返回新的未读数 */
  markContactRequestsRead(role: ContactRequestRole): Promise<ContactUnreadCounts>;
  /** 卖家：同意或拒绝（同一结论重复提交幂等） */
  decideContactRequest(id: string, status: 'APPROVED' | 'REJECTED'): Promise<ContactRequest>;
  /** 买家：撤回还没有处理的申请（重复撤回幂等） */
  withdrawContactRequest(id: string): Promise<ContactRequest>;
  /** 卖家：撤回已经给出的同意，买家立即看不到联系方式（重复撤回幂等） */
  revokeContactRequest(id: string): Promise<ContactRequest>;
  getUser(id: string): Promise<import('../types').PublicUser>;
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
  /** 修改密码：核对当前密码；成功后其他设备上的会话全部结束，当前会话保留 */
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<PasswordChangeResult>;
  /** 凭学校工作人员签发的一次性重置码设新密码（不需要登录）；成功后全部会话结束；失败一律同一句话 */
  resetPasswordWithCode(input: PasswordResetInput): Promise<{ reset: boolean }>;
  /** 注销：需要密码与确认语「确认注销」；仍有后台权限或仍是在用圈子的所有者时 409 */
  deleteAccount(input: { password: string; confirmation: string }): Promise<AccountDeletionResult>;
  /** 上传一张商品图片（multipart 字段 file）；返回的 ref 写进商品 images */
  uploadImage(file: File): Promise<UploadedImage>;
  listProducts(query: ProductQuery): Promise<ProductPage>;
  /** 楼栋集市 feed：范围自动降级与最近排序。旧的 listProducts 保持原样。 */
  feedProducts(query: FeedQuery): Promise<FeedPage>;
  /** 某分类的当前验货模板；不支持的分类返回 null。 */
  getInspectionTemplate(category: Category): Promise<InspectionTemplate | null>;
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
  listComments(productId: string): Promise<Comment[]>;
  addComment(input: CommentInput): Promise<Comment>;
  listConversations(): Promise<Conversation[]>;
  getOrCreateConversation(productId: string): Promise<Conversation>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  /** 快捷消息（需登录）：服务端决定是否开放文字私信与可用的模板 */
  listMessageTemplates(): Promise<MessageTemplateList>;
  /** 请求体只带 templateCode 或 content 其中一个 */
  sendMessage(conversationId: string, input: SendMessageInput): Promise<ChatMessage>;
  getUnreadCount(): Promise<number>;
  // ---- 可信治理（模块 7）：均需登录 ----
  createModerationReport(input: ModerationReportInput): Promise<MyModerationReport>;
  listMyModerationReports(): Promise<MyModerationReport[]>;
  getMyGovernance(): Promise<MyGovernance>;
  submitAppeal(input: AppealInput): Promise<MyAppealSummary>;
  /** 是否为本校平台工作人员：每次都由服务端从数据库读取 */
  getStaffStatus(): Promise<StaffStatus>;
  // ---- 工作人员（只处理本校；非工作人员 403） ----
  listModerationCases(query: ModerationCaseQuery): Promise<ModerationCasePage>;
  getModerationCase(id: string): Promise<ModerationCaseDetail>;
  /** 只能对现有内容立案；订单与爽约复核是只读历史 */
  openModerationCase(input: { targetType: ReportableTargetType; targetId: string }): Promise<ModerationCaseDetail>;
  claimModerationCase(id: string): Promise<ModerationCaseDetail>;
  decideModerationCase(id: string, input: ModerationDecisionInput): Promise<ModerationCaseDetail>;
  listModerationAppeals(query: { status?: 'PENDING' | 'ACCEPTED' | 'REJECTED'; page?: number; size?: number }): Promise<StaffAppealPage>;
  decideModerationAppeal(id: string, input: AppealDecisionInput): Promise<StaffAppeal>;
}
