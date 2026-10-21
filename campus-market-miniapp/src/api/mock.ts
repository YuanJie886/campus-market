import type { MarketApi, User, Product, ProductInput, ContactRequest, ContactQuery, ContactRole, ContactStatus, Query, ProductStatus, Campus, UnreadCount, WechatStatus, WechatLoginResult, PasswordResetInput, DeletionInput, DeletionResult, ProfileInput, Building, ReportInput, MyReport, MyGovernance, MyRestriction, MyNotice, AppealInput, AppealSummary, Comment, Conversation, ChatMessage, SendMessageInput, MessageTemplates, ReportTargetType, ReportReason, RestrictionScope, RestrictionSource, RevokeReason, NoticeActionCode } from '../model';
import { CONTACT_STATUSES, REPORT_REASONS, validateProduct, BATCH_MAX_ITEMS, CIRCLE_MEMBER_LIMIT, normalizeClientConfig } from '../model';
import type { ClientConfig, RegisterInput, FeedPage, FeedProduct, FeedQuery, BuildingScope, Circle, CircleInput, CircleInvite, CircleMemberPage, CircleRole, CircleType, CircleVisibility, DiscoverableCircle, ProductVisibility,
  ListingDraft, ListingKind, ListingPayload, ListingBatch, ListingBatchSummary, ListingValidation, PublishBatchResult, AssistInvite, AssistInviteCreated, AssistInviteRedeemed, DraftStatus, BatchStatus,
  CourseQuery, CoursePage, CourseDetail, CourseOffering, TextbookDetail, TextbookEdition, TextbookSuggestionInput, TextbookSuggestionResult, TextbookSuggestion, TextbookUsage, ProductTextbook, BundleItem,
  DemandConditions, DemandSubscribeResult, DemandSubscription, DemandMatchPage, DemandMatch, Category } from '../model';
import { ASSISTANT_FIELDS, DEMO_REGISTRATION_INVITES, compactRegistrationInvite, DEMO_SCHOOLS, INVALID_CAMPUS, demoSchoolOf, DEMO_COURSES, DEMO_COURSE_TEXTBOOKS, DEMO_EDITIONS, DEMO_OFFERINGS, TERM_ORDER, USAGE_ORDER, mockTier, normalizeDemandText, parseBundleItems, randomToken, sanitizePayload, scoreDemandMatch, tokenDigest, validateListing, type DemoEdition, type ValidationContext } from './mockRules';
import { isbnProblem, parseIsbn } from '../catalog';
import { AVATAR_EXTERNAL_REJECTED, AVATAR_INVALID, presetNumber } from '../avatar';
import { FREE_TEXT_DISABLED, MESSAGE_TEMPLATES, TEMPLATE_NOT_FOUND, TEMPLATE_WRONG_ROLE } from '../messages';
import { ApiError } from './transport';
import { INVITE_INVALID_MESSAGE, INVITE_REQUIRED_MESSAGE } from '../invite';
import { imageRefFromUrl, isUploadRef, type UploadedImage } from '../images';

export interface StoragePort { get(): unknown; set(value: unknown): void }
/** inviteRequired：演示是否要求注册邀请码（默认 false，与 GET /v1/config 缺省一致）。 */
export interface MockOptions { inviteRequired?: boolean }
/** 演示库中的申请：与后端一致，另存卖家 / 买家最近一次「看到」的时间，用于计算未读。 */
type StoredContact = Omit<ContactRequest, 'unread' | 'buyerNickname' | 'sellerNickname'> & { sellerSeenAt: number | null; buyerSeenAt: number | null };
/** wechat：演示里的「微信身份 ↔ 账号」绑定（相当于后端 user_wechat_identities）；绑定票据只在内存里，不进这个库。 */
interface Database {
  version: 1; users: (User & { password: string; deleted?: boolean })[]; userId: string | null; products: Product[]; favorites: Record<string, string[]>; contacts: StoredContact[];
  /** 旧版演示缓存里的商品举报（只有说明），载入时并入 moderationReports。 */
  reports?: { productId: string; reporterId: string; reason: string; createdAt: number }[];
  wechat?: { openid: string; userId: string }[]; images?: StoredImage[];
  comments?: StoredComment[]; conversations?: StoredConversation[]; messages?: StoredMessage[];
  moderationReports?: StoredReport[]; restrictions?: StoredRestriction[]; actions?: StoredAction[]; appeals?: StoredAppeal[];
  /** 演示里私信是否开放自由文字（与后端配置同义，默认关闭）。 */
  messaging?: { freeTextEnabled: boolean };
  /** 演示注册邀请码已用次数（按归一化后的邀请码）。 */
  registrationInviteUses?: Record<string, number>;
  // 与 Web 对齐（第二部分）
  circles?: StoredCircle[]; memberships?: StoredMembership[]; circleInvites?: StoredCircleInvite[]; productCircles?: Record<string, string[]>;
  drafts?: StoredDraft[]; batches?: StoredBatch[]; assistInvites?: StoredAssistInvite[]; publishRequests?: { ownerId: string; key: string; batchId: string; productIds: string[] }[];
  productAssistedBy?: Record<string, string>;
  subscriptions?: StoredSubscription[]; matches?: StoredMatch[];
  productTextbooks?: Record<string, string>; suggestions?: StoredSuggestion[];
}
interface StoredCircle { id: string; school: string; type: CircleType; name: string; description: string; visibility: CircleVisibility; ownerId: string; status: 'ACTIVE' | 'ARCHIVED'; createdAt: number; updatedAt: number }
interface StoredMembership { circleId: string; userId: string; role: CircleRole; status: 'ACTIVE' | 'LEFT' | 'REMOVED'; joinedAt: number; endedAt: number | null }
/** 邀请码只保存摘要；原始邀请码只出现在创建结果里。 */
interface StoredCircleInvite { id: string; circleId: string; createdBy: string; digest: string; status: 'PENDING' | 'REDEEMED' | 'REVOKED'; redeemedBy: string | null; expiresAt: number; createdAt: number }
interface StoredDraft { id: string; ownerId: string; editorId: string; draftType: ListingKind; payload: ListingPayload; version: number; status: DraftStatus; expiresAt: number; publishedProductId: string | null; createdAt: number; updatedAt: number }
interface StoredBatch { id: string; ownerId: string; status: BatchStatus; version: number; items: { draftId: string; position: number; active: boolean; productId: string | null }[]; createdAt: number; updatedAt: number; publishedAt: number | null }
interface StoredAssistInvite { id: string; ownerId: string; draftId: string | null; batchId: string | null; digest: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; assistantId: string | null; expiresAt: number; createdAt: number; lastEditAt: number | null }
interface StoredSubscription {
  id: string; userId: string; school: string; keyword: string | null; normalizedKeyword: string | null; category: string | null; minPrice: number | null; maxPrice: number | null;
  geoScope: BuildingScope; campusId: string | null; buildingId: string | null; textbookEditionId: string | null; circleId: string | null; fingerprint: string; active: boolean; createdAt: number; updatedAt: number;
}
interface StoredMatch { id: string; subscriptionId: string; productId: string; score: number; reasonCodes: string[]; readAt: number | null; dismissedAt: number | null; invalidatedAt: number | null; createdAt: number }
interface StoredSuggestion {
  id: string; submitterId: string; school: string; courseOfferingId: string; textbookEditionId: string | null; isbn: string | null; title: string | null; authors: string | null;
  publisher: string | null; editionLabel: string | null; publishedYear: number | null; usageType: TextbookUsage; note: string | null; status: 'PENDING' | 'WITHDRAWN'; fingerprint: string; createdAt: number;
}
/** 留言：hiddenAt / hiddenActionId 只在演示库里，响应只给出 moderationHidden / hiddenForAuthor。 */
interface StoredComment { id: string; productId: string; userId: string; content: string; parentId: string | null; createdAt: number; hiddenAt: number | null; hiddenActionId: string | null }
interface StoredConversation extends Conversation { buyerReadAt: number | null; sellerReadAt: number | null }
interface StoredMessage { id: string; conversationId: string; senderId: string; content: string; templateCode: string | null; createdAt: number; quarantinedAt: number | null; quarantineActionId: string | null }
interface StoredReport { id: string; reporterId: string; targetType: ReportTargetType; targetId: string; reasonCode: ReportReason; note: string | null; createdAt: number }
interface StoredRestriction { id: string; userId: string; scope: RestrictionScope; source: RestrictionSource; reasonCode: string; startsAt: number; endsAt: number; revokedAt: number | null; revokeReason: RevokeReason | null; createdAt: number }
/** 平台对本人内容的处理（隐藏留言 / 隔离私信 / 隐藏商品 / 历史爽约确认）；liftedAt 表示已恢复。 */
interface StoredAction { id: string; subjectId: string; actionCode: NoticeActionCode; targetId: string; targetLabel: string; reasonCode: string; createdAt: number; liftedAt: number | null }
interface StoredAppeal { id: string; userId: string; restrictionId: string | null; actionId: string | null; reason: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: number; decidedAt: number | null }
/**
 * 演示「上传」：不联网，只把选中的本机文件路径（微信端是 saveFile 保存后的路径）记下来，发一个与后端同形的引用 upload:<id>；
 * 商品里存引用，商品响应里给出与后端同形的签名地址 /v1/images/<id>?exp&sig，显示时再换回本机路径。
 */
interface StoredImage { id: string; ownerId: string; path: string; status: 'ACTIVE' | 'DELETED'; createdAt: number }
const DEMO_SIGNED = /^\/v1\/images\/([0-9a-fA-F-]{36})(?:[?#].*)?$/;
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
const DECIDED: ContactStatus[] = ['APPROVED', 'REJECTED', 'REVOKED'];
const NOT_FOUND = '联系申请不存在';
/** 与后端 ContactRequestService.conflictMessage 一致。 */
const conflictMessage = (status: ContactStatus) => status === 'WITHDRAWN' ? '买家已撤回这次申请' : status === 'REVOKED' ? '卖家已撤回同意' : '该申请已处理';
/** 旧版演示缓存里的申请没有决定时间与已读时间：与 V16 迁移一致，补齐决定时间，已读时间保持为空（视为未读）。 */
function upgradeContact(raw: StoredContact): StoredContact {
  const status = CONTACT_STATUSES.includes(raw.status) ? raw.status : 'PENDING';
  return { ...raw, status, decidedAt: raw.decidedAt ?? (DECIDED.includes(status) ? raw.updatedAt : null), sellerSeenAt: raw.sellerSeenAt ?? null, buyerSeenAt: raw.buyerSeenAt ?? null };
}
/** 与后端 AccountService 一致的文案。 */
const WECHAT_INVALID = '微信登录凭证无效或已过期，请重试';
const BIND_EXPIRED = '绑定已过期，请重新用微信登录';
export const DEMO_RESET_UNSUPPORTED = '演示模式不支持重置码找回：演示数据里没有学校管理员签发重置码，请直接使用演示账号登录';
const TICKET_TTL = 10 * 60 * 1000;
/** 演示微信身份：由模拟登录凭证派生（同一凭证 = 同一个微信）。 */
export const demoOpenid = (code: string) => `demo-openid-${code}`;
const randomHex = () => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const id = () => `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
/** 校区所属学校（来自演示学校目录）；未知校区各自独立，不会与任何学校相等。 */
const school = (campus: Campus) => demoSchoolOf(campus) ?? `unknown:${campus}`;
/** 与后端一致：不在学校目录里的校区一律 400「校区无效」。 */
function requireCampus(campus: unknown) { if (typeof campus !== 'string' || !demoSchoolOf(campus)) throw new ApiError(INVALID_CAMPUS, 400); }
/**
 * 演示的内容安全：后端关键词过滤的极简镜像（只放几条明确的违禁交易词，不复制完整词表）；
 * 去掉空白与标点后比对，挡住「代 - 考」这类拆分。命中时给出与后端逐字相同的统一提示。
 */
export const CONTENT_BLOCKED = '内容可能包含违规信息，请修改后再提交';
const BLOCKED_WORDS = ['代考', '替考', '代写论文', '办证', '假证', '枪支', '管制刀具', '冰毒', '赌博', '刷单', '套现', '校园贷'];
const normalizeForSafety = (text: string) => (typeof text.normalize === 'function' ? text.normalize('NFKC') : text).toLowerCase()
  .replace(/[\s~`!@#$%^&*()\-_=+[\]{}|\\;:'",.<>/?·！￥…（）—【】、；：‘’“”，。《》？]+/g, '');
function requireSafeText(...texts: string[]) {
  const joined = normalizeForSafety(texts.join('\n'));
  if (joined && BLOCKED_WORDS.some((word) => joined.includes(word))) throw new ApiError(CONTENT_BLOCKED, 400);
}
/** 与后端一致的受限提示：「M 月 D 日 HH:mm」按北京时间。 */
function restrictionEnd(epochMs: number) {
  const d = new Date(epochMs + 8 * 3600000), pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** 演示楼栋（演示学校 pilot 的每个有楼栋的校区两个园区）；另一所演示学校还没有楼栋。 */
export const DEMO_BUILDINGS: Building[] = DEMO_SCHOOLS[0].campuses.filter((c) => c.hasBuildings).map((c) => c.id).flatMap((campus, c) => [
  { id: `demo-building-${c}-1`, campusId: campus, zone: '沁园', name: '1号楼' },
  { id: `demo-building-${c}-2`, campusId: campus, zone: '沁园', name: '2号楼' },
  { id: `demo-building-${c}-3`, campusId: campus, zone: '澜园', name: '5号楼' },
]);
const REPORT_TARGETS: ReportTargetType[] = ['PRODUCT', 'USER', 'CIRCLE', 'COMMENT', 'MESSAGE'];
const DAY = 86400000;

/** 演示的留言、私信与治理记录：展示回复、被隐藏的留言、旧版自由文字私信与一条历史上的限制。 */
function seedInteractions(now: number): Pick<Database, 'comments' | 'conversations' | 'messages' | 'restrictions' | 'actions'> {
  return {
    comments: [
      { id: 'demo-comment-1', productId: 'demo-product-0', userId: 'demo-buyer', content: '降噪效果怎么样？地铁里能用吗？', parentId: null, createdAt: now - 50 * 60000, hiddenAt: null, hiddenActionId: null },
      { id: 'demo-comment-2', productId: 'demo-product-0', userId: 'demo-seller', content: '效果不错，地铁里基本听不到报站以外的噪音。', parentId: 'demo-comment-1', createdAt: now - 40 * 60000, hiddenAt: null, hiddenActionId: null },
      { id: 'demo-comment-3', productId: 'demo-product-1', userId: 'demo-seller', content: '（演示：一条被平台隐藏的留言）', parentId: null, createdAt: now - 2 * DAY, hiddenAt: now - DAY, hiddenActionId: 'demo-action-1' },
    ],
    conversations: [{ id: 'demo-conversation-1', productId: 'demo-product-3', buyerId: 'demo-buyer', sellerId: 'demo-seller', createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY + 600000, buyerReadAt: now - 3 * DAY + 600000, sellerReadAt: now - 3 * DAY + 600000 }],
    messages: [
      { id: 'demo-message-1', conversationId: 'demo-conversation-1', senderId: 'demo-buyer', content: '你好，周末可以在东门看车吗？（旧版自由文字消息）', templateCode: null, createdAt: now - 3 * DAY, quarantinedAt: null, quarantineActionId: null },
      { id: 'demo-message-2', conversationId: 'demo-conversation-1', senderId: 'demo-seller', content: '还在的，可以在商品页申请联系方式。', templateCode: 'SELLER_AVAILABLE', createdAt: now - 3 * DAY + 600000, quarantinedAt: null, quarantineActionId: null },
    ],
    restrictions: [{ id: 'demo-restriction-1', userId: 'demo-buyer', scope: 'BOOKING', source: 'SYSTEM_RULE', reasonCode: 'NO_SHOW_THRESHOLD', startsAt: now - 40 * DAY, endsAt: now - 33 * DAY, revokedAt: now - 38 * DAY, revokeReason: 'RULE_RETIRED', createdAt: now - 40 * DAY }],
    actions: [{ id: 'demo-action-1', subjectId: 'demo-seller', actionCode: 'HIDE_COMMENT', targetId: 'demo-comment-3', targetLabel: '你的一条商品留言', reasonCode: 'POLICY_VIOLATION', createdAt: now - DAY, liftedAt: null }],
  };
}

export function seedDatabase(): Database {
  const now = Date.now();
  const goods: [string, Product['category'], number, string, Product['condition']][] = [
    ['索尼无线降噪耳机', '数码电子', 280, 'headphones', '几乎全新'],
    ['高等数学教材，上下册', '教材书籍', 25, 'books', '轻微使用痕迹'],
    ['宿舍护眼台灯', '生活用品', 45, 'lamp', '几乎全新'],
    ['捷安特校园通勤自行车', '运动户外', 350, 'bike', '轻微使用痕迹'],
    ['帆布双肩包', '服饰鞋包', 35, 'bag', '全新'],
    ['蓝牙便携键盘', '数码电子', 80, 'keyboard', '几乎全新'],
    ['课程笔记与复习资料', '教材书籍', 15, 'books', '轻微使用痕迹'],
    ['毕业季收纳盒两件套', '生活用品', 20, 'box', '几乎全新'],
  ];
  return {
    version: 1, userId: null,
    users: [
      { id: 'demo-buyer', account: 'buyer001', password: 'demo12345', nickname: '小鹿同学', campus: '东校区', contact: 'wechat:campus-demo-buyer' },
      { id: 'demo-seller', account: 'seller001', password: 'demo12345', nickname: '小林同学', campus: '西校区', contact: 'wechat:campus-demo-seller' },
      { id: 'other-school', account: 'school002', password: 'demo12345', nickname: '另一所学校的同学', campus: 'demo-b-main', contact: 'private-contact' },
    ],
    products: [
      ...goods.map(([title, category, price, picture, condition], i): Product => ({
        id: `demo-product-${i}`, title, category, price, condition,
        originalPrice: Math.round(price * 1.8), description: '同学自用闲置，使用情况已写在成色里。可以约在校内公共地点当面查看，具体时间和地点双方联系后商量。\n这是演示商品，图片是示意插画。',
        campus: i % 3 === 0 ? '西校区' : '东校区', images: [`/assets/goods/${picture}.png`],
        // 演示取货楼栋：东校区几件放在沁园 1 / 2 号楼，便于体验「本楼」与自动放宽；其余不指定
        ...(i % 3 !== 0 && i < 6 ? { buildingId: i % 2 ? 'demo-building-0-1' : 'demo-building-0-2' } : {}),
        sellerId: 'demo-seller', contact: 'wechat:campus-demo-seller', contactPublic: i === 2,
        status: '在售', createdAt: now - (i + 1) * 3600000, views: 12 + i * 9,
      })),
      { id: 'other-school-product', title: '他校私有商品', category: '其他', condition: '全新', campus: 'demo-b-main', price: 10, images: ['/assets/goods/box.png'], sellerId: 'other-school', contact: 'private-contact', description: '只对本校展示', status: '在售', createdAt: now, views: 0 },
    ], favorites: {}, contacts: [],
    ...seedInteractions(now), moderationReports: [], appeals: [],
    // 演示：「高等数学教材」关联演示目录里的第 8 版（虚构教材，无 ISBN）
    productTextbooks: { 'demo-product-1': 'demo-ed-calculus-8' },
  };
}
/**
 * 旧版演示缓存：学校改由演示学校目录决定（pilot = 东 / 西 / 南 / 北校区）。原来的「demo-school-a」改名为 pilot；
 * 原来放在南校区演示跨校隔离的账号与商品移到另一所演示学校的校区，隔离演示保持不变。
 */
function migrateDemoSchools(db: Database) {
  const rename = (value: string) => value === 'demo-school-a' ? 'pilot' : value;
  for (const c of db.circles ?? []) c.school = rename(c.school);
  for (const x of db.subscriptions ?? []) x.school = rename(x.school);
  for (const x of db.suggestions ?? []) x.school = rename(x.school);
  const other = db.users.find((u) => u.id === 'other-school');
  if (other && demoSchoolOf(other.campus) === 'pilot') {
    other.campus = 'demo-b-main'; other.dormBuildingId = null;
    for (const p of db.products) if (p.sellerId === other.id) { p.campus = 'demo-b-main'; p.buildingId = null; }
  }
}
export class MockApi implements MarketApi {
  private db: Database;
  /** 微信绑定票据：只在内存，一次性、10 分钟；与后端一样只认票据本身。 */
  private readonly tickets = new Map<string, { openid: string; expiresAt: number }>();
  private readonly inviteRequired: boolean;
  constructor(private readonly storage: StoragePort, options: MockOptions = {}) {
    this.inviteRequired = options.inviteRequired === true;
    const saved = storage.get() as Partial<Database> | null;
    this.db = saved?.version === 1 && Array.isArray(saved.users) && Array.isArray(saved.products) && Array.isArray(saved.contacts) && saved.favorites
      ? saved as Database : seedDatabase();
    this.db.contacts = this.db.contacts.map(upgradeContact);
    migrateDemoSchools(this.db);
    // 旧版演示缓存的商品举报（只有一句说明）：并入新的举报记录，原因记为「其他」
    if (this.db.reports?.length && !this.db.moderationReports) {
      this.db.moderationReports = this.db.reports.map((r, i) => ({ id: `legacy-report-${i}`, reporterId: r.reporterId, targetType: 'PRODUCT', targetId: r.productId, reasonCode: 'OTHER', note: r.reason, createdAt: r.createdAt }));
    }
    this.save();
  }
  private save() { this.storage.set(this.db); }
  private user() { const user = this.db.users.find((u) => u.id === this.db.userId); if (!user) throw new Error('请先登录'); return user; }
  /** 本人资料：含头像与只有本人可见的宿舍楼。 */
  private safeUser(user: User): User { const { id, account, nickname, campus, contact, avatar, dormBuildingId } = user; return { id, account, nickname, campus, contact, avatar: this.avatarOut(avatar), dormBuildingId: dormBuildingId ?? null }; }
  /** 头像响应：本人上传的图片给出与后端同形的签名地址；其余原样（预设、空串、旧数据）。 */
  private avatarOut(avatar: string | undefined) { return avatar ? this.signed(avatar) : ''; }
  private item(id: string) {
    const user = this.user(), product = this.db.products.find((p) => p.id === id);
    if (!product || school(product.campus) !== school(user.campus) || (product.status === '已下架' && product.sellerId !== user.id) || !this.visibleTo(product, user.id)) throw new Error('商品不存在或已下架');
    return product;
  }
  private view(product: Product): Product {
    const uid = this.user().id;
    // 只有仍处于「已同意」的申请授权查看；撤回同意（REVOKED）后立即看不到
    const approved = this.db.contacts.some((r) => r.productId === product.id && r.buyerId === uid && r.status === 'APPROVED');
    return { ...product, images: product.images.map((image) => this.signed(image)), contact: product.sellerId === uid || product.contactPublic || approved ? product.contact : '', ...this.productExtras(product, uid) };
  }
  async restore() { const user = this.db.users.find((u) => u.id === this.db.userId); return user ? this.safeUser(user) : null; }
  async login(account: string, password: string) { const user = this.db.users.find((u) => !u.deleted && u.account === account.trim() && u.password === password); if (!user) throw new Error('账号或密码错误'); this.db.userId = user.id; this.save(); return this.safeUser(user); }
  async register(input: RegisterInput) {
    if (!/^[a-zA-Z0-9]{6,20}$/.test(input.account.trim()) || input.password.length < 8 || !input.nickname.trim()) throw new Error('请填写有效账号、昵称和至少 8 位密码');
    requireCampus(input.campus);
    // 试点期邀请注册：未填 400「请输入邀请码」；不存在或已用完 400「邀请码无效或已用完」；只有注册成功才计一次使用
    const invite = this.inviteRequired ? this.registrationInvite(input.inviteCode, input.campus) : null;
    if (this.db.users.some((u) => !u.deleted && u.account === input.account.trim())) throw new Error('该账号已注册');
    const { account, password, nickname, campus, contact } = input;
    const user = { account: account.trim(), password, nickname: nickname.trim(), campus, contact, id: id() };
    if (invite) this.db.registrationInviteUses = { ...this.db.registrationInviteUses, [invite]: (this.db.registrationInviteUses?.[invite] ?? 0) + 1 };
    this.db.users.push(user); this.db.userId = user.id; this.save(); return this.safeUser(user);
  }
  /**
   * 校验演示注册邀请码（与后端 RegistrationInvites 同序同文案）：缺少或空白 →「请输入邀请码」；
   * 不是字符串、不存在、已用完、不是所选校区那所学校的 → 一律「邀请码无效或已用完」。返回归一化后的邀请码（用于计数）。
   */
  private registrationInvite(raw: unknown, campus: Campus): string {
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) throw new ApiError(INVITE_REQUIRED_MESSAGE, 400);
    const compact = typeof raw === 'string' ? compactRegistrationInvite(raw) : '';
    const invite = DEMO_REGISTRATION_INVITES.find((c) => compactRegistrationInvite(c.code) === compact && c.school === demoSchoolOf(campus));
    if (!invite || (this.db.registrationInviteUses?.[compact] ?? 0) >= invite.maxUses) throw new ApiError(INVITE_INVALID_MESSAGE, 400);
    return compact;
  }
  async logout() { this.db.userId = null; this.save(); }
  async list(query: Query) {
    const user = this.user(), kw = query.keyword?.trim().toLowerCase() ?? '';
    const list = this.db.products.filter((p) => school(p.campus) === school(user.campus) && p.status !== '已下架' && this.visibleTo(p, user.id)
      && (!kw || `${p.title} ${p.description}`.toLowerCase().includes(kw))
      && (!query.category || p.category === query.category) && (!query.campus || p.campus === query.campus)
      && (!query.condition || p.condition === query.condition) && (query.minPrice === undefined || p.price >= query.minPrice)
      && (query.maxPrice === undefined || p.price <= query.maxPrice));
    list.sort((a, b) => query.sort === 'priceAsc' ? a.price - b.price : query.sort === 'priceDesc' ? b.price - a.price : query.sort === 'views' ? b.views - a.views : b.createdAt - a.createdAt);
    const start = (query.page - 1) * query.pageSize;
    return { items: list.slice(start, start + query.pageSize).map((p) => this.view(p)), total: list.length, page: query.page, pageSize: query.pageSize };
  }
  async detail(id: string) { return this.view(this.item(id)); }
  async publicUser(id: string) {
    const viewer = this.user(), user = this.db.users.find((u) => u.id === id);
    if (!user || school(user.campus) !== school(viewer.campus)) throw new Error('用户不存在');
    // 公共投影：没有账号、联系方式与宿舍楼
    return { id: user.id, nickname: user.nickname, campus: user.campus, avatar: this.avatarOut(user.avatar) };
  }
  async publish(input: ProductInput, productId?: string) {
    const user = this.user();
    const old = productId ? this.item(productId) : null;
    if (old && old.sellerId !== user.id) throw new Error('只能编辑自己的商品');
    const product = this.writeProduct(user, input, old, null);
    this.save(); return this.view(product);
  }
  /**
   * 单件、整套打包、批量发布与编辑共用（与后端 MarketService.createProductAs / updateProduct 同一顺序）：
   * 字段校验 → 图片归属 → 内容安全 → 可见范围与在籍身份 → 取货楼栋 → 打包明细 / 教材版本 → 写入 → 同步需求匹配。
   */
  private writeProduct(user: User, input: ProductInput, old: Product | null, assistedBy: string | null): Product {
    const message = validateProduct(input); if (message) throw new ApiError(message, 400);
    // 与后端 ImageService.requireUsable 一致：只能引用本人（或协助整理的人）上传、仍有效的图片
    for (const image of input.images) {
      if (image.startsWith('upload:') && !(isUploadRef(image) && this.uploads().some((u) => `upload:${u.id}` === image && (u.ownerId === user.id || u.ownerId === assistedBy) && u.status === 'ACTIVE'))) throw new ApiError('只能使用自己上传的图片，请重新上传', 400);
    }
    requireCampus(input.campus);
    if (school(user.campus) !== school(input.campus)) throw new Error('只能发布本校商品');
    if (!old) this.requireUnrestricted(user.id, 'PUBLISHING');
    requireSafeText(input.title, input.description);
    const kind: ListingKind = old ? old.listingKind ?? 'SINGLE' : input.listingKind ?? 'SINGLE';
    if (input.listingKind !== undefined && input.listingKind !== 'SINGLE' && input.listingKind !== 'BUNDLE') throw new ApiError('商品形态无效', 400);
    if (old && input.listingKind !== undefined && input.listingKind !== kind) throw new ApiError('商品发布后不能在单件与整套打包之间切换', 400);
    // 可见范围：发布默认公开；编辑时没有提交就保持不变
    const keepVisibility = old && input.visibility === undefined && input.circleIds === undefined;
    const choice = keepVisibility ? { visibility: old!.visibility ?? 'PUBLIC', circleIds: this.productCircleStore()[old!.id] ?? [] } : this.parseVisibility(input.visibility, input.circleIds);
    if (!keepVisibility) this.requirePublishable(user.id, input.campus, choice);
    const buildingId = input.buildingId === undefined ? (old?.buildingId ?? null) : input.buildingId;
    if (buildingId) {
      const b = DEMO_BUILDINGS.find((x) => x.id === buildingId);
      if (!b) throw new ApiError('楼栋不存在', 404);
      if (b.campusId !== input.campus) throw new ApiError('所选楼栋不属于该校区', 400);
    }
    let bundleItems: BundleItem[] | null = old?.bundleItems ?? null;
    let edition: DemoEdition | null | undefined;
    if (kind === 'BUNDLE') {
      if (input.inspection !== undefined && input.inspection !== null) throw new ApiError('整套打包商品按每条明细验货，不需要商品级验货清单', 400);
      if (input.textbookEditionId !== undefined && input.textbookEditionId !== null) throw new ApiError('整套打包商品不能关联单一教材版本', 400);
      if (!old || input.bundleItems !== undefined) bundleItems = parseBundleItems(input.bundleItems);
    } else {
      if (input.bundleItems !== undefined && input.bundleItems !== null) throw new ApiError('只有整套打包商品可以有明细', 400);
      if (input.textbookEditionId !== undefined) edition = this.resolveTextbook(input.textbookEditionId, input.category, input.campus);
    }
    const { inspection, listingKind: _kind, bundleItems: _items, visibility: _v, circleIds: _c, textbookEditionId: _t, buildingId: _b, ...fields } = input;
    const product: Product = { ...old, ...fields, buildingId, listingKind: kind, visibility: choice.visibility as ProductVisibility, bundleItems,
      inspection: inspection ? { items: inspection.map((item) => ({ code: item.itemCode, label: item.itemCode, condition: item.condition, note: item.note ?? null })) } : old?.inspection ?? null,
      id: old?.id ?? id(), sellerId: user.id, status: old?.status ?? '在售', createdAt: old?.createdAt ?? Date.now(), views: old?.views ?? 0 };
    this.db.products = [...this.db.products.filter((p) => p.id !== product.id), product];
    const circles = this.productCircleStore();
    if (choice.visibility === 'CIRCLE_ONLY') circles[product.id] = [...choice.circleIds]; else delete circles[product.id];
    const links = this.db.productTextbooks ??= {};
    // 教材版本：显式提交才改；切离教材书籍分类时自动解除
    if (edition !== undefined) { if (edition) links[product.id] = edition.id; else delete links[product.id]; }
    if (product.category !== '教材书籍' || kind === 'BUNDLE') delete links[product.id];
    if (assistedBy) (this.db.productAssistedBy ??= {})[product.id] = assistedBy;
    this.evaluateDemand(product);
    return product;
  }
  async myListings() { const user = this.user(); return this.db.products.filter((p) => p.sellerId === user.id).sort((a, b) => b.createdAt - a.createdAt).map((p) => this.view(p)); }
  async status(id: string, status: ProductStatus) { const p = this.item(id); if (p.sellerId !== this.user().id) throw new Error('只能管理自己的商品'); p.status = status; this.evaluateDemand(p); this.save(); }
  async favorites() { return [...(this.db.favorites[this.user().id] ?? [])]; }
  async favorite(id: string, active: boolean) { this.item(id); const uid = this.user().id, ids = new Set(this.db.favorites[uid] ?? []); active ? ids.add(id) : ids.delete(id); this.db.favorites[uid] = [...ids]; this.save(); }
  /** 申请对象（不含联系方式），unread 按查看者视角计算。 */
  private contactView(r: StoredContact): ContactRequest {
    const uid = this.user().id, nickname = (userId: string) => this.db.users.find((u) => u.id === userId)?.nickname ?? '';
    const unread = r.sellerId === uid ? r.status === 'PENDING' && r.sellerSeenAt === null : DECIDED.includes(r.status) && r.buyerSeenAt === null;
    const { sellerSeenAt: _seller, buyerSeenAt: _buyer, ...fields } = r;
    return { ...fields, productTitle: this.db.products.find((p) => p.id === r.productId)?.title ?? r.productTitle, buyerNickname: nickname(r.buyerId), sellerNickname: nickname(r.sellerId), unread };
  }
  /** 只统计、列出本人仍能看到的商品上的申请（与后端 product_visible_to 同口径：同校、未下架或本人商品）。 */
  private visibleContacts(role: ContactRole) {
    const user = this.user();
    return this.db.contacts.filter((r) => {
      const product = this.db.products.find((p) => p.id === r.productId);
      return (role === 'received' ? r.sellerId === user.id : r.buyerId === user.id) && product && school(product.campus) === school(user.campus)
        && (product.status !== '已下架' || product.sellerId === user.id) && this.visibleTo(product, user.id);
    });
  }
  /** 申请必须属于本人（卖家或买家），不存在与不属于本人一律 404。 */
  private owned(id: string, role: 'sellerId' | 'buyerId') {
    const r = this.db.contacts.find((c) => c.id === id);
    if (!r || r[role] !== this.user().id) throw new ApiError(NOT_FOUND, 404);
    return r;
  }
  async requestContact(id: string) {
    const p = this.item(id), buyer = this.user();
    if (p.sellerId === buyer.id) throw new ApiError('不能申请自己的联系方式', 400);
    this.requireUnrestricted(buyer.id, 'CONTACT');
    const existing = this.db.contacts.find((r) => r.productId === id && r.buyerId === buyer.id);
    // 与后端一致：待处理 / 已同意幂等返回；拒绝与撤回同意是终态，再次申请 409，不会静默成功
    if (existing && (existing.status === 'PENDING' || existing.status === 'APPROVED')) return this.contactView(existing);
    if (existing?.status === 'REJECTED') throw new ApiError('卖家已拒绝这次申请，不能再次申请', 409);
    if (existing?.status === 'REVOKED') throw new ApiError('卖家已撤回同意，不能再次申请', 409);
    if (p.status !== '在售') throw new ApiError('该商品当前不可申请联系', 409);
    if (p.contactPublic) throw new ApiError('卖家已公开联系方式，请直接查看', 409);
    const now = Date.now();
    if (existing) {
      // 撤回后重新申请：同一条记录回到 PENDING，卖家重新看到一条未读
      Object.assign(existing, { status: 'PENDING', updatedAt: now, sellerSeenAt: null, buyerSeenAt: now });
      this.save(); return this.contactView(existing);
    }
    const request: StoredContact = { id: `request_${Math.random().toString(36).slice(2)}`, productId: id, productTitle: p.title, buyerId: buyer.id, sellerId: p.sellerId, status: 'PENDING', createdAt: now, updatedAt: now, decidedAt: null, sellerSeenAt: null, buyerSeenAt: now };
    this.db.contacts.push(request); this.save(); return this.contactView(request);
  }
  async contactState(id: string) { this.item(id); const result = this.db.contacts.find((r) => r.productId === id && r.buyerId === this.user().id); return result ? this.contactView(result) : null; }
  async contacts(query: ContactQuery) {
    const page = query.page ?? 1, size = query.size ?? 20;
    if (query.role !== 'received' && query.role !== 'sent') throw new ApiError('role 只能是 received 或 sent', 400);
    if (query.status !== undefined && !CONTACT_STATUSES.includes(query.status)) throw new ApiError('申请状态无效', 400);
    if (!Number.isInteger(page) || page < 1) throw new ApiError('page 无效', 400);
    if (!Number.isInteger(size) || size < 1 || size > 50) throw new ApiError('size 无效', 400);
    const list = this.visibleContacts(query.role).filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { items: list.slice((page - 1) * size, page * size).map((r) => this.contactView(r)), total: list.length, page, size };
  }
  async unreadCount(): Promise<UnreadCount> {
    const received = this.visibleContacts('received').filter((r) => r.status === 'PENDING' && r.sellerSeenAt === null).length;
    const updates = this.visibleContacts('sent').filter((r) => DECIDED.includes(r.status) && r.buyerSeenAt === null).length;
    return { received, updates, total: received + updates };
  }
  async markRead(role: ContactRole) {
    if (role !== 'received' && role !== 'sent') throw new ApiError('role 只能是 received 或 sent', 400);
    const uid = this.user().id, now = Date.now();
    for (const r of this.db.contacts) {
      if (role === 'received' && r.sellerId === uid && r.status === 'PENDING' && r.sellerSeenAt === null) r.sellerSeenAt = now;
      if (role === 'sent' && r.buyerId === uid && DECIDED.includes(r.status) && r.buyerSeenAt === null) r.buyerSeenAt = now;
    }
    this.save(); return this.unreadCount();
  }
  async decide(id: string, status: 'APPROVED' | 'REJECTED') {
    if (status !== 'APPROVED' && status !== 'REJECTED') throw new ApiError('请选择同意或拒绝', 400);
    const r = this.owned(id, 'sellerId'); this.item(r.productId);
    if (r.status === 'PENDING') { const now = Date.now(); Object.assign(r, { status, updatedAt: now, decidedAt: now, buyerSeenAt: null }); this.save(); }
    else if (r.status !== status) throw new ApiError(conflictMessage(r.status), 409);
  }
  async withdraw(id: string) {
    const r = this.owned(id, 'buyerId');
    if (r.status === 'PENDING') { Object.assign(r, { status: 'WITHDRAWN', updatedAt: Date.now() }); this.save(); }
    else if (r.status !== 'WITHDRAWN') throw new ApiError(conflictMessage(r.status), 409);
    return this.contactView(r);
  }
  async revoke(id: string) {
    const r = this.owned(id, 'sellerId');
    if (r.status === 'APPROVED') { const now = Date.now(); Object.assign(r, { status: 'REVOKED', updatedAt: now, decidedAt: now, buyerSeenAt: null }); this.save(); }
    else if (r.status !== 'REVOKED') throw new ApiError('只能撤回已经同意的申请', 409);
    return this.contactView(r);
  }
  async template() { return null; }
  async me() { return this.safeUser(this.user()); }
  async updateProfile(input: ProfileInput) {
    const u = this.user(), nickname = input.nickname.trim();
    if (!nickname) throw new ApiError('昵称不能为空', 400);
    requireCampus(input.campus);
    if (school(input.campus) !== school(u.campus)) throw new ApiError('不能通过资料修改学校', 400);
    if (input.dormBuildingId && !DEMO_BUILDINGS.some((b) => b.id === input.dormBuildingId && b.campusId === input.campus)) throw new ApiError('宿舍楼不属于所选校区', 400);
    if (nickname !== u.nickname) requireSafeText(nickname);
    if (input.avatar !== undefined) this.requireAvatar(u.id, input.avatar);
    Object.assign(u, { nickname, campus: input.campus, contact: input.contact.trim() });
    if (input.avatar !== undefined) u.avatar = input.avatar;
    if (input.dormBuildingId !== undefined) u.dormBuildingId = input.dormBuildingId;
    this.save(); return this.safeUser(u);
  }
  async buildings(campus: Campus) { this.user(); return DEMO_BUILDINGS.filter((b) => b.campusId === campus).map((b) => ({ ...b })); }
  /** 与 GET /v1/schools 同形（公开，无需登录）。 */
  async schools() { return DEMO_SCHOOLS.map((s) => ({ ...s, campuses: s.campuses.map((c) => ({ ...c })) })); }

  // ---------- 可信治理（用户侧；演示没有工作人员，举报与申诉保持待处理，并如实说明） ----------
  private requireUnrestricted(userId: string, scope: 'CONTACT' | 'PUBLISHING') {
    const now = Date.now();
    const active = (this.db.restrictions ?? []).filter((r) => r.userId === userId && (r.scope === scope || (scope === 'CONTACT' && r.scope === 'BOOKING')) && !r.revokedAt && r.startsAt <= now && r.endsAt > now)
      .sort((a, b) => b.endsAt - a.endsAt)[0];
    if (!active) return;
    const what = scope === 'CONTACT' ? '申请联系方式' : '发布商品';
    throw new ApiError(`你的「${what}」功能暂时受限，至 ${restrictionEnd(active.endsAt)} 自动恢复。可以在「我的限制」里查看原因或提交申诉。`, 403);
  }
  private reportView(r: StoredReport): MyReport { return { id: r.id, targetType: r.targetType, targetId: r.targetId, reasonCode: r.reasonCode, createdAt: r.createdAt, status: 'RECEIVED', outcome: null, awaitingEligibleStaff: true }; }
  /** 举报对象必须存在且本人能看到（看不到与不存在一样 404）。 */
  private requireReportTarget(type: ReportTargetType, targetId: string) {
    const uid = this.user().id;
    if (type === 'PRODUCT') { this.item(targetId); return; }
    if (type === 'USER') { const u = this.db.users.find((x) => x.id === targetId && !x.deleted); if (u && school(u.campus) === school(this.user().campus)) return; }
    if (type === 'COMMENT') { const c = this.commentStore().find((x) => x.id === targetId); if (c) { this.item(c.productId); return; } }
    if (type === 'MESSAGE') { const m = this.messageStore().find((x) => x.id === targetId); const c = m && this.conversationStore().find((x) => x.id === m.conversationId); if (c && this.accessible(c, uid)) return; }
    throw new ApiError('举报对象不存在', 404);
  }
  async report(input: ReportInput) {
    const me = this.user();
    if (!REPORT_TARGETS.includes(input.targetType)) throw new ApiError('举报对象类型无效', 400);
    if (!REPORT_REASONS.includes(input.reasonCode)) throw new ApiError('举报原因无效', 400);
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 500 || /[<>]/.test(note)) throw new ApiError('说明最多 500 字，且不能包含尖括号', 400);
    if (input.reasonCode === 'OTHER' && !note) throw new ApiError('选择「其他」时请写一句说明', 400);
    this.requireReportTarget(input.targetType, String(input.targetId));
    const reports = this.db.moderationReports ??= [];
    const existing = reports.find((r) => r.reporterId === me.id && r.targetType === input.targetType && r.targetId === input.targetId);
    if (existing) return this.reportView(existing);
    const report: StoredReport = { id: id(), reporterId: me.id, targetType: input.targetType, targetId: String(input.targetId), reasonCode: input.reasonCode, note: note || null, createdAt: Date.now() };
    reports.push(report); this.save(); return this.reportView(report);
  }
  async myReports() { const uid = this.user().id; return (this.db.moderationReports ?? []).filter((r) => r.reporterId === uid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((r) => this.reportView(r)); }
  private appealView(a: StoredAppeal | undefined): AppealSummary | null { return a ? { id: a.id, status: a.status, createdAt: a.createdAt, decidedAt: a.decidedAt, awaitingEligibleStaff: a.status === 'PENDING' } : null; }
  private notices(uid: string): MyNotice[] {
    return (this.db.actions ?? []).filter((a) => a.subjectId === uid).sort((x, y) => y.createdAt - x.createdAt).slice(0, 50).map((a) => {
      const active = a.actionCode !== 'CONFIRM_NO_SHOW' && !a.liftedAt, appeal = (this.db.appeals ?? []).find((x) => x.actionId === a.id);
      return { actionId: a.id, actionCode: a.actionCode, targetId: a.targetId, targetLabel: a.targetLabel, reasonCode: a.reasonCode, createdAt: a.createdAt, active, appeal: this.appealView(appeal), canAppeal: active && !appeal };
    });
  }
  async myGovernance(): Promise<MyGovernance> {
    const uid = this.user().id, now = Date.now();
    const restrictions = (this.db.restrictions ?? []).filter((r) => r.userId === uid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((r): MyRestriction => {
      const active = !r.revokedAt && r.startsAt <= now && r.endsAt > now, appeal = (this.db.appeals ?? []).find((a) => a.restrictionId === r.id);
      return { id: r.id, scope: r.scope, source: r.source, reasonCode: r.reasonCode, startsAt: r.startsAt, endsAt: r.endsAt, active, revokedAt: r.revokedAt, revokeReason: r.revokeReason, appeal: this.appealView(appeal), canAppeal: active && !appeal };
    });
    return { restrictions, notices: this.notices(uid) };
  }
  async appeal(input: AppealInput) {
    const me = this.user(), raw = input as { restrictionId?: string; actionId?: string; reason?: unknown };
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!reason) throw new ApiError('请写明申诉理由', 400);
    if (reason.length > 500 || /[<>]/.test(reason)) throw new ApiError('申诉理由最多 500 字，且不能包含尖括号', 400);
    if (!!raw.restrictionId === !!raw.actionId) throw new ApiError('请指定要申诉的一条限制或一次处理', 400);
    if (raw.restrictionId) {
      const r = (this.db.restrictions ?? []).find((x) => x.id === raw.restrictionId);
      if (!r || r.userId !== me.id) throw new ApiError('限制不存在', 404);
      if (r.revokedAt || r.endsAt <= Date.now()) throw new ApiError('这条限制已经结束，不需要申诉', 409);
    } else {
      const notice = this.notices(me.id).find((n) => n.actionId === raw.actionId);
      if (!notice) throw new ApiError('处理记录不存在', 404);
      if (!notice.active) throw new ApiError('这项处理已经不再生效，不需要申诉', 409);
    }
    const appeals = this.db.appeals ??= [];
    if (appeals.some((x) => (raw.restrictionId && x.restrictionId === raw.restrictionId) || (raw.actionId && x.actionId === raw.actionId))) throw new ApiError('每条限制或处理只能申诉一次', 409);
    const appeal: StoredAppeal = { id: id(), userId: me.id, restrictionId: raw.restrictionId ?? null, actionId: raw.actionId ?? null, reason, status: 'PENDING', createdAt: Date.now(), decidedAt: null };
    appeals.push(appeal); this.save(); return this.appealView(appeal)!;
  }

  // ---------- 留言 ----------
  private commentStore() { return this.db.comments ??= []; }
  private commentView(c: StoredComment, viewerId: string): Comment {
    const hidden = !!c.hiddenAt;
    return { id: c.id, productId: c.productId, userId: c.userId, content: hidden ? '' : c.content, createdAt: c.createdAt, parentId: c.parentId, moderationHidden: hidden, hiddenForAuthor: hidden && c.userId === viewerId };
  }
  async comments(productId: string) {
    const uid = this.user().id; this.item(productId);
    return this.commentStore().filter((c) => c.productId === productId).sort((a, b) => b.createdAt - a.createdAt).map((c) => this.commentView(c, uid));
  }
  async addComment(productId: string, content: string, parentId: string | null) {
    const user = this.user(); this.item(productId);
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) throw new ApiError('留言内容不能为空', 400);
    if (parentId && !this.commentStore().some((c) => c.id === parentId && c.productId === productId)) throw new ApiError('回复的留言不存在', 404);
    requireSafeText(text);
    const comment: StoredComment = { id: id(), productId, userId: user.id, content: text, parentId: parentId || null, createdAt: Date.now(), hiddenAt: null, hiddenActionId: null };
    this.commentStore().push(comment); this.save(); return this.commentView(comment, user.id);
  }

  // ---------- 私信（阶段 1：只能发送快捷消息；自由文字默认关闭） ----------
  private conversationStore() { return this.db.conversations ??= []; }
  private messageStore() { return this.db.messages ??= []; }
  /** 卖家，或仍能看到这件商品的买家（与后端 ConversationMapper.countMember 同口径）。 */
  private accessible(c: StoredConversation, uid: string) {
    if (c.sellerId === uid) return true;
    const p = this.db.products.find((x) => x.id === c.productId), viewer = this.db.users.find((u) => u.id === uid);
    return c.buyerId === uid && !!p && !!viewer && school(p.campus) === school(viewer.campus) && p.status !== '已下架';
  }
  private conversation(id: string) {
    const c = this.conversationStore().find((x) => x.id === id);
    if (!c || !this.accessible(c, this.user().id)) throw new ApiError('会话不存在', 404);
    return c;
  }
  private conversationView(c: StoredConversation): Conversation { const { buyerReadAt: _b, sellerReadAt: _s, ...fields } = c; return { ...fields }; }
  private messageView(m: StoredMessage): ChatMessage {
    return { id: m.id, conversationId: m.conversationId, senderId: m.senderId, content: m.quarantinedAt ? '' : m.content, createdAt: m.createdAt, quarantined: !!m.quarantinedAt, templateCode: m.templateCode };
  }
  async conversations() { const uid = this.user().id; return this.conversationStore().filter((c) => this.accessible(c, uid)).sort((a, b) => b.updatedAt - a.updatedAt).map((c) => this.conversationView(c)); }
  async openConversation(productId: string) {
    const user = this.user(), product = this.item(productId);
    if (product.sellerId === user.id) throw new ApiError('不能与自己的商品创建会话', 400);
    const found = this.conversationStore().find((c) => c.productId === productId && c.buyerId === user.id);
    if (found) return this.conversationView(found);
    const now = Date.now();
    const conversation: StoredConversation = { id: id(), productId, buyerId: user.id, sellerId: product.sellerId, createdAt: now, updatedAt: now, buyerReadAt: now, sellerReadAt: null };
    this.conversationStore().push(conversation); this.save(); return this.conversationView(conversation);
  }
  async messages(conversationId: string) {
    const c = this.conversation(conversationId);
    return this.messageStore().filter((m) => m.conversationId === c.id).sort((a, b) => a.createdAt - b.createdAt).map((m) => this.messageView(m));
  }
  async sendMessage(conversationId: string, input: SendMessageInput) {
    const user = this.user(), c = this.conversation(conversationId), raw = (input ?? {}) as { templateCode?: unknown; content?: unknown };
    let content: string, templateCode: string | null = null;
    if (raw.templateCode !== undefined) {
      const template = MESSAGE_TEMPLATES.find((t) => t.code === raw.templateCode);
      if (!template) throw new ApiError(TEMPLATE_NOT_FOUND, 400);
      const role = c.buyerId === user.id ? 'BUYER' : 'SELLER';
      if (template.role !== 'ANY' && template.role !== role) throw new ApiError(TEMPLATE_WRONG_ROLE, 400);
      content = template.text; templateCode = template.code;
    } else {
      if (!this.db.messaging?.freeTextEnabled) throw new ApiError(FREE_TEXT_DISABLED, 400);
      content = typeof raw.content === 'string' ? raw.content.trim() : '';
      if (!content) throw new ApiError('请输入消息内容', 400);
      requireSafeText(content);
    }
    const now = Math.max(Date.now(), c.updatedAt + 1);
    const message: StoredMessage = { id: id(), conversationId: c.id, senderId: user.id, content, templateCode, createdAt: now, quarantinedAt: null, quarantineActionId: null };
    this.messageStore().push(message);
    c.updatedAt = now; if (c.buyerId === user.id) c.buyerReadAt = now; else c.sellerReadAt = now;
    this.save(); return this.messageView(message);
  }
  async markConversationRead(conversationId: string) {
    const uid = this.user().id, c = this.conversation(conversationId), now = Math.max(Date.now(), c.updatedAt);
    if (c.buyerId === uid) c.buyerReadAt = now; else c.sellerReadAt = now;
    this.save();
  }
  /** 有对方新消息（晚于我最近一次阅读）的会话数。 */
  async messageUnread() {
    const uid = this.user().id;
    return this.conversationStore().filter((c) => this.accessible(c, uid)).filter((c) => {
      const readAt = (c.buyerId === uid ? c.buyerReadAt : c.sellerReadAt) ?? -1;
      return this.messageStore().some((m) => m.conversationId === c.id && m.senderId !== uid && m.createdAt > readAt);
    }).length;
  }
  async messageTemplates(): Promise<MessageTemplates> { this.user(); return { freeTextEnabled: this.db.messaging?.freeTextEnabled === true, templates: MESSAGE_TEMPLATES.map((t) => ({ ...t })) }; }
  private uploads() { return this.db.images ??= []; }
  /** 引用 → 与后端同形的签名地址（演示签名，不校验）；其余原样。 */
  private signed(image: string) { return isUploadRef(image) ? `/v1/images/${image.slice(7)}?exp=${Math.floor(Date.now() / 1000) + 3600}&sig=demo` : image; }
  async upload(path: string, onProgress?: (percent: number) => void): Promise<UploadedImage> {
    const user = this.user();
    if (typeof path !== 'string' || !path) throw new ApiError('请选择一张图片', 400);
    const image: StoredImage = { id: uuid(), ownerId: user.id, path, status: 'ACTIVE', createdAt: Date.now() };
    this.uploads().push(image); this.save(); onProgress?.(100);
    const ref = `upload:${image.id}`;
    return { id: image.id, ref, url: this.signed(ref), width: 0, height: 0 };
  }
  /** 签名地址 → 本机文件路径；已注销 / 不存在的图片返回空串（显示占位）。 */
  imageSrc(url: string) {
    const match = typeof url === 'string' ? url.match(DEMO_SIGNED) : null;
    if (!match) return url || '';
    const image = this.uploads().find((u) => u.id === match[1]);
    return image?.status === 'ACTIVE' ? image.path : '';
  }
  imageRef(url: string) { return imageRefFromUrl(url); }

  // ---------- 阶段 3：账号生命周期（与后端 AccountService 同语义；演示只有一台设备，没有「其他设备的会话」） ----------
  private bindings() { return this.db.wechat ??= []; }
  async wechatStatus(): Promise<WechatStatus> {
    const uid = this.db.userId;
    return { enabled: true, bound: Boolean(uid && this.bindings().some((w) => w.userId === uid)) };
  }
  async wechatLogin(code: string): Promise<WechatLoginResult> {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(code)) throw new ApiError(WECHAT_INVALID, 400);
    const openid = demoOpenid(code), binding = this.bindings().find((w) => w.openid === openid);
    const user = binding && this.db.users.find((u) => u.id === binding.userId && !u.deleted);
    if (user) { this.db.userId = user.id; this.save(); return { bound: true, user: this.safeUser(user) }; }
    const bindTicket = randomHex(), expiresAt = Date.now() + TICKET_TTL;
    this.tickets.set(bindTicket, { openid, expiresAt });
    return { bound: false, bindTicket, expiresAt };
  }
  async wechatBind(bindTicket: string) {
    const user = this.user();
    const ticket = this.tickets.get(bindTicket);
    if (!ticket || ticket.expiresAt <= Date.now()) throw new ApiError(BIND_EXPIRED, 400);
    // 与后端一致：票据先作废，再检查一对一冲突（冲突时也不能复用这张票据）
    this.tickets.delete(bindTicket);
    if (this.bindings().some((w) => w.userId === user.id)) throw new ApiError('这个账号已经绑定了微信，请先解除绑定', 409);
    if (this.bindings().some((w) => w.openid === ticket.openid)) throw new ApiError('这个微信已经绑定了其他账号', 409);
    this.bindings().push({ openid: ticket.openid, userId: user.id }); this.save();
  }
  async wechatUnbind() { const uid = this.user().id; this.db.wechat = this.bindings().filter((w) => w.userId !== uid); this.save(); }
  async changePassword(currentPassword: string, newPassword: string) {
    const user = this.user(), current = currentPassword.trim(), next = newPassword.trim();
    if (!current || current.length > 72) throw new ApiError('currentPassword 长度无效', 400);
    if (next.length < 8 || next.length > 72) throw new ApiError('newPassword 长度无效', 400);
    if (user.password !== current) throw new ApiError('当前密码不正确', 400);
    if (current === next) throw new ApiError('新密码不能与当前密码相同', 400);
    user.password = next; this.save();
    // 演示只有本机这一个会话：当前会话保留，没有其他设备需要退出
    return { otherSessionsEnded: 0 };
  }
  async resetPassword(_input: PasswordResetInput): Promise<void> { throw new ApiError(DEMO_RESET_UNSUPPORTED, 400); }
  async deleteAccount(input: DeletionInput): Promise<DeletionResult> {
    const user = this.user();
    const password = typeof input.password === 'string' ? input.password.trim() : '';
    if (!password || password.length > 72) throw new ApiError('password 长度无效', 400);
    if (input.confirmation !== '确认注销') throw new ApiError('请输入「确认注销」确认注销', 400);
    if (user.password !== password) throw new ApiError('密码不正确', 400);
    // 演示没有后台工作人员；仍是在用圈子的所有者时与后端一样 409
    if (this.memberships().some((m) => m.userId === user.id && m.status === 'ACTIVE' && m.role === 'OWNER' && this.circleStore().some((c) => c.id === m.circleId && c.status === 'ACTIVE'))) {
      throw new ApiError('你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销', 409);
    }
    let productsTakenDown = 0, requestsClosed = 0;
    for (const p of this.db.products.filter((item) => item.sellerId === user.id)) {
      if (p.status === '在售') { p.status = '已下架'; productsTakenDown++; }
      p.contact = ''; p.contactPublic = false;
    }
    const now = Date.now();
    for (const r of this.db.contacts) {
      if (r.buyerId === user.id && r.status === 'PENDING') { Object.assign(r, { status: 'WITHDRAWN', updatedAt: now }); requestsClosed++; }
      else if (r.sellerId === user.id && r.status === 'PENDING') { Object.assign(r, { status: 'REJECTED', updatedAt: now, decidedAt: now, buyerSeenAt: null }); requestsClosed++; }
      else if (r.sellerId === user.id && r.status === 'APPROVED') { Object.assign(r, { status: 'REVOKED', updatedAt: now, decidedAt: now, buyerSeenAt: null }); requestsClosed++; }
    }
    this.db.wechat = this.bindings().filter((w) => w.userId !== user.id);
    // 退出圈子、停用需求订阅与协助邀请
    let membershipsEnded = 0;
    for (const m of this.memberships()) if (m.userId === user.id && m.status === 'ACTIVE') { Object.assign(m, { status: 'LEFT', role: 'MEMBER', endedAt: now }); membershipsEnded++; }
    for (const sub of this.subscriptionStore()) if (sub.userId === user.id) sub.active = false;
    for (const invite of this.assistInviteStore()) if (invite.ownerId === user.id || invite.assistantId === user.id) invite.status = 'REVOKED';
    // 与后端一致：本人上传的图片全部失效
    for (const image of this.uploads()) if (image.ownerId === user.id) image.status = 'DELETED';
    Object.assign(user, { account: `deleted-${user.id}`, password: randomHex(), nickname: '已注销用户', contact: '', avatar: '', deleted: true });
    this.db.userId = null; this.save();
    return { productsTakenDown, requestsClosed, membershipsEnded };
  }

  // ======================================================================
  // 与 Web 对齐（第二部分）：与后端 / Web Mock 逐条一致的演示实现
  // ======================================================================
  /** 演示不加载任何外部图片：外部头像与外部商品图都不允许（与后端 externalAllowed=false 一致）。 */
  async clientConfig(): Promise<ClientConfig> { return normalizeClientConfig({ images: { maxCount: 9, maxBytes: 5 * 1024 * 1024, accept: ['image/jpeg', 'image/png'], externalAllowed: false }, registration: { inviteRequired: this.inviteRequired } }); }
  /** 头像只能是空串、12 个预设之一或本人上传、仍有效的图片。 */
  private requireAvatar(userId: string, avatar: unknown) {
    if (avatar === '' || (typeof avatar === 'string' && presetNumber(avatar))) return;
    if (typeof avatar === 'string' && /^https?:\/\//i.test(avatar)) throw new ApiError(AVATAR_EXTERNAL_REJECTED, 400);
    if (typeof avatar === 'string' && isUploadRef(avatar) && this.uploads().some((u) => `upload:${u.id}` === avatar && u.ownerId === userId && u.status === 'ACTIVE')) return;
    throw new ApiError(AVATAR_INVALID, 400);
  }

  // ---------- 商品投影的附加字段 ----------
  private productCircleStore() { return this.db.productCircles ??= {}; }
  private circleStore() { return this.db.circles ??= []; }
  private memberships() { return this.db.memberships ??= []; }
  private activeMember(circleId: string, userId: string) {
    return this.circleStore().some((c) => c.id === circleId && c.status === 'ACTIVE') && this.memberships().some((m) => m.circleId === circleId && m.userId === userId && m.status === 'ACTIVE');
  }
  /** 圈子可见的商品只有卖家本人和所选圈子的在籍成员能看到（列表、详情、feed、申请、匹配同一口径）。 */
  private visibleTo(product: Product, uid: string) {
    if ((product.visibility ?? 'PUBLIC') !== 'CIRCLE_ONLY' || product.sellerId === uid) return true;
    return (this.productCircleStore()[product.id] ?? []).some((cid) => this.activeMember(cid, uid));
  }
  private productExtras(product: Product, uid: string): Partial<Product> {
    const building = DEMO_BUILDINGS.find((b) => b.id === product.buildingId);
    const items = product.listingKind === 'BUNDLE' ? product.bundleItems ?? [] : null;
    const circles = (product.visibility ?? 'PUBLIC') === 'CIRCLE_ONLY'
      ? (this.productCircleStore()[product.id] ?? []).map((cid) => this.circleStore().find((c) => c.id === cid && c.status === 'ACTIVE'))
        .filter((c): c is StoredCircle => !!c && (product.sellerId === uid || this.activeMember(c.id, uid))).map((c) => ({ id: c.id, name: c.name, type: c.type }))
      : null;
    return {
      buildingId: product.buildingId ?? null, buildingName: building?.name ?? null, buildingZone: building?.zone ?? null,
      listingKind: product.listingKind ?? 'SINGLE', visibility: product.visibility ?? 'PUBLIC', circles,
      textbook: this.productTextbookView(product.id),
      bundle: items ? { itemCount: items.length, totalQuantity: items.reduce((n, i) => n + i.quantity, 0), categoryCount: new Set(items.map((i) => i.category)).size } : null,
      bundleItems: items ? items.map((i) => ({ ...i })) : null,
    };
  }
  private parseVisibility(rawVisibility: unknown, rawCircleIds: unknown): { visibility: ProductVisibility; circleIds: string[] } {
    const visibility = rawVisibility === undefined || rawVisibility === null ? 'PUBLIC' : rawVisibility;
    if (visibility !== 'PUBLIC' && visibility !== 'CIRCLE_ONLY') throw new ApiError('可见范围无效', 400);
    let circleIds: string[] = [];
    if (rawCircleIds !== undefined && rawCircleIds !== null) {
      if (!Array.isArray(rawCircleIds)) throw new ApiError('circleIds 格式无效', 400);
      circleIds = rawCircleIds.map(String);
      if (new Set(circleIds).size !== circleIds.length) throw new ApiError('圈子不能重复选择', 400);
    }
    if (visibility === 'PUBLIC' && circleIds.length) throw new ApiError('全校公开的商品不需要选择圈子', 400);
    if (visibility === 'CIRCLE_ONLY' && (circleIds.length < 1 || circleIds.length > 5)) throw new ApiError('圈子可见需要选择 1～5 个圈子', 400);
    return { visibility, circleIds };
  }
  private requirePublishable(sellerId: string, campus: string, choice: { visibility: string; circleIds: string[] }) {
    if (choice.visibility !== 'CIRCLE_ONLY') return;
    const ok = choice.circleIds.every((cid) => this.circleStore().some((c) => c.id === cid && c.school === school(campus as Campus) && c.status === 'ACTIVE') && this.activeMember(cid, sellerId));
    if (!ok) throw new ApiError('圈子不存在或你不是这个圈子的成员', 404);
  }

  // ---------- 楼栋集市 ----------
  async feed(query: FeedQuery): Promise<FeedPage> { return this.feedWith(query); }
  private feedWith(query: FeedQuery, extra?: (p: Product) => boolean): FeedPage {
    const viewer = this.user();
    const scopes: BuildingScope[] = ['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL'];
    if (!scopes.includes(query.scope)) throw new ApiError('范围无效', 400);
    const needsOrigin = query.scope === 'BUILDING' || query.scope === 'ZONE' || query.sort === 'nearest';
    const origin = DEMO_BUILDINGS.find((b) => b.id === viewer.dormBuildingId) ?? null;
    if (needsOrigin && !origin) throw new ApiError('请先在个人资料中选择宿舍楼', 409);
    const kw = query.keyword?.trim().toLowerCase() ?? '';
    const matches = (p: Product) => school(p.campus) === school(viewer.campus) && p.status !== '已下架' && this.visibleTo(p, viewer.id)
      && (!kw || `${p.title} ${p.description}`.toLowerCase().includes(kw)) && (!query.category || p.category === query.category)
      && (!query.condition || p.condition === query.condition) && (query.minPrice === undefined || p.price >= query.minPrice)
      && (query.maxPrice === undefined || p.price <= query.maxPrice) && (!extra || extra(p));
    const inScope = (p: Product, scope: BuildingScope) => {
      if (scope === 'SCHOOL') return true;
      if (scope === 'CAMPUS') return p.campus === (origin?.campusId ?? viewer.campus);
      const b = DEMO_BUILDINGS.find((x) => x.id === p.buildingId);
      if (!b || !origin) return false;
      return scope === 'BUILDING' ? b.id === origin.id : b.campusId === origin.campusId && b.zone === origin.zone;
    };
    // 只有「本楼」逐级放宽；范围按总数在分页之前选定
    const chain = query.scope === 'BUILDING' ? scopes : [query.scope];
    let effective = chain[chain.length - 1], matched: Product[] = [];
    for (const candidate of chain) {
      const found = this.db.products.filter((p) => matches(p) && inScope(p, candidate));
      if (found.length) { effective = candidate; matched = found; break; }
    }
    const same = (p: Product) => !!origin && p.buildingId === origin.id;
    matched.sort((a, b) => query.sort === 'nearest' ? (Number(same(b)) - Number(same(a))) || (Number(!!b.buildingId) - Number(!!a.buildingId)) || b.createdAt - a.createdAt
      : query.sort === 'priceAsc' ? a.price - b.price : query.sort === 'priceDesc' ? b.price - a.price : query.sort === 'views' ? b.views - a.views : b.createdAt - a.createdAt);
    const page = Math.max(1, query.page), size = Math.max(1, query.pageSize), applied = effective !== query.scope;
    const labels: Record<BuildingScope, string> = { BUILDING: '本楼', ZONE: '本园区', CAMPUS: '本校区', SCHOOL: '全校' };
    return {
      requestedScope: query.scope, effectiveScope: effective, effectiveScopeLabel: labels[effective], fallbackApplied: applied,
      fallbackReason: applied ? (matched.length ? 'NO_RESULTS_IN_REQUESTED_SCOPE' : 'NO_RESULTS_IN_ANY_SCOPE') : null,
      // 演示楼栋没有坐标：同楼栋显示「同楼栋」，其余不给距离（不显示假精确的数字）
      items: matched.slice((page - 1) * size, page * size).map((p): FeedProduct => ({ ...this.view(p), sameBuilding: same(p), approximateDistanceMeters: null, approximateWalkMinutes: null })),
      page, pageSize: size, total: matched.length,
    };
  }

  // ---------- 圈子（无权访问与不存在一律 404） ----------
  private circleInviteStore() { return this.db.circleInvites ??= []; }
  private membershipOf(circleId: string, userId: string) { return this.memberships().find((m) => m.circleId === circleId && m.userId === userId && m.status === 'ACTIVE') ?? null; }
  private visibleCircle(id: string, userId: string) {
    const user = this.user(), circle = this.circleStore().find((c) => c.id === id);
    if (!circle || circle.school !== school(user.campus)) throw new ApiError('圈子不存在', 404);
    if (this.membershipOf(id, userId)) return circle;
    if (circle.status === 'ACTIVE' && circle.visibility === 'DISCOVERABLE') return circle;
    throw new ApiError('圈子不存在', 404);
  }
  private managerRole(id: string, userId: string): CircleRole {
    const m = this.membershipOf(id, userId);
    if (!m) throw new ApiError('圈子不存在', 404);
    if (m.role === 'MEMBER') throw new ApiError('只有圈子的所有者或管理员可以进行这个操作', 403);
    return m.role;
  }
  private circleView(c: StoredCircle, role: CircleRole): Circle { return { id: c.id, type: c.type, name: c.name, description: c.description, visibility: c.visibility, status: c.status, userCreated: true, joined: true, myRole: role, createdAt: c.createdAt }; }
  private circleName(raw: unknown) {
    if (typeof raw !== 'string') throw new ApiError('请填写圈子名称', 400);
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > 30) throw new ApiError('圈子名称应为 2～30 个字', 400);
    if (/[<>]/.test(value)) throw new ApiError('圈子名称不能包含尖括号', 400);
    return value;
  }
  private circleDescription(raw: unknown) {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw new ApiError('简介格式无效', 400);
    const value = raw.trim();
    if (value.length > 200) throw new ApiError('简介最多 200 个字', 400);
    if (/[<>]/.test(value)) throw new ApiError('简介不能包含尖括号', 400);
    return value;
  }
  async createCircle(input: CircleInput) {
    const user = this.user();
    this.requireUnrestrictedScope(user.id, 'CIRCLE_CREATION', '创建圈子');
    if (!['CLASS', 'CLUB', 'INTEREST', 'OTHER'].includes(String(input.type))) throw new ApiError('圈子类型无效', 400);
    const visibility = input.visibility ?? 'PRIVATE';
    if (visibility !== 'PRIVATE' && visibility !== 'DISCOVERABLE') throw new ApiError('可见范围无效', 400);
    const name = this.circleName(input.name), description = this.circleDescription(input.description);
    requireSafeText(name, description);
    const now = Date.now();
    const circle: StoredCircle = { id: id(), school: school(user.campus), type: input.type, name, description, visibility, ownerId: user.id, status: 'ACTIVE', createdAt: now, updatedAt: now };
    this.circleStore().push(circle);
    this.memberships().push({ circleId: circle.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: now, endedAt: null });
    this.save(); return this.circleView(circle, 'OWNER');
  }
  async myCircles() {
    const user = this.user();
    return this.memberships().filter((m) => m.userId === user.id && m.status === 'ACTIVE')
      .map((m) => ({ m, c: this.circleStore().find((c) => c.id === m.circleId)! })).filter(({ c }) => !!c)
      .sort((a, b) => a.c.status.localeCompare(b.c.status) || (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : a.c.id < b.c.id ? -1 : 1))
      .map(({ m, c }) => this.circleView(c, m.role));
  }
  async discoverCircles(q?: string): Promise<DiscoverableCircle[]> {
    const user = this.user(), query = q?.trim().toLowerCase() || null;
    if (query && query.length > 30) throw new ApiError('搜索词最多 30 个字', 400);
    return this.circleStore().filter((c) => c.school === school(user.campus) && c.status === 'ACTIVE' && c.visibility === 'DISCOVERABLE' && (!query || c.name.toLowerCase().includes(query)))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
      .map((c) => ({ id: c.id, type: c.type, name: c.name, description: c.description, userCreated: true as const, joined: !!this.membershipOf(c.id, user.id) }));
  }
  async circle(cid: string): Promise<Circle | DiscoverableCircle> {
    const user = this.user(), c = this.visibleCircle(cid, user.id), m = this.membershipOf(cid, user.id);
    return m ? this.circleView(c, m.role) : { id: c.id, type: c.type, name: c.name, description: c.description, userCreated: true, joined: false };
  }
  async updateCircle(cid: string, patch: Partial<CircleInput>) {
    const user = this.user(), c = this.visibleCircle(cid, user.id), role = this.managerRole(cid, user.id);
    if (c.status !== 'ACTIVE') throw new ApiError('圈子已归档', 409);
    if (('visibility' in patch || 'type' in patch) && role !== 'OWNER') throw new ApiError('只有所有者可以修改圈子的类型与可见范围', 403);
    if ('type' in patch && !['CLASS', 'CLUB', 'INTEREST', 'OTHER'].includes(String(patch.type))) throw new ApiError('圈子类型无效', 400);
    if ('visibility' in patch && patch.visibility !== 'PRIVATE' && patch.visibility !== 'DISCOVERABLE') throw new ApiError('可见范围无效', 400);
    const name = 'name' in patch ? this.circleName(patch.name) : c.name, description = 'description' in patch ? this.circleDescription(patch.description) : c.description;
    requireSafeText(name, description);
    Object.assign(c, { name, description, ...(patch.type ? { type: patch.type } : {}), ...(patch.visibility ? { visibility: patch.visibility } : {}), updatedAt: Date.now() });
    this.save(); return this.circleView(c, role);
  }
  async archiveCircle(cid: string) {
    const user = this.user(), c = this.visibleCircle(cid, user.id);
    if (this.managerRole(cid, user.id) !== 'OWNER') throw new ApiError('只有所有者可以归档圈子', 403);
    if (c.status === 'ACTIVE') {
      const now = Date.now();
      Object.assign(c, { status: 'ARCHIVED', updatedAt: now });
      for (const i of this.circleInviteStore()) if (i.circleId === cid && i.status === 'PENDING') i.status = 'REVOKED';
      const subs = this.subscriptionStore().filter((x) => x.circleId === cid);
      for (const x of subs) { x.active = false; x.updatedAt = now; }
      for (const m of this.matchStore()) if (m.invalidatedAt === null && subs.some((x) => x.id === m.subscriptionId)) m.invalidatedAt = now;
      this.save();
    }
    return this.circleView(c, 'OWNER');
  }
  async circleProducts(cid: string, page = 1) {
    const user = this.user(); this.visibleCircle(cid, user.id);
    if (!this.membershipOf(cid, user.id)) throw new ApiError('圈子不存在', 404);
    return this.feedWith({ scope: 'SCHOOL', sort: 'latest', page, pageSize: 20 }, (p) => (this.productCircleStore()[p.id] ?? []).includes(cid));
  }
  private circleInviteView(i: StoredCircleInvite): CircleInvite { return { id: i.id, status: i.status === 'PENDING' && i.expiresAt <= Date.now() ? 'EXPIRED' : i.status, expiresAt: i.expiresAt, createdAt: i.createdAt }; }
  async createCircleInvite(cid: string, expiresInHours?: number) {
    const user = this.user(), c = this.visibleCircle(cid, user.id); this.managerRole(cid, user.id);
    if (c.status !== 'ACTIVE') throw new ApiError('圈子已归档', 409);
    const hours = expiresInHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new ApiError('有效期应为 1～168 小时', 400);
    const token = randomToken(), now = Date.now();
    const invite: StoredCircleInvite = { id: id(), circleId: cid, createdBy: user.id, digest: tokenDigest(token), status: 'PENDING', redeemedBy: null, expiresAt: now + hours * 3600000, createdAt: now };
    this.circleInviteStore().push(invite); this.save();
    return { invite: this.circleInviteView(invite), token };
  }
  async circleInvites(cid: string) {
    const user = this.user(); this.visibleCircle(cid, user.id); this.managerRole(cid, user.id);
    return this.circleInviteStore().filter((i) => i.circleId === cid).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((i) => this.circleInviteView(i));
  }
  /** 各种失败对外都是同一个 404，不透露邀请码或圈子是否存在。 */
  async redeemCircleInvite(token: string) {
    const user = this.user(), invalid = () => new ApiError('邀请码无效或已失效', 404);
    if (typeof token !== 'string' || !token.trim() || token.length > 200) throw invalid();
    const invite = this.circleInviteStore().find((i) => i.digest === tokenDigest(token.trim()));
    const usable = !!invite && invite.status === 'PENDING' && invite.expiresAt > Date.now();
    const replay = !!invite && invite.status === 'REDEEMED' && invite.redeemedBy === user.id;
    if (!invite || (!usable && !replay)) throw invalid();
    const c = this.circleStore().find((x) => x.id === invite.circleId);
    if (!c || c.status !== 'ACTIVE' || c.school !== school(user.campus)) throw invalid();
    const mine = this.membershipOf(c.id, user.id);
    if (mine) return this.circleView(c, mine.role);
    if (!usable) throw invalid();
    if (this.memberships().filter((m) => m.circleId === c.id && m.status === 'ACTIVE').length >= CIRCLE_MEMBER_LIMIT) throw new ApiError(`圈子人数已达上限（${CIRCLE_MEMBER_LIMIT} 人）`, 409);
    const now = Date.now();
    Object.assign(invite, { status: 'REDEEMED', redeemedBy: user.id });
    const existing = this.memberships().find((m) => m.circleId === c.id && m.userId === user.id);
    if (existing) Object.assign(existing, { role: 'MEMBER', status: 'ACTIVE', joinedAt: now, endedAt: null });
    else this.memberships().push({ circleId: c.id, userId: user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: now, endedAt: null });
    this.save(); return this.circleView(c, 'MEMBER');
  }
  async revokeCircleInvite(inviteId: string) {
    const user = this.user(), invite = this.circleInviteStore().find((i) => i.id === inviteId);
    const m = invite && this.membershipOf(invite.circleId, user.id);
    if (!invite || !m || m.role === 'MEMBER') throw new ApiError('邀请不存在', 404);
    if (invite.status === 'PENDING') { invite.status = 'REVOKED'; this.save(); }
    return this.circleInviteView(invite);
  }
  async circleMembers(cid: string, page = 1, size = 20): Promise<CircleMemberPage> {
    const user = this.user();
    if (!Number.isInteger(page) || page < 1) throw new ApiError('page 无效', 400);
    if (!Number.isInteger(size) || size < 1 || size > 100) throw new ApiError('size 无效', 400);
    this.visibleCircle(cid, user.id); this.managerRole(cid, user.id);
    const order = { OWNER: 0, MODERATOR: 1, MEMBER: 2 } as const;
    const all = this.memberships().filter((m) => m.circleId === cid && m.status === 'ACTIVE').sort((a, b) => order[a.role] - order[b.role] || a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
    // 管理所需的最小投影：昵称、头像、角色、加入时间（没有账号、联系方式或宿舍楼）
    const items = all.slice((page - 1) * size, page * size).map((m) => { const u = this.db.users.find((x) => x.id === m.userId); return { userId: m.userId, nickname: u?.nickname ?? '', avatar: this.avatarOut(u?.avatar), role: m.role, joinedAt: m.joinedAt }; });
    return { items, total: all.length, page, size };
  }
  async changeCircleMemberRole(cid: string, userId: string, role: CircleRole) {
    const user = this.user(), c = this.visibleCircle(cid, user.id);
    if (c.status !== 'ACTIVE') throw new ApiError('圈子已归档', 409);
    if (this.managerRole(cid, user.id) !== 'OWNER') throw new ApiError('只有所有者可以调整成员角色', 403);
    if (!['OWNER', 'MODERATOR', 'MEMBER'].includes(role)) throw new ApiError('角色无效', 400);
    const target = this.membershipOf(cid, userId);
    if (!target) throw new ApiError('成员不存在', 404);
    if (userId === user.id) throw new ApiError('所有者不能修改自己的角色；需要时请把所有者转让给其他成员', 400);
    if (role === 'OWNER') { this.membershipOf(cid, user.id)!.role = 'MODERATOR'; target.role = 'OWNER'; c.ownerId = userId; }
    else target.role = role;
    this.save(); return this.circleMembers(cid, 1, 20);
  }
  async removeCircleMember(cid: string, userId: string) {
    const user = this.user(); this.visibleCircle(cid, user.id);
    const mine = this.membershipOf(cid, user.id);
    if (!mine) throw new ApiError('圈子不存在', 404);
    const theirs = this.membershipOf(cid, userId);
    if (!theirs) throw new ApiError('成员不存在', 404);
    const self = userId === user.id;
    if (self && mine.role === 'OWNER') throw new ApiError('所有者不能直接退出，请先把所有者转让给其他成员，或归档圈子', 409);
    if (!self) {
      if (mine.role === 'MEMBER') throw new ApiError('普通成员不能管理其他成员', 403);
      if (theirs.role === 'OWNER') throw new ApiError('不能移除圈子所有者', 403);
      if (mine.role === 'MODERATOR' && theirs.role !== 'MEMBER') throw new ApiError('管理员只能移除普通成员', 403);
    }
    const now = Date.now(), status = self ? 'LEFT' as const : 'REMOVED' as const;
    Object.assign(theirs, { status, role: 'MEMBER', endedAt: now });
    // 离开后：圈子订阅停用、匹配失效（未读随之清零）；私密商品与其上的联系申请随可见性一起消失
    const subs = this.subscriptionStore().filter((x) => x.circleId === cid && x.userId === userId);
    for (const x of subs) if (x.active) { x.active = false; x.updatedAt = now; }
    for (const m of this.matchStore()) if (m.invalidatedAt === null && subs.some((x) => x.id === m.subscriptionId)) m.invalidatedAt = now;
    this.save(); return { userId, status };
  }
  private requireUnrestrictedScope(userId: string, scope: 'CIRCLE_CREATION', what: string) {
    const now = Date.now();
    const active = (this.db.restrictions ?? []).find((r) => r.userId === userId && r.scope === scope && !r.revokedAt && r.startsAt <= now && r.endsAt > now);
    if (active) throw new ApiError(`你的「${what}」功能暂时受限，至 ${restrictionEnd(active.endsAt)} 自动恢复。可以在「我的限制」里查看原因或提交申诉。`, 403);
  }

  // ---------- 毕业季快速发布：草稿、批次、协助整理 ----------
  private draftStore() { return this.db.drafts ??= []; }
  private batchStore() { return this.db.batches ??= []; }
  private assistInviteStore() { return this.db.assistInvites ??= []; }
  private static readonly DRAFT_EXPIRY_MS = 30 * DAY;
  private expireDraft(d: StoredDraft) { if ((d.status === 'DRAFT' || d.status === 'READY') && d.expiresAt <= Date.now()) { d.status = 'EXPIRED'; d.updatedAt = Date.now(); return true; } return false; }
  private activeBatchOf(draftId: string) { return this.batchStore().find((b) => b.items.some((i) => i.draftId === draftId && i.active)); }
  private activeInvite(i: StoredAssistInvite, assistantId: string, draftId: string) {
    if (i.status !== 'ACTIVE' || i.assistantId !== assistantId || i.expiresAt <= Date.now()) return false;
    if (i.draftId === draftId) return true;
    return !!i.batchId && this.batchStore().some((b) => b.id === i.batchId && b.items.some((x) => x.draftId === draftId && x.active));
  }
  private draftAccess(d: StoredDraft | undefined, userId: string): 'OWNER' | 'ASSISTANT' {
    if (!d) throw new ApiError('草稿不存在', 404);
    if (d.ownerId === userId) return 'OWNER';
    if (this.assistInviteStore().some((i) => this.activeInvite(i, userId, d.id))) return 'ASSISTANT';
    throw new ApiError('草稿不存在', 404);
  }
  /** 协助人看不到联系方式；图片给出与后端同形的签名地址（保存时换回 upload:<id>）。 */
  private draftView(d: StoredDraft, access: 'OWNER' | 'ASSISTANT'): ListingDraft {
    const payload: ListingPayload = JSON.parse(JSON.stringify(d.payload));
    if (access === 'ASSISTANT') { delete payload.contact; delete payload.contactPublic; }
    if (Array.isArray(payload.images)) payload.images = payload.images.map((image) => this.signed(image));
    return { id: d.id, draftType: d.draftType, status: d.status, version: d.version, payload, access, editedByAssistant: d.editorId !== d.ownerId,
      batchId: this.activeBatchOf(d.id)?.id ?? null, publishedProductId: d.publishedProductId, expiresAt: d.expiresAt, createdAt: d.createdAt, updatedAt: d.updatedAt };
  }
  private payloadIn(raw: ListingPayload | undefined) {
    if (!raw || !Array.isArray(raw.images)) return raw;
    return { ...raw, images: raw.images.map((image) => imageRefFromUrl(image)) };
  }
  async createDraft(input: { draftType?: ListingKind; payload?: ListingPayload }) {
    const user = this.user(), type = input.draftType ?? 'SINGLE';
    if (type !== 'SINGLE' && type !== 'BUNDLE') throw new ApiError('草稿类型无效', 400);
    const payload = sanitizePayload(this.payloadIn(input.payload), false), now = Date.now();
    const draft: StoredDraft = { id: id(), ownerId: user.id, editorId: user.id, draftType: type, payload, version: 1, status: 'DRAFT', expiresAt: now + MockApi.DRAFT_EXPIRY_MS, publishedProductId: null, createdAt: now, updatedAt: now };
    this.draftStore().push(draft); this.save(); return this.draftView(draft, 'OWNER');
  }
  async drafts() {
    const user = this.user(), mine = this.draftStore().filter((d) => d.ownerId === user.id);
    if (mine.map((d) => this.expireDraft(d)).some(Boolean)) this.save();
    return mine.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200).map((d) => this.draftView(d, 'OWNER'));
  }
  async assistingDrafts() {
    const user = this.user();
    return this.draftStore().filter((d) => d.ownerId !== user.id && this.assistInviteStore().some((i) => this.activeInvite(i, user.id, d.id))).sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => this.draftView(d, 'ASSISTANT'));
  }
  async draft(did: string) {
    const user = this.user(), d = this.draftStore().find((x) => x.id === did), access = this.draftAccess(d, user.id);
    if (this.expireDraft(d!)) this.save();
    return this.draftView(d!, access);
  }
  async updateDraft(did: string, input: { expectedVersion: number; payload?: ListingPayload; status?: 'DRAFT' | 'READY' }) {
    const user = this.user(), d = this.draftStore().find((x) => x.id === did), access = this.draftAccess(d, user.id), draft = d!;
    if (typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ApiError('请提供 expectedVersion，防止覆盖其他页面的修改', 400);
    if (this.expireDraft(draft)) { this.save(); throw new ApiError('草稿已过期，不能再修改', 409); }
    if (draft.status !== 'DRAFT' && draft.status !== 'READY') throw new ApiError('草稿已发布、已丢弃或已过期，不能再修改', 409);
    const payload = 'payload' in input ? sanitizePayload(this.payloadIn(input.payload), access === 'ASSISTANT') : JSON.parse(JSON.stringify(draft.payload)) as ListingPayload;
    if (access === 'ASSISTANT') {
      // 协助人只能整理白名单字段，其余字段必须原样保留
      const before = draft.payload as Record<string, unknown>, after = payload as Record<string, unknown>;
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (ASSISTANT_FIELDS.includes(key) || key === 'contact' || key === 'contactPublic') continue;
        if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) throw new ApiError('协助人只能整理标题、描述、分类、价格建议、打包明细与取货楼栋建议', 403);
      }
      if (draft.payload.contact !== undefined) payload.contact = draft.payload.contact;
      if (draft.payload.contactPublic !== undefined) payload.contactPublic = draft.payload.contactPublic;
    }
    const nextStatus = input.status ?? 'DRAFT';
    if (nextStatus !== 'DRAFT' && nextStatus !== 'READY') throw new ApiError('草稿状态只能是 DRAFT 或 READY', 400);
    if (nextStatus === 'READY') {
      if (access === 'ASSISTANT') throw new ApiError('只有商品所有者可以把草稿标记为可发布', 403);
      const r = validateListing(payload, draft.draftType, this.validationContext(draft.ownerId));
      if (r.code !== 'VALID') throw new ApiError(`草稿还不能发布：${r.message}`, 400, r);
    }
    if (draft.version !== input.expectedVersion) throw new ApiError('草稿已被其他页面或协助人更新，请重新加载后再修改', 409, { currentVersion: draft.version });
    const now = Date.now();
    Object.assign(draft, { payload, status: nextStatus, editorId: user.id, version: draft.version + 1, updatedAt: now, expiresAt: now + MockApi.DRAFT_EXPIRY_MS });
    if (access === 'ASSISTANT') for (const i of this.assistInviteStore()) if (this.activeInvite(i, user.id, draft.id)) i.lastEditAt = now;
    this.save(); return this.draftView(draft, access);
  }
  async discardDraft(did: string) {
    const user = this.user(), d = this.draftStore().find((x) => x.id === did && x.ownerId === user.id);
    if (!d) throw new ApiError('草稿不存在', 404);
    if (this.activeBatchOf(d.id)) throw new ApiError('这个草稿还在批次里，请先从批次中移除', 409);
    this.expireDraft(d);
    if (d.status === 'DISCARDED') return this.draftView(d, 'OWNER');
    if (d.status !== 'DRAFT' && d.status !== 'READY') throw new ApiError('草稿已发布或已过期，不能丢弃', 409);
    d.status = 'DISCARDED'; d.updatedAt = Date.now(); this.save();
    return this.draftView(d, 'OWNER');
  }
  private validationContext(ownerId: string): ValidationContext {
    const owner = this.db.users.find((u) => u.id === ownerId)!;
    return {
      campusValid: (campus) => demoSchoolOf(campus) !== null && school(campus) === school(owner.campus),
      circlesUsable: (ids, campus) => ids.every((cid) => this.circleStore().some((c) => c.id === cid && c.school === school(campus as Campus) && c.status === 'ACTIVE') && this.activeMember(cid, ownerId)),
      building: (bid) => { const b = DEMO_BUILDINGS.find((x) => x.id === bid); return b ? { campusId: b.campusId } : null; },
      editionInSchoolOf: (eid, campus) => DEMO_EDITIONS.some((e) => e.id === eid && e.school === school(campus as Campus)),
    };
  }
  private draftClosed(d: StoredDraft): ListingValidation | null {
    return (d.status !== 'DRAFT' && d.status !== 'READY') || d.expiresAt <= Date.now() ? { code: 'DRAFT_CLOSED', field: 'status', message: '草稿已发布、已丢弃或已过期' } : null;
  }
  private batchView(b: StoredBatch): ListingBatch {
    const open = b.status === 'OPEN', ctx = this.validationContext(b.ownerId);
    let allValid = b.items.length > 0, assisted = false;
    const items = [...b.items].sort((x, y) => x.position - y.position).map((item) => {
      const d = this.draftStore().find((x) => x.id === item.draftId)!, draft = this.draftView(d, 'OWNER');
      assisted ||= draft.editedByAssistant;
      const view: ListingBatch['items'][number] = { position: item.position, draft, productId: item.productId };
      if (open) { const v = this.draftClosed(d) ?? validateListing(d.payload, d.draftType, ctx); allValid &&= v.code === 'VALID'; view.validation = v; }
      return view;
    });
    return { id: b.id, status: b.status, version: b.version, items, allValid: open && allValid, assisted, createdAt: b.createdAt, publishedAt: b.publishedAt };
  }
  private ownBatch(bid: string, userId: string) { const b = this.batchStore().find((x) => x.id === bid && x.ownerId === userId); if (!b) throw new ApiError('批次不存在', 404); return b; }
  private batchDraftIds(raw: unknown) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new ApiError('draftIds 格式无效', 400);
    if (raw.length > BATCH_MAX_ITEMS) throw new ApiError(`一个批次最多 ${BATCH_MAX_ITEMS} 件商品`, 400);
    const ids = raw.map(String);
    if (new Set(ids).size !== ids.length) throw new ApiError('同一个草稿不能在批次里出现两次', 400);
    return ids;
  }
  private attachDrafts(batch: StoredBatch, userId: string, ids: string[]) {
    for (const did of ids) {
      const d = this.draftStore().find((x) => x.id === did && x.ownerId === userId);
      if (!d) throw new ApiError('草稿不存在', 404);
      this.expireDraft(d);
      if (d.status !== 'DRAFT' && d.status !== 'READY') throw new ApiError('只能把未发布、未丢弃、未过期的草稿加入批次', 409);
      const other = this.activeBatchOf(did);
      if (other && other.id !== batch.id) throw new ApiError('有草稿已经在另一个未发布的批次里', 409);
    }
    batch.items = ids.map((draftId, index) => ({ draftId, position: index + 1, active: true, productId: null }));
  }
  async createBatch(input: { draftIds?: string[] }) {
    const user = this.user(), ids = this.batchDraftIds(input.draftIds), now = Date.now();
    const batch: StoredBatch = { id: id(), ownerId: user.id, status: 'OPEN', version: 1, items: [], createdAt: now, updatedAt: now, publishedAt: null };
    this.attachDrafts(batch, user.id, ids); this.batchStore().push(batch); this.save();
    return this.batchView(batch);
  }
  async batches(): Promise<ListingBatchSummary[]> {
    const user = this.user();
    return this.batchStore().filter((b) => b.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
      .map((b) => ({ id: b.id, status: b.status, version: b.version, itemCount: b.items.length, createdAt: b.createdAt, publishedAt: b.publishedAt }));
  }
  async batch(bid: string) { return this.batchView(this.ownBatch(bid, this.user().id)); }
  async updateBatch(bid: string, input: { expectedVersion: number; draftIds: string[] }) {
    const user = this.user(), batch = this.ownBatch(bid, user.id);
    if (batch.status !== 'OPEN') throw new ApiError('批次已发布或已丢弃，不能再修改', 409);
    if (typeof input.expectedVersion !== 'number' || input.expectedVersion < 1) throw new ApiError('请提供 expectedVersion', 400);
    if (batch.version !== input.expectedVersion) throw new ApiError('批次已被其他页面更新，请重新加载', 409);
    const ids = this.batchDraftIds(input.draftIds), previous = batch.items;
    batch.items = [];
    try { this.attachDrafts(batch, user.id, ids); } catch (e) { batch.items = previous; throw e; }
    batch.version += 1; batch.updatedAt = Date.now(); this.save();
    return this.batchView(batch);
  }
  async discardBatch(bid: string) {
    const batch = this.ownBatch(bid, this.user().id);
    if (batch.status === 'OPEN') { batch.status = 'DISCARDED'; batch.updatedAt = Date.now(); for (const item of batch.items) item.active = false; this.save(); }
    return this.batchView(batch);
  }
  /**
   * 整批发布：全部成功或全部不发布。逐项校验任一不通过 → 400，逐项原因放在 details.items，什么都不写；
   * 写入途中任何一步失败，演示库恢复到发布前的副本。同一个幂等键重复提交返回同一结果。
   */
  async publishBatch(bid: string, idempotencyKey: string): Promise<PublishBatchResult> {
    const user = this.user();
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.length > 100) throw new ApiError('请提供 8～100 位的 Idempotency-Key', 400);
    const requests = this.db.publishRequests ??= [];
    const previous = requests.find((r) => r.ownerId === user.id && r.key === idempotencyKey);
    if (previous) {
      if (previous.batchId !== bid) throw new ApiError('这个 Idempotency-Key 已用于另一次发布', 409);
      return { batchId: previous.batchId, productIds: [...previous.productIds], publishedCount: previous.productIds.length, replayed: true };
    }
    this.requireUnrestricted(user.id, 'PUBLISHING');
    const batch = this.ownBatch(bid, user.id);
    if (batch.status !== 'OPEN') throw new ApiError('批次已发布或已丢弃', 409);
    if (!batch.items.length) throw new ApiError('批次里还没有商品', 400);
    const ctx = this.validationContext(batch.ownerId), ordered = [...batch.items].sort((a, b) => a.position - b.position);
    const drafts = ordered.map((item) => this.draftStore().find((d) => d.id === item.draftId)!);
    const problems = drafts.flatMap((d, i) => { const r = this.draftClosed(d) ?? validateListing(d.payload, d.draftType, ctx); return r.code === 'VALID' ? [] : [{ ...r, position: ordered[i].position, draftId: d.id }]; });
    if (problems.length) throw new ApiError(`有 ${problems.length} 件商品还不能发布，整个批次都没有发布`, 400, { items: problems });
    const backup = JSON.stringify(this.db), productIds: string[] = [];
    try {
      drafts.forEach((d, i) => {
        const assistant = this.assistInviteStore().filter((x) => x.lastEditAt !== null && x.assistantId && this.activeInvite(x, x.assistantId, d.id)).sort((a, b) => (b.lastEditAt ?? 0) - (a.lastEditAt ?? 0))[0]?.assistantId ?? null;
        const p = d.payload;
        const input: ProductInput = {
          title: String(p.title).trim(), description: String(p.description).trim(), price: Number(p.price), ...(p.originalPrice != null ? { originalPrice: Number(p.originalPrice) } : {}),
          category: p.category as Category, condition: p.condition as ProductInput['condition'], campus: p.campus as Campus, images: [...(p.images ?? [])],
          contact: (p.contact ?? '').trim() || user.contact || user.account || '', contactPublic: p.contactPublic === true, buildingId: p.buildingId ?? null,
          listingKind: d.draftType, ...(d.draftType === 'BUNDLE' ? { bundleItems: p.bundleItems } : { textbookEditionId: p.textbookEditionId ?? undefined, inspection: p.inspection ?? undefined }),
          visibility: (p.visibility as ProductVisibility) ?? 'PUBLIC', ...(p.visibility === 'CIRCLE_ONLY' ? { circleIds: p.circleIds } : {}),
        };
        const product = this.writeProduct(user, input, null, assistant);
        Object.assign(d, { status: 'PUBLISHED', publishedProductId: product.id, updatedAt: Date.now() });
        ordered[i].productId = product.id; productIds.push(product.id);
      });
      Object.assign(batch, { status: 'PUBLISHED', publishedAt: Date.now(), updatedAt: Date.now() });
      for (const item of batch.items) item.active = false;
      requests.push({ ownerId: user.id, key: idempotencyKey, batchId: batch.id, productIds: [...productIds] });
    } catch (e) {
      this.db = JSON.parse(backup) as Database;
      throw e;
    }
    this.save();
    return { batchId: batch.id, productIds, publishedCount: productIds.length, replayed: false };
  }
  private assistInviteView(i: StoredAssistInvite): AssistInvite {
    const expired = i.status !== 'REVOKED' && i.expiresAt <= Date.now();
    return { id: i.id, scope: i.draftId ? 'DRAFT' : 'BATCH', draftId: i.draftId, batchId: i.batchId, status: expired ? 'EXPIRED' : i.status,
      assistantNickname: i.assistantId ? this.db.users.find((u) => u.id === i.assistantId)?.nickname ?? null : null, expiresAt: i.expiresAt, createdAt: i.createdAt };
  }
  async createAssistInvite(input: { draftId?: string; batchId?: string; expiresInHours?: number }): Promise<AssistInviteCreated> {
    const user = this.user(), draftId = input.draftId ?? null, batchId = input.batchId ?? null;
    if ((draftId === null) === (batchId === null)) throw new ApiError('请指定一个草稿或一个批次', 400);
    let hours = 24;
    if (input.expiresInHours !== undefined) {
      if (typeof input.expiresInHours !== 'number' || !Number.isInteger(input.expiresInHours) || input.expiresInHours < 1 || input.expiresInHours > 168) throw new ApiError('有效期应为 1～168 小时', 400);
      hours = input.expiresInHours;
    }
    if (draftId) {
      const d = this.draftStore().find((x) => x.id === draftId && x.ownerId === user.id);
      if (!d) throw new ApiError('草稿不存在', 404);
      if (d.status !== 'DRAFT' && d.status !== 'READY') throw new ApiError('草稿已不可编辑', 409);
    } else if (this.ownBatch(batchId!, user.id).status !== 'OPEN') throw new ApiError('批次已发布或已丢弃', 409);
    const token = randomToken(), now = Date.now();
    const invite: StoredAssistInvite = { id: id(), ownerId: user.id, draftId, batchId, digest: tokenDigest(token), status: 'PENDING', assistantId: null, expiresAt: now + hours * 3600000, createdAt: now, lastEditAt: null };
    this.assistInviteStore().push(invite); this.save();
    return { invite: this.assistInviteView(invite), token };
  }
  async assistInvites() { const user = this.user(); return this.assistInviteStore().filter((i) => i.ownerId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((i) => this.assistInviteView(i)); }
  /** 各种失败对外是同一个 404；不能兑换自己发出的邀请。 */
  async redeemAssistInvite(token: string): Promise<AssistInviteRedeemed> {
    const user = this.user(), invalid = () => new ApiError('邀请码无效或已失效', 404);
    if (typeof token !== 'string' || !token.trim() || token.length > 200) throw invalid();
    const invite = this.assistInviteStore().find((i) => i.digest === tokenDigest(token.trim()));
    if (!invite || invite.ownerId === user.id || invite.status !== 'PENDING' || invite.expiresAt <= Date.now()) throw invalid();
    Object.assign(invite, { status: 'ACTIVE', assistantId: user.id }); this.save();
    return { inviteId: invite.id, drafts: await this.assistingDrafts() };
  }
  async revokeAssistInvite(iid: string) {
    const user = this.user(), invite = this.assistInviteStore().find((i) => i.id === iid && i.ownerId === user.id);
    if (!invite) throw new ApiError('邀请不存在', 404);
    if (invite.status !== 'REVOKED') { invite.status = 'REVOKED'; this.save(); }
    return this.assistInviteView(invite);
  }

  // ---------- 课程教材（演示目录：虚构数据） ----------
  private viewerSchool() { return school(this.user().campus); }
  private editionOf(sch: string, eid: string | null | undefined) { return DEMO_EDITIONS.find((e) => e.id === eid && e.school === sch) ?? null; }
  private onSaleCount(editionId: string) {
    const uid = this.user().id;
    return this.db.products.filter((p) => p.status === '在售' && (this.db.productTextbooks ?? {})[p.id] === editionId && school(p.campus) === this.viewerSchool() && this.visibleTo(p, uid)).length;
  }
  private editionView(e: DemoEdition): TextbookEdition {
    return { id: e.id, isbn: e.isbn, isbn10: null, title: e.title, subtitle: e.subtitle, authors: [...e.authors], publisher: e.publisher, editionLabel: e.editionLabel, publishedYear: e.publishedYear, coverUrl: null, isDemo: true, onSaleCount: this.onSaleCount(e.id) };
  }
  private offeringView(o: typeof DEMO_OFFERINGS[number]): CourseOffering {
    const textbooks = DEMO_COURSE_TEXTBOOKS.filter((t) => t.offeringId === o.id).sort((a, b) => USAGE_ORDER[a.usageType] - USAGE_ORDER[b.usageType])
      .flatMap((t) => { const e = DEMO_EDITIONS.find((x) => x.id === t.editionId); return e ? [{ usageType: t.usageType, edition: this.editionView(e) }] : []; });
    return { id: o.id, courseId: o.courseId, academicYear: o.academicYear, term: o.term, instructorName: o.instructorName, campusId: o.campusId, textbooks };
  }
  async courses(query: CourseQuery): Promise<CoursePage> {
    const sch = this.viewerSchool(), raw = query.q ?? '';
    if (raw.length > 80) throw new ApiError('搜索词最多 80 个字', 400);
    if (query.term && !['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'].includes(query.term)) throw new ApiError('学期无效', 400);
    const q = normalizeDemandText(raw), code = q.toUpperCase().replace(/ /g, '');
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new ApiError('page 无效', 400);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new ApiError('pageSize 无效', 400);
    const matched = DEMO_COURSES.filter((c) => c.school === sch && (!q || c.name.toLowerCase().includes(q) || c.courseCode.startsWith(code))
      && (!(query.term || query.campus || query.academicYear) || DEMO_OFFERINGS.some((o) => o.courseId === c.id && (!query.term || o.term === query.term) && (!query.campus || o.campusId === query.campus) && (!query.academicYear || o.academicYear === query.academicYear))))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const items = matched.slice((page - 1) * pageSize, page * pageSize).map((c) => {
      const offerings = DEMO_OFFERINGS.filter((o) => o.courseId === c.id);
      const editions = new Set(DEMO_COURSE_TEXTBOOKS.filter((t) => offerings.some((o) => o.id === t.offeringId)).map((t) => t.editionId));
      return { id: c.id, courseCode: c.courseCode, name: c.name, department: c.department, isDemo: true, offeringCount: offerings.length, textbookCount: editions.size };
    });
    return { items, total: matched.length, page, pageSize };
  }
  async course(cid: string): Promise<CourseDetail> {
    const c = DEMO_COURSES.find((x) => x.id === cid && x.school === this.viewerSchool());
    if (!c) throw new ApiError('课程不存在', 404);
    const offerings = DEMO_OFFERINGS.filter((o) => o.courseId === c.id).sort((a, b) => (b.academicYear < a.academicYear ? -1 : b.academicYear > a.academicYear ? 1 : 0) || TERM_ORDER[a.term] - TERM_ORDER[b.term]);
    return { id: c.id, courseCode: c.courseCode, name: c.name, department: c.department, isDemo: true, offerings: offerings.map((o) => this.offeringView(o)) };
  }
  async textbookByIsbn(isbn: string) {
    const parsed = parseIsbn(isbn);
    if (!parsed.ok) throw new ApiError(isbnProblem(isbn) ?? 'ISBN 无效', 400);
    const e = DEMO_EDITIONS.find((x) => x.school === this.viewerSchool() && x.isbn === parsed.isbn13);
    if (!e) throw new ApiError('本校教材目录中没有这个 ISBN', 404);
    return this.editionView(e);
  }
  async textbook(eid: string, sort?: 'nearest' | 'latest'): Promise<TextbookDetail> {
    const sch = this.viewerSchool(), e = this.editionOf(sch, eid), viewer = this.user();
    if (!e) throw new ApiError('教材版本不存在', 404);
    const courses = DEMO_COURSE_TEXTBOOKS.filter((t) => t.editionId === e.id).flatMap((t) => {
      const o = DEMO_OFFERINGS.find((x) => x.id === t.offeringId), c = o && DEMO_COURSES.find((x) => x.id === o.courseId);
      return o && c ? [{ courseId: c.id, courseName: c.name, courseCode: c.courseCode, offeringId: o.id, academicYear: o.academicYear, term: o.term, instructorName: o.instructorName, usageType: t.usageType }] : [];
    });
    const listingSort: 'nearest' | 'latest' = sort === 'latest' || !viewer.dormBuildingId ? 'latest' : 'nearest';
    const others = e.workKey ? DEMO_EDITIONS.filter((x) => x.school === sch && x.workKey === e.workKey && x.id !== e.id).sort((a, b) => (b.publishedYear ?? -1) - (a.publishedYear ?? -1)) : [];
    const listings = (ids: string[]) => this.feedWith({ scope: 'SCHOOL', sort: listingSort, page: 1, pageSize: 20 }, (p) => p.status === '在售' && ids.includes((this.db.productTextbooks ?? {})[p.id] ?? '')).items;
    return { ...this.editionView(e), courses, listingSort, listings: listings([e.id]),
      otherEditions: others.map((x) => ({ id: x.id, isbn: x.isbn, title: x.title, editionLabel: x.editionLabel, publisher: x.publisher, publishedYear: x.publishedYear, onSaleCount: this.onSaleCount(x.id) })),
      otherEditionListings: others.length ? listings(others.map((x) => x.id)) : [] };
  }
  /** 只接受本校目录中的版本 id，从不按书名猜版本。返回 null 表示解除关联。 */
  private resolveTextbook(raw: unknown, category: string, campus: Campus): DemoEdition | null {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null;
    if (typeof raw !== 'string') throw new ApiError('textbookEditionId 格式无效', 400);
    if (category !== '教材书籍') throw new ApiError('只有教材书籍分类的商品可以关联教材版本', 400);
    const e = this.editionOf(school(campus), raw.trim());
    if (!e) throw new ApiError('教材版本不存在', 404);
    return e;
  }
  private productTextbookView(productId: string): ProductTextbook | null {
    const eid = (this.db.productTextbooks ?? {})[productId], e = eid ? DEMO_EDITIONS.find((x) => x.id === eid) : undefined;
    if (!e) return null;
    const names = new Set(DEMO_COURSE_TEXTBOOKS.filter((t) => t.editionId === e.id).flatMap((t) => { const o = DEMO_OFFERINGS.find((x) => x.id === t.offeringId); const c = o && DEMO_COURSES.find((x) => x.id === o.courseId); return c ? [c.name] : []; }));
    return { editionId: e.id, isbn: e.isbn, title: e.title, editionLabel: e.editionLabel, publisher: e.publisher, courseNames: [...names].sort() };
  }
  private suggestionStore() { return this.db.suggestions ??= []; }
  private suggestionView(x: StoredSuggestion): TextbookSuggestion {
    const o = DEMO_OFFERINGS.find((y) => y.id === x.courseOfferingId), c = o && DEMO_COURSES.find((y) => y.id === o.courseId), e = x.textbookEditionId ? DEMO_EDITIONS.find((y) => y.id === x.textbookEditionId) : undefined;
    return { id: x.id, courseOfferingId: x.courseOfferingId, courseName: c?.name ?? '', academicYear: o?.academicYear ?? '', term: o?.term ?? 'AUTUMN', textbookEditionId: x.textbookEditionId,
      editionTitle: e?.title ?? null, editionEditionLabel: e?.editionLabel ?? null, isbn: x.isbn, title: x.title, authors: x.authors, publisher: x.publisher, editionLabel: x.editionLabel,
      publishedYear: x.publishedYear, usageType: x.usageType, note: x.note, status: x.status, createdAt: x.createdAt };
  }
  async createTextbookSuggestion(input: TextbookSuggestionInput): Promise<TextbookSuggestionResult> {
    const me = this.user(), sch = this.viewerSchool();
    const text = (key: keyof TextbookSuggestionInput, max: number): string | null => {
      const raw = input[key];
      if (raw === undefined || raw === null) return null;
      if (typeof raw !== 'string') throw new ApiError(`${key} 格式无效`, 400);
      const value = raw.replace(/\s+/g, ' ').trim();
      if (!value) return null;
      if (value.length > max) throw new ApiError(`${key} 最多 ${max} 个字`, 400);
      if (/[<>]/.test(value)) throw new ApiError(`${key} 不能包含尖括号`, 400);
      return value;
    };
    const offeringId = text('courseOfferingId', 64);
    if (!offeringId) throw new ApiError('请提供 courseOfferingId', 400);
    if (!DEMO_OFFERINGS.some((o) => o.id === offeringId && o.school === sch)) throw new ApiError('开课不存在', 404);
    const usageType = input.usageType ?? 'REQUIRED';
    if (!['REQUIRED', 'RECOMMENDED', 'REFERENCE'].includes(usageType)) throw new ApiError('用途无效', 400);
    const note = text('note', 200);
    let editionId = text('textbookEditionId', 64), isbn13: string | null = null, title: string | null = null, authors: string | null = null, publisher: string | null = null, editionLabel: string | null = null;
    if (editionId) { if (!this.editionOf(sch, editionId)) throw new ApiError('教材版本不存在', 404); }
    else {
      const rawIsbn = text('isbn', 40);
      if (rawIsbn) {
        const parsed = parseIsbn(rawIsbn);
        if (!parsed.ok) throw new ApiError(isbnProblem(rawIsbn) ?? 'ISBN 无效', 400);
        const existing = DEMO_EDITIONS.find((e) => e.school === sch && e.isbn === parsed.isbn13);
        if (existing) editionId = existing.id; else isbn13 = parsed.isbn13;
      }
      if (!editionId) {
        title = text('title', 120); authors = text('authors', 120); publisher = text('publisher', 80); editionLabel = text('editionLabel', 40);
        if (!isbn13 && !title) throw new ApiError('请提供 ISBN 或书名', 400);
        if (!isbn13 && (!publisher || !editionLabel)) throw new ApiError('没有 ISBN 时，请同时填写出版社和版次', 400);
      }
    }
    // 与后端一致：书目信息与说明经过同一套内容安全检查，命中时 400 原样提示
    requireSafeText(title ?? '', authors ?? '', publisher ?? '', editionLabel ?? '', note ?? '');
    const fingerprint = ['sg-v1', offeringId, editionId ?? '', isbn13 ?? '', normalizeDemandText(title), normalizeDemandText(authors), normalizeDemandText(publisher), normalizeDemandText(editionLabel), usageType].join('\n');
    const existing = this.suggestionStore().find((x) => x.submitterId === me.id && x.status === 'PENDING' && x.fingerprint === fingerprint);
    if (existing) return { outcome: 'EXISTING', suggestion: this.suggestionView(existing) };
    if (this.suggestionStore().filter((x) => x.submitterId === me.id && x.createdAt > Date.now() - DAY).length >= 10) throw new ApiError('今天提交的教材建议已达上限，请明天再试', 429);
    const suggestion: StoredSuggestion = { id: id(), submitterId: me.id, school: sch, courseOfferingId: offeringId, textbookEditionId: editionId, isbn: isbn13, title, authors, publisher, editionLabel, publishedYear: null, usageType: usageType as TextbookUsage, note, status: 'PENDING', fingerprint, createdAt: Date.now() };
    this.suggestionStore().push(suggestion); this.save();
    return { outcome: 'CREATED', suggestion: this.suggestionView(suggestion) };
  }
  async myTextbookSuggestions() { const me = this.user(); return this.suggestionStore().filter((x) => x.submitterId === me.id).sort((a, b) => b.createdAt - a.createdAt).map((x) => this.suggestionView(x)); }
  async withdrawTextbookSuggestion(sid: string) {
    const me = this.user(), x = this.suggestionStore().find((y) => y.id === sid && y.submitterId === me.id);
    if (!x) throw new ApiError('建议不存在', 404);
    if (x.status === 'PENDING') { x.status = 'WITHDRAWN'; this.save(); }
    return this.suggestionView(x);
  }

  // ---------- 需求订阅 ----------
  private subscriptionStore() { return this.db.subscriptions ??= []; }
  private matchStore() { return this.db.matches ??= []; }
  private static readonly DEMAND_CREATE_FIELDS = ['keyword', 'category', 'minPrice', 'maxPrice', 'geoScope', 'campusId', 'buildingId', 'textbookEditionId', 'circleId'];
  private static readonly DEMAND_PATCH_FIELDS = ['keyword', 'category', 'minPrice', 'maxPrice', 'geoScope', 'campusId', 'buildingId', 'active'];
  private rejectUnknown(body: object, allowed: string[]) { for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ApiError('请求包含不支持的字段', 400); }
  private parseConditions(input: DemandConditions, user: User, requireMembership = true) {
    const rawKeyword = input.keyword ?? null, normalized = rawKeyword === null ? '' : normalizeDemandText(rawKeyword);
    if (normalized.length > 40) throw new ApiError('关键词最多 40 个字', 400);
    const keyword = normalized ? (rawKeyword as string).replace(/\s+/g, ' ').trim() : null, normalizedKeyword = normalized || null;
    let category: string | null = input.category || null;
    if (category && !(['数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他'] as string[]).includes(category)) throw new ApiError('分类无效', 400);
    let textbookEditionId: string | null = null;
    const rawEdition = input.textbookEditionId;
    if (rawEdition !== undefined && rawEdition !== null && String(rawEdition).trim() !== '') {
      if (typeof rawEdition !== 'string') throw new ApiError('textbookEditionId 格式无效', 400);
      if (normalizedKeyword) throw new ApiError('教材版本订阅按版本精确匹配，不需要关键词', 400);
      if (category && category !== '教材书籍') throw new ApiError('教材版本订阅的分类只能是教材书籍', 400);
      if (!this.editionOf(school(user.campus), rawEdition.trim())) throw new ApiError('教材版本不存在', 404);
      textbookEditionId = rawEdition.trim(); category = '教材书籍';
    }
    if (!normalizedKeyword && !category) throw new ApiError('请至少填写关键词或选择分类', 400);
    const price = (value: number | null | undefined, name: string) => {
      if (value === null || value === undefined) return null;
      if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100 || value > 99_999_999) throw new ApiError(`${name} 无效`, 400);
      return value;
    };
    const minPrice = price(input.minPrice, 'minPrice'), maxPrice = price(input.maxPrice, 'maxPrice');
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new ApiError('最低价不能高于最高价', 400);
    const geoScope = input.geoScope ?? 'SCHOOL';
    if (!['BUILDING', 'ZONE', 'CAMPUS', 'SCHOOL'].includes(geoScope)) throw new ApiError('范围无效', 400);
    const sch = school(user.campus), requestedCampus = input.campusId || null, requestedBuilding = input.buildingId || null;
    let campusId: string | null = null, buildingId: string | null = null, zone: string | null = null;
    if (geoScope === 'SCHOOL') { if (requestedCampus || requestedBuilding) throw new ApiError('全校范围不需要指定校区或楼栋', 400); }
    else if (geoScope === 'CAMPUS') {
      if (requestedBuilding) throw new ApiError('校区范围不需要指定楼栋', 400);
      campusId = requestedCampus ?? user.campus;
      requireCampus(campusId);
      if (school(campusId as Campus) !== sch) throw new ApiError('校区不属于你所在的学校', 400);
    } else {
      const anchor = requestedBuilding ?? user.dormBuildingId ?? null;
      if (!anchor) throw new ApiError('请先在个人资料中设置宿舍楼，或选择一栋楼', 409);
      const b = DEMO_BUILDINGS.find((x) => x.id === anchor);
      if (!b) throw new ApiError('楼栋不存在', 404);
      if (school(b.campusId) !== sch) throw new ApiError('楼栋不属于你所在的学校', 400);
      if (requestedCampus && requestedCampus !== b.campusId) throw new ApiError('所选楼栋不属于该校区', 400);
      campusId = b.campusId; buildingId = b.id; zone = b.zone;
    }
    let circleId: string | null = null;
    const rawCircle = input.circleId;
    if (rawCircle !== undefined && rawCircle !== null && String(rawCircle).trim() !== '') {
      if (geoScope !== 'SCHOOL') throw new ApiError('圈子订阅的范围就是这个圈子，不需要再选校区或楼栋', 400);
      if (textbookEditionId) throw new ApiError('圈子订阅不能同时订阅教材版本', 400);
      circleId = String(rawCircle);
      if (requireMembership && !(this.circleStore().some((c) => c.id === circleId && c.school === sch) && this.activeMember(circleId, user.id))) throw new ApiError('圈子不存在或你不是这个圈子的成员', 404);
    }
    const anchorKey = geoScope === 'BUILDING' ? buildingId : geoScope === 'ZONE' ? `${campusId}/${zone}` : geoScope === 'CAMPUS' ? campusId : '';
    const plain = (v: number | null) => (v === null ? '' : String(Number(v)));
    const fingerprint = ['v1', `kw=${normalizedKeyword ?? ''}`, `cat=${category ?? ''}`, `min=${plain(minPrice)}`, `max=${plain(maxPrice)}`, `geo=${geoScope}`, `anchor=${anchorKey ?? ''}`].join('\n')
      + (textbookEditionId ? `\ntb=${textbookEditionId}` : '') + (circleId ? `\ncircle=${circleId}` : '');
    return { keyword, normalizedKeyword, category, minPrice, maxPrice, geoScope, campusId, buildingId, fingerprint, school: sch, textbookEditionId, circleId };
  }
  private subscriptionView(x: StoredSubscription): DemandSubscription {
    const b = DEMO_BUILDINGS.find((y) => y.id === x.buildingId), e = x.textbookEditionId ? DEMO_EDITIONS.find((y) => y.id === x.textbookEditionId) : undefined;
    return { id: x.id, keyword: x.keyword, category: x.category as Category | null, minPrice: x.minPrice, maxPrice: x.maxPrice, geoScope: x.geoScope, campusId: x.campusId as Campus | null,
      buildingId: x.buildingId, zone: b?.zone ?? null, buildingName: b?.name ?? null,
      textbook: e ? { id: e.id, isbn: e.isbn, title: e.title, editionLabel: e.editionLabel, publisher: e.publisher } : null,
      circle: x.circleId ? { id: x.circleId, name: this.circleStore().find((c) => c.id === x.circleId)?.name ?? null } : null,
      active: x.active, matchCount: this.matchStore().filter((m) => m.subscriptionId === x.id).length, createdAt: x.createdAt, updatedAt: x.updatedAt };
  }
  private activeCount(uid: string) { return this.subscriptionStore().filter((x) => x.userId === uid && x.active).length; }
  async createSubscription(input: DemandConditions): Promise<DemandSubscribeResult> {
    this.rejectUnknown(input, MockApi.DEMAND_CREATE_FIELDS);
    const user = this.user(), c = this.parseConditions(input, user);
    const mine = this.subscriptionStore().filter((x) => x.userId === user.id && x.fingerprint === c.fingerprint);
    const existing = mine.find((x) => x.active);
    if (existing) return { outcome: 'EXISTING', subscription: this.subscriptionView(existing) };
    if (c.textbookEditionId && this.subscriptionStore().some((x) => x.userId === user.id && x.active && x.textbookEditionId === c.textbookEditionId)) throw new ApiError('你已订阅这个教材版本，可以修改原订阅的范围或预算', 409);
    if (this.activeCount(user.id) >= 50) throw new ApiError('启用中的订阅已达 50 个上限，请先停用一些', 409);
    const inactive = [...mine].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (inactive) { inactive.active = true; inactive.updatedAt = Date.now(); this.save(); return { outcome: 'REACTIVATED', subscription: this.subscriptionView(inactive) }; }
    const now = Date.now();
    const sub: StoredSubscription = { id: id(), userId: user.id, school: c.school, keyword: c.keyword, normalizedKeyword: c.normalizedKeyword, category: c.category, minPrice: c.minPrice, maxPrice: c.maxPrice,
      geoScope: c.geoScope as BuildingScope, campusId: c.campusId, buildingId: c.buildingId, textbookEditionId: c.textbookEditionId, circleId: c.circleId, fingerprint: c.fingerprint, active: true, createdAt: now, updatedAt: now };
    this.subscriptionStore().push(sub); this.save();
    return { outcome: 'CREATED', subscription: this.subscriptionView(sub) };
  }
  async subscriptions() { const user = this.user(); return this.subscriptionStore().filter((x) => x.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).map((x) => this.subscriptionView(x)); }
  async updateSubscription(sid: string, patch: DemandConditions & { active?: boolean }) {
    this.rejectUnknown(patch, MockApi.DEMAND_PATCH_FIELDS);
    const user = this.user(), current = this.subscriptionStore().find((x) => x.id === sid && x.userId === user.id);
    if (!current) throw new ApiError('订阅不存在', 404);
    const merged: DemandConditions = { keyword: current.keyword, category: current.category as Category | null, minPrice: current.minPrice, maxPrice: current.maxPrice, geoScope: current.geoScope,
      campusId: current.campusId as Campus | null, buildingId: current.buildingId, textbookEditionId: current.textbookEditionId, circleId: current.circleId };
    const { active: nextActive, ...conditions } = patch;
    Object.assign(merged, conditions);
    // 切换范围时，旧范围的锚点不带入新范围
    if ('geoScope' in patch && !('campusId' in patch)) merged.campusId = null;
    if ('geoScope' in patch && !('buildingId' in patch)) merged.buildingId = null;
    const active = typeof nextActive === 'boolean' ? nextActive : current.active;
    const c = this.parseConditions(merged, user, active);
    if (active) {
      if (this.subscriptionStore().some((x) => x.userId === user.id && x.active && x.fingerprint === c.fingerprint && x.id !== sid)) throw new ApiError('已有一条相同条件的订阅', 409);
      if (c.textbookEditionId && this.subscriptionStore().some((x) => x.userId === user.id && x.active && x.id !== sid && x.textbookEditionId === c.textbookEditionId)) throw new ApiError('你已订阅这个教材版本', 409);
      if (!current.active && this.activeCount(user.id) >= 50) throw new ApiError('启用中的订阅已达 50 个上限，请先停用一些', 409);
    }
    Object.assign(current, { keyword: c.keyword, normalizedKeyword: c.normalizedKeyword, category: c.category, minPrice: c.minPrice, maxPrice: c.maxPrice, geoScope: c.geoScope, campusId: c.campusId, buildingId: c.buildingId, fingerprint: c.fingerprint, active, updatedAt: Date.now() });
    this.save(); return this.subscriptionView(current);
  }
  async deleteSubscription(sid: string) {
    const user = this.user(), current = this.subscriptionStore().find((x) => x.id === sid && x.userId === user.id);
    if (!current) throw new ApiError('订阅不存在', 404);
    current.active = false; current.updatedAt = Date.now(); this.save();
    return this.subscriptionView(current);
  }
  /** 对一件商品重新计算全部匹配（发布、编辑、改状态时同步进行）：不在售 → 候选为空；不再命中的标记失效。 */
  private evaluateDemand(product: Product) {
    const keep = new Set<string>(), building = DEMO_BUILDINGS.find((b) => b.id === product.buildingId), textbookEditionId = (this.db.productTextbooks ?? {})[product.id] ?? null;
    if (product.status === '在售') {
      const circles = (product.visibility ?? 'PUBLIC') === 'CIRCLE_ONLY' ? this.productCircleStore()[product.id] ?? [] : null;
      for (const s of this.subscriptionStore()) {
        if (!s.active || s.school !== school(product.campus) || s.userId === product.sellerId) continue;
        if (circles === null ? !!s.circleId : !s.circleId || !circles.includes(s.circleId) || !this.activeMember(s.circleId, s.userId)) continue;
        if (s.category && s.category !== product.category) continue;
        if (s.textbookEditionId && s.textbookEditionId !== textbookEditionId) continue;
        if (s.minPrice !== null && s.minPrice > product.price) continue;
        if (s.maxPrice !== null && s.maxPrice < product.price) continue;
        if (s.normalizedKeyword && !normalizeDemandText(product.title).includes(s.normalizedKeyword) && !normalizeDemandText(product.description).includes(s.normalizedKeyword)) continue;
        const anchor = DEMO_BUILDINGS.find((b) => b.id === s.buildingId);
        const inGeo = s.geoScope === 'SCHOOL' || (s.geoScope === 'CAMPUS' && s.campusId === product.campus)
          || (s.geoScope === 'BUILDING' && !!product.buildingId && s.buildingId === product.buildingId)
          || (s.geoScope === 'ZONE' && !!building && s.campusId === product.campus && anchor?.zone === building.zone);
        if (!inGeo) continue;
        const r = scoreDemandMatch({ normalizedKeyword: s.normalizedKeyword, category: s.category, minPrice: s.minPrice, maxPrice: s.maxPrice, geoScope: s.geoScope, campusId: s.campusId, buildingId: s.buildingId, anchorZone: anchor?.zone ?? null, textbookEditionId: s.textbookEditionId },
          { title: product.title, description: product.description, category: product.category, price: product.price, campus: product.campus, buildingId: product.buildingId ?? null, zone: building?.zone ?? null, textbookEditionId });
        keep.add(s.id);
        const existing = this.matchStore().find((m) => m.subscriptionId === s.id && m.productId === product.id);
        if (existing) Object.assign(existing, { score: r.score, reasonCodes: r.reasonCodes, invalidatedAt: null });
        else this.matchStore().push({ id: id(), subscriptionId: s.id, productId: product.id, score: r.score, reasonCodes: r.reasonCodes, readAt: null, dismissedAt: null, invalidatedAt: null, createdAt: Date.now() });
      }
    }
    for (const m of this.matchStore()) if (m.productId === product.id && !keep.has(m.subscriptionId) && m.invalidatedAt === null && m.dismissedAt === null) m.invalidatedAt = Date.now();
  }
  private ownMatch(m: StoredMatch, uid: string) { return this.subscriptionStore().some((x) => x.id === m.subscriptionId && x.userId === uid); }
  async demandMatches(page = 1, pageSize = 20): Promise<DemandMatchPage> {
    const user = this.user();
    const mine = this.matchStore().filter((m) => { const p = this.db.products.find((x) => x.id === m.productId); return m.dismissedAt === null && this.ownMatch(m, user.id) && !!p && school(p.campus) === school(user.campus) && this.visibleTo(p, user.id); })
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    const items = mine.slice((page - 1) * pageSize, page * pageSize).flatMap((m): DemandMatch[] => {
      const p = this.db.products.find((x) => x.id === m.productId), sub = this.subscriptionStore().find((x) => x.id === m.subscriptionId);
      if (!p || !sub) return [];
      const onSale = p.status === '在售';
      const { active: _a, matchCount: _c, createdAt: _cr, updatedAt: _u, ...subscription } = this.subscriptionView(sub);
      return [{ id: m.id, score: m.score, tier: mockTier(m.score), reasonCodes: m.reasonCodes, read: m.readAt !== null, valid: m.invalidatedAt === null && onSale,
        invalidReason: m.invalidatedAt !== null ? 'NO_LONGER_MATCHES' : onSale ? null : 'NOT_ON_SALE', createdAt: m.createdAt, product: this.view(p), subscription }];
    });
    return { items, total: mine.length, page, pageSize };
  }
  async demandUnread() {
    const user = this.user();
    return this.matchStore().filter((m) => {
      const s = this.subscriptionStore().find((x) => x.id === m.subscriptionId), p = this.db.products.find((x) => x.id === m.productId);
      return !!s && s.userId === user.id && s.active && m.readAt === null && m.dismissedAt === null && m.invalidatedAt === null && p?.status === '在售' && this.visibleTo(p, user.id);
    }).length;
  }
  async markDemandRead(mid: string) {
    const user = this.user(), m = this.matchStore().find((x) => x.id === mid);
    if (!m || !this.ownMatch(m, user.id)) throw new ApiError('匹配不存在', 404);
    m.readAt ??= Date.now(); this.save(); return this.demandUnread();
  }
  async dismissDemandMatch(mid: string) {
    const user = this.user(), m = this.matchStore().find((x) => x.id === mid);
    if (!m || !this.ownMatch(m, user.id)) throw new ApiError('匹配不存在', 404);
    m.dismissedAt ??= Date.now(); m.readAt ??= Date.now(); this.save(); return this.demandUnread();
  }
}
