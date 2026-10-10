import { seedCourseTextbooks, seedCourses, seedEditions, seedOfferings } from '../data/courseCatalog';
import type { CanonicalOrderStatus } from './contracts';
import type { MarketState, Order, User } from '../types';
import { isTerminalStatus, statusLabel } from './mapper';
import { seedBuildings, type MockBuilding } from '../data/buildings';

/**
 * Mock 演示数据的持久化结构与版本迁移（0.9E）。
 *
 * <p>Mock 数据写在 localStorage，会跨版本存活：用户上周留下的数据，这周用新代码读。
 * 改造前这份负载没有版本号，新增字段只能靠读取时四处兜底；`canonicalStatus` 缺失的
 * 旧订单每次读都要重新猜一次，猜的结果也从不落盘，状态机因此在旧数据上行为漂移。
 *
 * <p>现在负载带 `schemaVersion`，迁移在<b>装载时一次性</b>完成并落盘，
 * 业务代码只面对当前版本的形状。
 */

/** 当前 schema 版本。每次改变持久化形状都要 +1 并补一条迁移。 */
export const MOCK_SCHEMA_VERSION = 12;

/** 需求订阅（v4 起）。字段与后端 demand_subscriptions 一一对应。 */
export interface MockDemandSubscription {
  id: string;
  userId: string;
  schoolId: string;
  keyword: string | null;
  normalizedKeyword: string | null;
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  geoScope: 'BUILDING' | 'ZONE' | 'CAMPUS' | 'SCHOOL';
  campusId: string | null;
  buildingId: string | null;
  /** 规范化条件的规范串，仅用于幂等，不对外返回 */
  fingerprint: string;
  /** 模块 4：精确教材版本订阅（v6 起）；普通订阅为 null 或缺省 */
  textbookEditionId?: string | null;
  /** 模块 6：圈子范围订阅（v9 起）；普通订阅为 null */
  circleId?: string | null;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 需求匹配（v4 起），即通知本身。字段与后端 demand_matches 一一对应。 */
export interface MockDemandMatch {
  id: string;
  subscriptionId: string;
  productId: string;
  score: number;
  reasonCodes: string[];
  readAt: number | null;
  dismissedAt: number | null;
  invalidatedAt: number | null;
  createdAt: number;
}

/** 商品当前的验货声明（v5 起）。 */
export interface MockDisclosure {
  templateId: string;
  items: Array<{ code: string; condition: 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE'; note: string }>;
}

/** 订单验货快照（v5 起）。下单时复制，之后与商品声明脱钩。 */
export interface MockOrderInspection {
  status: 'NOT_PROVIDED' | 'PENDING' | 'SUBMITTED' | 'NEEDS_RESOLUTION';
  templateId: string | null;
  templateTitle: string | null;
  templateVersion: number | null;
  hasMismatch: boolean;
  submittedAt: number | null;
  submittedBy: string | null;
  items: Array<{
    code: string; label: string; description: string; required: boolean;
    sellerCondition: 'NORMAL' | 'DEFECT' | 'NOT_TESTED' | 'NOT_APPLICABLE' | null; sellerNote: string;
    buyerResult: 'MATCH' | 'MISMATCH' | 'NOT_CHECKABLE' | null; buyerNote: string; checkedAt: number | null;
  }>;
}

export interface MockMeetingProposal {
  id: string; orderId: string; proposerId: string; meetingPointId: string;
  startsAt: number; endsAt: number; note: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'SUPERSEDED';
  revision: number | null; createdAt: number; respondedAt: number | null; respondedBy: string | null;
}

export interface MockPresence {
  orderId: string; userId: string; revision: number;
  status: 'NOT_STARTED' | 'DEPARTED' | 'ARRIVED';
  departedAt: number | null; arrivedAt: number | null;
}

/** 时间线事件：订单状态事件与流程事件统一记录，只有机器码。 */
export interface MockFlowEvent { seq: number; orderId: string; actorId: string | null; code: string; revision: number | null; at: number }

/** 商品 ↔ 教材版本（v6 起），与后端 product_textbook_details 一一对应。 */
export interface MockProductTextbook {
  schoolId: string; textbookEditionId: string;
  isbnSnapshot: string | null; titleSnapshot: string; editionSnapshot: string; publisherSnapshot: string;
  createdAt: number; updatedAt: number;
}

/** 教材建议（v6 起）。只有 PENDING / WITHDRAWN，不存在任何「已认证」状态。 */
export interface MockTextbookSuggestion {
  id: string; submitterId: string; schoolId: string; courseOfferingId: string;
  textbookEditionId: string | null; isbn13: string | null; title: string | null; authors: string | null;
  publisher: string | null; editionLabel: string | null; publishedYear: number | null;
  usageType: 'REQUIRED' | 'RECOMMENDED' | 'REFERENCE'; note: string | null;
  status: 'PENDING' | 'WITHDRAWN'; fingerprint: string; createdAt: number; withdrawnAt: number | null;
}

/** 服务端发布草稿（v7 起），与后端 listing_drafts 一一对应。 */
export interface MockListingDraft {
  id: string; ownerId: string; editorId: string; draftType: 'SINGLE' | 'BUNDLE';
  payload: import('./contracts').ListingPayload; version: number;
  status: import('./contracts').DraftStatus; expiresAt: number; publishedProductId: string | null;
  createdAt: number; updatedAt: number;
}
/** 批量发布批次（v7 起）。条目的 active 与后端部分唯一索引同义：一个草稿只能在一个未发布批次里。 */
export interface MockListingBatch {
  id: string; ownerId: string; status: import('./contracts').BatchStatus; version: number;
  items: Array<{ draftId: string; position: number; active: boolean; productId: string | null }>;
  createdAt: number; updatedAt: number; publishedAt: number | null;
}
/** 批量发布幂等记录（v7 起）。 */
export interface MockPublishRequest { ownerId: string; key: string; requestHash: string; batchId: string; productIds: string[] }
/** 协助整理发布的邀请（v7 起）。只保存邀请码的 SHA-256；原始邀请码从不写入 localStorage。 */
export interface MockAssistInvite {
  id: string; ownerId: string; draftId: string | null; batchId: string | null; tokenHash: string;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED'; assistantId: string | null;
  expiresAt: number; createdAt: number; redeemedAt: number | null; revokedAt: number | null;
}
/** 协助审计事件（v7 起）：只有机器码与时间。 */
export interface MockAssistEvent { seq: number; inviteId: string; actorId: string; code: import('./contracts').AssistEventCode; draftId: string | null; at: number }
/** 商品的发布人 / 协助人（v7 起），与后端 products.published_by / assisted_by 对应。 */
export interface MockProductAttribution { publishedBy: string | null; assistedBy: string | null }

/** 圈子（v9 起），与后端 circles 一一对应。没有「官方认证」字段：所有圈子都是用户创建的。 */
export interface MockCircle {
  id: string; schoolId: string; type: import('./contracts').CircleType; name: string; description: string;
  visibility: import('./contracts').CircleVisibility; ownerId: string; status: 'ACTIVE' | 'ARCHIVED';
  createdAt: number; updatedAt: number; archivedAt: number | null;
}
export interface MockCircleMembership {
  circleId: string; userId: string; role: import('./contracts').CircleRole; status: 'ACTIVE' | 'LEFT' | 'REMOVED';
  joinedAt: number; updatedAt: number; endedAt: number | null;
}
/** 圈子邀请（v9 起）：只保存邀请码的 SHA-256，原始邀请码从不写入 localStorage。 */
export interface MockCircleInvite {
  id: string; circleId: string; createdBy: string; tokenHash: string; status: 'PENDING' | 'REDEEMED' | 'REVOKED';
  redeemedBy: string | null; expiresAt: number; createdAt: number; redeemedAt: number | null; revokedAt: number | null;
}
export interface MockCircleEvent { seq: number; circleId: string; actorId: string; targetId: string | null; code: string; detail: string | null; at: number }

/* ---------------- v10：交易承诺与可信治理（模块 7） ---------------- */
/** 订单取消记录：一张订单至多一条；阶段由 Mock 按与后端相同的规则判定 */
export interface MockCancellation {
  orderId: string; schoolId: string; actorId: string; phase: import('./contracts').CancellationPhase;
  reasonCode: import('./contracts').CancellationReason | null; note: string | null; createdAt: number;
}
export interface MockNoShowReport {
  id: string; orderId: string; meetingRevision: number; schoolId: string; reporterId: string; reportedId: string;
  status: import('./contracts').NoShowStatus; reasonCode: import('./contracts').NoShowReason; note: string | null;
  responseNote: string | null; createdAt: number; respondedAt: number | null; decidedAt: number | null;
  decidedBy: string | null; confirmedAt: number | null;
}
/** 平台工作人员：默认没有任何记录；只能通过演示模式的显式切换或测试夹具产生 */
export interface MockStaffMember { userId: string; schoolId: string; role: import('./contracts').StaffRole; active: boolean; createdAt: number }
export interface MockModerationCase {
  id: string; schoolId: string; targetType: import('./contracts').ModerationTargetType; targetId: string;
  status: import('./contracts').ModerationCaseStatus; assignedStaffId: string | null;
  resolutionCode: import('./contracts').ModerationActionCode | null; reportCount: number;
  createdAt: number; updatedAt: number; resolvedAt: number | null; noShowReportId: string | null;
}
export interface MockModerationReport {
  id: string; schoolId: string; caseId: string; reporterId: string; targetType: import('./contracts').ModerationTargetType;
  targetId: string; reasonCode: import('./contracts').ModerationReportReason; note: string | null; snapshot: string | null; createdAt: number;
}
/** 治理动作：只增不改 */
export interface MockModerationAction {
  id: string; schoolId: string; caseId: string | null; appealId: string | null; staffId: string; actionCode: string;
  reasonCode: string; note: string | null; targetType: string; targetId: string; restrictionId: string | null;
  expiresAt: number | null; effective: boolean; createdAt: number;
  /** v11：动作涉及的用户（被处理内容的作者 / 被确认爽约的人 / 被限制的人），用于「我的限制」 */
  subjectId?: string | null;
}
export interface MockModerationAppeal {
  id: string; schoolId: string; userId: string; restrictionId: string | null; actionId: string | null; caseId: string | null;
  reason: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; decidedBy: string | null; decidedAt: number | null; createdAt: number;
}
export interface MockUserRestriction {
  id: string; userId: string; schoolId: string; scope: import('./contracts').RestrictionScope; source: import('./contracts').RestrictionSource;
  caseId: string | null; noShowReportId: string | null; createdBy: string | null; reasonCode: string;
  startsAt: number; endsAt: number; createdAt: number; revokedAt: number | null; revokedBy: string | null;
  revokeReason: 'APPEAL_ACCEPTED' | 'STAFF_CORRECTION' | 'RULE_RECOMPUTED' | null;
  /** v11：规则版本（仅 SYSTEM_RULE）、决定时间、依据的确认记录（决定时刻的快照）、最近一次纠正 */
  ruleVersion: string | null; decidedAt: number;
  basis: Array<{ reportId: string; confirmedAt: number }>;
  lastCorrectionId: string | null;
}

/* ---------------- v11：治理规则收口（模块 7.1） ---------------- */
/** 接受时冻结的档期快照：revision 0 = 卖家接受原始预约；revision N = 第 N 次被接受的改约 */
export interface MockSlotAgreement {
  orderId: string; revision: number; meetingPointId: string; startsAt: number; endsAt: number;
  source: 'SELLER_ACCEPTED_BOOKING' | 'PROPOSAL_ACCEPTED' | 'LEGACY_ACCEPTED_PROPOSAL'; agreedAt: number;
}
/** 自动限制的纠正记录：只增不改；只减轻或撤销 */
export interface MockRestrictionCorrection {
  id: string; restrictionId: string; schoolId: string; causeReportId: string; appealId: string | null; decidedBy: string | null;
  outcome: 'SHORTENED' | 'REVOKED'; ruleVersion: string; remainingCount: number; previousEndsAt: number; newEndsAt: number; createdAt: number;
}

/** 课程教材目录（v6 起）。迁移时植入演示目录（参考数据，不是用户数据）。 */
export interface MockCatalog {
  courses: import('../data/courseCatalog').MockCourse[];
  offerings: import('../data/courseCatalog').MockOffering[];
  editions: import('../data/courseCatalog').MockEdition[];
  courseTextbooks: import('../data/courseCatalog').MockCourseTextbook[];
}

export interface MockDatabase {
  contactRequests?: import('./contracts').ContactRequest[];
  schemaVersion: number;
  /** v10：校区 → 学校（6.1A 学校隔离；多校演示与测试可以登记新的校区） */
  campusSchools: Record<string, string>;
  /** v11：档期快照与自动限制纠正 */
  slotAgreements: MockSlotAgreement[];
  restrictionCorrections: MockRestrictionCorrection[];
  /** v10：交易承诺与可信治理 */
  cancellationRecords: MockCancellation[];
  noShowReports: MockNoShowReport[];
  staffMembers: MockStaffMember[];
  moderationReports: MockModerationReport[];
  moderationCases: MockModerationCase[];
  moderationActions: MockModerationAction[];
  moderationAppeals: MockModerationAppeal[];
  userRestrictions: MockUserRestriction[];
  /** v9：圈子集市 */
  circles: MockCircle[];
  circleMemberships: MockCircleMembership[];
  circleInvites: MockCircleInvite[];
  circleEvents: MockCircleEvent[];
  circleSeq: number;
  /** v9：商品 id → 可见的圈子 id（只有 CIRCLE_ONLY 商品才有） */
  productCircleVisibility: Record<string, string[]>;
  /** v7：发布草稿 / 批次 / 幂等记录 / 协助邀请与事件 / 打包明细 / 发布人与协助人 */
  listingDrafts: MockListingDraft[];
  listingBatches: MockListingBatch[];
  listingPublishRequests: MockPublishRequest[];
  listingAssistInvites: MockAssistInvite[];
  listingAssistEvents: MockAssistEvent[];
  assistSeq: number;
  bundleItems: Record<string, import('./contracts').BundleItem[]>;
  productAttribution: Record<string, MockProductAttribution>;
  /** v6：课程教材目录（演示） */
  catalog: MockCatalog;
  /** v6：商品 id → 关联的教材版本快照 */
  productTextbooks: Record<string, MockProductTextbook>;
  /** v6：本人的教材建议 */
  textbookSuggestions: MockTextbookSuggestion[];
  productDisclosures: Record<string, MockDisclosure>;
  orderInspections: Record<string, MockOrderInspection>;
  meetingProposals: MockMeetingProposal[];
  presence: MockPresence[];
  flowEvents: MockFlowEvent[];
  flowSeq: number;
  /** 已停用的面交点 id。停用而非删除：历史订单仍引用它们 */
  inactiveMeetingPoints: string[];
  users: User[];
  /** 楼栋参考数据（v3 起）。与后端 V3/V4 迁移的种子逐条一致。 */
  buildings: MockBuilding[];
  demandSubscriptions: MockDemandSubscription[];
  demandMatches: MockDemandMatch[];
  market: MarketState;
  idempotency: Record<string, Order>;
  /** 演示用登录态，与真实 Access Token 无关（后者纯内存，见 0.9A）。 */
  currentUserId?: string | null;
}

export interface MigrationResult {
  db: MockDatabase;
  /** 读到的版本号；负载无法识别时为 null。 */
  fromVersion: number | null;
  /** 实际执行的迁移步骤，便于在报告与日志中核对。 */
  applied: string[];
  /** 「交易中」无证据可依、已保守落到 PENDING_MEETING 的订单。 */
  ambiguousOrderIds: string[];
  /** 被隔离跳过的损坏记录数量。只记数量与位置，不记内容。 */
  skippedRecords: number;
  /** 负载损坏或形状不可识别，已回退到种子数据。 */
  discarded: boolean;
  /**
   * 是否允许写回 localStorage。
   * 读到<b>更高</b>版本时为 false：那是更新版应用写的数据，
   * 用旧代码覆盖它等于毁掉用户数据，宁可本次会话只在内存里跑。
   */
  persistable: boolean;
}

/** 中文文案 → canonical。「交易中」对应 4 个 canonical 值，必然有歧义。 */
const AMBIGUOUS_LABEL = '交易中';

/**
 * 旧负载里可能出现、但当前 Order 类型已不再声明的时间戳字段。
 * 迁移时用它们当作事件证据，而不是凭中文文案硬猜。
 */
interface LegacyOrderEvidence {
  completedAt?: unknown;
  completedAtIso?: unknown;
  cancelledAt?: unknown;
  cancelledAtIso?: unknown;
  expiredAt?: unknown;
  expiredAtIso?: unknown;
  buyerConfirmedAt?: unknown;
  buyerConfirmedAtIso?: unknown;
  sellerConfirmedAt?: unknown;
  sellerConfirmedAtIso?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeDatabase(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Array.isArray(value.users) && isRecord(value.market) && Array.isArray(value.market.products);
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== 0;
}

/**
 * 从旧数据的事件痕迹推断「交易中」到底是哪个 canonical 状态。
 *
 * <p>返回 null 表示没有任何可依据的证据。调用方此时必须走保守分支，
 * <b>不得</b>把它当成 BUYER_CONFIRMED——那会跳过买家确认这一步，
 * 让卖家直接可以完成交易。宁可让用户多点一次确认，也不能替他确认。
 *
 * <p>注意：当前 {@link Order} 类型并不记录买家/卖家确认时刻，
 * 因此实际数据里绝大多数「交易中」都会走保守分支。这里的判据是为
 * 手工构造或更早版本可能残留的字段准备的，不是常态路径。
 */
function inferFromEvidence(order: Order & LegacyOrderEvidence): CanonicalOrderStatus | null {
  if (present(order.completedAt) || present(order.completedAtIso)) return 'COMPLETED';
  if (present(order.cancelledAt) || present(order.cancelledAtIso)) return 'CANCELLED';
  if (present(order.expiredAt) || present(order.expiredAtIso)) return 'EXPIRED';
  if (present(order.buyerConfirmedAt) || present(order.buyerConfirmedAtIso)) return 'BUYER_CONFIRMED';
  // 只有卖家确认或面交信息：交易停在等待面交这一步
  if (present(order.sellerConfirmedAt) || present(order.sellerConfirmedAtIso)) return 'PENDING_MEETING';
  if (present(order.meetingAtIso) || present(order.meetingPointId)) return 'PENDING_MEETING';
  return null;
}

/** 一条订单迁移失败时抛出，用于把损坏记录单独隔离。 */
class RecordMigrationError extends Error {}

function migrateOrder(order: Order, ambiguous: string[]): void {
  if (typeof order?.id !== 'string' || !order.id) {
    throw new RecordMigrationError('订单缺少 id');
  }
  if (order.canonicalStatus) {
    // 已有 canonical 值的订单是真值来源，迁移不得覆盖
    order.status = statusLabel(order.canonicalStatus);
    return;
  }
  let canonical: CanonicalOrderStatus;
  switch (order.status) {
    case '已完成': canonical = 'COMPLETED'; break;
    case '已取消': canonical = 'CANCELLED'; break;
    case AMBIGUOUS_LABEL: {
      const inferred = inferFromEvidence(order);
      if (inferred) {
        canonical = inferred;
      } else {
        // 无任何证据：退到状态机上最靠前、权限最小、用户仍可继续推进的那个状态
        canonical = 'PENDING_MEETING';
        order.legacyStatusAmbiguous = true;
        ambiguous.push(order.id);
      }
      break;
    }
    case '待确认': canonical = 'PENDING_SELLER_CONFIRM'; break;
    default: throw new RecordMigrationError('订单状态文案无法识别');
  }
  order.canonicalStatus = canonical;
  order.status = statusLabel(canonical);
}

/**
 * v1 → v2：把订单的 canonical status 固化下来，并按订单重算商品状态。
 *
 * <p>逐条迁移：单条损坏只隔离这一条，不牵连整份数据，更不会清空 localStorage。
 */
function migrateV1ToV2(db: MockDatabase, ambiguous: string[]): number {
  const survivors: Order[] = [];
  let skipped = 0;
  for (const order of db.market.orders) {
    try {
      migrateOrder(order, ambiguous);
      survivors.push(order);
    } catch {
      // 只记数量，不记订单内容——里面有联系方式和成交信息
      skipped += 1;
    }
  }
  db.market.orders = survivors;
  recalibrateProductStatus(db);
  return skipped;
}

/**
 * 按订单重算商品状态。
 *
 * <p>旧数据里商品状态和订单状态各记各的，容易对不上（订单已取消、商品还挂着「预约中」，
 * 于是商品既卖不掉也下不了单）。这里以订单为准重算，但<b>不</b>碰「已下架」——
 * 那是卖家的显式决定，不是算出来的；也绝不凭模糊订单把商品判成「已售出」。
 */
function recalibrateProductStatus(db: MockDatabase): void {
  const orders = db.market.orders;
  for (const product of db.market.products) {
    if (product.status === '已下架') continue;
    const related = orders.filter((o) => o.productId === product.id);
    const completed = related.find((o) => o.canonicalStatus === 'COMPLETED');
    if (completed) {
      product.status = '已售出';
      if (!product.soldAt) product.soldAt = completed.updatedAt;
      continue;
    }
    const active = related.some((o) => !isTerminalStatus(o.canonicalStatus ?? 'PENDING_SELLER_CONFIRM'));
    product.status = active ? '预约中' : '在售';
    // 终态订单对应的商品不得被错误地留在「已售出」上
    if (!active) product.soldAt = undefined;
  }
}

/**
 * v2 → v3：引入楼栋参考数据。
 *
 * <p>只<b>加入</b>楼栋目录，绝不推断任何关联：
 * 老用户的宿舍楼保持未填写，老商品的取货楼栋保持未指定。
 * 「猜一个最近的楼栋」听起来贴心，实际是在公开一条用户从未同意公开的信息。
 */
function migrateV2ToV3(db: MockDatabase): number {
  db.buildings = seedBuildings.map((building) => ({ ...building }));
  for (const user of db.users) {
    if (user.dormBuildingId === undefined) user.dormBuildingId = null;
  }
  for (const product of db.market.products) {
    if (product.buildingId === undefined) product.buildingId = null;
  }
  return 0;
}

/**
 * v3 → v4：需求雷达。
 *
 * <p>楼栋补上 active / sortOrder（与后端 V4 一致，并加入那一栋停用的演示楼）；
 * 订阅与匹配补为空数组。<b>不伪造任何历史订阅或匹配</b>——
 * 用户从未订阅过的东西，不应在升级后凭空出现在收件箱里。
 */
function migrateV3ToV4(db: MockDatabase): number {
  const seedById = new Map(seedBuildings.map((b) => [b.id, b]));
  db.buildings = (db.buildings ?? []).map((building) => {
    const seed = seedById.get(building.id);
    return {
      ...building,
      active: typeof building.active === 'boolean' ? building.active : seed?.active ?? true,
      sortOrder: typeof building.sortOrder === 'number' ? building.sortOrder : seed?.sortOrder ?? 0,
    };
  });
  for (const seed of seedBuildings) {
    if (!db.buildings.some((b) => b.id === seed.id)) db.buildings.push({ ...seed });
  }
  db.demandSubscriptions ??= [];
  db.demandMatches ??= [];
  return 0;
}

/**
 * v4 → v5：可信面交闭环。
 *
 * <p>只补齐空结构。<b>不</b>把任何旧商品标成「全部正常」，
 * <b>不</b>给任何旧订单补写验货、档期或到达记录——没有就是没有。
 * 旧订单的当前协议就是下单时的原始预约（版本 0）。
 */
function migrateV4ToV5(db: MockDatabase): number {
  db.productDisclosures ??= {};
  db.orderInspections ??= {};
  db.meetingProposals ??= [];
  db.presence ??= [];
  db.flowEvents ??= [];
  db.flowSeq ??= 0;
  db.inactiveMeetingPoints ??= [];
  for (const order of db.market.orders) {
    if (!order || typeof order !== 'object') continue;
    if (order.meetingRevision === undefined) order.meetingRevision = 0;
    if (order.codeAttempts === undefined) order.codeAttempts = 0;
  }
  return 0;
}

/**
 * v5 结构的逐条容错：单条损坏的提议 / 到达 / 事件 / 快照只丢弃该条，不拖垮整库。
 * 每次装载都执行（包括已是 v5 的数据），返回丢弃条数。
 */
function sanitizeTrustedFlow(db: MockDatabase): number {
  let skipped = 0;
  const keep = <T>(list: unknown, valid: (x: Record<string, unknown>) => boolean): T[] => {
    if (!Array.isArray(list)) return [];
    const kept = list.filter((x) => isRecord(x) && valid(x));
    skipped += list.length - kept.length;
    return kept as T[];
  };
  db.meetingProposals = keep(db.meetingProposals, (p) => typeof p.id === 'string' && typeof p.orderId === 'string');
  db.presence = keep(db.presence, (p) => typeof p.orderId === 'string' && typeof p.userId === 'string');
  db.flowEvents = keep(db.flowEvents, (e) => typeof e.orderId === 'string' && typeof e.code === 'string' && typeof e.seq === 'number');
  for (const bag of ['productDisclosures', 'orderInspections'] as const) {
    const source: unknown = db[bag];
    const cleaned: Record<string, unknown> = {};
    if (isRecord(source)) {
      for (const [key, value] of Object.entries(source)) {
        if (isRecord(value) && Array.isArray(value.items)) cleaned[key] = value;
        else skipped += 1;
      }
    }
    (db as unknown as Record<string, unknown>)[bag] = cleaned;
  }
  if (!Array.isArray(db.inactiveMeetingPoints)) db.inactiveMeetingPoints = [];
  if (typeof db.flowSeq !== 'number') db.flowSeq = 0;
  db.flowSeq = Math.max(db.flowSeq, ...db.flowEvents.map((e) => e.seq));
  return skipped;
}

/**
 * v5 → v6：课程教材图谱。
 *
 * <p>植入演示目录（虚构的参考数据，明确标记 isDemo）；商品关联与教材建议为空。
 * <b>不</b>替任何旧商品猜教材版本，<b>不</b>生成选课、订阅或建议记录；旧订阅保持原样（没有教材版本）。
 */
function migrateV5ToV6(db: MockDatabase): number {
  db.catalog ??= freshCatalog();
  db.productTextbooks ??= {};
  db.textbookSuggestions ??= [];
  return 0;
}

/**
 * 4.8：V6 植入的 5 条演示教材曾使用 979-0（乐谱号 ISMN）号段。与后端 V7 相同，只修正
 * 「id + 演示标记 + 学校 + 原号码 + 书名 + 版次」逐项精确匹配的行；被改过的行与任何用户数据都不动。
 */
const DEMO_ISMN_FIXES: ReadonlyArray<{ id: string; oldIsbn: string; title: string; editionLabel: string }> = [
  { id: 'demo-calculus-7', oldIsbn: '9790000001015', title: '微积分教程（演示）', editionLabel: '第 7 版' },
  { id: 'demo-calculus-8', oldIsbn: '9790000001022', title: '微积分教程（演示）', editionLabel: '第 8 版' },
  { id: 'demo-linear-algebra-3', oldIsbn: '9790000002012', title: '线性代数导论（演示）', editionLabel: '第 3 版' },
  { id: 'demo-physics-5', oldIsbn: '9790000003019', title: '大学物理（演示）· 上册', editionLabel: '第 5 版' },
  { id: 'demo-programming-2', oldIsbn: '9790000004016', title: '程序设计基础（演示）', editionLabel: '第 2 版' },
];

/**
 * v6 → v7：毕业季通用供给引擎 + 4.8 演示教材标识修正。
 *
 * <p>只补空结构：没有草稿、批次、邀请或协助关系被伪造；旧商品一律是单件（SINGLE），发布人 / 协助人为空；
 * 旧订单没有可信的成交价快照，显式记为 null，<b>不</b>从订单价格或商品标价猜。
 */
function migrateV6ToV7(db: MockDatabase): number {
  db.listingDrafts ??= [];
  db.listingBatches ??= [];
  db.listingPublishRequests ??= [];
  db.listingAssistInvites ??= [];
  db.listingAssistEvents ??= [];
  db.assistSeq ??= 0;
  db.bundleItems ??= {};
  db.productAttribution ??= {};
  for (const product of db.market.products) {
    if (product && typeof product === 'object' && product.listingKind === undefined) product.listingKind = 'SINGLE';
  }
  for (const order of db.market.orders) {
    if (order && typeof order === 'object') {
      if (order.priceSnapshot === undefined) order.priceSnapshot = null;
      if (order.currency === undefined) order.currency = null;
    }
  }
  const fixed = new Set<string>();
  const editions: unknown = db.catalog?.editions;
  if (Array.isArray(editions)) {
    for (const e of editions) {
      const fix = DEMO_ISMN_FIXES.find((f) => f.id === e?.id);
      const seed = seedEditions.find((x) => x.id === fix?.id);
      if (!fix || !seed || !isRecord(e)) continue;
      if (e.isDemo === true && e.schoolId === 'pilot' && e.normalizedIsbn === fix.oldIsbn && e.isbn13 === fix.oldIsbn
          && (e.isbn10 === undefined || e.isbn10 === null) && e.title === fix.title && e.editionLabel === fix.editionLabel) {
        e.isbn13 = null;
        e.normalizedIsbn = null;
        e.noIsbnFingerprint = seed.noIsbnFingerprint;
        fixed.add(fix.id);
      }
    }
  }
  if (isRecord(db.productTextbooks)) {
    const oldIsbns = new Set(DEMO_ISMN_FIXES.map((f) => f.oldIsbn));
    for (const link of Object.values(db.productTextbooks)) {
      if (isRecord(link) && fixed.has(String(link.textbookEditionId)) && oldIsbns.has(String(link.isbnSnapshot))) link.isbnSnapshot = null;
    }
  }
  return 0;
}

/**
 * v7 → v8（5.7）：订单增加冻结的统计维度。旧订单一律显式记为 null——不从商品当前的分类、成色、校区或教材关联回填，
 * 快照不完整的订单不进入价格参考。
 */
function migrateV7ToV8(db: MockDatabase): number {
  for (const order of db.market.orders) {
    if (!order || typeof order !== 'object') continue;
    for (const key of ['schoolIdSnapshot', 'categorySnapshot', 'conditionSnapshot', 'listingKindSnapshot', 'textbookEditionIdSnapshot'] as const) {
      if (order[key] === undefined) order[key] = null;
    }
  }
  return 0;
}

/**
 * v8 → v9（模块 6）：圈子集市。旧商品一律 PUBLIC、没有任何圈子关系；不创建任何圈子、不替任何人加入圈子、
 * 不自动创建宿舍圈；旧订阅不绑定圈子；旧订单的可见性快照显式为 null（不回填）。
 */
function migrateV8ToV9(db: MockDatabase): number {
  db.circles ??= [];
  db.circleMemberships ??= [];
  db.circleInvites ??= [];
  db.circleEvents ??= [];
  db.circleSeq ??= 0;
  db.productCircleVisibility ??= {};
  for (const product of db.market.products) {
    if (product && typeof product === 'object' && product.visibility === undefined) product.visibility = 'PUBLIC';
  }
  for (const sub of db.demandSubscriptions) {
    if (sub && typeof sub === 'object' && (sub as { circleId?: unknown }).circleId === undefined) (sub as { circleId?: string | null }).circleId = null;
  }
  for (const order of db.market.orders) {
    if (order && typeof order === 'object' && order.visibilitySnapshot === undefined) order.visibilitySnapshot = null;
  }
  return 0;
}

/** 试点学校的四个校区（与后端 V1 的 campuses 种子一致） */
export const PILOT_CAMPUS_SCHOOLS: Readonly<Record<string, string>> = { 东校区: 'pilot', 西校区: 'pilot', 南校区: 'pilot', 北校区: 'pilot' };

/**
 * v9 → v10（模块 6.1 / 7）：校区归属登记为试点学校；治理相关集合为空——不伪造工作人员、举报、处罚或爽约；
 * 旧的已取消订单不猜取消原因；旧用户没有任何限制；旧商品没有被隐藏。
 */
function migrateV9ToV10(db: MockDatabase): number {
  db.campusSchools ??= { ...PILOT_CAMPUS_SCHOOLS };
  db.cancellationRecords ??= [];
  db.noShowReports ??= [];
  db.staffMembers ??= [];
  db.moderationReports ??= [];
  db.moderationCases ??= [];
  db.moderationActions ??= [];
  db.moderationAppeals ??= [];
  db.userRestrictions ??= [];
  for (const product of db.market.products) {
    if (product && typeof product === 'object' && product.moderationHiddenAt === undefined) product.moderationHiddenAt = null;
  }
  return 0;
}

/**
 * v10 → v11（模块 7.1）：
 * <ul>
 *   <li>只为真实被接受过的改约（有完整开始 / 结束时间）回填档期快照；原始预约没有结束时间的旧订单不补、不猜；</li>
 *   <li>NO_SHOW_RULE 限制改名 SYSTEM_RULE，补规则版本 NO_SHOW_V1、决定时间 = 创建时间、依据 = 来源报告 + 决定前 30 天内仍已确认的报告；</li>
 *   <li>人工限制只补决定时间；动作补上涉及的用户；不隐藏任何评论或私信；不生成纠正记录。</li>
 * </ul>
 */
function migrateV10ToV11(db: MockDatabase): number {
  db.slotAgreements ??= [];
  db.restrictionCorrections ??= [];
  for (const p of db.meetingProposals ?? []) {
    if (!p || typeof p.revision !== 'number' || p.revision < 1 || typeof p.startsAt !== 'number' || typeof p.endsAt !== 'number') continue;
    if (db.slotAgreements.some((a) => a.orderId === p.orderId && a.revision === p.revision)) continue;
    db.slotAgreements.push({ orderId: p.orderId, revision: p.revision, meetingPointId: p.meetingPointId, startsAt: p.startsAt, endsAt: p.endsAt,
      source: 'LEGACY_ACCEPTED_PROPOSAL', agreedAt: p.respondedAt ?? p.createdAt });
  }
  const reports = db.noShowReports ?? [];
  for (const r of (db.userRestrictions ?? []) as unknown as Array<Omit<MockUserRestriction, 'source'> & { source: string }>) {
    if (!r || typeof r !== 'object') continue;
    r.decidedAt ??= r.createdAt;
    r.lastCorrectionId ??= null;
    if (r.source === 'NO_SHOW_RULE') {
      r.source = 'SYSTEM_RULE';
      r.ruleVersion = 'NO_SHOW_V1';
      const basis = new Map<string, number>();
      const own = reports.find((x) => x.id === r.noShowReportId);
      if (r.noShowReportId) basis.set(r.noShowReportId, own?.confirmedAt ?? r.createdAt);
      for (const x of reports) {
        if (x.reportedId === r.userId && (x.status === 'ACKNOWLEDGED' || x.status === 'CONFIRMED') && x.confirmedAt
          && x.confirmedAt > r.createdAt - 30 * 86_400_000 && x.confirmedAt <= r.createdAt) basis.set(x.id, x.confirmedAt);
      }
      r.basis = [...basis].map(([reportId, confirmedAt]) => ({ reportId, confirmedAt }));
    } else {
      r.ruleVersion ??= null;
      r.basis ??= [];
    }
  }
  for (const a of db.moderationActions ?? []) {
    if (!a || a.subjectId !== undefined) continue;
    if (a.targetType === 'PRODUCT') a.subjectId = db.market.products.find((p) => p.id === a.targetId)?.sellerId ?? null;
    else if (a.targetType === 'NO_SHOW') a.subjectId = reports.find((x) => x.id === a.targetId)?.reportedId ?? null;
    else a.subjectId = a.restrictionId ? db.userRestrictions.find((x) => x.id === a.restrictionId)?.userId ?? null : null;
  }
  for (const c of db.market.comments) if (c && typeof c === 'object' && c.moderationHiddenAt === undefined) c.moderationHiddenAt = null;
  for (const msg of db.market.messages) if (msg && typeof msg === 'object' && msg.moderationQuarantinedAt === undefined) msg.moderationQuarantinedAt = null;
  return 0;
}

/**
 * v10 结构的逐条容错：损坏的记录只丢弃该条。工作人员必须对应真实用户且学校一致（否则丢弃，不会凭空多出一个管理员）；
 * 限制不能超过 30 天；取消记录必须对应已取消的订单。
 */
function sanitizeGovernance(db: MockDatabase): number {
  let skipped = 0;
  const keep = <T>(list: unknown, valid: (x: Record<string, unknown>) => boolean): T[] => {
    if (!Array.isArray(list)) return [];
    const kept = list.filter((x) => isRecord(x) && valid(x));
    skipped += list.length - kept.length;
    return kept as T[];
  };
  if (!isRecord(db.campusSchools)) db.campusSchools = { ...PILOT_CAMPUS_SCHOOLS };
  const schoolOfUser = (id: unknown) => {
    const u = db.users.find((x) => x.id === id);
    return u ? db.campusSchools[u.campus] ?? null : null;
  };
  const cancelled = new Set(db.market.orders.filter((o) => o && (o.canonicalStatus === 'CANCELLED' || o.status === '已取消')).map((o) => o.id));
  db.cancellationRecords = keep(db.cancellationRecords, (c) => typeof c.orderId === 'string' && cancelled.has(c.orderId) && typeof c.phase === 'string');
  db.staffMembers = keep(db.staffMembers, (m) => typeof m.userId === 'string' && typeof m.schoolId === 'string'
    && (m.role === 'MODERATOR' || m.role === 'SENIOR_MODERATOR') && schoolOfUser(m.userId) === m.schoolId);
  db.noShowReports = keep(db.noShowReports, (r) => typeof r.id === 'string' && typeof r.orderId === 'string' && typeof r.status === 'string');
  db.moderationCases = keep(db.moderationCases, (c) => typeof c.id === 'string' && typeof c.schoolId === 'string' && typeof c.status === 'string');
  const caseIds = new Set(db.moderationCases.map((c) => c.id));
  db.moderationReports = keep(db.moderationReports, (r) => typeof r.id === 'string' && typeof r.caseId === 'string' && caseIds.has(r.caseId));
  db.moderationActions = keep(db.moderationActions, (a) => typeof a.id === 'string' && typeof a.staffId === 'string' && typeof a.actionCode === 'string');
  db.userRestrictions = keep(db.userRestrictions, (r) => typeof r.id === 'string' && typeof r.userId === 'string'
    && typeof r.startsAt === 'number' && typeof r.endsAt === 'number' && r.endsAt > r.startsAt && r.endsAt - r.startsAt <= 30 * 86_400_000);
  db.moderationAppeals = keep(db.moderationAppeals, (a) => typeof a.id === 'string' && typeof a.userId === 'string'
    && ((a.restrictionId == null) !== (a.actionId == null)));
  // v11：快照必须有完整的开始 / 结束时间且不超过 2 小时；限制来源只能是 CASE / SYSTEM_RULE（自动的必须有规则版本与依据）
  db.slotAgreements = keep(db.slotAgreements, (a) => typeof a.orderId === 'string' && typeof a.revision === 'number'
    && typeof a.startsAt === 'number' && typeof a.endsAt === 'number' && a.endsAt > a.startsAt && a.endsAt - a.startsAt <= 2 * 3_600_000);
  db.userRestrictions = db.userRestrictions.filter((r) => {
    const ok = (r.source === 'CASE' || (r.source === 'SYSTEM_RULE' && typeof r.ruleVersion === 'string' && Array.isArray(r.basis)))
      && typeof r.decidedAt === 'number';
    if (!ok) skipped += 1;
    return ok;
  });
  db.restrictionCorrections = keep(db.restrictionCorrections, (c) => typeof c.id === 'string' && typeof c.restrictionId === 'string'
    && (c.outcome === 'SHORTENED' || c.outcome === 'REVOKED') && typeof c.newEndsAt === 'number' && typeof c.previousEndsAt === 'number'
    && c.newEndsAt <= c.previousEndsAt);
  return skipped;
}

/** v9 结构的逐条容错：单条损坏的圈子 / 成员 / 邀请 / 事件 / 可见关系只丢弃该条；带明文邀请码的邀请直接丢弃。 */
function sanitizeCircles(db: MockDatabase): number {
  let skipped = 0;
  const keep = <T>(list: unknown, valid: (x: Record<string, unknown>) => boolean): T[] => {
    if (!Array.isArray(list)) return [];
    const kept = list.filter((x) => isRecord(x) && valid(x));
    skipped += list.length - kept.length;
    return kept as T[];
  };
  db.circles = keep(db.circles, (c) => typeof c.id === 'string' && typeof c.schoolId === 'string' && typeof c.name === 'string'
    && typeof c.ownerId === 'string' && !('official' in c));
  const circleIds = new Set(db.circles.map((c) => c.id));
  db.circleMemberships = keep(db.circleMemberships, (m) => typeof m.userId === 'string' && typeof m.circleId === 'string' && circleIds.has(m.circleId)
    && ['OWNER', 'MODERATOR', 'MEMBER'].includes(String(m.role)) && ['ACTIVE', 'LEFT', 'REMOVED'].includes(String(m.status)));
  db.circleInvites = keep(db.circleInvites, (i) => typeof i.id === 'string' && typeof i.tokenHash === 'string'
    && /^[0-9a-f]{64}$/.test(i.tokenHash) && !('token' in i));
  db.circleEvents = keep(db.circleEvents, (e) => typeof e.circleId === 'string' && typeof e.code === 'string');
  if (typeof db.circleSeq !== 'number') db.circleSeq = db.circleEvents.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  const links: unknown = db.productCircleVisibility;
  const clean: Record<string, string[]> = {};
  if (isRecord(links)) {
    for (const [productId, value] of Object.entries(links)) {
      if (Array.isArray(value) && value.length >= 1 && value.length <= 5 && value.every((v) => typeof v === 'string' && circleIds.has(v))) clean[productId] = value;
      else skipped += 1;
    }
  }
  db.productCircleVisibility = clean;
  // 圈子关系损坏的圈子商品不能「退化成公开」——没有有效圈子的 CIRCLE_ONLY 商品保持私密，只对卖家可见
  return skipped;
}

/** v7 结构的逐条容错：单条损坏的草稿 / 批次 / 邀请 / 事件 / 明细只丢弃该条。每次装载都执行。 */
function sanitizeSupply(db: MockDatabase): number {
  let skipped = 0;
  const keep = <T>(list: unknown, valid: (x: Record<string, unknown>) => boolean): T[] => {
    if (!Array.isArray(list)) return [];
    const kept = list.filter((x) => isRecord(x) && valid(x));
    skipped += list.length - kept.length;
    return kept as T[];
  };
  db.listingDrafts = keep(db.listingDrafts, (d) => typeof d.id === 'string' && typeof d.ownerId === 'string'
    && typeof d.version === 'number' && isRecord(d.payload) && typeof d.status === 'string');
  db.listingBatches = keep(db.listingBatches, (b) => typeof b.id === 'string' && typeof b.ownerId === 'string' && Array.isArray(b.items));
  db.listingPublishRequests = keep(db.listingPublishRequests, (r) => typeof r.key === 'string' && Array.isArray(r.productIds));
  // 只接受哈希形状的邀请：带明文邀请码或形状不对的记录直接丢弃
  db.listingAssistInvites = keep(db.listingAssistInvites, (i) => typeof i.id === 'string' && typeof i.tokenHash === 'string'
    && /^[0-9a-f]{64}$/.test(i.tokenHash) && !('token' in i));
  db.listingAssistEvents = keep(db.listingAssistEvents, (e) => typeof e.inviteId === 'string' && typeof e.code === 'string');
  if (typeof db.assistSeq !== 'number') db.assistSeq = db.listingAssistEvents.reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  const bundles: unknown = db.bundleItems;
  const cleanBundles: Record<string, import('./contracts').BundleItem[]> = {};
  if (isRecord(bundles)) {
    for (const [key, value] of Object.entries(bundles)) {
      if (Array.isArray(value) && value.every((x) => isRecord(x) && typeof x.name === 'string' && typeof x.quantity === 'number')) {
        cleanBundles[key] = value as import('./contracts').BundleItem[];
      } else skipped += 1;
    }
  }
  db.bundleItems = cleanBundles;
  if (!isRecord(db.productAttribution)) db.productAttribution = {};
  return skipped;
}

/** 全新的演示目录副本（种子数据与迁移共用）。 */
export function freshCatalog(): MockCatalog {
  return {
    courses: seedCourses.map((c) => ({ ...c })),
    offerings: seedOfferings.map((o) => ({ ...o })),
    editions: seedEditions.map((e) => ({ ...e, authors: [...e.authors] })),
    courseTextbooks: seedCourseTextbooks.map((t) => ({ ...t })),
  };
}

/** v6 结构的逐条容错：单条损坏的目录行 / 关联 / 建议只丢弃该条。每次装载都执行。 */
function sanitizeCatalog(db: MockDatabase): number {
  let skipped = 0;
  const keep = <T>(list: unknown, valid: (x: Record<string, unknown>) => boolean): T[] => {
    if (!Array.isArray(list)) return [];
    const kept = list.filter((x) => isRecord(x) && valid(x));
    skipped += list.length - kept.length;
    return kept as T[];
  };
  const catalog: unknown = db.catalog;
  if (!isRecord(catalog)) {
    db.catalog = freshCatalog();
  } else {
    db.catalog = {
      courses: keep(catalog.courses, (c) => typeof c.id === 'string' && typeof c.schoolId === 'string' && typeof c.name === 'string'),
      offerings: keep(catalog.offerings, (o) => typeof o.id === 'string' && typeof o.courseId === 'string'),
      editions: keep(catalog.editions, (e) => typeof e.id === 'string' && typeof e.title === 'string' && Array.isArray(e.authors)),
      courseTextbooks: keep(catalog.courseTextbooks, (t) => typeof t.courseOfferingId === 'string' && typeof t.textbookEditionId === 'string'),
    };
  }
  db.textbookSuggestions = keep(db.textbookSuggestions, (s) => typeof s.id === 'string' && typeof s.submitterId === 'string');
  const links: unknown = db.productTextbooks;
  const cleaned: Record<string, MockProductTextbook> = {};
  if (isRecord(links)) {
    for (const [key, value] of Object.entries(links)) {
      if (isRecord(value) && typeof value.textbookEditionId === 'string') cleaned[key] = value as unknown as MockProductTextbook;
      else skipped += 1;
    }
  }
  db.productTextbooks = cleaned;
  return skipped;
}

/** 逐版本迁移表。key 是「当前版本」，值把它升到 key+1。 */
const STEPS: Record<number, { name: string; run: (db: MockDatabase, ambiguous: string[]) => number }> = {
  1: { name: 'v1→v2 固化 canonicalStatus 并重算商品状态', run: migrateV1ToV2 },
  2: { name: 'v2→v3 引入楼栋参考数据（不推断任何关联）', run: migrateV2ToV3 },
  3: { name: 'v3→v4 需求雷达（楼栋补启用状态，订阅与匹配为空）', run: migrateV3ToV4 },
  4: { name: 'v4→v5 可信面交（只补空结构，不伪造验货、档期或到达）', run: migrateV4ToV5 },
  5: { name: 'v5→v6 课程教材图谱（植入演示目录，不猜旧商品版本，不伪造选课）', run: migrateV5ToV6 },
  6: { name: 'v6→v7 毕业季供给引擎（只补空结构，旧商品为单件，不猜成交价；只修正精确匹配的演示 ISMN）', run: migrateV6ToV7 },
  7: { name: 'v7→v8 冻结成交统计维度（旧订单为 null，不回填）', run: migrateV7ToV8 },
  8: { name: 'v8→v9 圈子集市（旧商品全部公开，不创建圈子、不替任何人入圈）', run: migrateV8ToV9 },
  9: { name: 'v9→v10 交易承诺与可信治理（不伪造工作人员、举报、处罚或爽约；旧取消订单不猜原因）', run: migrateV9ToV10 },
  11: { name: 'v11→v12 联系方式申请（默认不公开，释放旧预约）', run: (db) => { db.contactRequests = []; for (const p of db.market.products) { p.contactPublic = false; if (p.status === '预约中') p.status = '在售'; } return 0; } },
  10: { name: 'v10→v11 治理规则收口（只为真实改约回填档期快照，旧原始预约不补结束时间；NO_SHOW_RULE 改名 SYSTEM_RULE 并补依据）', run: migrateV10ToV11 },
};

/** 深拷贝。迁移在副本上进行，全部成功后调用方才整体写回。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 装载并迁移 Mock 负载。
 *
 * <p>事务式：先在<b>深拷贝</b>上构造新对象，整体成功后才由调用方写回；
 * 中途抛错不会在 localStorage 里留下半迁移状态。
 *
 * <p>幂等：对已是当前版本的负载不做任何改动；对同一份旧负载连续迁移两次，
 * 第二次是空操作，结果与第一次深度相等。
 */
export function migrateMockDatabase(raw: unknown, buildSeed: () => MockDatabase): MigrationResult {
  const applied: string[] = [];
  const ambiguous: string[] = [];

  const fallback = (fromVersion: number | null, persistable: boolean, discarded: boolean): MigrationResult => ({
    db: buildSeed(), fromVersion, applied, ambiguousOrderIds: ambiguous,
    skippedRecords: 0, discarded, persistable,
  });

  // 空存储 / 负载损坏 / 被手工改坏 / 根本不是这个应用写的：回退种子，不抛异常打断演示
  if (!looksLikeDatabase(raw)) return fallback(null, true, true);

  const rawVersion = raw.schemaVersion;
  // 没有版本号的负载来自引入版本机制之前，按 v1 处理
  const fromVersion = typeof rawVersion === 'number' && Number.isInteger(rawVersion) && rawVersion >= 1
    ? rawVersion
    : 1;

  // 更新版应用写的数据。不降级、不覆盖，本次会话用种子数据在内存里跑。
  if (fromVersion > MOCK_SCHEMA_VERSION) return fallback(fromVersion, false, false);

  let db: MockDatabase;
  let skipped = 0;
  try {
    db = clone(raw) as unknown as MockDatabase;
    db.contactRequests ??= [];
    db.buildings ??= [];
    db.demandSubscriptions ??= [];
    db.demandMatches ??= [];
    db.productDisclosures ??= {};
    db.orderInspections ??= {};
    db.meetingProposals ??= [];
    db.presence ??= [];
    db.flowEvents ??= [];
    db.flowSeq ??= 0;
    db.inactiveMeetingPoints ??= [];
    db.market.orders ??= [];
    db.market.products ??= [];
    db.market.favorites ??= [];
    db.market.comments ??= [];
    db.market.conversations ??= [];
    db.market.messages ??= [];
    db.idempotency ??= {};

    for (let v = fromVersion; v < MOCK_SCHEMA_VERSION; v += 1) {
      const step = STEPS[v];
      if (!step) continue;
      skipped += step.run(db, ambiguous);
      applied.push(step.name);
    }
    skipped += sanitizeTrustedFlow(db);
    skipped += sanitizeCatalog(db);
    skipped += sanitizeSupply(db);
    skipped += sanitizeCircles(db);
    skipped += sanitizeGovernance(db);
    db.schemaVersion = MOCK_SCHEMA_VERSION;
  } catch {
    // 整体迁移失败：本次会话用种子数据在内存里跑，但<b>不</b>写回——
    // 原负载原封不动地留在 localStorage 里，等下一个版本的迁移或人工排查，
    // 而不是被我们就地抹平。
    return fallback(fromVersion, false, true);
  }

  return { db, fromVersion, applied, ambiguousOrderIds: ambiguous, skippedRecords: skipped, discarded: false, persistable: true };
}
