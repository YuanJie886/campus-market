import type { CampusMarketApi, AuthSession, LoginInput, RegisterInput, ProfilePatch, ProductQuery, ProductPage, ProductCreateInput, ProductPatch, CommentInput, ContactRequest, ContactRequestPage, ContactRequestQuery, ContactRequestRole, ContactRequestStatus, ContactUnreadCounts } from './contracts';
import type { User, Product, Favorite, Comment, Conversation, ChatMessage, ProductStatus } from '../types';
import { ApiError } from './errors';
import { loadState, saveState } from '../utils/storage';
import { MOCK_SCHEMA_VERSION, MOCK_SCHOOL_NAMES, PILOT_CAMPUS_SCHOOLS, closeLegacyTrade, freshCatalog, migrateMockDatabase, type MockAssistInvite, type MockContactRequest, type MockDatabase, type MockDemandMatch, type MockDemandSubscription, type MockDisclosure, type MockListingBatch, type MockListingDraft, type MockTextbookSuggestion } from './mockMigrations';
import { ASSISTANT_FIELDS, parseBundleItems, randomToken, sanitizePayload, sha256Hex, validateListing, type ValidationContext } from './mock/supplyRules';
import { BATCH_MAX_ITEMS, CIRCLE_MEMBER_LIMIT, CONTACT_REQUEST_HOURLY_LIMIT, CONTACT_REQUEST_PAGE_MAX, CONTACT_REQUEST_STATUSES, MODERATION_DECISION_REASONS, MODERATION_REPORT_REASONS, MODERATION_REPORT_TARGETS, RESTRICTION_MAX_HOURS } from './contracts';
import type { AssistEvent, AssistInvite, AssistInviteCreated, AssistInviteRedeemed, BundleItem, ListingBatch, ListingBatchSummary, ListingDraft, ListingKind, ListingPayload, ListingValidation, PublishBatchResult } from './contracts';
import { seedInspectionTemplates, type MockInspectionTemplate } from '../data/inspectionTemplates';
import { isbnProblem, parseIsbn } from '../utils/isbn';
import { DECLARED_CONDITIONS, note, rejectUnknownKeys } from './mock/trustedFlowRules';
import { MAX_ACTIVE_SUBSCRIPTIONS, MAX_KEYWORD_LENGTH } from '../utils/demand';
import { containsKeyword, mockTier, normalizeDemandText, scoreDemandMatch } from './mock/demandScoring';
import { CATEGORIES } from '../types';
import { buildSeedMarketState, seedUsers } from '../data/seed';
import { compareBuildings, publicBuilding, seedBuildings } from '../data/buildings';
import { allowsFallback, fallbackChain, haversineMeters, SCOPE_FALLBACK_ORDER, SCOPE_LABEL, walkMinutes, type BuildingScope } from '../utils/geo';
import { safeUuid, uid } from '../utils/id';
import { requireSafeText } from './mock/contentSafety';
import { MOCK_DEMO_INVITE_CODES, MOCK_INVITE_REQUIRED_KEY, MockInviteCodeBook, type MockInviteCodeSeed, type MockInviteCodeStatus } from './mock/registrationInvites';
import { FREE_TEXT_DISABLED, MOCK_MESSAGE_TEMPLATES, TEMPLATE_NOT_FOUND, TEMPLATE_OR_TEXT, TEMPLATE_REQUIRED, TEMPLATE_WRONG_ROLE } from './mock/messageTemplates';
import { bytesToDataUrl, imageSize, readBytes, sniffImage } from './mock/imageRules';
import { AVATAR_EXTERNAL_NOT_ALLOWED, AVATAR_INVALID, isPresetAvatar } from '../utils/avatar';
import { IMAGE_PRESETS } from '../utils/externalDemoImages';
import { ACCOUNT_DELETION_CONFIRMATION, DEFAULT_CLIENT_CONFIG, normalizeClientConfig, normalizeSchools, type ClientConfig, type School, type MessageTemplateList, type SendMessageInput, IMAGE_MAX_BYTES, IMAGE_TOO_LARGE, PASSWORD_MAX, PASSWORD_MIN, PASSWORD_RESET_FAILURE, UPLOAD_REF_PREFIX, type AccountDeletionResult, type PasswordChangeResult, type PasswordResetInput, type UploadedImage } from './contracts';

/** 与后端 RestrictionGuard 的到期时间格式相同：「M 月 d 日 HH:mm」（Asia/Shanghai） */
function formatRestrictionEnd(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(epochMs));
  const part = (type: string) => parts.find((x) => x.type === type)?.value ?? '';
  return `${part('month')} 月 ${part('day')} 日 ${part('hour')}:${part('minute')}`;
}

const DB_KEY = 'mock_database_v1';
/** 阶段 4：离线演示上传的图片（data: 地址）单独存放，不进入 MockDatabase，避免一张大图挤爆演示数据；超出浏览器配额时只保留在内存里 */
const IMAGE_KEY = 'mock_uploaded_images_v1';
interface MockUploadedImage { ownerId: string; dataUrl: string; status: 'ACTIVE' | 'DELETED'; width: number; height: number }

/** 全新的演示数据。始终按当前 schema 版本生成。 */
function buildSeedDatabase(): MockDatabase {
  const market = buildSeedMarketState();
  market.products = market.products.map((p) => ({ ...p, contactPublic: false }));
  const db: MockDatabase = {
    schemaVersion: MOCK_SCHEMA_VERSION,
    contactRequests: [],
    legacyTradeClosures: [],
    users: seedUsers.map((user) => ({ ...user, dormBuildingId: user.dormBuildingId ?? null })),
    buildings: seedBuildings.map((building) => ({ ...building })),
    demandSubscriptions: [],
    demandMatches: [],
    productDisclosures: {},
    orderInspections: {},
    meetingProposals: [],
    presence: [],
    flowEvents: [],
    flowSeq: 0,
    inactiveMeetingPoints: [],
    catalog: freshCatalog(),
    productTextbooks: {},
    textbookSuggestions: [],
    listingDrafts: [],
    listingBatches: [],
    listingPublishRequests: [],
    listingAssistInvites: [],
    listingAssistEvents: [],
    assistSeq: 0,
    bundleItems: {},
    productAttribution: {},
    circles: [],
    circleMemberships: [],
    circleInvites: [],
    circleEvents: [],
    circleSeq: 0,
    productCircleVisibility: {},
    campusSchools: { ...PILOT_CAMPUS_SCHOOLS },
    cancellationRecords: [],
    noShowReports: [],
    staffMembers: [],
    moderationReports: [],
    moderationCases: [],
    moderationActions: [],
    moderationAppeals: [],
    userRestrictions: [],
    slotAgreements: [],
    restrictionCorrections: [],
    market,
    idempotency: {},
    currentUserId: null,
  };
  // 演示种子里的历史订单同样按阶段 1 收尾（与迁移同一个函数）：站内交易已停用，不留下未结束的订单或「预约中」的商品
  closeLegacyTrade(db);
  return db;
}

// 静态白名单放在模块顶层并标注 PURE：类定义本身因此没有副作用，
// REST 构建（VITE_API_MODE=rest）里未被引用的 MockCampusMarketApi 连同演示种子数据会被整体摇掉。
const DEMAND_CREATE_FIELDS: ReadonlySet<string> = /* @__PURE__ */ new Set(['keyword', 'category', 'minPrice', 'maxPrice', 'geoScope', 'campusId', 'buildingId', 'textbookEditionId', 'circleId']);
const DEMAND_PATCH_FIELDS: ReadonlySet<string> = /* @__PURE__ */ new Set(['keyword', 'category', 'minPrice', 'maxPrice', 'geoScope', 'campusId', 'buildingId', 'active']);

export class MockCampusMarketApi implements CampusMarketApi {
  private db: MockDatabase;
  /** 读到更高 schema 版本时为 false：不拿旧代码覆盖新版应用写下的数据。 */
  private readonly persistEnabled: boolean;

  /**
   * 私信是否开放文字（后端的部署开关 campus-market.messages.free-text-enabled，默认关闭）。
   * 离线演示与后端默认一致：只能发送快捷消息；测试可以显式打开以覆盖开放文字时的行为。不写入演示数据。
   */
  private readonly messageFreeTextEnabled: boolean;

  /**
   * 是否允许外部 http(s) 图片 / 头像（后端 GET /v1/config 的 images.externalAllowed）。离线演示需要示例图，默认允许；
   * 测试可以显式关闭以覆盖「不支持外部头像链接」。不写入演示数据。
   */
  private readonly externalImagesAllowed: boolean;

  /**
   * 注册是否需要邀请码（后端 GET /v1/config 的 registration.inviteRequired，默认 false）。
   * 构造参数优先；未给出时读取离线演示的开关（注册页「演示邀请码」面板里切换，刷新后生效）。不写入演示数据。
   */
  private readonly inviteRequired: boolean;
  /** 演示邀请码与使用次数：只在内存里，刷新页面即恢复 */
  private readonly inviteCodes: MockInviteCodeBook;

  constructor(options: { messageFreeTextEnabled?: boolean; externalImagesAllowed?: boolean; inviteRequired?: boolean; inviteCodes?: readonly MockInviteCodeSeed[] } = {}) {
    this.messageFreeTextEnabled = options.messageFreeTextEnabled === true;
    this.externalImagesAllowed = options.externalImagesAllowed !== false;
    this.inviteRequired = options.inviteRequired ?? loadState<unknown>(MOCK_INVITE_REQUIRED_KEY, false) === true;
    this.inviteCodes = new MockInviteCodeBook(options.inviteCodes ?? MOCK_DEMO_INVITE_CODES);
    // loadState 已经吃掉 JSON 解析异常；migrate 再负责形状与版本
    const raw = loadState<unknown>(DB_KEY, null);
    const result = migrateMockDatabase(raw, buildSeedDatabase);
    this.db = result.db;
    this.persistEnabled = result.persistable;
    // 迁移结果立即落盘，避免每次装载都重新推断一遍
    this.persist();
  }

  /** 批量发布期间暂停落盘：整批成功后一次写入，失败则整体回滚到发布前的副本（与 REST 的单事务同义）。 */
  private persistSuspended = false;
  private persist(): void { if (this.persistEnabled && !this.persistSuspended) saveState(DB_KEY, this.db) }
  /**
   * 模块 5 的限流计数只在内存里（本标签页会话），与后端按账号计数的口径一致；
   * 不写 localStorage，刷新页面即清零——离线演示没有需要防御的服务端资源。
   */
  private readonly supplyCounters = new Map<string, number[]>();
  private supplyLimit(scope: string, userId: string, limit: number, windowMs: number, message = '操作过于频繁，请稍后再试'): void {
    const now = Date.now();
    const key = `${scope}:${userId}`;
    const hits = (this.supplyCounters.get(key) ?? []).filter((t) => t > now - windowMs);
    if (hits.length >= limit) {
      this.supplyCounters.set(key, hits);
      throw ApiError.mock({ code: 429, message, retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) });
    }
    hits.push(now);
    this.supplyCounters.set(key, hits);
  }

  /**
   * 多标签页：联系申请与治理的读写之前以 localStorage 为准重新装载（保留本标签页的登录身份），
   * 避免用过期的内存副本覆盖另一个标签页刚写下的状态——例如把对方标签页刚撤回的同意写回「已同意」。
   */
  private syncFromStorage(): void {
    if (!this.persistEnabled) return;
    const result = migrateMockDatabase(loadState<unknown>(DB_KEY, null), buildSeedDatabase);
    if (result.discarded || !result.persistable) return;
    const currentUserId = this.db.currentUserId;
    this.db = result.db;
    this.db.currentUserId = currentUserId;
  }
  private currentUser(): User { const id = this.db.currentUserId; const user = this.db.users.find((item) => item.id === id); if (!user) throw ApiError.mock({ code: 401, message: '请先登录' }); return user }
  private session(user: User): AuthSession { const expires = new Date(Date.now() + 7 * 86400000).toISOString(); this.db.currentUserId = user.id; this.persist(); return { accessToken: user.id, expiresAtIso: expires, user: this.userOut(user) } }
  /** 响应里的用户：头像若是上传引用，换成显示地址（与后端返回签名地址相同；图片已失效时为空串） */
  private userOut(user: User): User { return { ...user, avatar: this.avatarOut(user.avatar) } }
  private avatarOut(stored: string | null | undefined): string { return stored ? this.imageUrlOf(stored) : '' }
  /**
   * PATCH /v1/auth/me 的 avatar，与后端相同：「""」、preset:1..12、本人上传且仍有效的 upload:<id>（编辑时带回的显示地址先还原成引用）、
   * 只在允许外部图片时的 http(s)。其余一律 400「头像无效」；外部链接在不允许时 400「不支持外部头像链接，请选择预设头像或上传图片」。
   */
  private avatarIn(raw: unknown, owner: User): string {
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: AVATAR_INVALID });
    const value = this.imageRefOf(raw);
    if (value === '' || isPresetAvatar(value)) return value;
    if (value.startsWith(UPLOAD_REF_PREFIX)) {
      const image = this.images[value.slice(UPLOAD_REF_PREFIX.length)];
      if (!image || image.status !== 'ACTIVE' || image.ownerId !== owner.id) throw ApiError.mock({ code: 400, message: AVATAR_INVALID });
      return value;
    }
    if (/^https?:\/\/[^\s/?#]+/i.test(value)) {
      if (!this.externalImagesAllowed) throw ApiError.mock({ code: 400, message: AVATAR_EXTERNAL_NOT_ALLOWED });
      return value;
    }
    throw ApiError.mock({ code: 400, message: AVATAR_INVALID });
  }
  /**
   * 公共用户投影，字段与后端 DomainMapper.user(row, false) 逐一对应。
   *
   * <p>改造前这里是「去掉 password 之后全部返回」，于是账号、联系方式，
   * 以及 1.2 新增的宿舍楼都会出现在任何人都能调用的公共接口里。
   * 改为<b>白名单</b>投影：新增字段默认不公开，必须显式加进来才可见。
   */
  async getUser(id: string): Promise<import('../types').PublicUser> {
    // 6.1A：他人公开资料需要登录，只对同校用户可见；他校与不存在同为 404
    const me = this.currentUser();
    const u = this.db.users.find((item) => item.id === id);
    if (!u || this.schoolOf(u.campus) !== this.schoolOf(me.campus)) throw ApiError.mock({ code: 404, message: '用户不存在' });
    return { id: u.id, nickname: u.nickname, avatar: this.avatarOut(u.avatar), campus: u.campus, createdAt: u.createdAt };
  }
  /** 楼栋参考数据。公共信息，未登录也可读，不含任何住户信息。 */
  async listBuildings(campus: User['campus'], zone?: string) {
    // 与 REST 相同：只列启用的楼栋，按唯一的 compareBuildings 排序，只返回 6 个公共字段
    return this.db.buildings
      .filter((building) => building.active && building.campusId === campus && (!zone || building.zone === zone))
      .sort(compareBuildings)
      .map(publicBuilding);
  }

  private buildingById(id: string | null | undefined) {
    return id ? this.db.buildings.find((building) => building.id === id) ?? null : null;
  }

  /**
   * 校验楼栋可被关联到某校区。错误语义与后端 BuildingService.requireSelectable 完全一致：
   * 不存在 404、已停用 400、不属于该校区 400。
   */
  private requireSelectableBuilding(id: string, campus: User['campus']): string {
    const building = this.buildingById(id);
    if (!building) throw ApiError.mock({ code: 404, message: '楼栋不存在' });
    if (!building.active) throw ApiError.mock({ code: 400, message: '该楼栋已停用，请选择其他楼栋' });
    if (building.campusId !== campus) throw ApiError.mock({ code: 400, message: '所选楼栋不属于该校区' });
    return building.id;
  }
  async markConversationRead(_id: string) {}
  async login(input: LoginInput): Promise<AuthSession> { const account = input.account.trim(); const user = this.db.users.find((item) => item.account === account || item.contact === account); if (!user) throw ApiError.mock({ code: 404, message: '账号不存在，请先注册' }); if (user.password !== input.password) throw ApiError.mock({ code: 401, message: '密码错误，请重新输入' }); return this.session(user) }
  /**
   * 邀请制（inviteRequired=true）时与后端的顺序相同：字段与校区校验 → 缺少邀请码 400「请输入邀请码」→ 昵称内容安全 →
   * 邀请码不存在或已用完 400「邀请码无效或已用完」→ 账号已注册 409（没有有效邀请码的人无法借注册接口探测账号）。
   * 次数在创建账号的同一个同步步骤里扣减（中间没有 await），其他校验失败不消耗次数。不需要邀请码时 inviteCode 被忽略。
   */
  async register(input: RegisterInput): Promise<AuthSession> {
    const account = input.account.trim();
    if (!account || !input.password || input.password.length < 6 || !input.nickname.trim()) throw ApiError.mock({ code: 400, message: '请完善注册信息，密码至少 6 位' });
    if (!this.schoolOf(input.campus)) throw ApiError.mock({ code: 400, message: '校区无效' });
    if (this.inviteRequired) this.inviteCodes.requirePresent(input.inviteCode);
    requireSafeText(input.nickname);
    if (this.inviteRequired) this.inviteCodes.check(input.inviteCode);
    if (this.db.users.some((user) => user.account === account)) throw ApiError.mock({ code: 409, message: '该账号已注册，请直接登录' });
    if (this.inviteRequired) this.inviteCodes.consume(input.inviteCode);
    const user: User = { id: uid('u'), account, password: input.password, nickname: input.nickname.trim(), avatar: '', campus: input.campus, contact: input.contact?.trim() || account, createdAt: Date.now() };
    this.db.users.push(user);
    this.persist();
    return this.session(user);
  }

  /** 仅离线演示：注册页「演示邀请码」面板列出的演示邀请码与剩余次数（真实部署由学校工作人员发放，REST 没有对应能力） */
  demoInviteCodes(): { inviteRequired: boolean; codes: MockInviteCodeStatus[] } {
    return { inviteRequired: this.inviteRequired, codes: this.inviteCodes.list() };
  }

  /** 仅离线演示：切换「以邀请制运行」开关（保存在本机，刷新页面后生效：客户端配置每个页面只读取一次） */
  demoSetInviteRequired(required: boolean): void {
    saveState(MOCK_INVITE_REQUIRED_KEY, required);
  }
  /** Mock 的登录态持久在 MockDatabase（演示数据），无需真实刷新，直接回报当前会话。 */
  async refreshSession(): Promise<AuthSession | null> {
    const id = this.db.currentUserId;
    const user = this.db.users.find((item) => item.id === id);
    if (!user) throw ApiError.mock({ code: 401, message: '请先登录' });
    return this.session(user);
  }
  async getCurrentUser(): Promise<User | null> { const id = this.db.currentUserId; const user = this.db.users.find((item) => item.id === id); return user ? this.userOut(user) : null }
  async updateProfile(patch: ProfilePatch): Promise<User> {
    const current = this.currentUser();
    // 阶段 4：昵称经过内容安全检查（与后端 MarketService.profile 相同）
    if (patch.nickname !== undefined) requireSafeText(patch.nickname);
    // 6.1A：只能在本校校区之间切换
    if (patch.campus !== undefined) this.requireCampusInSchool(patch.campus, this.schoolOf(current.campus));
    const { dormBuildingId, avatar, ...rest } = patch;
    // 头像先校验再写入：失败时什么都不改
    const nextAvatar = 'avatar' in patch ? this.avatarIn(avatar, current) : undefined;
    Object.assign(current, rest);
    if (nextAvatar !== undefined) current.avatar = nextAvatar;
    if ('dormBuildingId' in patch) {
      if (dormBuildingId === null || dormBuildingId === undefined || dormBuildingId === '') {
        // 显式清空：用户有权收回宿舍楼这条信息
        current.dormBuildingId = null;
      } else {
        // 同时改 campus 时按新校区校验，与 REST 的 MarketService.profile 一致
        current.dormBuildingId = this.requireSelectableBuilding(dormBuildingId, patch.campus ?? current.campus);
      }
    }
    this.persist();
    return this.userOut(current);
  }
  async logout(): Promise<void> { this.db.currentUserId = null; this.persist() }
  // ======================================================================
  // 阶段 3：账号生命周期（与后端 AccountService 逐条对应；docs/account-lifecycle.md）
  // ======================================================================
  /** 后端 AuthService.string：必须是字符串、去掉首尾空白后再按长度校验，消息只回显字段名 */
  private static accountString(body: Record<string, unknown>, name: string, min: number, max: number): string {
    const raw = body[name];
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: `${name} 格式无效` });
    const value = raw.trim();
    if (value.length < min || value.length > max) throw ApiError.mock({ code: 400, message: `${name} 长度无效` });
    return value;
  }
  private static rejectUnknownAccountFields(body: object, allowed: readonly string[]): void {
    const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
    if (unknown.length) throw ApiError.mock({ code: 400, message: `不支持的字段：${unknown.join(', ')}` });
  }

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<PasswordChangeResult> {
    const user = this.currentUser();
    const body = input as unknown as Record<string, unknown>;
    MockCampusMarketApi.rejectUnknownAccountFields(body, ['currentPassword', 'newPassword']);
    const current = MockCampusMarketApi.accountString(body, 'currentPassword', 1, PASSWORD_MAX);
    const next = MockCampusMarketApi.accountString(body, 'newPassword', PASSWORD_MIN, PASSWORD_MAX);
    // 后端按用户每小时 10 次（ACCOUNT_SECURITY）
    this.supplyLimit('account-security', user.id, 10, MockCampusMarketApi.HOUR, '请求过于频繁，请稍后再试');
    if (user.password !== current) throw ApiError.mock({ code: 400, message: '当前密码不正确' });
    if (current === next) throw ApiError.mock({ code: 400, message: '新密码不能与当前密码相同' });
    user.password = next;
    this.persist();
    // 离线演示只有本标签页这一个会话：没有其他设备可以结束
    return { changed: true, otherSessionsEnded: 0 };
  }

  /** 重置码只在内存里保存 SHA-256（与后端只存哈希相同），刷新页面即失效 */
  private readonly resetTickets = new Map<string, { codeHash: string; expiresAt: number; attempts: number }>();
  private static readonly RESET_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  private static normalizeResetCode(code: string): string { return code.replace(/-/g, '').replace(/ /g, '').toUpperCase() }

  /**
   * 仅离线演示：代替「学校管理员线下核对身份后签发」这一步（真实部署由管理后台签发，见 docs/account-lifecycle.md）。
   * 与后端相同：XXXX-XXXX-XXXX、30 分钟、最多 5 次错误、新码让旧码作废；账号不存在时不签发也不报错（返回 null）。
   */
  async demoIssueResetCode(account: string): Promise<{ code: string; expiresAt: number } | null> {
    this.syncFromStorage();
    const user = this.db.users.find((u) => u.account === account.trim());
    if (!user) return null;
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    const alphabet = MockCampusMarketApi.RESET_CODE_ALPHABET;
    let code = '';
    bytes.forEach((b, i) => { if (i > 0 && i % 4 === 0) code += '-'; code += alphabet[b % alphabet.length] });
    const expiresAt = Date.now() + 30 * 60_000;
    this.resetTickets.set(user.id, { codeHash: sha256Hex(MockCampusMarketApi.normalizeResetCode(code)), expiresAt, attempts: 0 });
    return { code, expiresAt };
  }

  async resetPasswordWithCode(input: PasswordResetInput): Promise<{ reset: boolean }> {
    this.syncFromStorage();
    const body = input as unknown as Record<string, unknown>;
    MockCampusMarketApi.rejectUnknownAccountFields(body, ['account', 'code', 'newPassword']);
    const account = MockCampusMarketApi.accountString(body, 'account', 1, 64);
    if (!/^[\w@.+-]+$/.test(account)) throw ApiError.mock({ code: 400, message: 'account 格式无效' });
    const code = MockCampusMarketApi.accountString(body, 'code', 1, 40);
    const next = MockCampusMarketApi.accountString(body, 'newPassword', PASSWORD_MIN, PASSWORD_MAX);
    // 后端按账号每小时 10 次（PASSWORD_RESET），成功与失败都计数
    this.supplyLimit('password-reset', account.toLowerCase(), 10, MockCampusMarketApi.HOUR, '请求过于频繁，请稍后再试');
    const user = this.db.users.find((u) => u.account === account);
    const ticket = user ? this.resetTickets.get(user.id) : undefined;
    if (!user || !ticket || ticket.expiresAt <= Date.now() || ticket.attempts >= 5) {
      throw ApiError.mock({ code: 400, message: PASSWORD_RESET_FAILURE });
    }
    if (sha256Hex(MockCampusMarketApi.normalizeResetCode(code)) !== ticket.codeHash) {
      ticket.attempts += 1;
      throw ApiError.mock({ code: 400, message: PASSWORD_RESET_FAILURE });
    }
    this.resetTickets.delete(user.id);
    user.password = next;
    // 全部会话结束：如果本标签页正登录着这个账号，同样退出
    if (this.db.currentUserId === user.id) this.db.currentUserId = null;
    this.persist();
    return { reset: true };
  }

  /** 注销：与后端同一事务内的收尾一一对应（docs/account-lifecycle.md 第 3 节） */
  async deleteAccount(input: { password: string; confirmation: string }): Promise<AccountDeletionResult> {
    this.syncFromStorage();
    const user = this.currentUser();
    const body = input as unknown as Record<string, unknown>;
    MockCampusMarketApi.rejectUnknownAccountFields(body, ['password', 'confirmation']);
    const password = MockCampusMarketApi.accountString(body, 'password', 1, PASSWORD_MAX);
    if (body.confirmation !== ACCOUNT_DELETION_CONFIRMATION) throw ApiError.mock({ code: 400, message: `请输入「${ACCOUNT_DELETION_CONFIRMATION}」确认注销` });
    this.supplyLimit('account-security', user.id, 10, MockCampusMarketApi.HOUR, '请求过于频繁，请稍后再试');
    if (user.password !== password) throw ApiError.mock({ code: 400, message: '密码不正确' });
    if (this.db.staffMembers.some((s) => s.userId === user.id && s.active)) {
      throw ApiError.mock({ code: 409, message: '你仍有后台工作人员权限，请先请学校管理员停用后再注销' });
    }
    if (this.db.circles.some((c) => c.ownerId === user.id && c.status === 'ACTIVE')) {
      throw ApiError.mock({ code: 409, message: '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销' });
    }
    const now = Date.now();
    let productsTakenDown = 0;
    for (const p of this.db.market.products) {
      if (p.sellerId !== user.id) continue;
      if (p.status === '在售') { p.status = '已下架'; productsTakenDown += 1 }
      p.contact = '';
      p.contactPublic = false;
    }
    let requestsClosed = 0;
    for (const r of this.db.contactRequests) {
      if (r.buyerId === user.id && r.status === 'PENDING') { r.status = 'WITHDRAWN'; r.updatedAt = now; requestsClosed += 1 }
      else if (r.sellerId === user.id && r.status === 'PENDING') { r.status = 'REJECTED'; r.decidedAt = now; r.updatedAt = now; r.buyerSeenAt = null; requestsClosed += 1 }
      else if (r.sellerId === user.id && r.status === 'APPROVED') { r.status = 'REVOKED'; r.decidedAt = now; r.updatedAt = now; r.buyerSeenAt = null; requestsClosed += 1 }
    }
    let membershipsEnded = 0;
    for (const m of this.db.circleMemberships) {
      if (m.userId !== user.id || m.status !== 'ACTIVE' || m.role === 'OWNER') continue;
      m.status = 'LEFT'; m.role = 'MEMBER'; m.endedAt = now; m.updatedAt = now; membershipsEnded += 1;
      this.circleEvent(m.circleId, user.id, user.id, 'MEMBER_LEFT');
    }
    for (const sub of this.db.demandSubscriptions) if (sub.userId === user.id && sub.active) { sub.active = false; sub.updatedAt = now }
    for (const invite of this.db.listingAssistInvites) if (invite.ownerId === user.id && invite.status !== 'REVOKED') { invite.status = 'REVOKED'; invite.revokedAt = now }
    // 阶段 4：本人上传的图片一律不可读
    for (const image of Object.values(this.images)) if (image.ownerId === user.id) { image.status = 'DELETED'; image.dataUrl = '' }
    this.persistImages();
    this.resetTickets.delete(user.id);
    // 资料匿名化：账号改为不可登录的占位值，密码改为随机值；原账号名可以重新注册
    Object.assign(user, { account: `deleted-${user.id}`, password: randomToken(), nickname: '已注销用户', avatar: '', contact: '', dormBuildingId: null });
    this.db.currentUserId = null;
    this.persist();
    return { deleted: true, productsTakenDown, requestsClosed, membershipsEnded };
  }

  // ======================================================================
  // 阶段 4：图片上传（与后端 ImageService 的校验顺序相同；图片以 data: 地址保存在本机）
  // ======================================================================
  private images: Record<string, MockUploadedImage> = loadState<Record<string, MockUploadedImage>>(IMAGE_KEY, {}) ?? {};
  private persistImages(): void { if (this.persistEnabled) saveState(IMAGE_KEY, this.images) }

  async uploadImage(file: File): Promise<UploadedImage> {
    const user = this.currentUser();
    if (!file || file.size === 0) throw ApiError.mock({ code: 400, message: '请选择一张图片' });
    if (file.size > IMAGE_MAX_BYTES) throw ApiError.mock({ code: 413, message: IMAGE_TOO_LARGE });
    const bytes = await readBytes(file);
    const format = sniffImage(bytes);
    if (!format) throw ApiError.mock({ code: 400, message: '只支持 JPEG 或 PNG 图片' });
    this.supplyLimit('image-upload', user.id, 60, MockCampusMarketApi.HOUR, '请求过于频繁，请稍后再试');
    const size = imageSize(bytes, format);
    if (!size || size.width < 1 || size.height < 1) throw ApiError.mock({ code: 400, message: '图片已损坏或无法识别' });
    if (size.width > 6000 || size.height > 6000) throw ApiError.mock({ code: 400, message: '图片尺寸不能超过 6000×6000' });
    const id = safeUuid();
    const dataUrl = bytesToDataUrl(bytes, format === 'png' ? 'image/png' : 'image/jpeg');
    this.images[id] = { ownerId: user.id, dataUrl, status: 'ACTIVE', ...size };
    this.persistImages();
    return { id, ref: `${UPLOAD_REF_PREFIX}${id}`, url: dataUrl, ...size };
  }

  /**
   * GET /v1/schools 的离线版本：与 REST 同一个形状。学校与校区来自 campusSchools 的登记（演示数据只有试点学校的四个校区），
   * hasBuildings 按是否还有启用的楼栋计算（与后端相同）。无需登录。
   */
  async getSchools(): Promise<School[]> {
    const bySchool = new Map<string, string[]>();
    for (const [campus, school] of Object.entries(this.db.campusSchools ?? {})) {
      if (!bySchool.has(school)) bySchool.set(school, []);
      bySchool.get(school)!.push(campus);
    }
    return normalizeSchools([...bySchool.entries()].map(([id, campuses]) => ({
      id,
      name: MOCK_SCHOOL_NAMES[id]?.name ?? id,
      shortName: MOCK_SCHOOL_NAMES[id]?.shortName ?? id,
      campuses: campuses.map((campus) => ({
        id: campus,
        name: campus,
        hasBuildings: this.db.buildings.some((building) => building.active && building.campusId === campus),
      })),
    })));
  }

  /** GET /v1/config 的离线版本：演示需要示例图，因此允许外部图片；张数、大小与类型与后端默认值相同；默认不需要邀请码（与后端默认相同） */
  async getClientConfig(): Promise<ClientConfig> {
    return normalizeClientConfig({ images: { ...DEFAULT_CLIENT_CONFIG.images, externalAllowed: this.externalImagesAllowed }, messages: { freeTextEnabled: this.messageFreeTextEnabled }, registration: { inviteRequired: this.inviteRequired } });
  }

  /** 商品里保存的引用 → 可显示的地址；外部示例图原样返回，已删除 / 不存在的上传图片为空串（界面显示占位图） */
  private imageUrlOf(stored: string): string {
    if (!stored.startsWith(UPLOAD_REF_PREFIX)) return stored;
    const image = this.images[stored.slice(UPLOAD_REF_PREFIX.length)];
    return image && image.status === 'ACTIVE' ? image.dataUrl : '';
  }
  /** 草稿里保存的引用 → 显示地址（与后端草稿响应里的签名地址相同）；已失效的上传图片保留引用，保存时原样带回由校验处理 */
  private draftImageUrlOf(stored: string): string {
    return this.imageUrlOf(stored) || stored;
  }
  private draftPayloadIn(payload: ListingPayload | undefined): ListingPayload | undefined {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.images)) return payload;
    return { ...payload, images: payload.images.map((image) => (typeof image === 'string' ? this.imageRefOf(image) : image)) };
  }
  /** 编辑时表单带回的是显示地址：还原成引用（与 REST 把签名地址还原成 upload:<id> 相同） */
  private imageRefOf(value: string): string {
    if (!value.startsWith('data:')) return value;
    const hit = Object.entries(this.images).find(([, image]) => image.dataUrl === value);
    return hit ? `${UPLOAD_REF_PREFIX}${hit[0]}` : value;
  }
  /** 与后端 ImageService.requireUsable 相同：只能引用卖家本人或协助人上传、仍有效的图片 */
  private requireUsableImages(images: readonly string[] | undefined, sellerId: string, assistantId: string | null): void {
    for (const ref of images ?? []) {
      if (typeof ref !== 'string' || !ref.startsWith(UPLOAD_REF_PREFIX)) continue;
      const id = ref.slice(UPLOAD_REF_PREFIX.length);
      if (!/^[0-9a-fA-F-]{36}$/.test(id) && !id.startsWith('uuid_')) throw ApiError.mock({ code: 400, message: '图片无效，请重新上传' });
      const image = this.images[id];
      if (!image || image.status !== 'ACTIVE' || (image.ownerId !== sellerId && image.ownerId !== assistantId)) {
        throw ApiError.mock({ code: 400, message: '只能使用自己上传的图片，请重新上传' });
      }
    }
  }

  async listProducts(query: ProductQuery): Promise<ProductPage> { const me = this.currentUser(); MockCampusMarketApi.rejectSchoolOverride(query); if (query.campus) this.requireCampusInSchool(query.campus, this.schoolOf(me.campus)); const viewer = me.id; const keyword = query.keyword?.trim().toLowerCase() ?? ''; let items = this.db.market.products.filter((p) => this.visibleTo(p, viewer) && (!keyword || `${p.title} ${p.description}`.toLowerCase().includes(keyword)) && (!query.category || p.category === query.category) && (!query.campus || p.campus === query.campus) && (!query.condition || p.condition === query.condition) && (query.minPrice === undefined || p.price >= query.minPrice) && (query.maxPrice === undefined || p.price <= query.maxPrice)); items = [...items].sort((a, b) => query.sort === 'priceAsc' ? a.price - b.price : query.sort === 'priceDesc' ? b.price - a.price : query.sort === 'views' ? b.views - a.views : b.createdAt - a.createdAt); const page = Math.max(1, query.page); const pageSize = Math.max(1, query.pageSize); return { items: items.slice((page - 1) * pageSize, page * pageSize).map((p) => this.withBuilding(p)), page, pageSize, total: items.length } }
  private validateContactPublic(input: { contactPublic?: boolean }): void {
    if ('contactPublic' in input && typeof input.contactPublic !== 'boolean') throw ApiError.mock({ code: 400, message: 'contactPublic 必须是布尔值' });
  }
  // ======================================================================
  // 联系申请（阶段 1，与后端 ContactRequestService / ContactRequestMapper 逐条对应）
  //   PENDING → APPROVED / REJECTED（卖家）/ WITHDRAWN（买家撤回）；APPROVED → REVOKED（卖家撤回同意）；
  //   WITHDRAWN → PENDING（买家重新申请，同一条记录）；REJECTED、REVOKED 是终态，再次申请 409。
  // ======================================================================

  private static readonly CONTACT_NOT_FOUND = '联系申请不存在';

  /** 申请对象：按查看者视角计算 unread，从不包含联系方式 */
  private contactView(r: MockContactRequest, viewerId: string): ContactRequest {
    const asSeller = r.sellerId === viewerId;
    const unread = asSeller ? r.status === 'PENDING' && r.sellerSeenAt === null
      : (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'REVOKED') && r.buyerSeenAt === null;
    return {
      id: r.id, productId: r.productId, buyerId: r.buyerId, sellerId: r.sellerId, status: r.status,
      createdAt: r.createdAt, updatedAt: r.updatedAt, decidedAt: r.decidedAt,
      productTitle: this.db.market.products.find((p) => p.id === r.productId)?.title ?? '',
      buyerNickname: this.db.users.find((u) => u.id === r.buyerId)?.nickname ?? '',
      sellerNickname: this.db.users.find((u) => u.id === r.sellerId)?.nickname ?? '',
      unread,
    };
  }

  /** 与后端 VISIBLE 条件相同：只列出本人仍能看到的商品上的申请 */
  private contactVisible(r: MockContactRequest, viewerId: string): boolean {
    const p = this.db.market.products.find((x) => x.id === r.productId);
    return !!p && this.visibleTo(p, viewerId);
  }

  /** 不属于本人与不存在同为 404 */
  private ownedContactRequest(id: string, userId: string, side: 'sellerId' | 'buyerId'): MockContactRequest {
    const r = this.db.contactRequests.find((x) => x.id === id);
    if (!r || r[side] !== userId) throw ApiError.mock({ code: 404, message: MockCampusMarketApi.CONTACT_NOT_FOUND });
    return r;
  }

  private static contactConflict(current: ContactRequestStatus): string {
    return current === 'WITHDRAWN' ? '买家已撤回这次申请' : current === 'REVOKED' ? '卖家已撤回同意' : '该申请已处理';
  }

  async getContactRequest(productId: string): Promise<ContactRequest | null> {
    this.syncFromStorage();
    const me = this.currentUser();
    this.readableProduct(productId);
    const request = this.db.contactRequests.find((r) => r.productId === productId && r.buyerId === me.id);
    return request ? this.contactView(request, me.id) : null;
  }

  async requestContact(productId: string): Promise<ContactRequest> {
    this.syncFromStorage();
    const me = this.currentUser();
    // 限制检查在先（后端先对用户行取共享锁再读商品）：受限时不透露商品是否存在
    this.requireUnrestricted(me.id, 'CONTACT');
    const product = this.readableProduct(productId);
    if (product.sellerId === me.id) throw ApiError.mock({ code: 400, message: '不能申请自己的联系方式' });
    const existing = this.db.contactRequests.find((r) => r.productId === productId && r.buyerId === me.id);
    if (existing) {
      // 对同一件商品的重复请求幂等返回原申请，不计入限流
      if (existing.status === 'PENDING' || existing.status === 'APPROVED') return this.contactView(existing, me.id);
      if (existing.status === 'REJECTED') throw ApiError.mock({ code: 409, message: '卖家已拒绝这次申请，不能再次申请' });
      if (existing.status === 'REVOKED') throw ApiError.mock({ code: 409, message: '卖家已撤回同意，不能再次申请' });
    }
    if (product.status !== '在售') throw ApiError.mock({ code: 409, message: '该商品当前不可申请联系' });
    if (product.contactPublic) throw ApiError.mock({ code: 409, message: '卖家已公开联系方式，请直接查看' });
    this.supplyLimit('contactRequest', me.id, CONTACT_REQUEST_HOURLY_LIMIT, 3_600_000, '请求过于频繁，请稍后再试');
    const now = Date.now();
    if (existing) {
      // 撤回后重新申请：回到 PENDING（同一条记录），卖家重新看到一条未读
      Object.assign(existing, { status: 'PENDING', updatedAt: now, sellerSeenAt: null, buyerSeenAt: now });
      this.persist();
      return this.contactView(existing, me.id);
    }
    const request: MockContactRequest = { id: uid('contact'), productId, buyerId: me.id, sellerId: product.sellerId, status: 'PENDING',
      createdAt: now, updatedAt: now, decidedAt: null, sellerSeenAt: null, buyerSeenAt: now };
    this.db.contactRequests.unshift(request);
    this.persist();
    return this.contactView(request, me.id);
  }

  /** 分页列表：role 默认 received；按最近变化倒序（updatedAt DESC, id） */
  async listContactRequests(query: ContactRequestQuery = {}): Promise<ContactRequestPage> {
    this.syncFromStorage();
    const me = this.currentUser();
    rejectUnknownKeys(query, ['role', 'status', 'page', 'size'], '查询');
    const role = query.role === undefined ? 'received' : query.role;
    if (role !== 'received' && role !== 'sent') throw ApiError.mock({ code: 400, message: 'role 只能是 received 或 sent' });
    const status = query.status === undefined ? null : query.status;
    if (status !== null && !CONTACT_REQUEST_STATUSES.includes(status)) throw ApiError.mock({ code: 400, message: '申请状态无效' });
    const intParam = (raw: unknown, name: string, max: number, fallback: number) => {
      if (raw === undefined) return fallback;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > max) throw ApiError.mock({ code: 400, message: `${name} 无效` });
      return n;
    };
    const page = intParam(query.page, 'page', 10000, 1);
    const size = intParam(query.size, 'size', CONTACT_REQUEST_PAGE_MAX, 20);
    const side = role === 'received' ? 'sellerId' : 'buyerId';
    const all = this.db.contactRequests
      .filter((r) => r[side] === me.id && this.contactVisible(r, me.id) && (status === null || r.status === status))
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { items: all.slice((page - 1) * size, page * size).map((r) => this.contactView(r, me.id)), total: all.length, page, size };
  }

  /** 卖家未读：还没看过的待处理申请；买家未读：还没看过的同意 / 拒绝 / 撤回同意 */
  private contactUnread(meId: string): ContactUnreadCounts {
    const received = this.db.contactRequests.filter((r) => r.sellerId === meId && r.status === 'PENDING' && r.sellerSeenAt === null && this.contactVisible(r, meId)).length;
    const updates = this.db.contactRequests.filter((r) => r.buyerId === meId && (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'REVOKED')
      && r.buyerSeenAt === null && this.contactVisible(r, meId)).length;
    return { received, updates, total: received + updates };
  }

  async getContactRequestUnreadCount(): Promise<ContactUnreadCounts> {
    this.syncFromStorage();
    return this.contactUnread(this.currentUser().id);
  }

  async markContactRequestsRead(role: ContactRequestRole): Promise<ContactUnreadCounts> {
    this.syncFromStorage();
    const me = this.currentUser();
    if (role !== 'received' && role !== 'sent') throw ApiError.mock({ code: 400, message: 'role 只能是 received 或 sent' });
    const now = Date.now();
    for (const r of this.db.contactRequests) {
      if (role === 'received' && r.sellerId === me.id && r.status === 'PENDING' && r.sellerSeenAt === null) r.sellerSeenAt = now;
      if (role === 'sent' && r.buyerId === me.id && (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'REVOKED') && r.buyerSeenAt === null) r.buyerSeenAt = now;
    }
    this.persist();
    return this.contactUnread(me.id);
  }

  async decideContactRequest(id: string, status: 'APPROVED' | 'REJECTED'): Promise<ContactRequest> {
    this.syncFromStorage();
    const me = this.currentUser();
    if (status !== 'APPROVED' && status !== 'REJECTED') throw ApiError.mock({ code: 400, message: '请选择同意或拒绝' });
    const request = this.ownedContactRequest(id, me.id, 'sellerId');
    this.readableProduct(request.productId);
    if (request.status === 'PENDING') {
      const now = Date.now();
      // 卖家同意 / 拒绝：买家多一条未读结果
      Object.assign(request, { status, updatedAt: now, decidedAt: now, buyerSeenAt: null });
      this.persist();
    } else if (request.status !== status) {
      throw ApiError.mock({ code: 409, message: MockCampusMarketApi.contactConflict(request.status) });
    }
    return this.contactView(request, me.id);
  }

  async withdrawContactRequest(id: string): Promise<ContactRequest> {
    this.syncFromStorage();
    const me = this.currentUser();
    const request = this.ownedContactRequest(id, me.id, 'buyerId');
    if (request.status === 'PENDING') {
      Object.assign(request, { status: 'WITHDRAWN', updatedAt: Date.now() });
      this.persist();
    } else if (request.status !== 'WITHDRAWN') {
      throw ApiError.mock({ code: 409, message: MockCampusMarketApi.contactConflict(request.status) });
    }
    return this.contactView(request, me.id);
  }

  async revokeContactRequest(id: string): Promise<ContactRequest> {
    this.syncFromStorage();
    const me = this.currentUser();
    const request = this.ownedContactRequest(id, me.id, 'sellerId');
    if (request.status === 'APPROVED') {
      const now = Date.now();
      // 卖家撤回同意：买家立即看不到联系方式，并多一条未读结果
      Object.assign(request, { status: 'REVOKED', updatedAt: now, decidedAt: now, buyerSeenAt: null });
      this.persist();
    } else if (request.status !== 'REVOKED') {
      throw ApiError.mock({ code: 409, message: '只能撤回已经同意的申请' });
    }
    return this.contactView(request, me.id);
  }
  async getProduct(id: string): Promise<Product> {
    this.syncFromStorage();
    this.currentUser();
    const product = this.readableProduct(id);
    const view: Product = { ...this.withBuilding(product), inspection: this.productDisclosureView(product.id) };
    // 只有「已获同意且未被撤回」的这一位买家能看到联系方式（REVOKED 立即失效）
    if (this.db.contactRequests.some((r) => r.productId === id && r.buyerId === this.viewerId() && r.status === 'APPROVED')) view.contact = product.contact;
    if ((product.listingKind ?? 'SINGLE') === 'BUNDLE') view.bundleItems = (this.db.bundleItems[product.id] ?? []).map((i) => ({ ...i }));
    return view;
  }
  async createProduct(input: ProductCreateInput): Promise<Product> {
    const user = this.currentUser();
    const product = this.createProductAs(user, input, null);
    this.persist();
    return this.withBuilding(product);
  }
  /**
   * 与 REST 的 MarketService.createProductAs 一致：单件或整套打包；发布人就是所有者本人，
   * assistedBy 只记录协助整理的人，不授予任何发布后的权限。校验全部在写入之前完成。
   */
  private createProductAs(user: User, input: ProductCreateInput, assistedBy: string | null): Product {
    this.validateContactPublic(input);
    rejectUnknownKeys(input, MockCampusMarketApi.PRODUCT_FIELDS, '商品');
    // 模块 7：单件、打包、批量、草稿最终发布都经过这里
    this.requireUnrestricted(user.id, 'PUBLISHING');
    this.requireCampusInSchool(input.campus, this.schoolOf(user.campus));
    const { inspection, textbookEditionId, listingKind: rawKind, bundleItems: rawItems, visibility: rawVisibility, circleIds: rawCircleIds, ...fields } = input as ProductCreateInput & { listingKind?: unknown };
    const listingKind = this.listingKindOf(rawKind);
    // 阶段 4：只能引用本人或协助人上传的有效图片；标题与描述经过内容安全检查（与后端 MarketService 相同的顺序）
    this.requireUsableImages(fields.images, user.id, assistedBy);
    requireSafeText(fields.title, fields.description);
    // 模块 6：默认公开；圈子可见要求所有者（卖家本人）是每个目标圈子的在籍成员
    const choice = this.parseVisibility(rawVisibility, rawCircleIds);
    this.requirePublishable(user.id, fields.campus, choice);
    let items: BundleItem[] | null = null;
    let disclosure: MockDisclosure | null = null;
    let edition: ReturnType<MockCampusMarketApi['resolveTextbook']> = null;
    const buildingId = fields.buildingId ? this.requireSelectableBuilding(fields.buildingId, fields.campus) : null;
    if (listingKind === 'BUNDLE') {
      if (inspection !== undefined && inspection !== null) throw ApiError.mock({ code: 400, message: '整套打包商品按每条明细验货，不需要商品级验货清单' });
      if (textbookEditionId !== undefined && textbookEditionId !== null) throw ApiError.mock({ code: 400, message: '整套打包商品不能关联单一教材版本' });
      items = parseBundleItems(rawItems);
    } else {
      if (rawItems !== undefined && rawItems !== null) throw ApiError.mock({ code: 400, message: '只有整套打包商品可以有明细' });
      edition = this.resolveTextbook(textbookEditionId, fields.category, fields.campus);
      // 与 REST 一致：声明在写入商品之前校验，失败时什么都不落库
      disclosure = this.parseDisclosure(fields.category, inspection);
    }
    const product: Product = { ...fields, buildingId, listingKind, visibility: choice.visibility, id: uid('p'), sellerId: user.id, status: '在售', views: 0, createdAt: Date.now(), images: fields.images.length ? fields.images : [IMAGE_PRESETS[this.db.market.products.length % IMAGE_PRESETS.length]], contact: fields.contact ?? user.contact };
    if (disclosure) this.db.productDisclosures[product.id] = disclosure;
    this.db.market.products.unshift(product);
    if (items) this.db.bundleItems[product.id] = items;
    if (choice.visibility === 'CIRCLE_ONLY') this.db.productCircleVisibility[product.id] = [...choice.circleIds];
    this.db.productAttribution[product.id] = { publishedBy: user.id, assistedBy };
    if (edition) this.linkTextbook(product.id, edition);
    // 与 REST 同一时刻：发布返回之前匹配已经写好（整套只按主体匹配，明细不单独匹配）
    this.evaluateDemand(product);
    return product;
  }
  private listingKindOf(raw: unknown): ListingKind {
    if (raw === undefined || raw === null) return 'SINGLE';
    if (raw !== 'SINGLE' && raw !== 'BUNDLE') throw ApiError.mock({ code: 400, message: '商品形态无效' });
    return raw;
  }
  async updateProduct(id: string, patch: ProductPatch): Promise<Product> {
    const user = this.currentUser();
    const product = this.db.market.products.find((item) => item.id === id);
    if (!product) throw ApiError.mock({ code: 404, message: '商品不存在' });
    if (product.sellerId !== user.id) throw ApiError.mock({ code: 403, message: '无权修改该商品' });

    this.validateContactPublic(patch);
    rejectUnknownKeys(patch, MockCampusMarketApi.PRODUCT_FIELDS, '商品');
    if (patch.images) {
      patch = { ...patch, images: patch.images.map((image) => this.imageRefOf(image)) };
      this.requireUsableImages(patch.images, user.id, this.db.productAttribution[product.id]?.assistedBy ?? null);
    }
    if (patch.title !== undefined || patch.description !== undefined) requireSafeText(patch.title, patch.description);
    const { buildingId, inspection, textbookEditionId, bundleItems: rawItems, visibility: rawVisibility, circleIds: rawCircleIds, ...rest } = patch;
    const kind = product.listingKind ?? 'SINGLE';
    if ('listingKind' in patch && (patch as { listingKind?: unknown }).listingKind !== kind) {
      throw ApiError.mock({ code: 400, message: '商品发布后不能在单件与整套打包之间切换' });
    }
    delete (rest as { listingKind?: unknown }).listingKind;
    let nextItems: BundleItem[] | undefined;
    if (kind === 'BUNDLE') {
      if ('inspection' in patch && inspection) throw ApiError.mock({ code: 400, message: '整套打包商品按每条明细验货，不需要商品级验货清单' });
      if ('textbookEditionId' in patch && textbookEditionId) throw ApiError.mock({ code: 400, message: '整套打包商品不能关联单一教材版本' });
      if ('bundleItems' in patch) nextItems = parseBundleItems(rawItems);
    } else if ('bundleItems' in patch && rawItems !== undefined && rawItems !== null) {
      throw ApiError.mock({ code: 400, message: '只有整套打包商品可以有明细' });
    }
    if (patch.campus !== undefined) this.requireCampusInSchool(patch.campus, this.schoolOf(user.campus));
    const effectiveCampus = patch.campus ?? product.campus;
    // 与 REST 的 MarketService.updateProduct 一致：切换分类或显式提供声明时整体替换，
    // 已生成的订单验货快照不受影响（快照在 orderInspections 中独立保存）
    const categoryChanged = patch.category !== undefined && patch.category !== product.category;
    const replaceDisclosure = kind === 'SINGLE' && (categoryChanged || 'inspection' in patch);
    const disclosure = replaceDisclosure ? this.parseDisclosure(patch.category ?? product.category, inspection) : undefined;
    let nextBuildingId: string | null = product.buildingId ?? null;
    if ('buildingId' in patch) {
      nextBuildingId = buildingId ? this.requireSelectableBuilding(buildingId, effectiveCampus) : null;
    } else if (patch.campus) {
      // 与 REST 完全相同的语义：切换校区而原楼栋不属于新校区时，要求卖家显式表态，
      // 既不静默清空，也不留下一个指向另一个校区的取货点
      const current = this.buildingById(product.buildingId);
      if (current && current.campusId !== effectiveCampus) {
        throw ApiError.mock({
          code: 400,
          message: '切换校区后原取货楼栋不再属于该校区，请同时提供 buildingId（传 null 表示不指定楼栋）',
        });
      }
    }
    // 模块 4：与 REST 一致——显式提交则按本次生效的分类 / 校区校验后关联或解除；
    // 切离教材分类或换到他校校区则自动解除；否则保留原关联与快照
    const effectiveCategory = patch.category ?? product.category;
    const linked = this.db.productTextbooks[product.id];
    let newEdition: ReturnType<MockCampusMarketApi['resolveTextbook']> = null;
    let unlink = false;
    if ('textbookEditionId' in patch && kind === 'SINGLE') {
      newEdition = this.resolveTextbook(textbookEditionId, effectiveCategory, effectiveCampus);
      unlink = !newEdition && !!linked;
    } else if (linked && (effectiveCategory !== '教材书籍' || this.schoolOf(effectiveCampus) !== linked.schoolId)) {
      unlink = true;
    }
    // 模块 6：可见范围整体替换；圈子商品换校区时按新校区重新校验原有圈子
    const currentVisibility = product.visibility ?? 'PUBLIC';
    let visibilityChoice: { visibility: 'PUBLIC' | 'CIRCLE_ONLY'; circleIds: string[] } | null = null;
    if ('visibility' in patch || 'circleIds' in patch) {
      const nextVisibility = 'visibility' in patch ? rawVisibility : currentVisibility;
      const nextCircles = 'circleIds' in patch ? rawCircleIds
        : nextVisibility === 'CIRCLE_ONLY' && currentVisibility === 'CIRCLE_ONLY' ? this.db.productCircleVisibility[product.id] ?? [] : undefined;
      visibilityChoice = this.parseVisibility(nextVisibility, nextCircles);
    } else if (patch.campus && currentVisibility === 'CIRCLE_ONLY') {
      visibilityChoice = this.parseVisibility('CIRCLE_ONLY', this.db.productCircleVisibility[product.id] ?? []);
    }
    if (visibilityChoice) this.requirePublishable(user.id, effectiveCampus, visibilityChoice);
    Object.assign(product, rest);
    product.buildingId = nextBuildingId;
    if (visibilityChoice) {
      product.visibility = visibilityChoice.visibility;
      if (visibilityChoice.visibility === 'CIRCLE_ONLY') this.db.productCircleVisibility[product.id] = [...visibilityChoice.circleIds];
      else delete this.db.productCircleVisibility[product.id];
    }
    if (unlink) delete this.db.productTextbooks[product.id];
    if (newEdition) this.linkTextbook(product.id, newEdition);
    if (replaceDisclosure) {
      if (disclosure) this.db.productDisclosures[product.id] = disclosure;
      else delete this.db.productDisclosures[product.id];
    }
    if (nextItems) this.db.bundleItems[product.id] = nextItems;
    this.evaluateDemand(product);
    this.persist();
    return this.withBuilding(product);
  }

  // ======================================================================
  // 模块 6：唯一的可见性实现（与后端 V9 的 product_visible_to / product_readable_by 同一规则）
  // ======================================================================

  private viewerId(): string | null { return this.db.currentUserId ?? null }

  private activeMember(circleId: string, userId: string): boolean {
    return this.db.circles.some((c) => c.id === circleId && c.status === 'ACTIVE')
      && this.db.circleMemberships.some((m) => m.circleId === circleId && m.userId === userId && m.status === 'ACTIVE');
  }

  /** 列表、搜索、feed、计数、收藏列表、需求匹配、收件箱、未读数的条件。 */
  private visibleTo(product: Product, viewer: string | null): boolean {
    // 6.1A：必须登录，且商品校区属于查看者的学校；7：被治理隐藏的商品只有卖家本人看得到
    if (!viewer) return false;
    const me = this.db.users.find((u) => u.id === viewer);
    const school = this.schoolOf(me?.campus);
    if (!school || this.schoolOf(product.campus) !== school) return false;
    if (product.moderationHiddenAt && product.sellerId !== viewer) return false;
    if ((product.visibility ?? 'PUBLIC') === 'PUBLIC') return true;
    if (product.sellerId === viewer) return true;
    return (this.db.productCircleVisibility[product.id] ?? []).some((cid) => this.activeMember(cid, viewer));
  }

  /** 不可读与不存在一样：同一个 404、同一句话。 */
  private readableProduct(id: string): Product {
    const product = this.db.market.products.find((item) => item.id === id);
    if (!product || !this.visibleTo(product, this.viewerId()) || (product.status === '已下架' && product.sellerId !== this.viewerId())) throw ApiError.mock({ code: 404, message: '商品不存在或已下架' });
    return product;
  }

  /** 卡片上的圈子标签：只列出查看者自己也在籍的关联圈子（卖家本人看到全部）。 */
  private circleLabels(product: Product): import('./contracts').CircleLabel[] {
    if ((product.visibility ?? 'PUBLIC') !== 'CIRCLE_ONLY') return [];
    const viewer = this.viewerId();
    return (this.db.productCircleVisibility[product.id] ?? [])
      .map((cid) => this.db.circles.find((c) => c.id === cid && c.status === 'ACTIVE'))
      .filter((c): c is NonNullable<typeof c> => !!c && (product.sellerId === viewer || (!!viewer && this.activeMember(c.id, viewer))))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));
  }

  /** 发布 / 编辑：可见范围的形状与所有者（卖家）的在籍身份，与后端 ProductVisibility 同一规则。 */
  private parseVisibility(rawVisibility: unknown, rawCircleIds: unknown): { visibility: 'PUBLIC' | 'CIRCLE_ONLY'; circleIds: string[] } {
    const visibility = rawVisibility === undefined || rawVisibility === null ? 'PUBLIC' : rawVisibility;
    if (visibility !== 'PUBLIC' && visibility !== 'CIRCLE_ONLY') throw ApiError.mock({ code: 400, message: '可见范围无效' });
    let circleIds: string[] = [];
    if (rawCircleIds !== undefined && rawCircleIds !== null) {
      if (!Array.isArray(rawCircleIds)) throw ApiError.mock({ code: 400, message: 'circleIds 格式无效' });
      circleIds = rawCircleIds.map(String);
      if (new Set(circleIds).size !== circleIds.length) throw ApiError.mock({ code: 400, message: '圈子不能重复选择' });
    }
    if (visibility === 'PUBLIC' && circleIds.length) throw ApiError.mock({ code: 400, message: '全校公开的商品不需要选择圈子' });
    if (visibility === 'CIRCLE_ONLY' && (circleIds.length < 1 || circleIds.length > 5)) throw ApiError.mock({ code: 400, message: '圈子可见需要选择 1～5 个圈子' });
    return { visibility, circleIds };
  }

  private requirePublishable(sellerId: string, campus: string, choice: { visibility: string; circleIds: string[] }): void {
    if (choice.visibility !== 'CIRCLE_ONLY') return;
    const school = this.schoolOf(campus);
    const ok = choice.circleIds.every((cid) => this.db.circles.some((c) => c.id === cid && c.schoolId === school && c.status === 'ACTIVE')
      && this.activeMember(cid, sellerId));
    if (!ok) throw ApiError.mock({ code: 404, message: '圈子不存在或你不是这个圈子的成员' });
  }

  /** 补上展示用的楼栋名与园区，对应 REST 的 LEFT JOIN 投影。 */
  private withBuilding(product: Product): Product {
    const building = this.buildingById(product.buildingId);
    const { moderationHiddenAt, moderationHiddenActionId, ...rest } = product;
    void moderationHiddenActionId;
    const own = product.sellerId === this.viewerId();
    return {
      ...rest,
      images: (product.images ?? []).map((image) => this.imageUrlOf(image)),
      contactPublic: product.contactPublic === true,
      contact: own || product.contactPublic === true ? product.contact : '',
      // 模块 7：被治理隐藏只告诉卖家本人（与 REST 的 moderationHidden 一致）；Mock 内部字段不外泄
      ...(own ? { moderationHidden: !!moderationHiddenAt } : {}),
      buildingId: product.buildingId ?? null,
      buildingName: building?.name ?? null,
      buildingZone: building?.zone ?? null,
      // 模块 4：与 REST 的商品投影一致，每件商品都带教材版本摘要（未关联为 null）
      textbook: this.productTextbookView(product.id),
      // 模块 5：与 REST 一致，卡片与详情都带打包摘要（单件为 null）
      listingKind: product.listingKind ?? 'SINGLE',
      bundle: this.bundleSummary(product),
      visibility: product.visibility ?? 'PUBLIC',
      circles: this.circleLabels(product),
    };
  }
  private bundleSummary(product: Product): import('./contracts').BundleSummary | null {
    const items = (product.listingKind ?? 'SINGLE') === 'BUNDLE' ? this.db.bundleItems[product.id] : undefined;
    if (!items) return null;
    return { itemCount: items.length, totalQuantity: items.reduce((n, i) => n + i.quantity, 0), categoryCount: new Set(items.map((i) => i.category)).size };
  }
  async setProductStatus(id: string, status: ProductStatus): Promise<Product> { if (!['在售', '已售出', '已下架'].includes(status)) throw ApiError.mock({ code: 400, message: '商品状态无效' }); const user=this.currentUser(); const p=this.db.market.products.find(p=>p.id===id && p.sellerId===user.id); if(!p) throw new Error('无权修改'); p.status=status; this.evaluateDemand(p); this.persist(); return {...p} }
  async incrementProductViews(id: string): Promise<void> { const product = await this.getProduct(id); product.views += 1; const target = this.db.market.products.find((item) => item.id === id); if (target) target.views = product.views; this.persist() }

  /**
   * 楼栋集市 feed。降级顺序与距离公式全部来自 utils/geo，
   * 与 REST 共用同一份定义——Mock 绝不能有自己的一套降级顺序。
   */
  /**
   * @param extraFilter 仅 Mock 内部使用（模块 4 的教材商品流）：在同一套范围 / 排序 / 距离逻辑上额外限定商品。
   *                    对应 REST 的 FeedQuery.textbookEditionIds + onSaleOnly，不属于对外契约。
   */
  async feedProducts(query: import('./contracts').FeedQuery, extraFilter?: (product: Product) => boolean): Promise<import('./contracts').FeedPage> {
    const needsOrigin = query.scope === 'BUILDING' || query.scope === 'ZONE' || query.sort === 'nearest';
    // 6.1A：商品的一切读取都需要登录
    const viewer = this.currentUser();
    MockCampusMarketApi.rejectSchoolOverride(query);
    if (needsOrigin && !viewer) throw ApiError.mock({ code: 401, message: '请先登录后再使用本楼范围' });
    const origin = needsOrigin ? this.buildingById(viewer?.dormBuildingId) : null;
    if (needsOrigin && !origin) {
      throw ApiError.mock({ code: 409, message: '请先在个人资料中选择宿舍楼' });
    }
    if (needsOrigin && origin && !origin.active) {
      // 与 REST 一致：宿舍楼停用时要求重新选择，不静默退回校区
      throw ApiError.mock({ code: 409, message: '你选择的宿舍楼已停用，请在个人资料中重新选择' });
    }
    // 「本校区」与 REST（BuildingFeedService.resolveOrigin）一致：填了宿舍楼就取宿舍楼所在校区（停用 → 409），
    // 没填就是本人资料里的校区——「本校区」不需要宿舍楼，也不会因此 409
    let campusDorm: ReturnType<MockCampusMarketApi['buildingById']> = null;
    if (query.scope === 'CAMPUS' && !needsOrigin && viewer?.dormBuildingId) {
      campusDorm = this.buildingById(viewer.dormBuildingId);
      if (!campusDorm || !campusDorm.active) {
        throw ApiError.mock({ code: 409, message: '你选择的宿舍楼已停用，请在个人资料中重新选择' });
      }
    }
    const scopeCampus = origin?.campusId ?? campusDorm?.campusId ?? viewer?.campus ?? null;

    const keyword = query.keyword?.trim().toLowerCase() ?? '';
    const matchesFilters = (product: Product): boolean =>
      (!keyword || `${product.title} ${product.description}`.toLowerCase().includes(keyword)) &&
      (!query.category || product.category === query.category) &&
      (!query.condition || product.condition === query.condition) &&
      (query.minPrice === undefined || product.price >= query.minPrice) &&
      (query.maxPrice === undefined || product.price <= query.maxPrice) &&
      product.status !== '已下架' &&
      this.visibleTo(product, this.viewerId()) &&
      (!extraFilter || extraFilter(product));

    const inScope = (product: Product, scope: BuildingScope): boolean => {
      if (scope === 'SCHOOL') return true;
      if (scope === 'CAMPUS') return scopeCampus !== null && product.campus === scopeCampus;
      if (!origin) return false;
      const building = this.buildingById(product.buildingId);
      if (!building) return false;
      if (scope === 'BUILDING') return building.id === origin.id;
      // 与 REST 的 ZONE 子查询一致：停用楼栋不参与同园区范围
      return building.active && building.campusId === origin.campusId && building.zone === origin.zone;
    };

    // 范围选择基于总数，在分页之前完成：翻到第二页不会因为「这一页空」而扩大范围
    const chain = allowsFallback(query.scope) ? fallbackChain(query.scope) : [query.scope];
    let effectiveScope = chain[chain.length - 1];
    let matched: Product[] = [];
    for (const candidate of chain) {
      const found = this.db.market.products.filter((p) => matchesFilters(p) && inScope(p, candidate));
      if (found.length > 0) {
        effectiveScope = candidate;
        matched = found;
        break;
      }
    }

    const sorted = [...matched].sort((a, b) => {
      if (query.sort === 'nearest') {
        const rank = (p: Product) => (p.buildingId && p.buildingId === origin?.id ? 0 : p.buildingId ? 1 : 2);
        const byRank = rank(a) - rank(b);
        if (byRank !== 0) return byRank;
        const da = haversineMeters(origin, this.buildingById(a.buildingId));
        const db_ = haversineMeters(origin, this.buildingById(b.buildingId));
        if (da !== null && db_ !== null && da !== db_) return da - db_;
        if (da === null && db_ !== null) return 1;
        if (da !== null && db_ === null) return -1;
        return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
      }
      if (query.sort === 'priceAsc') return a.price - b.price || a.id.localeCompare(b.id);
      if (query.sort === 'priceDesc') return b.price - a.price || a.id.localeCompare(b.id);
      if (query.sort === 'views') return b.views - a.views || a.id.localeCompare(b.id);
      return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
    });

    const page = Math.max(1, query.page);
    const pageSize = Math.max(1, query.pageSize);
    const fallbackApplied = effectiveScope !== query.scope;
    return {
      requestedScope: query.scope,
      effectiveScope,
      effectiveScopeLabel: SCOPE_LABEL[effectiveScope],
      fallbackApplied,
      fallbackReason: fallbackApplied
        ? (matched.length === 0 ? 'NO_RESULTS_IN_ANY_SCOPE' : 'NO_RESULTS_IN_REQUESTED_SCOPE')
        : null,
      items: sorted.slice((page - 1) * pageSize, page * pageSize).map((product) => {
        const sameBuilding = !!product.buildingId && product.buildingId === origin?.id;
        // 同楼栋不给距离与「0 分钟」，与 REST 的 BuildingFeedService.item 一致
        const meters = sameBuilding ? null : haversineMeters(origin, this.buildingById(product.buildingId));
        return {
          ...this.withBuilding(product),
          sameBuilding,
          approximateDistanceMeters: meters,
          approximateWalkMinutes: walkMinutes(meters),
        };
      }),
      page,
      pageSize,
      total: matched.length,
    };
  }

  /* ============================== 需求雷达 ============================== */
  //
  // 与 REST 的 DemandSubscriptionService / DemandMatchService 逐条对齐：
  // 同样的规范化、同样的幂等与重新激活语义、同样的 50 条上限、同样的地理规则、
  // 同样的评分（来自 utils/demand，前端唯一一份）、同样的错误码。

  private static readonly DEMAND_CREATE_FIELDS = DEMAND_CREATE_FIELDS;
  // 与 REST 一致：教材版本创建后不可修改（PATCH 不接受 textbookEditionId）
  private static readonly DEMAND_PATCH_FIELDS = DEMAND_PATCH_FIELDS;
  /** 与 REST 的 MarketService.PRODUCT_FIELDS 一致：sellerId / schoolId / 快照字段等一律拒绝。 */
  private static readonly PRODUCT_FIELDS = ['title', 'description', 'price', 'originalPrice', 'category', 'condition', 'campus',
    'images', 'contact', 'contactPublic', 'buildingId', 'inspection', 'textbookEditionId', 'listingKind', 'bundleItems', 'visibility', 'circleIds'];

  /** 6.1A：与后端 campuses 表一致——校区归属以数据登记为准（演示种子是试点学校的四个校区）。 */
  private schoolOf(campus: string | null | undefined): string | null {
    return campus ? this.db.campusSchools?.[campus] ?? null : null;
  }

  /** 校区必须属于指定学校；他校校区与不存在的校区是同一个 400。 */
  private requireCampusInSchool(campus: unknown, school: string | null): string {
    const value = typeof campus === 'string' ? campus.trim() : '';
    if (!value || !school || this.schoolOf(value) !== school) throw ApiError.mock({ code: 400, message: '校区无效' });
    return value;
  }

  private static rejectSchoolOverride(query: object): void {
    for (const key of Object.keys(query)) {
      if (['schoolid', 'school', 'school_id'].includes(key.toLowerCase())) throw ApiError.mock({ code: 400, message: `不支持的字段：${key}` });
    }
  }

  private rejectUnknownDemandFields(body: object, allowed: ReadonlySet<string>): void {
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) throw ApiError.mock({ code: 400, message: '请求包含不支持的字段' });
    }
  }

  private parseDemandConditions(input: import('./contracts').DemandConditions, user: User, requireMembership = true) {
    const rawKeyword = input.keyword ?? null;
    const normalized = rawKeyword === null ? '' : normalizeDemandText(rawKeyword);
    if (normalized.length > MAX_KEYWORD_LENGTH) throw ApiError.mock({ code: 400, message: `关键词最多 ${MAX_KEYWORD_LENGTH} 个字` });
    const keyword = normalized ? (rawKeyword as string).replace(/\s+/g, ' ').trim() : null;
    const normalizedKeyword = normalized || null;

    let category = input.category || null;
    if (category && !CATEGORIES.includes(category)) throw ApiError.mock({ code: 400, message: '分类无效' });
    // 模块 4：精确教材版本订阅——按版本 id 匹配，不带关键词，分类固定为教材书籍；他校版本与不存在一样 404
    let textbookEditionId: string | null = null;
    const rawEdition = input.textbookEditionId;
    if (rawEdition !== undefined && rawEdition !== null && String(rawEdition).trim() !== '') {
      if (typeof rawEdition !== 'string') throw ApiError.mock({ code: 400, message: 'textbookEditionId 格式无效' });
      if (normalizedKeyword) throw ApiError.mock({ code: 400, message: '教材版本订阅按版本精确匹配，不需要关键词' });
      if (category && category !== '教材书籍') throw ApiError.mock({ code: 400, message: '教材版本订阅的分类只能是教材书籍' });
      const school = this.schoolOf(user.campus);
      if (!school || !this.editionOf(school, rawEdition.trim())) throw ApiError.mock({ code: 404, message: '教材版本不存在' });
      textbookEditionId = rawEdition.trim();
      category = '教材书籍';
    }
    if (!normalizedKeyword && !category) throw ApiError.mock({ code: 400, message: '请至少填写关键词或选择分类' });

    const price = (value: number | null | undefined, name: string): number | null => {
      if (value === null || value === undefined) return null;
      if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100 || value > 99_999_999) {
        throw ApiError.mock({ code: 400, message: `${name} 无效` });
      }
      return value;
    };
    const minPrice = price(input.minPrice, 'minPrice');
    const maxPrice = price(input.maxPrice, 'maxPrice');
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw ApiError.mock({ code: 400, message: '最低价不能高于最高价' });

    const geoScope = input.geoScope ?? 'SCHOOL';
    // 合法范围取自 utils/geo 的唯一定义，不在这里再写一遍
    if (!SCOPE_FALLBACK_ORDER.includes(geoScope)) throw ApiError.mock({ code: 400, message: '范围无效' });
    const school = this.schoolOf(user.campus);
    const requestedCampus = input.campusId || null;
    const requestedBuilding = input.buildingId || null;

    let campusId: string | null = null, buildingId: string | null = null, zone: string | null = null;
    if (geoScope === 'SCHOOL') {
      if (requestedCampus || requestedBuilding) throw ApiError.mock({ code: 400, message: '全校范围不需要指定校区或楼栋' });
    } else if (geoScope === 'CAMPUS') {
      if (requestedBuilding) throw ApiError.mock({ code: 400, message: '校区范围不需要指定楼栋' });
      campusId = requestedCampus ?? user.campus;
      if (this.schoolOf(campusId) !== school) throw ApiError.mock({ code: 400, message: '校区不属于你所在的学校' });
    } else {
      const anchor = requestedBuilding ?? user.dormBuildingId ?? null;
      if (!anchor) throw ApiError.mock({ code: 409, message: '请先在个人资料中设置宿舍楼，或选择一栋楼' });
      const building = this.buildingById(anchor);
      if (!building) throw ApiError.mock({ code: 404, message: '楼栋不存在' });
      if (!building.active) throw ApiError.mock({ code: 400, message: '该楼栋已停用，请选择其他楼栋' });
      if (this.schoolOf(building.campusId) !== school) throw ApiError.mock({ code: 400, message: '楼栋不属于你所在的学校' });
      if (requestedCampus && requestedCampus !== building.campusId) throw ApiError.mock({ code: 400, message: '所选楼栋不属于该校区' });
      campusId = building.campusId;
      buildingId = building.id;
      zone = building.zone;
    }
    // 与后端 DemandFingerprint 相同的规范串；Mock 直接用它做幂等键，不对外暴露
    const anchorKey = geoScope === 'BUILDING' ? buildingId : geoScope === 'ZONE' ? `${campusId}/${zone}` : geoScope === 'CAMPUS' ? campusId : '';
    const plain = (v: number | null) => (v === null ? '' : String(Number(v)));
    // 没有教材版本时与 V4 时代逐字节相同；有版本时追加一行 tb=（与 DemandFingerprint 一致）
    // 模块 6：圈子范围订阅——只有在籍成员可以创建；范围固定为这个圈子（全校），不与教材版本组合
    let circleId: string | null = null;
    const rawCircle = input.circleId;
    if (rawCircle !== undefined && rawCircle !== null && String(rawCircle).trim() !== '') {
      if (geoScope !== 'SCHOOL') throw ApiError.mock({ code: 400, message: '圈子订阅的范围就是这个圈子，不需要再选校区或楼栋' });
      if (textbookEditionId) throw ApiError.mock({ code: 400, message: '圈子订阅不能同时订阅教材版本' });
      circleId = String(rawCircle);
      if (requireMembership && !(this.db.circles.some((c) => c.id === circleId && c.schoolId === school) && this.activeMember(circleId, user.id))) {
        throw ApiError.mock({ code: 404, message: '圈子不存在或你不是这个圈子的成员' });
      }
    }
    const fingerprint = ['v1', `kw=${normalizedKeyword ?? ''}`, `cat=${category ?? ''}`, `min=${plain(minPrice)}`,
      `max=${plain(maxPrice)}`, `geo=${geoScope}`, `anchor=${anchorKey ?? ''}`].join('\n') + (textbookEditionId ? `\ntb=${textbookEditionId}` : '')
      + (circleId ? `\ncircle=${circleId}` : '');
    return { keyword, normalizedKeyword, category, minPrice, maxPrice, geoScope, campusId, buildingId, fingerprint, school, textbookEditionId, circleId };
  }

  private projectSubscription(s: MockDemandSubscription): import('./contracts').DemandSubscription {
    const anchor = this.buildingById(s.buildingId);
    return {
      id: s.id, keyword: s.keyword, category: s.category as import('./contracts').DemandSubscription['category'],
      minPrice: s.minPrice, maxPrice: s.maxPrice, geoScope: s.geoScope,
      campusId: s.campusId as import('./contracts').DemandSubscription['campusId'],
      buildingId: s.buildingId, zone: anchor?.zone ?? null, buildingName: anchor?.name ?? null,
      textbook: (() => {
        const e = s.textbookEditionId ? this.db.catalog.editions.find((x) => x.id === s.textbookEditionId) : undefined;
        return e ? { id: e.id, isbn: e.normalizedIsbn ?? null, title: e.title, editionLabel: e.editionLabel, publisher: e.publisher } : null;
      })(),
      circle: s.circleId ? { id: s.circleId, name: this.db.circles.find((c) => c.id === s.circleId)?.name ?? null } : null,
      active: s.active, matchCount: this.db.demandMatches.filter((m) => m.subscriptionId === s.id).length,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  }

  private activeDemandCount(userId: string): number {
    return this.db.demandSubscriptions.filter((s) => s.userId === userId && s.active).length;
  }

  async createDemandSubscription(input: import('./contracts').DemandConditions): Promise<import('./contracts').DemandSubscribeResult> {
    this.rejectUnknownDemandFields(input, MockCampusMarketApi.DEMAND_CREATE_FIELDS);
    const user = this.currentUser();
    const c = this.parseDemandConditions(input, user);
    const mine = this.db.demandSubscriptions.filter((s) => s.userId === user.id && s.fingerprint === c.fingerprint);

    const existing = mine.find((s) => s.active);
    if (existing) return { outcome: 'EXISTING', subscription: this.projectSubscription(existing) };
    // 同一教材版本只能有一条启用订阅：条件不同也不另建，引导修改原订阅
    if (c.textbookEditionId && this.db.demandSubscriptions.some((s) => s.userId === user.id && s.active && s.textbookEditionId === c.textbookEditionId)) {
      throw ApiError.mock({ code: 409, message: '你已订阅这个教材版本，可以修改原订阅的范围或预算' });
    }

    if (this.activeDemandCount(user.id) >= MAX_ACTIVE_SUBSCRIPTIONS) {
      throw ApiError.mock({ code: 409, message: `启用中的订阅已达 ${MAX_ACTIVE_SUBSCRIPTIONS} 个上限，请先停用一些` });
    }
    const inactive = [...mine].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0];
    if (inactive) {
      inactive.active = true;
      inactive.updatedAt = Date.now();
      this.persist();
      return { outcome: 'REACTIVATED', subscription: this.projectSubscription(inactive) };
    }
    const now = Date.now();
    const subscription: MockDemandSubscription = {
      id: uid('ds'), userId: user.id, schoolId: c.school as string,
      keyword: c.keyword, normalizedKeyword: c.normalizedKeyword, category: c.category,
      minPrice: c.minPrice, maxPrice: c.maxPrice, geoScope: c.geoScope as MockDemandSubscription['geoScope'],
      campusId: c.campusId, buildingId: c.buildingId, fingerprint: c.fingerprint, textbookEditionId: c.textbookEditionId,
      circleId: c.circleId, active: true, createdAt: now, updatedAt: now,
    };
    this.db.demandSubscriptions.push(subscription);
    this.persist();
    return { outcome: 'CREATED', subscription: this.projectSubscription(subscription) };
  }

  async listDemandSubscriptions() {
    const user = this.currentUser();
    return this.db.demandSubscriptions
      .filter((s) => s.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .map((s) => this.projectSubscription(s));
  }

  async updateDemandSubscription(id: string, patch: import('./contracts').DemandConditions & { active?: boolean }) {
    this.rejectUnknownDemandFields(patch, MockCampusMarketApi.DEMAND_PATCH_FIELDS);
    const user = this.currentUser();
    const current = this.db.demandSubscriptions.find((s) => s.id === id && s.userId === user.id);
    if (!current) throw ApiError.mock({ code: 404, message: '订阅不存在' });

    const merged: import('./contracts').DemandConditions = {
      keyword: current.keyword, category: current.category as import('./contracts').DemandConditions['category'],
      minPrice: current.minPrice, maxPrice: current.maxPrice, geoScope: current.geoScope,
      campusId: current.campusId as import('./contracts').DemandConditions['campusId'], buildingId: current.buildingId,
      textbookEditionId: current.textbookEditionId ?? null,
      circleId: current.circleId ?? null,
    };
    const { active: nextActive, ...conditions } = patch;
    Object.assign(merged, conditions);
    // 与后端一致：切换范围时，旧范围的锚点不带入新范围
    if ('geoScope' in patch && !('campusId' in patch)) merged.campusId = null;
    if ('geoScope' in patch && !('buildingId' in patch)) merged.buildingId = null;
    const active = typeof nextActive === 'boolean' ? nextActive : current.active;
    // 与后端一致：只有继续启用时才要求仍是圈子的在籍成员
    const c = this.parseDemandConditions(merged, user, active);

    if (active) {
      const clash = this.db.demandSubscriptions.find((s) => s.userId === user.id && s.active && s.fingerprint === c.fingerprint && s.id !== id);
      if (clash) throw ApiError.mock({ code: 409, message: '已有一条相同条件的订阅' });
      if (c.textbookEditionId && this.db.demandSubscriptions.some((s) => s.userId === user.id && s.active && s.id !== id && s.textbookEditionId === c.textbookEditionId)) {
        throw ApiError.mock({ code: 409, message: '你已订阅这个教材版本' });
      }
      if (!current.active && this.activeDemandCount(user.id) >= MAX_ACTIVE_SUBSCRIPTIONS) {
        throw ApiError.mock({ code: 409, message: `启用中的订阅已达 ${MAX_ACTIVE_SUBSCRIPTIONS} 个上限，请先停用一些` });
      }
    }
    Object.assign(current, {
      keyword: c.keyword, normalizedKeyword: c.normalizedKeyword, category: c.category,
      minPrice: c.minPrice, maxPrice: c.maxPrice, geoScope: c.geoScope, campusId: c.campusId,
      buildingId: c.buildingId, fingerprint: c.fingerprint, active, updatedAt: Date.now(),
    });
    this.persist();
    return this.projectSubscription(current);
  }

  async deleteDemandSubscription(id: string) {
    const user = this.currentUser();
    const current = this.db.demandSubscriptions.find((s) => s.id === id && s.userId === user.id);
    if (!current) throw ApiError.mock({ code: 404, message: '订阅不存在' });
    current.active = false;
    current.updatedAt = Date.now();
    this.persist();
    return this.projectSubscription(current);
  }

  /**
   * 对一件商品重新计算全部匹配。与 REST 的 DemandMatchService.evaluate 同一套步骤：
   * 不在售 → 候选为空；否则按硬性条件筛选、评分、写入或刷新；不再命中的标记失效。
   */
  private evaluateDemand(product: Product): void {
    const keep = new Set<string>();
    if (product.status === '在售') {
      const school = this.schoolOf(product.campus);
      const building = this.buildingById(product.buildingId);
      const zone = building?.zone ?? null;
      const title = normalizeDemandText(product.title);
      const description = normalizeDemandText(product.description);
      const textbookEditionId = this.db.productTextbooks[product.id]?.textbookEditionId ?? null;

      // 模块 6：公开商品只匹配普通订阅；圈子商品只匹配绑定了其中某个圈子、且订阅人仍在籍的订阅
      const circles = (product.visibility ?? 'PUBLIC') === 'CIRCLE_ONLY' ? this.db.productCircleVisibility[product.id] ?? [] : null;
      const candidates = this.db.demandSubscriptions.filter((s) => {
        if (!s.active || s.schoolId !== school || s.userId === product.sellerId) return false;
        if (circles === null ? !!s.circleId : !s.circleId || !circles.includes(s.circleId) || !this.activeMember(s.circleId, s.userId)) return false;
        if (s.category && s.category !== product.category) return false;
        // 精确教材版本订阅只命中关联了同一版本的商品（不按书名）
        if (s.textbookEditionId && s.textbookEditionId !== textbookEditionId) return false;
        if (s.minPrice !== null && s.minPrice > product.price) return false;
        if (s.maxPrice !== null && s.maxPrice < product.price) return false;
        if (s.normalizedKeyword && !containsKeyword(title, s.normalizedKeyword) && !containsKeyword(description, s.normalizedKeyword)) return false;
        switch (s.geoScope) {
          case 'SCHOOL': return true;
          case 'CAMPUS': return s.campusId === product.campus;
          case 'BUILDING': return !!product.buildingId && s.buildingId === product.buildingId;
          case 'ZONE': return !!product.buildingId && s.campusId === product.campus && this.buildingById(s.buildingId)?.zone === zone;
        }
      });

      const scored = candidates.map((s) => ({
        s,
        result: scoreDemandMatch({
          normalizedKeyword: s.normalizedKeyword, category: s.category, minPrice: s.minPrice, maxPrice: s.maxPrice,
          geoScope: s.geoScope, campusId: s.campusId, buildingId: s.buildingId,
          anchorZone: this.buildingById(s.buildingId)?.zone ?? null, textbookEditionId: s.textbookEditionId ?? null,
        }, {
          normalizedTitle: title, normalizedDescription: description, category: product.category,
          price: product.price, campus: product.campus, buildingId: product.buildingId ?? null, zone, textbookEditionId,
        }),
      }));
      scored.sort((a, b) => b.result.score - a.result.score || a.s.createdAt - b.s.createdAt || a.s.id.localeCompare(b.s.id));

      for (const { s, result } of scored) {
        keep.add(s.id);
        const existing = this.db.demandMatches.find((m) => m.subscriptionId === s.id && m.productId === product.id);
        if (existing) {
          // 与 REST 的 ON CONFLICT 分支一致：刷新分数理由、清除失效；已读 / 已忽略保持不变
          existing.score = result.score;
          existing.reasonCodes = result.reasonCodes;
          existing.invalidatedAt = null;
        } else {
          this.db.demandMatches.push({
            id: uid('dm'), subscriptionId: s.id, productId: product.id, score: result.score,
            reasonCodes: result.reasonCodes, readAt: null, dismissedAt: null, invalidatedAt: null, createdAt: Date.now(),
          });
        }
      }
    }
    const now = Date.now();
    for (const m of this.db.demandMatches) {
      if (m.productId === product.id && !keep.has(m.subscriptionId) && m.invalidatedAt === null && m.dismissedAt === null) {
        m.invalidatedAt = now;
      }
    }
  }

  private isOwnMatch(m: MockDemandMatch, userId: string): boolean {
    return this.db.demandSubscriptions.some((s) => s.id === m.subscriptionId && s.userId === userId);
  }

  async listDemandMatches(page = 1, pageSize = 20): Promise<import('./contracts').DemandMatchPage> {
    const user = this.currentUser();
    const mine = this.db.demandMatches
      .filter((m) => {
        const p = this.db.market.products.find((x) => x.id === m.productId);
        return m.dismissedAt === null && this.isOwnMatch(m, user.id) && !!p && this.visibleTo(p, user.id);
      })
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    const items = mine.slice((page - 1) * pageSize, page * pageSize).flatMap((m) => {
      const product = this.db.market.products.find((p) => p.id === m.productId);
      const subscription = this.db.demandSubscriptions.find((s) => s.id === m.subscriptionId);
      if (!product || !subscription) return [];
      const onSale = product.status === '在售';
      const { active: _active, matchCount: _count, createdAt: _c, updatedAt: _u, ...sub } = this.projectSubscription(subscription);
      return [{
        id: m.id, score: m.score, tier: mockTier(m.score), reasonCodes: m.reasonCodes as import('./contracts').DemandReasonCode[],
        read: m.readAt !== null,
        valid: m.invalidatedAt === null && onSale,
        invalidReason: m.invalidatedAt !== null ? 'NO_LONGER_MATCHES' as const : onSale ? null : 'NOT_ON_SALE' as const,
        createdAt: m.createdAt,
        // 买家视角：卖家联系方式不出现在收件箱里
        product: this.withBuilding(product),
        subscription: sub,
      }];
    });
    return { items, total: mine.length, page, pageSize };
  }

  async getDemandUnreadCount(): Promise<number> {
    const user = this.currentUser();
    return this.db.demandMatches.filter((m) => {
      const s = this.db.demandSubscriptions.find((x) => x.id === m.subscriptionId);
      const p = this.db.market.products.find((x) => x.id === m.productId);
      return !!s && s.userId === user.id && s.active && m.readAt === null && m.dismissedAt === null
        && m.invalidatedAt === null && p?.status === '在售' && this.visibleTo(p, user.id);
    }).length;
  }

  async markDemandMatchRead(id: string): Promise<number> {
    const user = this.currentUser();
    const m = this.db.demandMatches.find((x) => x.id === id);
    if (!m || !this.isOwnMatch(m, user.id)) throw ApiError.mock({ code: 404, message: '匹配不存在' });
    m.readAt ??= Date.now();
    this.persist();
    return this.getDemandUnreadCount();
  }

  async dismissDemandMatch(id: string): Promise<number> {
    const user = this.currentUser();
    const m = this.db.demandMatches.find((x) => x.id === id);
    if (!m || !this.isOwnMatch(m, user.id)) throw ApiError.mock({ code: 404, message: '匹配不存在' });
    m.dismissedAt ??= Date.now();
    m.readAt ??= Date.now();
    this.persist();
    return this.getDemandUnreadCount();
  }

  /* ============================ 卖家声明（模块 3） ============================ */
  //
  // 与 REST 的 InspectionService 对齐：发布 / 编辑时的卖家声明规则。
  // 订单验货、档期、到达与交易履历随站内交易一起停用（阶段 1），这里不再提供。

  private templateFor(category: string): MockInspectionTemplate | null {
    return seedInspectionTemplates.find((t) => t.category === category) ?? null;
  }

  async getInspectionTemplate(category: Product['category']): Promise<import('./contracts').InspectionTemplate | null> {
    if (!CATEGORIES.includes(category)) throw ApiError.mock({ code: 400, message: '分类无效' });
    const t = this.templateFor(category);
    if (!t) return null;
    return { category: t.category, version: t.version, title: t.title, items: t.items.map((i) => ({ ...i })) };
  }

  /** 与后端 InspectionService.parseDisclosure 同一规则。 */
  private parseDisclosure(category: string, raw: unknown): MockDisclosure | null {
    const t = this.templateFor(category);
    if (!t) {
      if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
        throw ApiError.mock({ code: 400, message: '该分类没有验货清单，请不要提交清单' });
      }
      return null;
    }
    if (!Array.isArray(raw)) throw ApiError.mock({ code: 400, message: '该分类需要填写验货清单' });
    const byCode = new Map(t.items.map((i) => [i.code, i]));
    const seen = new Set<string>();
    const items: MockDisclosure['items'] = [];
    for (const element of raw) {
      if (!element || typeof element !== 'object') throw ApiError.mock({ code: 400, message: '验货清单格式无效' });
      rejectUnknownKeys(element, ['itemCode', 'condition', 'note'], '验货清单');
      const { itemCode, condition } = element as Record<string, unknown>;
      if (typeof itemCode !== 'string' || !byCode.has(itemCode)) throw ApiError.mock({ code: 400, message: '验货条目不存在' });
      if (seen.has(itemCode)) throw ApiError.mock({ code: 400, message: '验货条目重复' });
      seen.add(itemCode);
      if (typeof condition !== 'string' || !(DECLARED_CONDITIONS as readonly string[]).includes(condition)) {
        throw ApiError.mock({ code: 400, message: '验货条目状态无效' });
      }
      items.push({ code: itemCode, condition: condition as MockDisclosure['items'][number]['condition'], note: note((element as Record<string, unknown>).note, 200) });
    }
    for (const item of t.items) {
      if (item.required && !seen.has(item.code)) throw ApiError.mock({ code: 400, message: '请逐项填写验货清单中的必填项' });
    }
    return { templateId: t.id, items };
  }

  private productDisclosureView(productId: string): import('./contracts').ProductDisclosure | null {
    const d = this.db.productDisclosures[productId];
    if (!d) return null;
    const t = seedInspectionTemplates.find((x) => x.id === d.templateId);
    if (!t) return null;
    return {
      category: t.category, version: t.version, title: t.title,
      items: t.items.map((i) => {
        const declared = d.items.find((x) => x.code === i.code);
        return { ...i, condition: declared?.condition ?? null, note: declared?.note ?? '' };
      }),
    };
  }

  /* ============================ 课程教材图谱（模块 4） ============================ */
  //
  // 与 REST 的 CatalogService / TextbookSuggestionService / MarketService（教材关联）逐条对齐：
  // 学校隔离（他校 id 一律 404）、只公开 VERIFIED、精确版本与其他版本分开、建议永远是 PENDING。

  // ======================================================================
  // 模块 6：圈子与成员管理——与 REST 的 CircleService 逐条对齐（无权访问与不存在一律 404）
  // ======================================================================

  private static readonly CIRCLE_TYPES: readonly string[] = ['CLASS', 'CLUB', 'INTEREST', 'OTHER'];

  private circleEvent(circleId: string, actorId: string, targetId: string | null, code: string, detail: string | null = null): void {
    this.db.circleSeq += 1;
    this.db.circleEvents.push({ seq: this.db.circleSeq, circleId, actorId, targetId, code, detail, at: Date.now() });
  }

  private membershipOf(circleId: string, userId: string) {
    return this.db.circleMemberships.find((m) => m.circleId === circleId && m.userId === userId && m.status === 'ACTIVE') ?? null;
  }

  /** 圈子对这个人「存在」：本校，且（在籍成员，或 DISCOVERABLE 且在用）。 */
  private visibleCircle(id: string, userId: string) {
    const user = this.db.users.find((u) => u.id === userId)!;
    const circle = this.db.circles.find((c) => c.id === id);
    if (!circle || circle.schoolId !== this.schoolOf(user.campus)) throw ApiError.mock({ code: 404, message: '圈子不存在' });
    if (this.membershipOf(id, userId)) return circle;
    if (circle.status === 'ACTIVE' && circle.visibility === 'DISCOVERABLE') return circle;
    throw ApiError.mock({ code: 404, message: '圈子不存在' });
  }

  private circleManagerRole(id: string, userId: string): import('./contracts').CircleRole {
    const m = this.membershipOf(id, userId);
    if (!m) throw ApiError.mock({ code: 404, message: '圈子不存在' });
    if (m.role === 'MEMBER') throw ApiError.mock({ code: 403, message: '只有圈子的所有者或管理员可以进行这个操作' });
    return m.role;
  }

  private circleView(c: import('./mockMigrations').MockCircle, role: import('./contracts').CircleRole): import('./contracts').Circle {
    return { id: c.id, type: c.type, name: c.name, description: c.description, visibility: c.visibility, status: c.status,
      userCreated: true, joined: true, myRole: role, createdAt: c.createdAt };
  }

  private circleName(raw: unknown): string {
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: '请填写圈子名称' });
    const value = raw.trim().replace(/\s+/gu, ' ');
    if (value.length < 2 || value.length > 30) throw ApiError.mock({ code: 400, message: '圈子名称应为 2～30 个字' });
    if (/[<>]/.test(value)) throw ApiError.mock({ code: 400, message: '圈子名称不能包含尖括号' });
    return value;
  }

  private circleDescription(raw: unknown): string {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: '简介格式无效' });
    const value = raw.trim();
    if (value.length > 200) throw ApiError.mock({ code: 400, message: '简介最多 200 个字' });
    if (/[<>]/.test(value)) throw ApiError.mock({ code: 400, message: '简介不能包含尖括号' });
    return value;
  }

  async createCircle(input: import('./contracts').CircleInput): Promise<import('./contracts').Circle> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['type', 'name', 'description', 'visibility'], '圈子');
    // 模块 7：只禁止新建圈子
    this.requireUnrestricted(user.id, 'CIRCLE_CREATION');
    if (!MockCampusMarketApi.CIRCLE_TYPES.includes(String(input.type))) throw ApiError.mock({ code: 400, message: '圈子类型无效' });
    const visibility = input.visibility ?? 'PRIVATE';
    if (visibility !== 'PRIVATE' && visibility !== 'DISCOVERABLE') throw ApiError.mock({ code: 400, message: '可见范围无效' });
    const name = this.circleName(input.name);
    const description = this.circleDescription(input.description);
    this.supplyLimit('circle', user.id, 10, 86_400_000);
    const now = Date.now();
    const circle = { id: uid('circle'), schoolId: this.schoolOf(user.campus) as string, type: input.type, name, description, visibility,
      ownerId: user.id, status: 'ACTIVE' as const, createdAt: now, updatedAt: now, archivedAt: null };
    this.db.circles.push(circle);
    this.db.circleMemberships.push({ circleId: circle.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: now, updatedAt: now, endedAt: null });
    this.circleEvent(circle.id, user.id, user.id, 'CIRCLE_CREATED');
    this.persist();
    return this.circleView(circle, 'OWNER');
  }

  async listMyCircles(): Promise<import('./contracts').Circle[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    return this.db.circleMemberships.filter((m) => m.userId === user.id && m.status === 'ACTIVE')
      .map((m) => ({ m, c: this.db.circles.find((c) => c.id === m.circleId)! }))
      .filter(({ c }) => !!c)
      .sort((a, b) => (a.c.status < b.c.status ? -1 : a.c.status > b.c.status ? 1 : a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : a.c.id < b.c.id ? -1 : 1))
      .map(({ m, c }) => this.circleView(c, m.role));
  }

  async discoverCircles(q?: string): Promise<import('./contracts').DiscoverableCircle[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    const query = q?.trim().toLowerCase() || null;
    if (query && query.length > 30) throw ApiError.mock({ code: 400, message: '搜索词最多 30 个字' });
    const school = this.schoolOf(user.campus);
    return this.db.circles.filter((c) => c.schoolId === school && c.status === 'ACTIVE' && c.visibility === 'DISCOVERABLE'
      && (!query || c.name.toLowerCase().includes(query)))
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)).slice(0, 50)
      .map((c) => ({ id: c.id, type: c.type, name: c.name, description: c.description, userCreated: true as const, joined: !!this.membershipOf(c.id, user.id) }));
  }

  async getCircle(id: string): Promise<import('./contracts').Circle | import('./contracts').DiscoverableCircle> {
    this.syncFromStorage();
    const user = this.currentUser();
    const circle = this.visibleCircle(id, user.id);
    const m = this.membershipOf(id, user.id);
    if (m) return this.circleView(circle, m.role);
    return { id: circle.id, type: circle.type, name: circle.name, description: circle.description, userCreated: true, joined: false };
  }

  async updateCircle(id: string, patch: Partial<import('./contracts').CircleInput>): Promise<import('./contracts').Circle> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(patch, ['type', 'name', 'description', 'visibility'], '圈子');
    const circle = this.visibleCircle(id, user.id);
    const role = this.circleManagerRole(id, user.id);
    if (circle.status !== 'ACTIVE') throw ApiError.mock({ code: 409, message: '圈子已归档' });
    if (('visibility' in patch || 'type' in patch) && role !== 'OWNER') throw ApiError.mock({ code: 403, message: '只有所有者可以修改圈子的类型与可见范围' });
    if ('type' in patch && !MockCampusMarketApi.CIRCLE_TYPES.includes(String(patch.type))) throw ApiError.mock({ code: 400, message: '圈子类型无效' });
    if ('visibility' in patch && patch.visibility !== 'PRIVATE' && patch.visibility !== 'DISCOVERABLE') throw ApiError.mock({ code: 400, message: '可见范围无效' });
    Object.assign(circle, {
      ...('type' in patch ? { type: patch.type } : {}),
      ...('name' in patch ? { name: this.circleName(patch.name) } : {}),
      ...('description' in patch ? { description: this.circleDescription(patch.description) } : {}),
      ...('visibility' in patch ? { visibility: patch.visibility } : {}),
      updatedAt: Date.now(),
    });
    this.circleEvent(id, user.id, null, 'CIRCLE_UPDATED');
    this.persist();
    return this.circleView(circle, role);
  }

  async archiveCircle(id: string): Promise<import('./contracts').Circle> {
    this.syncFromStorage();
    const user = this.currentUser();
    const circle = this.visibleCircle(id, user.id);
    if (this.circleManagerRole(id, user.id) !== 'OWNER') throw ApiError.mock({ code: 403, message: '只有所有者可以归档圈子' });
    if (circle.status === 'ACTIVE') {
      this.archiveCircleRecord(circle, user.id);
      this.persist();
    }
    return this.circleView(circle, 'OWNER');
  }

  /** 所有者归档与工作人员强制归档共用的清理（与后端 CircleService.archive / archiveAsStaff 相同） */
  private archiveCircleRecord(circle: import('./mockMigrations').MockCircle, actorId: string): void {
    const id = circle.id;
    const now = Date.now();
    Object.assign(circle, { status: 'ARCHIVED', archivedAt: now, updatedAt: now });
    for (const i of this.db.circleInvites) if (i.circleId === id && i.status === 'PENDING') Object.assign(i, { status: 'REVOKED', revokedAt: now });
    const subs = this.db.demandSubscriptions.filter((s) => s.circleId === id);
    for (const s of subs) { s.active = false; s.updatedAt = now }
    for (const m of this.db.demandMatches) if (m.invalidatedAt === null && subs.some((s) => s.id === m.subscriptionId)) m.invalidatedAt = now;
    this.circleEvent(id, actorId, null, 'CIRCLE_ARCHIVED');
  }

  async listCircleProducts(id: string, page = 1): Promise<import('./contracts').FeedPage> {
    this.syncFromStorage();
    const user = this.currentUser();
    this.visibleCircle(id, user.id);
    if (!this.membershipOf(id, user.id)) throw ApiError.mock({ code: 404, message: '圈子不存在' });
    return this.feedProducts({ scope: 'SCHOOL', sort: 'latest', page, pageSize: 20 } as import('./contracts').FeedQuery,
      (p) => (this.db.productCircleVisibility[p.id] ?? []).includes(id));
  }

  async createCircleInvite(id: string, expiresInHours?: number): Promise<import('./contracts').CircleInviteCreated> {
    this.syncFromStorage();
    const user = this.currentUser();
    const circle = this.visibleCircle(id, user.id);
    this.circleManagerRole(id, user.id);
    if (circle.status !== 'ACTIVE') throw ApiError.mock({ code: 409, message: '圈子已归档' });
    const hours = expiresInHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw ApiError.mock({ code: 400, message: '有效期应为 1～168 小时' });
    this.supplyLimit('circleInvite', user.id, 30, 86_400_000);
    const token = randomToken();
    const now = Date.now();
    const invite = { id: uid('cinv'), circleId: id, createdBy: user.id, tokenHash: sha256Hex(token), status: 'PENDING' as const,
      redeemedBy: null, expiresAt: now + hours * 3_600_000, createdAt: now, redeemedAt: null, revokedAt: null };
    this.db.circleInvites.push(invite);
    this.circleEvent(id, user.id, null, 'INVITE_CREATED');
    this.persist();
    // 原始邀请码只出现在这一次返回值里；localStorage 只有哈希
    return { invite: this.circleInviteView(invite), token };
  }

  private circleInviteView(i: import('./mockMigrations').MockCircleInvite): import('./contracts').CircleInvite {
    return { id: i.id, status: i.status === 'PENDING' && i.expiresAt <= Date.now() ? 'EXPIRED' : i.status, expiresAt: i.expiresAt, createdAt: i.createdAt };
  }

  async listCircleInvites(id: string): Promise<import('./contracts').CircleInvite[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    this.visibleCircle(id, user.id);
    this.circleManagerRole(id, user.id);
    return this.db.circleInvites.filter((i) => i.circleId === id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((i) => this.circleInviteView(i));
  }

  /** 每次尝试都计入限流；各种失败对外都是同一个 404，不透露邀请码或圈子是否存在。 */
  async redeemCircleInvite(token: string): Promise<import('./contracts').Circle> {
    this.syncFromStorage();
    const user = this.currentUser();
    this.supplyLimit('circleRedeem', user.id, 10, 600_000);
    const invalid = () => ApiError.mock({ code: 404, message: '邀请码无效或已失效' });
    if (typeof token !== 'string' || !token.trim() || token.length > 200) throw invalid();
    const invite = this.db.circleInvites.find((i) => i.tokenHash === sha256Hex(token.trim()));
    // 7.1D 与后端相同的有效性规则：可用 = PENDING 且未过期；原兑换者重放 = REDEEMED 且兑换人是本人；其余一律同一个 404
    const usable = !!invite && invite.status === 'PENDING' && invite.expiresAt > Date.now();
    const replay = !!invite && invite.status === 'REDEEMED' && invite.redeemedBy === user.id;
    if (!invite || (!usable && !replay)) throw invalid();
    const circle = this.db.circles.find((c) => c.id === invite.circleId);
    if (!circle || circle.status !== 'ACTIVE' || circle.schoolId !== this.schoolOf(user.campus)) throw invalid();
    // 6.1C：邀请有效且本人已在该圈在籍 → 幂等返回圈子，不消耗邀请码、不占名额
    const mine = this.membershipOf(circle.id, user.id);
    if (mine) return this.circleView(circle, mine.role);
    // 原兑换者已退出 / 被移除：这个码已经用过，不能用来重新加入
    if (!usable) throw invalid();
    // 单圈 1000 人在籍上限（含 OWNER；LEFT / REMOVED 不占名额）；满员时邀请码不被消耗
    if (this.db.circleMemberships.filter((m) => m.circleId === circle.id && m.status === 'ACTIVE').length >= CIRCLE_MEMBER_LIMIT) {
      throw ApiError.mock({ code: 409, message: `圈子人数已达上限（${CIRCLE_MEMBER_LIMIT} 人）` });
    }
    const now = Date.now();
    Object.assign(invite, { status: 'REDEEMED', redeemedBy: user.id, redeemedAt: now });
    const existing = this.db.circleMemberships.find((m) => m.circleId === circle.id && m.userId === user.id);
    if (existing) Object.assign(existing, { role: 'MEMBER', status: 'ACTIVE', joinedAt: now, updatedAt: now, endedAt: null });
    else this.db.circleMemberships.push({ circleId: circle.id, userId: user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: now, updatedAt: now, endedAt: null });
    this.circleEvent(circle.id, user.id, user.id, 'MEMBER_JOINED', 'MEMBER');
    this.persist();
    return this.circleView(circle, 'MEMBER');
  }

  async revokeCircleInvite(inviteId: string): Promise<import('./contracts').CircleInvite> {
    this.syncFromStorage();
    const user = this.currentUser();
    const invite = this.db.circleInvites.find((i) => i.id === inviteId);
    if (!invite) throw ApiError.mock({ code: 404, message: '邀请不存在' });
    const m = this.membershipOf(invite.circleId, user.id);
    if (!m || m.role === 'MEMBER') throw ApiError.mock({ code: 404, message: '邀请不存在' });
    if (invite.status === 'PENDING') {
      Object.assign(invite, { status: 'REVOKED', revokedAt: Date.now() });
      this.circleEvent(invite.circleId, user.id, null, 'INVITE_REVOKED');
      this.persist();
    }
    return this.circleInviteView(invite);
  }

  /** 管理所需的最小公共投影：昵称、头像、角色、加入时间。 */
  /** 6.1C：分页（默认 20、最大 100），角色优先级 → 加入时间 → userId 的稳定排序，与后端索引一致。 */
  async listCircleMembers(id: string, page = 1, size = 20): Promise<import('./contracts').CircleMemberPage> {
    this.syncFromStorage();
    const user = this.currentUser();
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw ApiError.mock({ code: 400, message: 'page 无效' });
    if (!Number.isInteger(size) || size < 1 || size > 100) throw ApiError.mock({ code: 400, message: 'size 无效' });
    this.visibleCircle(id, user.id);
    this.circleManagerRole(id, user.id);
    const order = { OWNER: 0, MODERATOR: 1, MEMBER: 2 } as const;
    const all = this.db.circleMemberships.filter((m) => m.circleId === id && m.status === 'ACTIVE')
      .sort((a, b) => order[a.role] - order[b.role] || a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
    const items = all.slice((page - 1) * size, page * size).map((m) => {
      const u = this.db.users.find((x) => x.id === m.userId);
      return { userId: m.userId, nickname: u?.nickname ?? '', avatar: this.avatarOut(u?.avatar), role: m.role, joinedAt: m.joinedAt };
    });
    return { items, total: all.length, page, size };
  }

  async changeCircleMemberRole(id: string, userId: string, role: import('./contracts').CircleRole): Promise<import('./contracts').CircleMemberPage> {
    this.syncFromStorage();
    const user = this.currentUser();
    const circle = this.visibleCircle(id, user.id);
    if (circle.status !== 'ACTIVE') throw ApiError.mock({ code: 409, message: '圈子已归档' });
    if (this.circleManagerRole(id, user.id) !== 'OWNER') throw ApiError.mock({ code: 403, message: '只有所有者可以调整成员角色' });
    if (!['OWNER', 'MODERATOR', 'MEMBER'].includes(role)) throw ApiError.mock({ code: 400, message: '角色无效' });
    const target = this.membershipOf(id, userId);
    if (!target) throw ApiError.mock({ code: 404, message: '成员不存在' });
    if (userId === user.id) throw ApiError.mock({ code: 400, message: '所有者不能修改自己的角色；需要时请把所有者转让给其他成员' });
    const now = Date.now();
    if (role === 'OWNER') {
      Object.assign(this.membershipOf(id, user.id)!, { role: 'MODERATOR', updatedAt: now });
      Object.assign(target, { role: 'OWNER', updatedAt: now });
      circle.ownerId = userId;
      this.circleEvent(id, user.id, userId, 'OWNER_TRANSFERRED', 'OWNER');
    } else if (target.role !== role) {
      Object.assign(target, { role, updatedAt: now });
      this.circleEvent(id, user.id, userId, 'ROLE_CHANGED', role);
    }
    this.persist();
    return this.listCircleMembers(id, 1, 20);
  }

  async removeCircleMember(id: string, userId: string): Promise<{ userId: string; status: 'LEFT' | 'REMOVED' }> {
    this.syncFromStorage();
    const user = this.currentUser();
    this.visibleCircle(id, user.id);
    const mine = this.membershipOf(id, user.id);
    if (!mine) throw ApiError.mock({ code: 404, message: '圈子不存在' });
    const theirs = this.membershipOf(id, userId);
    if (!theirs) throw ApiError.mock({ code: 404, message: '成员不存在' });
    const self = userId === user.id;
    if (self && mine.role === 'OWNER') throw ApiError.mock({ code: 409, message: '所有者不能直接退出，请先把所有者转让给其他成员，或归档圈子' });
    if (!self) {
      if (mine.role === 'MEMBER') throw ApiError.mock({ code: 403, message: '普通成员不能管理其他成员' });
      if (theirs.role === 'OWNER') throw ApiError.mock({ code: 403, message: '不能移除圈子所有者' });
      if (mine.role === 'MODERATOR' && theirs.role !== 'MEMBER') throw ApiError.mock({ code: 403, message: '管理员只能移除普通成员' });
    }
    const now = Date.now();
    const status = self ? 'LEFT' as const : 'REMOVED' as const;
    Object.assign(theirs, { status, role: 'MEMBER', endedAt: now, updatedAt: now });
    // 离开后：圈子订阅停用、匹配失效（未读随之清零），私密商品立即不可见，这些商品上的联系申请随之从列表中消失
    const subs = this.db.demandSubscriptions.filter((s) => s.circleId === id && s.userId === userId);
    for (const s of subs) if (s.active) { s.active = false; s.updatedAt = now }
    for (const m of this.db.demandMatches) if (m.invalidatedAt === null && subs.some((s) => s.id === m.subscriptionId)) m.invalidatedAt = now;
    this.circleEvent(id, user.id, userId, self ? 'MEMBER_LEFT' : 'MEMBER_REMOVED');
    this.persist();
    return { userId, status };
  }

  // ======================================================================
  // 模块 5：毕业季通用供给引擎——与 REST 的 ListingDraftService / ListingBatchService /
  // AssistInviteService / PriceGuidanceService 逐条对齐
  // ======================================================================

  private static readonly DRAFT_EXPIRY_MS = 30 * 86_400_000;

  private expireDraft(d: MockListingDraft): boolean {
    if ((d.status === 'DRAFT' || d.status === 'READY') && d.expiresAt <= Date.now()) {
      d.status = 'EXPIRED';
      d.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  private activeBatchOf(draftId: string): MockListingBatch | undefined {
    return this.db.listingBatches.find((b) => b.items.some((i) => i.draftId === draftId && i.active));
  }

  private activeInvite(i: MockAssistInvite, assistantId: string, draftId: string): boolean {
    if (i.status !== 'ACTIVE' || i.assistantId !== assistantId || i.expiresAt <= Date.now()) return false;
    if (i.draftId === draftId) return true;
    return !!i.batchId && this.db.listingBatches.some((b) => b.id === i.batchId && b.items.some((x) => x.draftId === draftId && x.active));
  }

  private draftAccess(d: MockListingDraft | undefined, userId: string): 'OWNER' | 'ASSISTANT' {
    if (!d) throw ApiError.mock({ code: 404, message: '草稿不存在' });
    if (d.ownerId === userId) return 'OWNER';
    if (this.db.listingAssistInvites.some((i) => this.activeInvite(i, userId, d.id))) return 'ASSISTANT';
    throw ApiError.mock({ code: 404, message: '草稿不存在' });
  }

  /** 草稿投影：协助人看不到联系方式；任何人都看不到所有者与编辑人的 id。 */
  private draftView(d: MockListingDraft, access: 'OWNER' | 'ASSISTANT'): ListingDraft {
    const payload: ListingPayload = JSON.parse(JSON.stringify(d.payload));
    if (access === 'ASSISTANT') { delete payload.contact; delete payload.contactPublic; }
    // 与后端相同：草稿响应里的上传图片是可显示的地址（Mock 为 data: 地址），保存时再还原成 upload:<id>
    if (Array.isArray(payload.images)) payload.images = payload.images.map((image) => this.draftImageUrlOf(image));
    return {
      id: d.id, draftType: d.draftType, status: d.status, version: d.version, payload, access,
      editedByAssistant: d.editorId !== d.ownerId, batchId: this.activeBatchOf(d.id)?.id ?? null,
      publishedProductId: d.publishedProductId, expiresAt: d.expiresAt, createdAt: d.createdAt, updatedAt: d.updatedAt,
    };
  }

  async createListingDraft(input: { draftType?: ListingKind; payload?: ListingPayload }): Promise<ListingDraft> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['draftType', 'payload'], '草稿');
    const type = input.draftType ?? 'SINGLE';
    if (type !== 'SINGLE' && type !== 'BUNDLE') throw ApiError.mock({ code: 400, message: '草稿类型无效' });
    const payload = sanitizePayload(this.draftPayloadIn(input.payload), false);
    this.supplyLimit('draft', user.id, 120, 3_600_000);
    const now = Date.now();
    const draft: MockListingDraft = {
      id: uid('draft'), ownerId: user.id, editorId: user.id, draftType: type, payload, version: 1, status: 'DRAFT',
      expiresAt: now + MockCampusMarketApi.DRAFT_EXPIRY_MS, publishedProductId: null, createdAt: now, updatedAt: now,
    };
    this.db.listingDrafts.push(draft);
    this.persist();
    return this.draftView(draft, 'OWNER');
  }

  async listListingDrafts(): Promise<ListingDraft[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    const mine = this.db.listingDrafts.filter((d) => d.ownerId === user.id);
    if (mine.map((d) => this.expireDraft(d)).some(Boolean)) this.persist();
    return mine.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)).slice(0, 200).map((d) => this.draftView(d, 'OWNER'));
  }

  async listAssistingDrafts(): Promise<ListingDraft[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    return this.db.listingDrafts
      .filter((d) => d.ownerId !== user.id && this.db.listingAssistInvites.some((i) => this.activeInvite(i, user.id, d.id)))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((d) => this.draftView(d, 'ASSISTANT'));
  }

  async getListingDraft(id: string): Promise<ListingDraft> {
    this.syncFromStorage();
    const user = this.currentUser();
    const d = this.db.listingDrafts.find((x) => x.id === id);
    const access = this.draftAccess(d, user.id);
    if (this.expireDraft(d!)) this.persist();
    return this.draftView(d!, access);
  }

  async updateListingDraft(id: string, input: { expectedVersion: number; payload?: ListingPayload; status?: 'DRAFT' | 'READY' }): Promise<ListingDraft> {
    // 多标签页：先以 localStorage 为准，否则另一个标签页刚保存的版本会被这边的旧副本静默覆盖
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['expectedVersion', 'payload', 'status'], '草稿');
    const d = this.db.listingDrafts.find((x) => x.id === id);
    const access = this.draftAccess(d, user.id);
    const draft = d!;
    const expected = input.expectedVersion;
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1) {
      throw ApiError.mock({ code: 400, message: '请提供 expectedVersion，防止覆盖其他页面的修改' });
    }
    if (this.expireDraft(draft)) { this.persist(); throw ApiError.mock({ code: 409, message: '草稿已过期，不能再修改' }) }
    if (draft.status !== 'DRAFT' && draft.status !== 'READY') throw ApiError.mock({ code: 409, message: '草稿已发布、已丢弃或已过期，不能再修改' });
    const payload = 'payload' in input ? sanitizePayload(this.draftPayloadIn(input.payload), access === 'ASSISTANT') : JSON.parse(JSON.stringify(draft.payload)) as ListingPayload;
    if (access === 'ASSISTANT') {
      // 与 REST 一致：协助人只能整理白名单字段，其余字段必须原样保留
      const before = draft.payload as Record<string, unknown>;
      const after = payload as Record<string, unknown>;
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (ASSISTANT_FIELDS.includes(key) || key === 'contact' || key === 'contactPublic') continue;
        if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
          throw ApiError.mock({ code: 403, message: '协助人只能整理标题、描述、分类、价格建议、打包明细与取货楼栋建议' });
        }
      }
      if (draft.payload.contact !== undefined) payload.contact = draft.payload.contact;
      if (draft.payload.contactPublic !== undefined) payload.contactPublic = draft.payload.contactPublic;
    }
    const nextStatus = input.status ?? 'DRAFT';
    if (nextStatus !== 'DRAFT' && nextStatus !== 'READY') throw ApiError.mock({ code: 400, message: '草稿状态只能是 DRAFT 或 READY' });
    if (nextStatus === 'READY') {
      if (access === 'ASSISTANT') throw ApiError.mock({ code: 403, message: '只有商品所有者可以把草稿标记为可发布' });
      const result = validateListing(payload, draft.draftType, this.validationContext(draft.ownerId));
      if (result.code !== 'VALID') throw ApiError.mock({ code: 400, message: `草稿还不能发布：${result.message}`, details: result });
    }
    if (draft.version !== expected) {
      throw ApiError.mock({ code: 409, message: '草稿已被其他页面或协助人更新，请重新加载后再修改', details: { currentVersion: draft.version } });
    }
    const now = Date.now();
    Object.assign(draft, { payload, status: nextStatus, editorId: user.id, version: draft.version + 1, updatedAt: now, expiresAt: now + MockCampusMarketApi.DRAFT_EXPIRY_MS });
    if (access === 'ASSISTANT') {
      const invite = this.db.listingAssistInvites.filter((i) => this.activeInvite(i, user.id, draft.id)).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (invite) this.assistEvent(invite.id, user.id, 'ASSIST_DRAFT_EDITED', draft.id);
    }
    this.persist();
    return this.draftView(draft, access);
  }

  async discardListingDraft(id: string): Promise<ListingDraft> {
    this.syncFromStorage();
    const user = this.currentUser();
    const d = this.db.listingDrafts.find((x) => x.id === id && x.ownerId === user.id);
    if (!d) throw ApiError.mock({ code: 404, message: '草稿不存在' });
    if (this.activeBatchOf(d.id)) throw ApiError.mock({ code: 409, message: '这个草稿还在批次里，请先从批次中移除' });
    this.expireDraft(d);
    if (d.status === 'DISCARDED') return this.draftView(d, 'OWNER');
    if (d.status !== 'DRAFT' && d.status !== 'READY') throw ApiError.mock({ code: 409, message: '草稿已发布或已过期，不能丢弃' });
    d.status = 'DISCARDED';
    d.updatedAt = Date.now();
    this.persist();
    return this.draftView(d, 'OWNER');
  }

  private validationContext(ownerId?: string): ValidationContext {
    const owner = this.db.users.find((u) => u.id === (ownerId ?? this.viewerId()));
    const ownerSchool = this.schoolOf(owner?.campus);
    return {
      // 6.1A：草稿的校区必须属于所有者本人的学校
      campusValid: (campus) => !!this.schoolOf(campus) && (!ownerSchool || this.schoolOf(campus) === ownerSchool),
      circlesUsable: (circleIds, campus) => {
        const school = this.schoolOf(campus);
        const owner = ownerId ?? this.viewerId();
        return !!owner && circleIds.every((cid) => this.db.circles.some((c) => c.id === cid && c.schoolId === school && c.status === 'ACTIVE')
          && this.activeMember(cid, owner));
      },
      building: (id) => {
        const b = this.buildingById(id);
        return b ? { campusId: b.campusId, active: b.active !== false } : null;
      },
      parseDisclosure: (category, raw) => this.parseDisclosure(category, raw),
      editionInSchoolOf: (editionId, campus) => {
        const school = this.schoolOf(campus);
        return !!school && this.db.catalog.editions.some((e) => e.id === editionId && e.schoolId === school && e.active !== false);
      },
    };
  }

  private draftClosed(d: MockListingDraft): ListingValidation | null {
    const expired = d.expiresAt <= Date.now();
    if ((d.status !== 'DRAFT' && d.status !== 'READY') || expired) {
      return { code: 'DRAFT_CLOSED', field: 'status', message: '草稿已发布、已丢弃或已过期' };
    }
    return null;
  }

  private batchView(b: MockListingBatch): ListingBatch {
    const open = b.status === 'OPEN';
    const ctx = this.validationContext(b.ownerId);
    let allValid = b.items.length > 0;
    let assisted = false;
    const items = [...b.items].sort((x, y) => x.position - y.position).map((item) => {
      const d = this.db.listingDrafts.find((x) => x.id === item.draftId)!;
      const draft = this.draftView(d, 'OWNER');
      assisted ||= draft.editedByAssistant;
      const view: ListingBatch['items'][number] = { position: item.position, draft, productId: item.productId };
      if (open) {
        const validation = this.draftClosed(d) ?? validateListing(d.payload, d.draftType, ctx);
        allValid &&= validation.code === 'VALID';
        view.validation = validation;
      }
      return view;
    });
    return { id: b.id, status: b.status, version: b.version, items, allValid: open && allValid, assisted, createdAt: b.createdAt, publishedAt: b.publishedAt };
  }

  private ownBatch(id: string, userId: string): MockListingBatch {
    const b = this.db.listingBatches.find((x) => x.id === id && x.ownerId === userId);
    if (!b) throw ApiError.mock({ code: 404, message: '批次不存在' });
    return b;
  }

  private batchDraftIds(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw ApiError.mock({ code: 400, message: 'draftIds 格式无效' });
    if (raw.length > BATCH_MAX_ITEMS) throw ApiError.mock({ code: 400, message: `一个批次最多 ${BATCH_MAX_ITEMS} 件商品` });
    const ids = raw.map(String);
    if (new Set(ids).size !== ids.length) throw ApiError.mock({ code: 400, message: '同一个草稿不能在批次里出现两次' });
    return ids;
  }

  private attachDrafts(batch: MockListingBatch, userId: string, ids: string[]): void {
    for (const id of ids) {
      const d = this.db.listingDrafts.find((x) => x.id === id && x.ownerId === userId);
      if (!d) throw ApiError.mock({ code: 404, message: '草稿不存在' });
      this.expireDraft(d);
      if (d.status !== 'DRAFT' && d.status !== 'READY') throw ApiError.mock({ code: 409, message: '只能把未发布、未丢弃、未过期的草稿加入批次' });
      const other = this.activeBatchOf(id);
      if (other && other.id !== batch.id) throw ApiError.mock({ code: 409, message: '有草稿已经在另一个未发布的批次里' });
    }
    batch.items = ids.map((draftId, index) => ({ draftId, position: index + 1, active: true, productId: null }));
  }

  async createListingBatch(input: { draftIds?: string[] }): Promise<ListingBatch> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['draftIds'], '批次');
    const ids = this.batchDraftIds(input.draftIds);
    const now = Date.now();
    const batch: MockListingBatch = { id: uid('batch'), ownerId: user.id, status: 'OPEN', version: 1, items: [], createdAt: now, updatedAt: now, publishedAt: null };
    this.attachDrafts(batch, user.id, ids);
    this.db.listingBatches.push(batch);
    this.persist();
    return this.batchView(batch);
  }

  async listListingBatches(): Promise<ListingBatchSummary[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    return this.db.listingBatches.filter((b) => b.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
      .map((b) => ({ id: b.id, status: b.status, version: b.version, itemCount: b.items.length, createdAt: b.createdAt, publishedAt: b.publishedAt }));
  }

  async getListingBatch(id: string): Promise<ListingBatch> {
    this.syncFromStorage();
    return this.batchView(this.ownBatch(id, this.currentUser().id));
  }

  async updateListingBatch(id: string, input: { expectedVersion: number; draftIds: string[] }): Promise<ListingBatch> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['expectedVersion', 'draftIds'], '批次');
    const batch = this.ownBatch(id, user.id);
    if (batch.status !== 'OPEN') throw ApiError.mock({ code: 409, message: '批次已发布或已丢弃，不能再修改' });
    if (typeof input.expectedVersion !== 'number' || input.expectedVersion < 1) throw ApiError.mock({ code: 400, message: '请提供 expectedVersion' });
    if (batch.version !== input.expectedVersion) throw ApiError.mock({ code: 409, message: '批次已被其他页面更新，请重新加载' });
    const ids = this.batchDraftIds(input.draftIds);
    const previous = batch.items;
    batch.items = [];
    try {
      this.attachDrafts(batch, user.id, ids);
    } catch (e) {
      batch.items = previous;
      throw e;
    }
    batch.version += 1;
    batch.updatedAt = Date.now();
    this.persist();
    return this.batchView(batch);
  }

  async discardListingBatch(id: string): Promise<ListingBatch> {
    this.syncFromStorage();
    const batch = this.ownBatch(id, this.currentUser().id);
    if (batch.status === 'OPEN') {
      batch.status = 'DISCARDED';
      batch.updatedAt = Date.now();
      for (const item of batch.items) item.active = false;
      this.persist();
    }
    return this.batchView(batch);
  }

  /**
   * 整批发布：全部成功或全部不发布。与 REST 相同的顺序：限流 → 幂等 → 批次状态 → 逐项校验
   * （任一不通过 400，逐项原因放在 details.items，什么都不写）→ 逐条创建商品（含同步需求匹配）。
   * 中途任何一步失败，内存恢复到发布前的副本，localStorage 也从未写入中间状态。
   */
  async publishListingBatch(id: string, idempotencyKey: string): Promise<PublishBatchResult> {
    this.syncFromStorage();
    const user = this.currentUser();
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.length > 100) {
      throw ApiError.mock({ code: 400, message: '请提供 8～100 位的 Idempotency-Key' });
    }
    this.supplyLimit('publish', user.id, 30, 3_600_000);
    const hash = sha256Hex(`listing-batch-publish\nbatch=${id}`);
    const previous = this.db.listingPublishRequests.find((r) => r.ownerId === user.id && r.key === idempotencyKey);
    if (previous) {
      if (previous.requestHash !== hash) throw ApiError.mock({ code: 409, message: '这个 Idempotency-Key 已用于另一次发布' });
      return { batchId: previous.batchId, productIds: [...previous.productIds], publishedCount: previous.productIds.length, replayed: true };
    }
    // 模块 7：发布受限时整批不发布（同键重放上面已经原样返回）
    this.requireUnrestricted(user.id, 'PUBLISHING');
    const batch = this.ownBatch(id, user.id);
    if (batch.status !== 'OPEN') throw ApiError.mock({ code: 409, message: '批次已发布或已丢弃' });
    if (batch.items.length === 0) throw ApiError.mock({ code: 400, message: '批次里还没有商品' });
    const ctx = this.validationContext(batch.ownerId);
    const ordered = [...batch.items].sort((a, b) => a.position - b.position);
    const drafts = ordered.map((item) => this.db.listingDrafts.find((d) => d.id === item.draftId)!);
    const problems = drafts.flatMap((d, i) => {
      const r = this.draftClosed(d) ?? validateListing(d.payload, d.draftType, ctx);
      return r.code === 'VALID' ? [] : [{ ...r, position: ordered[i].position, draftId: d.id }];
    });
    if (problems.length) {
      throw ApiError.mock({ code: 400, message: `有 ${problems.length} 件商品还不能发布，整个批次都没有发布`, details: { items: problems } });
    }
    const lastEditor = new Map<string, { actorId: string; inviteId: string }>();
    for (const e of [...this.db.listingAssistEvents].sort((a, b) => a.seq - b.seq)) {
      if (e.code === 'ASSIST_DRAFT_EDITED' && e.draftId) lastEditor.set(e.draftId, { actorId: e.actorId, inviteId: e.inviteId });
    }
    const backup = JSON.stringify(this.db);
    this.persistSuspended = true;
    const productIds: string[] = [];
    try {
      drafts.forEach((d, i) => {
        const body = { ...JSON.parse(JSON.stringify(d.payload)), listingKind: d.draftType } as ProductCreateInput;
        const product = this.createProductAs(user, body, lastEditor.get(d.id)?.actorId ?? null);
        d.status = 'PUBLISHED';
        d.publishedProductId = product.id;
        d.updatedAt = Date.now();
        ordered[i].productId = product.id;
        productIds.push(product.id);
      });
      batch.status = 'PUBLISHED';
      batch.publishedAt = Date.now();
      batch.updatedAt = batch.publishedAt;
      for (const item of batch.items) item.active = false;
      this.db.listingPublishRequests.push({ ownerId: user.id, key: idempotencyKey, requestHash: hash, batchId: batch.id, productIds: [...productIds] });
      for (const inviteId of new Set([...lastEditor.entries()].filter(([draftId]) => drafts.some((d) => d.id === draftId)).map(([, v]) => v.inviteId))) {
        this.assistEvent(inviteId, user.id, 'PUBLISHED_AFTER_ASSIST', null);
      }
    } catch (e) {
      this.db = JSON.parse(backup) as MockDatabase;
      throw e;
    } finally {
      this.persistSuspended = false;
    }
    this.persist();
    return { batchId: batch.id, productIds, publishedCount: productIds.length, replayed: false };
  }

  private assistEvent(inviteId: string, actorId: string, code: AssistEvent['code'], draftId: string | null): void {
    this.db.assistSeq += 1;
    this.db.listingAssistEvents.push({ seq: this.db.assistSeq, inviteId, actorId, code, draftId, at: Date.now() });
  }

  private inviteView(i: MockAssistInvite): AssistInvite {
    const expired = i.status !== 'REVOKED' && i.expiresAt <= Date.now();
    const assistant = i.assistantId ? this.db.users.find((u) => u.id === i.assistantId) : undefined;
    return {
      id: i.id, scope: i.draftId ? 'DRAFT' : 'BATCH', draftId: i.draftId, batchId: i.batchId,
      status: expired ? 'EXPIRED' : i.status, assistantNickname: assistant?.nickname ?? null, expiresAt: i.expiresAt, createdAt: i.createdAt,
    };
  }

  /**
   * 创建邀请。原始邀请码只在返回值里出现这一次：localStorage 里只有它的 SHA-256，
   * 界面只在当前会话的组件内存中展示它，关闭后无法再次取回（与 REST 一致）。
   */
  async createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }): Promise<AssistInviteCreated> {
    this.syncFromStorage();
    const user = this.currentUser();
    rejectUnknownKeys(input, ['draftId', 'batchId', 'expiresInHours'], '邀请');
    const { draftId = null, batchId = null } = input;
    if ((draftId === null) === (batchId === null)) throw ApiError.mock({ code: 400, message: '请指定一个草稿或一个批次' });
    let hours = 24;
    if (input.expiresInHours !== undefined) {
      if (typeof input.expiresInHours !== 'number' || !Number.isInteger(input.expiresInHours) || input.expiresInHours < 1 || input.expiresInHours > 168) {
        throw ApiError.mock({ code: 400, message: '有效期应为 1～168 小时' });
      }
      hours = input.expiresInHours;
    }
    if (draftId) {
      const d = this.db.listingDrafts.find((x) => x.id === draftId && x.ownerId === user.id);
      if (!d) throw ApiError.mock({ code: 404, message: '草稿不存在' });
      if (d.status !== 'DRAFT' && d.status !== 'READY') throw ApiError.mock({ code: 409, message: '草稿已不可编辑' });
    } else {
      const b = this.ownBatch(batchId!, user.id);
      if (b.status !== 'OPEN') throw ApiError.mock({ code: 409, message: '批次已发布或已丢弃' });
    }
    this.supplyLimit('invite', user.id, 20, 86_400_000);
    const token = randomToken();
    const now = Date.now();
    const invite: MockAssistInvite = {
      id: uid('invite'), ownerId: user.id, draftId, batchId, tokenHash: sha256Hex(token), status: 'PENDING', assistantId: null,
      expiresAt: now + hours * 3_600_000, createdAt: now, redeemedAt: null, revokedAt: null,
    };
    this.db.listingAssistInvites.push(invite);
    this.assistEvent(invite.id, user.id, 'INVITE_CREATED', draftId);
    this.persist();
    return { invite: this.inviteView(invite), token };
  }

  async listAssistInvites(): Promise<AssistInvite[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    return this.db.listingAssistInvites.filter((i) => i.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
      .map((i) => this.inviteView(i));
  }

  /** 兑换：每次尝试都计入限流；各种失败对外是同一个 404，不透露邀请码是否存在过。 */
  async redeemAssistInvite(token: string): Promise<AssistInviteRedeemed> {
    this.syncFromStorage();
    const user = this.currentUser();
    this.supplyLimit('redeem', user.id, 10, 600_000);
    const invalid = () => ApiError.mock({ code: 404, message: '邀请码无效或已失效' });
    if (typeof token !== 'string' || !token.trim() || token.length > 200) throw invalid();
    const hash = sha256Hex(token.trim());
    const invite = this.db.listingAssistInvites.find((i) => i.tokenHash === hash);
    if (!invite || invite.ownerId === user.id || invite.status !== 'PENDING' || invite.expiresAt <= Date.now()) throw invalid();
    invite.status = 'ACTIVE';
    invite.assistantId = user.id;
    invite.redeemedAt = Date.now();
    this.assistEvent(invite.id, user.id, 'INVITE_REDEEMED', invite.draftId);
    this.persist();
    return { inviteId: invite.id, drafts: await this.listAssistingDrafts() };
  }

  async revokeAssistInvite(id: string): Promise<AssistInvite> {
    this.syncFromStorage();
    const user = this.currentUser();
    const invite = this.db.listingAssistInvites.find((i) => i.id === id && i.ownerId === user.id);
    if (!invite) throw ApiError.mock({ code: 404, message: '邀请不存在' });
    if (invite.status !== 'REVOKED') {
      invite.status = 'REVOKED';
      invite.revokedAt = Date.now();
      this.assistEvent(invite.id, user.id, 'INVITE_REVOKED', invite.draftId);
      this.persist();
    }
    return this.inviteView(invite);
  }

  async listAssistEvents(id: string): Promise<AssistEvent[]> {
    this.syncFromStorage();
    const user = this.currentUser();
    const invite = this.db.listingAssistInvites.find((i) => i.id === id && i.ownerId === user.id);
    if (!invite) throw ApiError.mock({ code: 404, message: '邀请不存在' });
    return this.db.listingAssistEvents.filter((e) => e.inviteId === id).sort((a, b) => a.seq - b.seq)
      .map((e) => ({ code: e.code, byOwner: e.actorId === user.id, draftId: e.draftId, at: e.at }));
  }

  private static readonly TERMS: readonly string[] = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  private static readonly TERM_ORDER: Record<string, number> = { AUTUMN: 0, SUMMER: 1, SPRING: 2, WINTER: 3 };
  private static readonly USAGE_ORDER: Record<string, number> = { REQUIRED: 0, RECOMMENDED: 1, REFERENCE: 2 };
  private static readonly SUGGESTION_FIELDS = ['courseOfferingId', 'textbookEditionId', 'isbn', 'title', 'authors', 'publisher',
    'editionLabel', 'publishedYear', 'usageType', 'note'];
  private static readonly SUGGESTIONS_PER_DAY = 10;

  /** 与 REST 同一口径：字节序比较（后端 ORDER BY … COLLATE "C"）。 */
  private static byCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  private viewerSchool(): string {
    this.syncFromStorage();
    const school = this.schoolOf(this.currentUser().campus);
    if (!school) throw ApiError.mock({ code: 401, message: '登录已失效，请重新登录' });
    return school;
  }

  private editionOf(school: string, id: string | null | undefined) {
    return this.db.catalog.editions.find((e) => e.id === id && e.schoolId === school && e.active !== false) ?? null;
  }

  private onSaleCount(editionId: string): number {
    // 模块 6：只计当前查看者可见的商品
    const viewer = this.viewerId();
    return this.db.market.products.filter((p) => p.status === '在售' && this.db.productTextbooks[p.id]?.textbookEditionId === editionId && this.visibleTo(p, viewer)).length;
  }

  private editionView(e: import('../data/courseCatalog').MockEdition): import('./contracts').TextbookEdition {
    return {
      id: e.id, isbn: e.normalizedIsbn, isbn10: e.isbn10 ?? null, title: e.title, subtitle: e.subtitle ?? null,
      authors: [...e.authors], publisher: e.publisher, editionLabel: e.editionLabel, publishedYear: e.publishedYear,
      coverUrl: e.coverUrl ?? null, isDemo: e.isDemo, onSaleCount: this.onSaleCount(e.id),
    };
  }

  private activeOffering(o: import('../data/courseCatalog').MockOffering) { return o.active !== false }

  /** 已验证的课程—教材关系（PENDING / REJECTED 永不出现在公开目录）。 */
  private verifiedTextbooksOf(offeringIds: string[]) {
    return this.db.catalog.courseTextbooks
      .filter((t) => t.verificationStatus === 'VERIFIED' && offeringIds.includes(t.courseOfferingId))
      .map((t) => ({ t, e: this.db.catalog.editions.find((e) => e.id === t.textbookEditionId && e.active !== false) }))
      .filter((x): x is { t: typeof x.t; e: NonNullable<typeof x.e> } => !!x.e)
      .sort((a, b) => MockCampusMarketApi.byCodeUnits(a.t.courseOfferingId, b.t.courseOfferingId)
        || MockCampusMarketApi.USAGE_ORDER[a.t.usageType] - MockCampusMarketApi.USAGE_ORDER[b.t.usageType]
        || MockCampusMarketApi.byCodeUnits(a.e.title, b.e.title) || MockCampusMarketApi.byCodeUnits(a.e.id, b.e.id));
  }

  private courseSummary(c: import('../data/courseCatalog').MockCourse): import('./contracts').CourseSummary {
    return { id: c.id, courseCode: c.courseCode, name: c.name, department: c.department, isDemo: c.isDemo };
  }

  private offeringView(o: import('../data/courseCatalog').MockOffering): import('./contracts').CourseOffering {
    return {
      id: o.id, courseId: o.courseId, academicYear: o.academicYear, term: o.term, instructorName: o.instructorName,
      campusId: o.campusId, textbooks: this.verifiedTextbooksOf([o.id]).map(({ t, e }) => ({ usageType: t.usageType, edition: this.editionView(e) })),
    };
  }

  async listCourses(query: import('./contracts').CourseQuery): Promise<import('./contracts').CoursePage> {
    const school = this.viewerSchool();
    const rawQ = query.q ?? '';
    if (rawQ.length > 80) throw ApiError.mock({ code: 400, message: '搜索词最多 80 个字' });
    const q = normalizeDemandText(rawQ) || null;
    const compact = q ? q.toUpperCase().replace(/ /g, '') : null;
    const codePrefix = compact && /^[A-Z0-9-]{1,20}$/.test(compact) ? compact : null;
    if (query.term && !MockCampusMarketApi.TERMS.includes(query.term)) throw ApiError.mock({ code: 400, message: '学期无效' });
    if (query.academicYear && !/^[0-9]{4}-[0-9]{4}$/.test(query.academicYear)) throw ApiError.mock({ code: 400, message: '学年格式应为 2026-2027' });
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1 || page > 10_000) throw ApiError.mock({ code: 400, message: 'page 无效' });
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw ApiError.mock({ code: 400, message: 'pageSize 无效' });

    const offerings = this.db.catalog.offerings.filter((o) => this.activeOffering(o));
    const matched = this.db.catalog.courses
      .filter((c) => c.schoolId === school && c.active !== false)
      .filter((c) => !q || c.normalizedName.includes(q) || (!!codePrefix && !!c.courseCode && c.courseCode.startsWith(codePrefix)))
      .filter((c) => !(query.term || query.academicYear || query.campus) || offerings.some((o) => o.courseId === c.id
        && (!query.term || o.term === query.term) && (!query.academicYear || o.academicYear === query.academicYear)
        && (!query.campus || o.campusId === query.campus)))
      .sort((a, b) => MockCampusMarketApi.byCodeUnits(a.normalizedName, b.normalizedName) || MockCampusMarketApi.byCodeUnits(a.id, b.id));
    const items = matched.slice((page - 1) * pageSize, page * pageSize).map((c) => {
      const mine = offerings.filter((o) => o.courseId === c.id);
      const editions = new Set(this.verifiedTextbooksOf(mine.map((o) => o.id)).map(({ e }) => e.id));
      return { ...this.courseSummary(c), offeringCount: mine.length, textbookCount: editions.size };
    });
    return { items, total: matched.length, page, pageSize };
  }

  async getCourse(courseId: string): Promise<import('./contracts').CourseDetail> {
    const school = this.viewerSchool();
    const course = this.db.catalog.courses.find((c) => c.id === courseId && c.schoolId === school && c.active !== false);
    if (!course) throw ApiError.mock({ code: 404, message: '课程不存在' });
    const offerings = this.db.catalog.offerings
      .filter((o) => o.courseId === course.id && this.activeOffering(o))
      .sort((a, b) => MockCampusMarketApi.byCodeUnits(b.academicYear, a.academicYear)
        || MockCampusMarketApi.TERM_ORDER[a.term] - MockCampusMarketApi.TERM_ORDER[b.term]
        || MockCampusMarketApi.byCodeUnits(a.id, b.id));
    return { ...this.courseSummary(course), offerings: offerings.map((o) => this.offeringView(o)) };
  }

  async getCourseOffering(offeringId: string): Promise<import('./contracts').OfferingDetail> {
    const school = this.viewerSchool();
    const o = this.db.catalog.offerings.find((x) => x.id === offeringId && x.schoolId === school && this.activeOffering(x));
    const course = o && this.db.catalog.courses.find((c) => c.id === o.courseId && c.active !== false);
    if (!o || !course) throw ApiError.mock({ code: 404, message: '开课不存在' });
    return { ...this.offeringView(o), course: { id: course.id, name: course.name, courseCode: course.courseCode, isDemo: course.isDemo } };
  }

  async getTextbookByIsbn(isbn: string): Promise<import('./contracts').TextbookEdition> {
    const school = this.viewerSchool();
    const parsed = parseIsbn(isbn);
    if (!parsed.ok) throw ApiError.mock({ code: 400, message: isbnProblem(isbn) ?? 'ISBN 无效' });
    const edition = this.db.catalog.editions.find((e) => e.schoolId === school && e.normalizedIsbn === parsed.isbn13 && e.active !== false);
    if (!edition) throw ApiError.mock({ code: 404, message: '本校教材目录中没有这个 ISBN' });
    return this.editionView(edition);
  }

  async getTextbook(editionId: string, sort?: 'nearest' | 'latest'): Promise<import('./contracts').TextbookDetail> {
    const school = this.viewerSchool();
    const edition = this.editionOf(school, editionId);
    if (!edition) throw ApiError.mock({ code: 404, message: '教材版本不存在' });
    const courses = this.db.catalog.courseTextbooks
      .filter((t) => t.textbookEditionId === edition.id && t.schoolId === school && t.verificationStatus === 'VERIFIED')
      .flatMap((t) => {
        const o = this.db.catalog.offerings.find((x) => x.id === t.courseOfferingId && this.activeOffering(x));
        const c = o && this.db.catalog.courses.find((x) => x.id === o.courseId && x.active !== false);
        return o && c ? [{ t, o, c }] : [];
      })
      .sort((a, b) => MockCampusMarketApi.byCodeUnits(b.o.academicYear, a.o.academicYear)
        || MockCampusMarketApi.byCodeUnits(a.c.name, b.c.name) || MockCampusMarketApi.byCodeUnits(a.o.id, b.o.id))
      .map(({ t, o, c }) => ({
        courseId: c.id, courseName: c.name, courseCode: c.courseCode, offeringId: o.id, academicYear: o.academicYear,
        term: o.term, instructorName: o.instructorName, usageType: t.usageType,
      }));

    const viewer = this.currentUser();
    const listingSort: 'nearest' | 'latest' = sort === 'latest' || !viewer.dormBuildingId ? 'latest' : 'nearest';
    const others = edition.workKey
      ? this.db.catalog.editions
        .filter((e) => e.schoolId === school && e.workKey === edition.workKey && e.id !== edition.id && e.active !== false)
        .sort((a, b) => (b.publishedYear ?? -1) - (a.publishedYear ?? -1) || MockCampusMarketApi.byCodeUnits(a.id, b.id))
      : [];
    return {
      ...this.editionView(edition),
      courses,
      listingSort,
      // 精确版本与其他版本分两次取、分两个字段返回，从不混在一起排序
      listings: await this.textbookListings([edition.id], listingSort),
      otherEditions: others.map((e) => ({
        id: e.id, isbn: e.normalizedIsbn, title: e.title, editionLabel: e.editionLabel, publisher: e.publisher,
        publishedYear: e.publishedYear, onSaleCount: this.onSaleCount(e.id),
      })),
      otherEditionListings: others.length ? await this.textbookListings(others.map((e) => e.id), listingSort) : [],
    };
  }

  /** 教材商品流：复用楼栋集市 feed 的排序与距离（同一份公式），只额外限定版本与在售。 */
  private async textbookListings(editionIds: string[], sort: 'nearest' | 'latest'): Promise<import('./contracts').FeedProduct[]> {
    const filter = (p: Product) => p.status === '在售' && editionIds.includes(this.db.productTextbooks[p.id]?.textbookEditionId ?? '');
    const query = { scope: 'SCHOOL' as const, sort: sort === 'nearest' ? 'nearest' as const : 'latest' as const, page: 1, pageSize: 20 };
    try {
      return (await this.feedProducts(query, filter)).items;
    } catch (e) {
      // 与 REST 一致：宿舍楼刚被停用等情况退回最新排序，不让整个教材页失败
      if (sort !== 'nearest') throw e;
      return (await this.feedProducts({ ...query, sort: 'latest' }, filter)).items;
    }
  }

  /** 商品卡片上的教材版本：关联时的快照 + 关联课程名（与 REST 的 tb_json 同一结构）。 */
  private productTextbookView(productId: string): import('./contracts').ProductTextbook | null {
    const link = this.db.productTextbooks[productId];
    if (!link) return null;
    const offeringIds = this.db.catalog.courseTextbooks
      .filter((t) => t.textbookEditionId === link.textbookEditionId && t.verificationStatus === 'VERIFIED')
      .map((t) => t.courseOfferingId);
    const names = new Set(this.db.catalog.offerings
      .filter((o) => offeringIds.includes(o.id) && this.activeOffering(o))
      .flatMap((o) => this.db.catalog.courses.filter((c) => c.id === o.courseId && c.active !== false).map((c) => c.name)));
    return {
      editionId: link.textbookEditionId, isbn: link.isbnSnapshot, title: link.titleSnapshot,
      editionLabel: link.editionSnapshot, publisher: link.publisherSnapshot,
      courseNames: [...names].sort(MockCampusMarketApi.byCodeUnits),
    };
  }

  /** 与 REST 的 MarketService.resolveTextbook 一致：只接受本校目录中的版本 id，从不按书名猜版本。 */
  private resolveTextbook(raw: unknown, category: string, campus: string) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: 'textbookEditionId 格式无效' });
    if (category !== '教材书籍') throw ApiError.mock({ code: 400, message: '只有教材书籍分类的商品可以关联教材版本' });
    const school = this.schoolOf(campus);
    const edition = school ? this.editionOf(school, raw.trim()) : null;
    if (!edition) throw ApiError.mock({ code: 404, message: '教材版本不存在' });
    return edition;
  }

  /** 关联并保存快照；版本不变时不改写快照（与 REST 的 ON CONFLICT … WHERE 一致）。 */
  private linkTextbook(productId: string, edition: import('../data/courseCatalog').MockEdition): void {
    const current = this.db.productTextbooks[productId];
    if (current && current.textbookEditionId === edition.id) return;
    const now = Date.now();
    this.db.productTextbooks[productId] = {
      schoolId: edition.schoolId, textbookEditionId: edition.id, isbnSnapshot: edition.normalizedIsbn,
      titleSnapshot: edition.title, editionSnapshot: edition.editionLabel, publisherSnapshot: edition.publisher,
      createdAt: current?.createdAt ?? now, updatedAt: now,
    };
  }

  async createTextbookSuggestion(input: import('./contracts').TextbookSuggestionInput): Promise<import('./contracts').TextbookSuggestionResult> {
    rejectUnknownKeys(input, MockCampusMarketApi.SUGGESTION_FIELDS);
    const school = this.viewerSchool();
    const me = this.currentUser();
    const text = (key: keyof import('./contracts').TextbookSuggestionInput, max: number): string | null => {
      const raw = input[key];
      if (raw === undefined || raw === null) return null;
      if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: `${key} 格式无效` });
      const value = raw.replace(/\s+/g, ' ').trim();
      if (!value) return null;
      if (value.length > max) throw ApiError.mock({ code: 400, message: `${key} 最多 ${max} 个字` });
      if (/[<>]/.test(value)) throw ApiError.mock({ code: 400, message: `${key} 不能包含尖括号` });
      return value;
    };
    const offeringId = text('courseOfferingId', 64);
    if (!offeringId) throw ApiError.mock({ code: 400, message: '请提供 courseOfferingId' });
    if (!this.db.catalog.offerings.some((o) => o.id === offeringId && o.schoolId === school && this.activeOffering(o))) {
      throw ApiError.mock({ code: 404, message: '开课不存在' });
    }
    const usageType = input.usageType ?? 'REQUIRED';
    if (!['REQUIRED', 'RECOMMENDED', 'REFERENCE'].includes(usageType)) throw ApiError.mock({ code: 400, message: '用途无效' });
    const noteText = text('note', 200);
    const metadataKeys = ['isbn', 'title', 'authors', 'publisher', 'editionLabel', 'publishedYear'] as const;

    let editionId = text('textbookEditionId', 64);
    let isbn13: string | null = null, title: string | null = null, authors: string | null = null;
    let publisher: string | null = null, editionLabel: string | null = null, year: number | null = null;
    if (editionId) {
      if (metadataKeys.some((k) => input[k] !== undefined && input[k] !== null)) {
        throw ApiError.mock({ code: 400, message: '选择了目录中的教材版本时，不需要再填写书目信息' });
      }
      if (!this.editionOf(school, editionId)) throw ApiError.mock({ code: 404, message: '教材版本不存在' });
    } else {
      const rawIsbn = text('isbn', 40);
      if (rawIsbn) {
        const parsed = parseIsbn(rawIsbn);
        if (!parsed.ok) throw ApiError.mock({ code: 400, message: isbnProblem(rawIsbn) ?? 'ISBN 无效' });
        const existing = this.db.catalog.editions.find((e) => e.schoolId === school && e.normalizedIsbn === parsed.isbn13 && e.active !== false);
        if (existing) editionId = existing.id; else isbn13 = parsed.isbn13;
      }
      if (!editionId) {
        title = text('title', 120); authors = text('authors', 120); publisher = text('publisher', 80); editionLabel = text('editionLabel', 40);
        if (input.publishedYear !== undefined && input.publishedYear !== null) {
          if (!Number.isInteger(input.publishedYear) || input.publishedYear < 1900 || input.publishedYear > 2100) {
            throw ApiError.mock({ code: 400, message: '出版年份无效' });
          }
          year = input.publishedYear;
        }
        if (!isbn13 && !title) throw ApiError.mock({ code: 400, message: '请提供 ISBN 或书名' });
        if (!isbn13 && (!publisher || !editionLabel)) throw ApiError.mock({ code: 400, message: '没有 ISBN 时，请同时填写出版社和版次' });
      } else if (['title', 'publisher', 'editionLabel', 'authors', 'publishedYear'].some((k) => input[k as keyof typeof input] !== undefined && input[k as keyof typeof input] !== null)) {
        throw ApiError.mock({ code: 400, message: '该 ISBN 已在目录中，不需要再填写书目信息' });
      }
    }
    const fingerprint = ['sg-v1', `offering=${offeringId}`, `edition=${editionId ?? ''}`, `isbn=${isbn13 ?? ''}`,
      `title=${normalizeDemandText(title)}`, `authors=${normalizeDemandText(authors)}`, `publisher=${normalizeDemandText(publisher)}`,
      `edition-label=${normalizeDemandText(editionLabel)}`, `year=${year ?? ''}`, `usage=${usageType}`].join('\n');
    const existing = this.db.textbookSuggestions.find((s) => s.submitterId === me.id && s.status === 'PENDING' && s.fingerprint === fingerprint);
    if (existing) return { outcome: 'EXISTING', suggestion: this.suggestionView(existing) };
    // 与 REST 一致：只有真正新建才计入每日限额（幂等重复提交不计）
    const dayAgo = Date.now() - 86_400_000;
    if (this.db.textbookSuggestions.filter((s) => s.submitterId === me.id && s.createdAt > dayAgo).length >= MockCampusMarketApi.SUGGESTIONS_PER_DAY) {
      throw ApiError.mock({ code: 429, message: '今天提交的教材建议已达上限，请明天再试', retryAfterSeconds: 3600 });
    }
    const suggestion: MockTextbookSuggestion = {
      id: uid('tbs'), submitterId: me.id, schoolId: school, courseOfferingId: offeringId, textbookEditionId: editionId,
      isbn13, title, authors, publisher, editionLabel, publishedYear: year, usageType: usageType as MockTextbookSuggestion['usageType'],
      note: noteText, status: 'PENDING', fingerprint, createdAt: Date.now(), withdrawnAt: null,
    };
    this.db.textbookSuggestions.push(suggestion);
    this.persist();
    return { outcome: 'CREATED', suggestion: this.suggestionView(suggestion) };
  }

  private suggestionView(s: MockTextbookSuggestion): import('./contracts').TextbookSuggestion {
    const o = this.db.catalog.offerings.find((x) => x.id === s.courseOfferingId);
    const c = o && this.db.catalog.courses.find((x) => x.id === o.courseId);
    const e = s.textbookEditionId ? this.db.catalog.editions.find((x) => x.id === s.textbookEditionId) : undefined;
    return {
      id: s.id, courseOfferingId: s.courseOfferingId, courseName: c?.name ?? '', academicYear: o?.academicYear ?? '',
      term: (o?.term ?? 'AUTUMN') as import('./contracts').Term, textbookEditionId: s.textbookEditionId,
      editionTitle: e?.title ?? null, editionEditionLabel: e?.editionLabel ?? null, isbn: s.isbn13, title: s.title,
      authors: s.authors, publisher: s.publisher, editionLabel: s.editionLabel, publishedYear: s.publishedYear,
      usageType: s.usageType, note: s.note, status: s.status, createdAt: s.createdAt,
    };
  }

  async listMyTextbookSuggestions(): Promise<import('./contracts').TextbookSuggestion[]> {
    this.syncFromStorage();
    const me = this.currentUser();
    return this.db.textbookSuggestions
      .filter((s) => s.submitterId === me.id)
      .sort((a, b) => b.createdAt - a.createdAt || MockCampusMarketApi.byCodeUnits(a.id, b.id))
      .map((s) => this.suggestionView(s));
  }

  async withdrawTextbookSuggestion(id: string): Promise<import('./contracts').TextbookSuggestion> {
    this.syncFromStorage();
    const me = this.currentUser();
    const s = this.db.textbookSuggestions.find((x) => x.id === id && x.submitterId === me.id);
    if (!s) throw ApiError.mock({ code: 404, message: '建议不存在' });
    if (s.status === 'PENDING') {
      s.status = 'WITHDRAWN';
      s.withdrawnAt = Date.now();
      this.persist();
    }
    return this.suggestionView(s);
  }

  // 模块 6：只列出当前仍可见的商品，不暴露不可见商品是否存在
  async listFavorites(): Promise<Favorite[]> { const user = this.currentUser(); return this.db.market.favorites.filter((f) => { const p = this.db.market.products.find((x) => x.id === f.productId); return f.userId === user.id && !!p && this.visibleTo(p, user.id) }).map((f) => ({ ...f })) }
  async setFavorite(productId: string, desired: boolean): Promise<boolean> {
    const user = this.currentUser();
    // 模块 6：不可读的商品与不存在一样 404——收藏不能用来探测私密商品
    this.readableProduct(productId);
    const index = this.db.market.favorites.findIndex((f) => f.userId === user.id && f.productId === productId);
    if (desired) {
      // 幂等新增：已存在则什么都不做
      if (index < 0) this.db.market.favorites.unshift({ id: uid('f'), userId: user.id, productId, createdAt: Date.now() });
    } else {
      // 幂等删除：不存在也视为目标状态已满足
      if (index >= 0) this.db.market.favorites.splice(index, 1);
    }
    this.persist();
    return desired;
  }
  /** 7.1E：被隐藏的评论对任何人都不返回正文（作者额外看到可申诉的提示）；原文仍在库里 */
  private commentView(c: Comment, viewerId: string): Comment {
    const { moderationHiddenAt, moderationHiddenActionId: _a, ...rest } = c;
    const hidden = !!moderationHiddenAt;
    return { ...rest, content: hidden ? '' : c.content, moderationHidden: hidden, hiddenForAuthor: hidden && c.userId === viewerId };
  }
  async listComments(productId: string): Promise<Comment[]> { const me = this.currentUser(); this.readableProduct(productId); return this.db.market.comments.filter((c) => c.productId === productId).sort((a, b) => b.createdAt - a.createdAt).map((c) => this.commentView(c, me.id)) }
  async addComment(input: CommentInput): Promise<Comment> { const user = this.currentUser(); this.readableProduct(input.productId); if (!input.content.trim()) throw ApiError.mock({ code: 400, message: '留言内容不能为空' }); requireSafeText(input.content); const comment: Comment = { id: uid('c'), productId: input.productId, userId: user.id, content: input.content.trim(), parentId: input.parentId ?? null, createdAt: Date.now(), moderationHiddenAt: null }; this.db.market.comments.unshift(comment); this.persist(); return this.commentView(comment, user.id) }
  async listConversations(): Promise<Conversation[]> { const user = this.currentUser(); return this.db.market.conversations.filter((c) => this.conversationAccessible(c, user.id)).sort((a, b) => b.updatedAt - a.updatedAt).map((c) => ({ ...c })) }
  async getOrCreateConversation(productId: string): Promise<Conversation> { const user = this.currentUser(); const product = await this.getProduct(productId); if (product.sellerId === user.id) throw ApiError.mock({ code: 400, message: '不能与自己的商品创建会话' }); const found = this.db.market.conversations.find((c) => c.productId === productId && c.buyerId === user.id); if (found) return { ...found }; const now = Date.now(); const conversation: Conversation = { id: uid('conv'), productId, buyerId: user.id, sellerId: product.sellerId, createdAt: now, updatedAt: now }; this.db.market.conversations.unshift(conversation); this.persist(); return { ...conversation } }
  /** 与后端 ConversationMapper.countMember 同一条件：卖家，或仍能读取这件商品的买家 */
  private conversationAccessible(c: Conversation, userId: string): boolean {
    if (c.sellerId === userId) return true;
    const p = this.db.market.products.find((x) => x.id === c.productId);
    return c.buyerId === userId && !!p && this.visibleTo(p, userId);
  }
  async listMessages(conversationId: string): Promise<ChatMessage[]> { const user = this.currentUser(); const c = this.db.market.conversations.find((item) => item.id === conversationId); if (!c || !this.conversationAccessible(c, user.id)) throw ApiError.mock({ code: 404, message: '会话不存在' }); return this.db.market.messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt - b.createdAt).map((m) => this.messageView(m)) }
  /** 7.1E：被隔离的单条私信对双方都只返回占位；会话与其他消息照常 */
  private messageView(m: ChatMessage): ChatMessage {
    const { moderationQuarantinedAt, moderationQuarantineActionId: _a, ...rest } = m;
    // 历史的文字私信没有 templateCode：统一返回 null（照常显示原文）
    return { ...rest, templateCode: rest.templateCode ?? null, content: moderationQuarantinedAt ? '' : m.content, quarantined: !!moderationQuarantinedAt };
  }
  /** GET /v1/message-templates 的离线版本（需登录）：全部模板按固定顺序返回，前端按会话里的身份过滤 */
  async listMessageTemplates(): Promise<MessageTemplateList> {
    this.currentUser();
    return { freeTextEnabled: this.messageFreeTextEnabled, templates: MOCK_MESSAGE_TEMPLATES.map((t) => ({ ...t })) };
  }
  /**
   * 与后端 MessagingPolicy.resolve 相同的顺序：先看请求体（文字关闭时带 content 一律拒绝；开放时两个字段只能二选一），
   * 再确认会话成员，最后核对模板身份（BUYER_* 只给买家、SELLER_* 只给卖家、ANY_* 双方）。文字消息照旧做内容安全检查。
   */
  async sendMessage(conversationId: string, input: SendMessageInput): Promise<ChatMessage> {
    const user = this.currentUser();
    const body = (input ?? {}) as { templateCode?: unknown; content?: unknown };
    const hasContent = 'content' in body;
    const hasTemplate = 'templateCode' in body;
    if (!this.messageFreeTextEnabled) {
      if (hasContent) throw ApiError.mock({ code: 400, message: FREE_TEXT_DISABLED });
      if (!hasTemplate) throw ApiError.mock({ code: 400, message: TEMPLATE_REQUIRED });
    } else if (hasContent && hasTemplate) {
      throw ApiError.mock({ code: 400, message: TEMPLATE_OR_TEXT });
    }
    const template = hasTemplate ? MOCK_MESSAGE_TEMPLATES.find((t) => typeof body.templateCode === 'string' && t.code === body.templateCode) : undefined;
    if (hasTemplate && !template) throw ApiError.mock({ code: 400, message: TEMPLATE_NOT_FOUND });
    await this.listMessages(conversationId);
    const c = this.db.market.conversations.find((item) => item.id === conversationId)!;
    let content: string;
    if (template) {
      const role = c.buyerId === user.id ? 'BUYER' : 'SELLER';
      if (template.role !== 'ANY' && template.role !== role) throw ApiError.mock({ code: 400, message: TEMPLATE_WRONG_ROLE });
      content = template.text;
    } else {
      const text = typeof body.content === 'string' ? body.content : '';
      requireSafeText(text);
      content = text.trim();
    }
    const message: ChatMessage = { id: uid('m'), conversationId, senderId: user.id, content, templateCode: template ? template.code : null, createdAt: Date.now(), moderationQuarantinedAt: null };
    this.db.market.messages.push(message);
    c.updatedAt = message.createdAt;
    this.persist();
    return this.messageView(message);
  }
  async getUnreadCount(): Promise<number> { const user = this.currentUser(); const convs = await this.listConversations(); return convs.filter((c) => { const messages = this.db.market.messages.filter((m) => m.conversationId === c.id); const last = messages[messages.length - 1]; return Boolean(last && last.senderId !== user.id) }).length }

  // ======================================================================
  // 模块 7：可信治理（与后端 governance 包逐条对应）。
  // 阶段 1（V16）：站内交易已停用——订单与爽约复核只作为历史数据保留（只读），不能再被举报或立案；
  // 爽约确认、爽约自动限制与「预约新订单」限制都不再产生；新的限制范围是「申请联系方式」（CONTACT）。
  // ======================================================================

  /** 可以举报 / 立案的对象（后端 ModerationService.TARGETS） */
  private static readonly REPORT_TARGETS: readonly string[] = MODERATION_REPORT_TARGETS;
  /** 案件列表可以筛选的对象：另含历史上的订单与爽约复核案件（后端 ALL_TARGETS，只读） */
  private static readonly CASE_FILTER_TARGETS: readonly string[] = [...MODERATION_REPORT_TARGETS, 'ORDER', 'NO_SHOW'];
  private static readonly REPORT_REASONS: readonly string[] = MODERATION_REPORT_REASONS;
  /** 后端 StaffModerationService.ACTIONS：RESTRICT_BOOKING / CONFIRM_NO_SHOW / REJECT_NO_SHOW 不再被接受 */
  private static readonly DECISION_ACTIONS: readonly string[] = ['HIDE_PRODUCT', 'RESTORE_PRODUCT', 'ARCHIVE_CIRCLE', 'RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION', 'NO_ACTION',
    'HIDE_COMMENT', 'RESTORE_COMMENT', 'QUARANTINE_MESSAGE', 'RELEASE_MESSAGE'];
  private static readonly DECISION_REASONS: readonly string[] = MODERATION_DECISION_REASONS;
  private static readonly HOUR = 3_600_000;
  // ---------------- 7.1C 利益回避（与后端 staff_case_conflict / staff_appeal_conflict 相同的判断） ----------------

  private caseConflict(c: import('./mockMigrations').MockModerationCase, staffId: string): import('./contracts').ConflictReason | null {
    const m = this.db.market;
    switch (c.targetType) {
      case 'USER': if (c.targetId === staffId) return 'SELF_TARGET'; break;
      case 'PRODUCT':
        if (m.products.find((p) => p.id === c.targetId)?.sellerId === staffId) return 'OWN_CONTENT';
        // 阶段 2（V17）：申请过这件商品联系方式的工作人员回避
        if (this.db.contactRequests.some((r) => r.productId === c.targetId && r.buyerId === staffId)) return 'CONTACT_PARTY';
        break;
      case 'COMMENT': if (m.comments.find((x) => x.id === c.targetId)?.userId === staffId) return 'OWN_CONTENT'; break;
      case 'MESSAGE': {
        const msg = m.messages.find((x) => x.id === c.targetId);
        if (msg?.senderId === staffId) return 'OWN_CONTENT';
        const conv = msg && m.conversations.find((x) => x.id === msg.conversationId);
        if (conv && (conv.buyerId === staffId || conv.sellerId === staffId)) return 'OWN_CONVERSATION';
        break;
      }
      case 'CIRCLE': if (this.db.circles.find((x) => x.id === c.targetId)?.ownerId === staffId) return 'OWN_CONTENT'; break;
      case 'ORDER': { const o = m.orders.find((x) => x.id === c.targetId); if (o && (o.buyerId === staffId || o.sellerId === staffId)) return 'OWN_ORDER'; break }
      case 'NO_SHOW': {
        const r = this.db.noShowReports.find((x) => x.id === c.targetId);
        const o = r && m.orders.find((x) => x.id === r.orderId);
        if (o && (o.buyerId === staffId || o.sellerId === staffId)) return 'OWN_ORDER';
        break;
      }
      default: break;
    }
    if (this.db.moderationReports.some((r) => r.caseId === c.id && r.reporterId === staffId)) return 'OWN_REPORT';
    return null;
  }

  private appealConflict(a: import('./mockMigrations').MockModerationAppeal, staffId: string): import('./contracts').ConflictReason | null {
    if (a.userId === staffId) return 'SELF_TARGET';
    const r = a.restrictionId ? this.db.userRestrictions.find((x) => x.id === a.restrictionId) : undefined;
    const act = a.actionId ? this.db.moderationActions.find((x) => x.id === a.actionId) : undefined;
    const reportId = r?.noShowReportId ?? (act?.actionCode === 'CONFIRM_NO_SHOW' ? act.targetId : null);
    const n = reportId ? this.db.noShowReports.find((x) => x.id === reportId) : undefined;
    if (r?.createdBy === staffId || act?.staffId === staffId || n?.decidedBy === staffId) return 'OWN_ACTION';
    if (a.caseId && this.db.moderationActions.some((x) => x.caseId === a.caseId && !x.appealId && x.staffId === staffId)) return 'OWN_ACTION';
    if (n?.reporterId === staffId) return 'OWN_REPORT';
    const o = n && this.db.market.orders.find((x) => x.id === n.orderId);
    if (o && (o.buyerId === staffId || o.sellerId === staffId)) return 'OWN_ORDER';
    const c = a.caseId ? this.db.moderationCases.find((x) => x.id === a.caseId) : undefined;
    return c ? this.caseConflict(c, staffId) : null;
  }

  private activeStaffOf(schoolId: string) {
    return this.db.staffMembers.filter((s) => s.schoolId === schoolId && !!this.staffOf(s.userId));
  }

  private requireNoConflict(reason: import('./contracts').ConflictReason | null, message: string): void {
    if (reason) throw ApiError.mock({ code: 403, message, details: { code: 'CONFLICT_OF_INTEREST', reason } });
  }

  private govNote(raw: unknown, max: number): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') throw ApiError.mock({ code: 400, message: '说明格式无效' });
    const value = raw.trim();
    if (!value) return null;
    if (value.length > max || /[<>]/.test(value)) throw ApiError.mock({ code: 400, message: `说明最多 ${max} 字，且不能包含尖括号` });
    return value;
  }

  private govCode<T extends string>(raw: unknown, allowed: readonly string[], label: string): T {
    if (typeof raw !== 'string' || !allowed.includes(raw)) throw ApiError.mock({ code: 400, message: `${label}无效` });
    return raw as T;
  }

  /**
   * 7.5：限制的唯一检查点（CONTACT / PUBLISHING / CIRCLE_CREATION），与后端 RestrictionGuard.require 相同。
   * 历史上的 BOOKING（限制预约新订单）在到期前按 CONTACT 处理（GovernanceMapper.selectActiveRestriction）。
   */
  private requireUnrestricted(userId: string, scope: 'CONTACT' | 'PUBLISHING' | 'CIRCLE_CREATION'): void {
    const now = Date.now();
    const active = this.db.userRestrictions.filter((r) => r.userId === userId && (r.scope === scope || (scope === 'CONTACT' && r.scope === 'BOOKING'))
      && !r.revokedAt && r.startsAt <= now && r.endsAt > now)
      .sort((a, b) => b.endsAt - a.endsAt)[0];
    if (!active) return;
    const what = scope === 'CONTACT' ? '申请联系方式' : scope === 'PUBLISHING' ? '发布商品' : '创建圈子';
    throw ApiError.mock({ code: 403, message: `你的「${what}」功能暂时受限，至 ${formatRestrictionEnd(active.endsAt)} 自动恢复。可以在「我的限制」里查看原因或提交申诉。`,
      details: { code: 'RESTRICTED', scope, endsAt: active.endsAt } });
  }

  /** 只有工作人员在案件里的决定能产生限制（V16 守卫：不再接受 BOOKING 范围与 SYSTEM_RULE 来源） */
  private createRestriction(userId: string, schoolId: string, scope: 'CONTACT' | 'PUBLISHING' | 'CIRCLE_CREATION', caseId: string,
                            createdBy: string, reasonCode: string, hours: number): import('./mockMigrations').MockUserRestriction {
    const now = Date.now();
    const r = { id: uid('restr'), userId, schoolId, scope, source: 'CASE' as const, caseId, noShowReportId: null, createdBy, reasonCode,
      startsAt: now, endsAt: now + hours * MockCampusMarketApi.HOUR, createdAt: now, revokedAt: null, revokedBy: null, revokeReason: null,
      ruleVersion: null, decidedAt: now, basis: [], lastCorrectionId: null };
    this.db.userRestrictions.push(r);
    return r;
  }

  private openCaseFor(schoolId: string, targetType: string, targetId: string) {
    return this.db.moderationCases.find((c) => c.schoolId === schoolId && c.targetType === targetType && c.targetId === targetId
      && (c.status === 'OPEN' || c.status === 'UNDER_REVIEW' || c.status === 'APPEALED')) ?? null;
  }

  private ensureCase(schoolId: string, targetType: import('./contracts').ReportableTargetType, targetId: string) {
    const open = this.openCaseFor(schoolId, targetType, targetId);
    if (open) return open;
    const now = Date.now();
    const c = { id: uid('case'), schoolId, targetType, targetId, status: 'OPEN' as const, assignedStaffId: null, resolutionCode: null,
      reportCount: 0, createdAt: now, updatedAt: now, resolvedAt: null, noShowReportId: null };
    this.db.moderationCases.push(c);
    return c;
  }
  // ---------------- 举报 ----------------

  private reportSnapshot(me: User, school: string, type: string, target: string): string | null {
    const notFound = () => ApiError.mock({ code: 404, message: '举报对象不存在或你没有权限查看' });
    const clip = (t: string) => t.slice(0, 2000);
    switch (type) {
      case 'PRODUCT': {
        const p = this.db.market.products.find((x) => x.id === target);
        if (!p || !this.visibleTo(p, me.id)) throw notFound();
        if (p.sellerId === me.id) throw ApiError.mock({ code: 400, message: '不能举报自己发布的商品' });
        return clip(p.title);
      }
      case 'USER': {
        const u = this.db.users.find((x) => x.id === target);
        if (!u || this.schoolOf(u.campus) !== school) throw notFound();
        if (u.id === me.id) throw ApiError.mock({ code: 400, message: '不能举报自己' });
        return clip(u.nickname);
      }
      case 'CIRCLE': {
        const c = this.db.circles.find((x) => x.id === target);
        if (!c || c.schoolId !== school) throw notFound();
        const member = !!this.membershipOf(c.id, me.id);
        if (!member && !(c.status === 'ACTIVE' && c.visibility === 'DISCOVERABLE')) throw notFound();
        return clip(c.name);
      }
      case 'COMMENT': {
        const c = this.db.market.comments.find((x) => x.id === target);
        const p = c && this.db.market.products.find((x) => x.id === c.productId);
        if (!c || !p || !this.visibleTo(p, me.id)) throw notFound();
        if (c.userId === me.id) throw ApiError.mock({ code: 400, message: '不能举报自己的留言' });
        return clip(c.content);
      }
      case 'MESSAGE': {
        const m = this.db.market.messages.find((x) => x.id === target);
        const conv = m && this.db.market.conversations.find((x) => x.id === m.conversationId);
        if (!m || !conv || (conv.buyerId !== me.id && conv.sellerId !== me.id)) throw notFound();
        if (m.senderId === me.id) throw ApiError.mock({ code: 400, message: '不能举报自己发送的消息' });
        return clip(m.content);
      }
      default: throw notFound();
    }
  }

  private myReportView(r: import('./mockMigrations').MockModerationReport): import('./contracts').MyModerationReport {
    const c = this.db.moderationCases.find((x) => x.id === r.caseId);
    const closed = !!c && ['RESOLVED', 'DISMISSED', 'APPEALED'].includes(c.status);
    return {
      id: r.id, targetType: r.targetType, targetId: r.targetId, reasonCode: r.reasonCode, createdAt: r.createdAt,
      status: closed ? 'CLOSED' : c?.status === 'OPEN' ? 'RECEIVED' : 'UNDER_REVIEW',
      outcome: !closed ? null : !c?.resolutionCode || c.resolutionCode === 'NO_ACTION' || c.resolutionCode === 'REJECT_NO_SHOW' ? 'NO_ACTION' : 'ACTION_TAKEN',
      // 7.1C：本校没有一位可以回避利益冲突的在岗工作人员 → 保持待处理并明确告知
      awaitingEligibleStaff: !closed && !!c && !this.activeStaffOf(c.schoolId).some((s) => !this.caseConflict(c, s.userId)),
    };
  }

  async createModerationReport(input: import('./contracts').ModerationReportInput): Promise<import('./contracts').MyModerationReport> {
    this.syncFromStorage();
    const me = this.currentUser();
    rejectUnknownKeys(input, ['targetType', 'targetId', 'reasonCode', 'note'], '举报');
    // V16：订单与爽约复核只作为历史保留，不能再被举报（与后端 TARGETS 一致，400）
    const type = this.govCode<import('./contracts').ReportableTargetType>(input.targetType, MockCampusMarketApi.REPORT_TARGETS, '举报对象类型');
    const reason = this.govCode<import('./contracts').ModerationReportReason>(input.reasonCode, MockCampusMarketApi.REPORT_REASONS, '举报原因');
    const note = this.govNote(input.note, 500);
    if (reason === 'OTHER' && !note) throw ApiError.mock({ code: 400, message: '选择「其他」时请写一句说明' });
    const school = this.schoolOf(me.campus) ?? 'pilot';
    const snapshot = this.reportSnapshot(me, school, type, String(input.targetId));
    const existing = this.db.moderationReports.find((r) => r.reporterId === me.id && r.targetType === type && r.targetId === input.targetId);
    if (existing) return this.myReportView(existing);
    this.supplyLimit('moderationReport', me.id, 20, 86_400_000);
    const c = this.ensureCase(school, type, String(input.targetId));
    const r = { id: uid('report'), schoolId: school, caseId: c.id, reporterId: me.id, targetType: type, targetId: String(input.targetId),
      reasonCode: reason, note, snapshot, createdAt: Date.now() };
    this.db.moderationReports.push(r);
    c.reportCount += 1;
    c.updatedAt = r.createdAt;
    this.persist();
    return this.myReportView(r);
  }

  async listMyModerationReports(): Promise<import('./contracts').MyModerationReport[]> {
    this.syncFromStorage();
    const me = this.currentUser();
    return this.db.moderationReports.filter((r) => r.reporterId === me.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((r) => this.myReportView(r));
  }

  // ---------------- 我的限制与申诉 ----------------

  private appealSummary(a: import('./mockMigrations').MockModerationAppeal | undefined): import('./contracts').MyAppealSummary | null {
    return a ? { id: a.id, status: a.status, createdAt: a.createdAt, decidedAt: a.decidedAt,
      awaitingEligibleStaff: a.status === 'PENDING' && !this.activeStaffOf(a.schoolId).some((s) => !this.appealConflict(a, s.userId)) } : null;
  }

  /** 与我有关、可以申诉的处理：与后端 selectMyActionNotices 相同的四类与「仍在生效」口径 */
  private myNotices(meId: string) {
    const codes = ['HIDE_PRODUCT', 'HIDE_COMMENT', 'QUARANTINE_MESSAGE', 'CONFIRM_NO_SHOW'];
    return this.db.moderationActions.filter((a) => a.subjectId === meId && a.effective && codes.includes(a.actionCode))
      .sort((x, y) => y.createdAt - x.createdAt).slice(0, 50)
      .map((a) => {
        let active = false;
        let label = '';
        if (a.actionCode === 'HIDE_PRODUCT') {
          const p = this.db.market.products.find((x) => x.id === a.targetId);
          active = !!p?.moderationHiddenAt && p.moderationHiddenActionId === a.id;
          label = p?.title ?? '';
        } else if (a.actionCode === 'HIDE_COMMENT') {
          const c = this.db.market.comments.find((x) => x.id === a.targetId);
          active = !!c?.moderationHiddenAt && c.moderationHiddenActionId === a.id;
          label = '你的一条商品留言';
        } else if (a.actionCode === 'QUARANTINE_MESSAGE') {
          const m = this.db.market.messages.find((x) => x.id === a.targetId);
          active = !!m?.moderationQuarantinedAt && m.moderationQuarantineActionId === a.id;
          label = '你发送的一条私信';
        } else {
          // 历史上的爽约确认：爽约规则已停用（V16），只展示，不再生效、不能申诉
          active = false;
          label = '一次爽约确认（历史，已不再生效）';
        }
        const appeal = this.db.moderationAppeals.find((x) => x.actionId === a.id);
        return { actionId: a.id, actionCode: a.actionCode as import('./contracts').MyNoticeActionCode, targetId: a.targetId, targetLabel: label,
          reasonCode: a.reasonCode, createdAt: a.createdAt, active, appeal: this.appealSummary(appeal), canAppeal: active && !appeal };
      });
  }

  async getMyGovernance(): Promise<import('./contracts').MyGovernance> {
    this.syncFromStorage();
    const me = this.currentUser();
    const now = Date.now();
    const restrictions = this.db.userRestrictions.filter((r) => r.userId === me.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((r) => {
      const active = !r.revokedAt && r.startsAt <= now && r.endsAt > now;
      const appeal = this.db.moderationAppeals.find((a) => a.restrictionId === r.id);
      const stillConfirmed = (id: string) => { const x = this.db.noShowReports.find((y) => y.id === id); return x?.status === 'ACKNOWLEDGED' || x?.status === 'CONFIRMED' };
      return { id: r.id, scope: r.scope, source: r.source, reasonCode: r.reasonCode, startsAt: r.startsAt, endsAt: r.endsAt, active,
        revokedAt: r.revokedAt, appeal: this.appealSummary(appeal), canAppeal: active && !appeal,
        ruleVersion: r.ruleVersion, decidedAt: r.decidedAt, revokeReason: r.revokeReason,
        basis: r.source === 'SYSTEM_RULE' ? r.basis.map((b) => ({ confirmedAt: b.confirmedAt, stillConfirmed: stillConfirmed(b.reportId) })).sort((a, b) => a.confirmedAt - b.confirmedAt) : [],
        corrections: this.db.restrictionCorrections.filter((c) => c.restrictionId === r.id).sort((a, b) => a.createdAt - b.createdAt)
          .map((c) => ({ outcome: c.outcome, remainingCount: c.remainingCount, previousEndsAt: c.previousEndsAt, newEndsAt: c.newEndsAt, createdAt: c.createdAt })) };
    });
    // 阶段 1：不再有爽约提醒（noShowWarning 已从 /v1/me/governance 移除）
    return { restrictions, notices: this.myNotices(me.id) };
  }

  async submitAppeal(input: import('./contracts').AppealInput): Promise<import('./contracts').MyAppealSummary> {
    this.syncFromStorage();
    const me = this.currentUser();
    rejectUnknownKeys(input, ['restrictionId', 'actionId', 'reason'], '申诉');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw ApiError.mock({ code: 400, message: '请写明申诉理由' });
    if (reason.length > 500 || /[<>]/.test(reason)) throw ApiError.mock({ code: 400, message: '申诉理由最多 500 字，且不能包含尖括号' });
    if (!!input.restrictionId === !!input.actionId) throw ApiError.mock({ code: 400, message: '请指定要申诉的一条限制或一次处理' });
    let caseId: string | null;
    let school: string;
    if (input.restrictionId) {
      const r = this.db.userRestrictions.find((x) => x.id === input.restrictionId);
      if (!r || r.userId !== me.id) throw ApiError.mock({ code: 404, message: '限制不存在' });
      if (r.revokedAt || r.endsAt <= Date.now()) throw ApiError.mock({ code: 409, message: '这条限制已经结束，不需要申诉' });
      caseId = r.caseId;
      school = r.schoolId;
    } else {
      const a = this.db.moderationActions.find((x) => x.id === input.actionId);
      const notice = a && a.subjectId === me.id ? this.myNotices(me.id).find((n) => n.actionId === a.id) : undefined;
      if (!a || !notice) throw ApiError.mock({ code: 404, message: '处理记录不存在' });
      if (!notice.active) throw ApiError.mock({ code: 409, message: '这项处理已经不再生效，不需要申诉' });
      caseId = a.caseId;
      school = a.schoolId;
    }
    if (this.db.moderationAppeals.some((x) => (input.restrictionId && x.restrictionId === input.restrictionId) || (input.actionId && x.actionId === input.actionId))) {
      throw ApiError.mock({ code: 409, message: '每条限制或处理只能申诉一次' });
    }
    this.supplyLimit('appeal', me.id, 5, 86_400_000);
    const appeal = { id: uid('appeal'), schoolId: school, userId: me.id, restrictionId: input.restrictionId ?? null, actionId: input.actionId ?? null,
      caseId, reason, status: 'PENDING' as const, decidedBy: null, decidedAt: null, createdAt: Date.now() };
    this.db.moderationAppeals.push(appeal);
    const c = caseId ? this.db.moderationCases.find((x) => x.id === caseId) : null;
    if (c && c.status === 'RESOLVED') Object.assign(c, { status: 'APPEALED', updatedAt: Date.now() });
    this.persist();
    return this.appealSummary(appeal)!;
  }

  // ---------------- 工作人员 ----------------

  private staffOf(userId: string | null) {
    if (!userId) return null;
    const user = this.db.users.find((u) => u.id === userId);
    const m = this.db.staffMembers.find((s) => s.userId === userId && s.active);
    return m && user && this.schoolOf(user.campus) === m.schoolId ? m : null;
  }

  private requireStaff() {
    this.syncFromStorage();
    const me = this.currentUser();
    const staff = this.staffOf(me.id);
    if (!staff) throw ApiError.mock({ code: 403, message: '需要平台工作人员权限' });
    return staff;
  }

  async getStaffStatus(): Promise<import('./contracts').StaffStatus> {
    this.syncFromStorage();
    const me = this.currentUser();
    const staff = this.staffOf(me.id);
    return { staff: !!staff, role: staff?.role ?? null };
  }

  /**
   * 仅离线演示：把当前用户设为本校平台工作人员，方便体验治理工作台。这个方法只存在于 Mock，
   * REST 接口里没有任何对应能力；演示种子里也没有预置工作人员。
   */
  async demoBecomeStaff(role: import('./contracts').StaffRole = 'MODERATOR'): Promise<import('./contracts').StaffStatus> {
    this.syncFromStorage();
    const me = this.currentUser();
    const school = this.schoolOf(me.campus);
    if (!school) throw ApiError.mock({ code: 400, message: '校区无效' });
    const existing = this.db.staffMembers.find((s) => s.userId === me.id);
    if (existing) Object.assign(existing, { role, active: true, schoolId: school });
    else this.db.staffMembers.push({ userId: me.id, schoolId: school, role, active: true, createdAt: Date.now() });
    this.persist();
    return { staff: true, role };
  }

  private caseSummary(c: import('./mockMigrations').MockModerationCase, staffId: string): import('./contracts').ModerationCaseSummary {
    return { id: c.id, targetType: c.targetType, targetId: c.targetId, status: c.status, reportCount: c.reportCount, createdAt: c.createdAt,
      updatedAt: c.updatedAt, assignedToMe: c.assignedStaffId === staffId, assigned: !!c.assignedStaffId, resolutionCode: c.resolutionCode };
  }

  /** 目标摘要：与后端 StaffModerationService.targetSummary 相同的最少字段 */
  private caseTarget(type: string, id: string): { target: import('./contracts').ModerationTarget; subject: string | null; school: string | null; hidden?: boolean; archived?: boolean } {
    const none = { target: { type: type as import('./contracts').ModerationTargetType, exists: false, label: '', fields: {} }, subject: null, school: null };
    const nick = (uid2: string) => this.db.users.find((u) => u.id === uid2)?.nickname ?? '';
    switch (type) {
      case 'PRODUCT': {
        const p = this.db.market.products.find((x) => x.id === id);
        if (!p) return none;
        return { target: { type: 'PRODUCT', exists: true, label: p.title, fields: { title: p.title, description: p.description, price: p.price, status: p.status,
          visibility: p.visibility ?? 'PUBLIC', hidden: !!p.moderationHiddenAt, sellerNickname: nick(p.sellerId) } }, subject: p.sellerId, school: this.schoolOf(p.campus), hidden: !!p.moderationHiddenAt };
      }
      case 'USER': {
        const u = this.db.users.find((x) => x.id === id);
        if (!u) return none;
        return { target: { type: 'USER', exists: true, label: u.nickname, fields: { nickname: u.nickname, campus: u.campus, joinedAt: u.createdAt } }, subject: u.id, school: this.schoolOf(u.campus) };
      }
      case 'CIRCLE': {
        const c = this.db.circles.find((x) => x.id === id);
        if (!c) return none;
        const count = this.db.circleMemberships.filter((m) => m.circleId === c.id && m.status === 'ACTIVE').length;
        return { target: { type: 'CIRCLE', exists: true, label: c.name, fields: { name: c.name, description: c.description, type: c.type, visibility: c.visibility, status: c.status, memberCount: count } },
          subject: c.ownerId, school: c.schoolId, archived: c.status !== 'ACTIVE' };
      }
      case 'COMMENT': {
        const cm = this.db.market.comments.find((x) => x.id === id);
        const p = cm && this.db.market.products.find((x) => x.id === cm.productId);
        if (!cm || !p) return none;
        return { target: { type: 'COMMENT', exists: true, label: '留言', fields: { content: cm.content, authorNickname: nick(cm.userId), createdAt: cm.createdAt, hidden: !!cm.moderationHiddenAt } },
          subject: cm.userId, school: this.schoolOf(p.campus), hidden: !!cm.moderationHiddenAt };
      }
      case 'MESSAGE': {
        const m = this.db.market.messages.find((x) => x.id === id);
        const conv = m && this.db.market.conversations.find((x) => x.id === m.conversationId);
        const p = conv && this.db.market.products.find((x) => x.id === conv.productId);
        if (!m || !p) return none;
        // 消息正文只以举报快照的形式出现，这里不读取
        return { target: { type: 'MESSAGE', exists: true, label: '私信', fields: { senderNickname: nick(m.senderId), createdAt: m.createdAt, quarantined: !!m.moderationQuarantinedAt } },
          subject: m.senderId, school: this.schoolOf(p.campus), hidden: !!m.moderationQuarantinedAt };
      }
      case 'ORDER': {
        const o = this.db.market.orders.find((x) => x.id === id);
        const p = o && this.db.market.products.find((x) => x.id === o.productId);
        if (!o || !p) return none;
        // 历史订单（只读）：站内交易已停用
        return { target: { type: 'ORDER', exists: true, label: '订单（历史）', fields: { status: o.canonicalStatus ?? 'PENDING_SELLER_CONFIRM', price: o.price, meetingAt: Date.parse(o.meetingAtIso ?? '') || null,
          buyerNickname: nick(o.buyerId), sellerNickname: nick(o.sellerId) } }, subject: null, school: this.schoolOf(p.campus) };
      }
      default: {
        const r = this.db.noShowReports.find((x) => x.id === id);
        if (!r) return none;
        // 历史上的爽约复核（只读）：只给出报告状态
        return { target: { type: 'NO_SHOW', exists: true, label: '爽约复核（历史）', fields: { status: r.status } }, subject: r.reportedId, school: r.schoolId };
      }
    }
  }

  private allowedActionsFor(type: string, senior: boolean, t: ReturnType<MockCampusMarketApi['caseTarget']>): import('./contracts').ModerationActionCode[] {
    if (!t.target.exists) return ['NO_ACTION'];
    const a: import('./contracts').ModerationActionCode[] = [];
    if (type === 'PRODUCT') a.push(t.hidden ? 'RESTORE_PRODUCT' : 'HIDE_PRODUCT', 'RESTRICT_PUBLISHING');
    else if (type === 'COMMENT') a.push(t.hidden ? 'RESTORE_COMMENT' : 'HIDE_COMMENT', 'RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION');
    else if (type === 'MESSAGE') a.push(t.hidden ? 'RELEASE_MESSAGE' : 'QUARANTINE_MESSAGE', 'RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION');
    else if (type === 'USER') a.push('RESTRICT_CONTACT', 'RESTRICT_PUBLISHING', 'RESTRICT_CIRCLE_CREATION');
    else if (type === 'CIRCLE') { if (senior && !t.archived) a.push('ARCHIVE_CIRCLE'); a.push('RESTRICT_CIRCLE_CREATION') }
    // 历史上的订单 / 爽约复核案件：只能「不采取措施」（与后端 allowedActions 的 default 分支一致）
    a.push('NO_ACTION');
    return a;
  }

  private caseDetail(c: import('./mockMigrations').MockModerationCase, staff: import('./mockMigrations').MockStaffMember): import('./contracts').ModerationCaseDetail {
    const t = this.caseTarget(c.targetType, c.targetId);
    const decidable = (c.status === 'OPEN' || c.status === 'UNDER_REVIEW') && (!c.assignedStaffId || c.assignedStaffId === staff.userId);
    return {
      ...this.caseSummary(c, staff.userId),
      target: t.target,
      reports: this.db.moderationReports.filter((r) => r.caseId === c.id).sort((a, b) => a.createdAt - b.createdAt).slice(0, 100)
        .map((r) => ({ id: r.id, reasonCode: r.reasonCode, note: r.note, snapshot: r.snapshot, createdAt: r.createdAt })),
      actions: this.db.moderationActions.filter((a) => a.caseId === c.id).sort((a, b) => a.createdAt - b.createdAt)
        .map((a) => ({ id: a.id, actionCode: a.actionCode, reasonCode: a.reasonCode, note: a.note, createdAt: a.createdAt, byMe: a.staffId === staff.userId, expiresAt: a.expiresAt, effective: a.effective })),
      allowedActions: decidable ? this.allowedActionsFor(c.targetType, staff.role === 'SENIOR_MODERATOR', t) : [],
    };
  }

  private staffCase(id: string, staff: import('./mockMigrations').MockStaffMember) {
    const c = this.db.moderationCases.find((x) => x.id === id);
    if (!c || c.schoolId !== staff.schoolId) throw ApiError.mock({ code: 404, message: '案件不存在' });
    return c;
  }

  private pageArgs(page: unknown, size: unknown): { page: number; size: number } {
    const p = page === undefined ? 1 : Number(page);
    const s = size === undefined ? 20 : Number(size);
    if (!Number.isInteger(p) || p < 1 || p > 10000) throw ApiError.mock({ code: 400, message: 'page 无效' });
    if (!Number.isInteger(s) || s < 1 || s > 100) throw ApiError.mock({ code: 400, message: 'size 无效' });
    return { page: p, size: s };
  }

  async listModerationCases(query: import('./contracts').ModerationCaseQuery): Promise<import('./contracts').ModerationCasePage> {
    const staff = this.requireStaff();
    rejectUnknownKeys(query, ['status', 'targetType', 'page', 'size'], '查询');
    const { page, size } = this.pageArgs(query.page, query.size);
    if (query.targetType !== undefined) this.govCode(query.targetType, MockCampusMarketApi.CASE_FILTER_TARGETS, '目标类型');
    // 7.1C：与本人有利益冲突的案件不进入本人的队列
    const all = this.db.moderationCases.filter((c) => c.schoolId === staff.schoolId && (!query.status || c.status === query.status)
      && (!query.targetType || c.targetType === query.targetType) && !this.caseConflict(c, staff.userId))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    return { items: all.slice((page - 1) * size, page * size).map((c) => this.caseSummary(c, staff.userId)), total: all.length, page, size };
  }

  private static readonly CASE_CONFLICT = '这个案件与你本人有关，需要由其他工作人员处理';
  private static readonly APPEAL_CONFLICT = '这条申诉与你本人或你做出的处理有关，需要由其他工作人员决定';

  async getModerationCase(id: string): Promise<import('./contracts').ModerationCaseDetail> {
    const staff = this.requireStaff();
    const c = this.staffCase(id, staff);
    this.requireNoConflict(this.caseConflict(c, staff.userId), MockCampusMarketApi.CASE_CONFLICT);
    return this.caseDetail(c, staff);
  }

  async openModerationCase(input: { targetType: import('./contracts').ReportableTargetType; targetId: string }): Promise<import('./contracts').ModerationCaseDetail> {
    const staff = this.requireStaff();
    rejectUnknownKeys(input, ['targetType', 'targetId'], '立案');
    const type = this.govCode<import('./contracts').ReportableTargetType>(input.targetType, MockCampusMarketApi.REPORT_TARGETS, '目标类型');
    const t = this.caseTarget(type, String(input.targetId));
    if (!t.target.exists || t.school !== staff.schoolId) throw ApiError.mock({ code: 404, message: '目标不存在' });
    const existing = this.openCaseFor(staff.schoolId, type, String(input.targetId));
    const probe = existing ?? { id: '', schoolId: staff.schoolId, targetType: type, targetId: String(input.targetId) } as import('./mockMigrations').MockModerationCase;
    // 利益冲突时不立案（与后端事务回滚一致）
    this.requireNoConflict(this.caseConflict(probe, staff.userId), MockCampusMarketApi.CASE_CONFLICT);
    const c = this.ensureCase(staff.schoolId, type, String(input.targetId));
    this.persist();
    return this.caseDetail(c, staff);
  }

  async claimModerationCase(id: string): Promise<import('./contracts').ModerationCaseDetail> {
    const staff = this.requireStaff();
    const c = this.staffCase(id, staff);
    this.requireNoConflict(this.caseConflict(c, staff.userId), MockCampusMarketApi.CASE_CONFLICT);
    if (c.status === 'UNDER_REVIEW' && c.assignedStaffId === staff.userId) return this.caseDetail(c, staff);
    if (c.status !== 'OPEN') throw ApiError.mock({ code: 409, message: '案件已由其他工作人员处理或已结案' });
    Object.assign(c, { status: 'UNDER_REVIEW', assignedStaffId: staff.userId, updatedAt: Date.now() });
    this.persist();
    return this.caseDetail(c, staff);
  }

  async decideModerationCase(id: string, input: import('./contracts').ModerationDecisionInput): Promise<import('./contracts').ModerationCaseDetail> {
    const staff = this.requireStaff();
    const c = this.staffCase(id, staff);
    this.requireNoConflict(this.caseConflict(c, staff.userId), MockCampusMarketApi.CASE_CONFLICT);
    if (c.status !== 'OPEN' && c.status !== 'UNDER_REVIEW') throw ApiError.mock({ code: 409, message: '案件已经有处理结果' });
    rejectUnknownKeys(input, ['action', 'reasonCode', 'note', 'durationHours'], '处理');
    const action = this.govCode<import('./contracts').ModerationActionCode>(input.action, MockCampusMarketApi.DECISION_ACTIONS, '处理动作');
    const reason = this.govCode<string>(input.reasonCode, MockCampusMarketApi.DECISION_REASONS, '处理原因');
    const note = this.govNote(input.note, 500);
    if (reason === 'OTHER' && !note) throw ApiError.mock({ code: 400, message: '选择「其他」时请写一句说明' });
    if (c.status === 'UNDER_REVIEW' && c.assignedStaffId && c.assignedStaffId !== staff.userId) throw ApiError.mock({ code: 409, message: '案件已由其他工作人员领取' });
    const t = this.caseTarget(c.targetType, c.targetId);
    if (!this.allowedActionsFor(c.targetType, staff.role === 'SENIOR_MODERATOR', t).includes(action)) throw ApiError.mock({ code: 400, message: '这个动作不适用于该案件' });
    const now = Date.now();
    const act = (actionCode: string, restrictionId: string | null, expiresAt: number | null, effective: boolean) => {
      const a = { id: uid('action'), schoolId: staff.schoolId, caseId: c.id, appealId: null, staffId: staff.userId, actionCode, reasonCode: reason, note,
        targetType: c.targetType, targetId: c.targetId, restrictionId, expiresAt, effective, createdAt: now, subjectId: t.subject };
      this.db.moderationActions.push(a);
      return a;
    };
    if (action === 'HIDE_PRODUCT' || action === 'RESTORE_PRODUCT') {
      const p = this.db.market.products.find((x) => x.id === c.targetId)!;
      const effective = (action === 'HIDE_PRODUCT') !== !!p.moderationHiddenAt;
      const a = act(action, null, null, effective);
      if (effective) Object.assign(p, action === 'HIDE_PRODUCT' ? { moderationHiddenAt: now, moderationHiddenActionId: a.id } : { moderationHiddenAt: null, moderationHiddenActionId: a.id });
    } else if (action === 'HIDE_COMMENT' || action === 'RESTORE_COMMENT') {
      const cm = this.db.market.comments.find((x) => x.id === c.targetId)!;
      const effective = (action === 'HIDE_COMMENT') !== !!cm.moderationHiddenAt;
      const a = act(action, null, null, effective);
      if (effective) Object.assign(cm, action === 'HIDE_COMMENT' ? { moderationHiddenAt: now, moderationHiddenActionId: a.id } : { moderationHiddenAt: null, moderationHiddenActionId: a.id });
    } else if (action === 'QUARANTINE_MESSAGE' || action === 'RELEASE_MESSAGE') {
      const m = this.db.market.messages.find((x) => x.id === c.targetId)!;
      const effective = (action === 'QUARANTINE_MESSAGE') !== !!m.moderationQuarantinedAt;
      const a = act(action, null, null, effective);
      if (effective) Object.assign(m, action === 'QUARANTINE_MESSAGE' ? { moderationQuarantinedAt: now, moderationQuarantineActionId: a.id } : { moderationQuarantinedAt: null, moderationQuarantineActionId: a.id });
    } else if (action.startsWith('RESTRICT_')) {
      const hours = input.durationHours;
      if (typeof hours !== 'number' || !Number.isInteger(hours)) throw ApiError.mock({ code: 400, message: '请填写限制时长（小时）' });
      if (hours < 1 || hours > RESTRICTION_MAX_HOURS) throw ApiError.mock({ code: 400, message: '限制时长应为 1～720 小时（最长 30 天）' });
      if (hours > 168 && staff.role !== 'SENIOR_MODERATOR') throw ApiError.mock({ code: 403, message: '超过 7 天的限制需要高级工作人员处理' });
      const r = this.createRestriction(t.subject!, staff.schoolId, action.slice('RESTRICT_'.length) as 'CONTACT' | 'PUBLISHING' | 'CIRCLE_CREATION', c.id, staff.userId, reason, hours);
      act(action, r.id, r.endsAt, true);
    } else if (action === 'ARCHIVE_CIRCLE') {
      const circle = this.db.circles.find((x) => x.id === c.targetId)!;
      const effective = circle.status === 'ACTIVE';
      if (effective) this.archiveCircleRecord(circle, staff.userId);
      act(action, null, null, effective);
    } else {
      act('NO_ACTION', null, null, false);
    }
    Object.assign(c, { status: action === 'NO_ACTION' ? 'DISMISSED' : 'RESOLVED', resolutionCode: action, resolvedAt: now,
      assignedStaffId: c.assignedStaffId ?? staff.userId, updatedAt: now });
    this.persist();
    return { ...this.caseDetail(c, staff), requestId: `mock-${uid('req')}` };
  }

  private staffAppealView(a: import('./mockMigrations').MockModerationAppeal, staffId: string): import('./contracts').StaffAppeal {
    const now = Date.now();
    let subject: import('./contracts').StaffAppeal['subject'];
    if (a.restrictionId) {
      const r = this.db.userRestrictions.find((x) => x.id === a.restrictionId)!;
      subject = { kind: 'RESTRICTION', scope: r.scope, endsAt: r.endsAt, active: !r.revokedAt && r.endsAt > now, sourceType: r.source, ruleVersion: r.ruleVersion };
    } else {
      const act = this.db.moderationActions.find((x) => x.id === a.actionId)!;
      subject = { kind: 'ACTION', actionCode: act.actionCode, targetId: act.targetId };
    }
    return { id: a.id, status: a.status, reason: a.reason, createdAt: a.createdAt, decidedAt: a.decidedAt, subject, caseId: a.caseId,
      decidable: a.status === 'PENDING' && !this.appealConflict(a, staffId) };
  }

  async listModerationAppeals(query: { status?: 'PENDING' | 'ACCEPTED' | 'REJECTED'; page?: number; size?: number }): Promise<import('./contracts').StaffAppealPage> {
    const staff = this.requireStaff();
    rejectUnknownKeys(query, ['status', 'page', 'size'], '查询');
    const { page, size } = this.pageArgs(query.page, query.size);
    const all = this.db.moderationAppeals.filter((a) => a.schoolId === staff.schoolId && (!query.status || a.status === query.status)
      && !this.appealConflict(a, staff.userId))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    return { items: all.slice((page - 1) * size, page * size).map((a) => this.staffAppealView(a, staff.userId)), total: all.length, page, size };
  }

  async decideModerationAppeal(id: string, input: import('./contracts').AppealDecisionInput): Promise<import('./contracts').StaffAppeal> {
    const staff = this.requireStaff();
    rejectUnknownKeys(input, ['accept', 'reasonCode', 'note'], '申诉处理');
    if (typeof input.accept !== 'boolean') throw ApiError.mock({ code: 400, message: '请选择接受或驳回' });
    if (input.reasonCode !== 'APPEAL_ACCEPTED' && input.reasonCode !== 'APPEAL_REJECTED') throw ApiError.mock({ code: 400, message: '处理原因无效' });
    if (input.accept !== (input.reasonCode === 'APPEAL_ACCEPTED')) throw ApiError.mock({ code: 400, message: '处理原因与决定不一致' });
    const note = this.govNote(input.note, 500);
    const appeal = this.db.moderationAppeals.find((x) => x.id === id);
    if (!appeal || appeal.schoolId !== staff.schoolId) throw ApiError.mock({ code: 404, message: '申诉不存在' });
    if (appeal.status !== 'PENDING') throw ApiError.mock({ code: 409, message: '申诉已经有结果' });
    this.requireNoConflict(this.appealConflict(appeal, staff.userId), MockCampusMarketApi.APPEAL_CONFLICT);
    const now = Date.now();
    const act = (actionCode: string, targetType: string, targetId: string, restrictionId: string | null, effective: boolean) => {
      const a = { id: uid('action'), schoolId: staff.schoolId, caseId: appeal.caseId, appealId: appeal.id, staffId: staff.userId, actionCode,
        reasonCode: input.reasonCode, note, targetType, targetId, restrictionId, expiresAt: null, effective, createdAt: now, subjectId: appeal.userId };
      this.db.moderationActions.push(a);
      return a;
    };
    if (appeal.restrictionId) {
      const r = this.db.userRestrictions.find((x) => x.id === appeal.restrictionId)!;
      let effective = false;
      if (input.accept && !r.revokedAt && r.endsAt > now) {
        Object.assign(r, { revokedAt: now, revokedBy: staff.userId, revokeReason: 'APPEAL_ACCEPTED' });
        effective = true;
      }
      act(input.accept ? 'ACCEPT_APPEAL' : 'REJECT_APPEAL', 'RESTRICTION', r.id, r.id, effective);
    } else {
      const original = this.db.moderationActions.find((x) => x.id === appeal.actionId)!;
      act(input.accept ? 'ACCEPT_APPEAL' : 'REJECT_APPEAL', 'APPEAL', appeal.id, null, true);
      if (input.accept) {
        // 申诉成功：撤回被申诉的处理，并追加对应的恢复动作（与后端 StaffModerationService.undo 相同）
        if (original.actionCode === 'HIDE_PRODUCT') {
          const p = this.db.market.products.find((x) => x.id === original.targetId);
          const still = !!p?.moderationHiddenAt && p.moderationHiddenActionId === original.id;
          const restore = act('RESTORE_PRODUCT', 'PRODUCT', original.targetId, null, still);
          if (p && still) Object.assign(p, { moderationHiddenAt: null, moderationHiddenActionId: restore.id });
        } else if (original.actionCode === 'HIDE_COMMENT') {
          const cm = this.db.market.comments.find((x) => x.id === original.targetId);
          const still = !!cm?.moderationHiddenAt && cm.moderationHiddenActionId === original.id;
          const restore = act('RESTORE_COMMENT', 'COMMENT', original.targetId, null, still);
          if (cm && still) Object.assign(cm, { moderationHiddenAt: null, moderationHiddenActionId: restore.id });
        } else if (original.actionCode === 'QUARANTINE_MESSAGE') {
          const m = this.db.market.messages.find((x) => x.id === original.targetId);
          const still = !!m?.moderationQuarantinedAt && m.moderationQuarantineActionId === original.id;
          const release = act('RELEASE_MESSAGE', 'MESSAGE', original.targetId, null, still);
          if (m && still) Object.assign(m, { moderationQuarantinedAt: null, moderationQuarantineActionId: release.id });
        }
        // 历史上的爽约确认：爽约规则已停用，申诉结论只记录，不再有可撤回的效果（与后端 undo 一致）
      }
    }
    Object.assign(appeal, { status: input.accept ? 'ACCEPTED' : 'REJECTED', decidedBy: staff.userId, decidedAt: now });
    const c = appeal.caseId ? this.db.moderationCases.find((x) => x.id === appeal.caseId) : null;
    if (c && c.status === 'APPEALED') Object.assign(c, { status: 'RESOLVED', updatedAt: now });
    this.persist();
    return { ...this.staffAppealView(appeal, staff.userId), requestId: `mock-${uid('req')}` };
  }

}
