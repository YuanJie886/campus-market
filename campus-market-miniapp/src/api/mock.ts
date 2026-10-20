import type { MarketApi, User, Product, ProductInput, ContactRequest, ContactQuery, ContactRole, ContactStatus, Query, ProductStatus, Campus, UnreadCount, WechatStatus, WechatLoginResult, PasswordResetInput, DeletionInput, DeletionResult } from '../model';
import { CONTACT_STATUSES, validateProduct } from '../model';
import { ApiError } from './transport';
import { imageRefFromUrl, isUploadRef, type UploadedImage } from '../images';

export interface StoragePort { get(): unknown; set(value: unknown): void }
/** 演示库中的申请：与后端一致，另存卖家 / 买家最近一次「看到」的时间，用于计算未读。 */
type StoredContact = Omit<ContactRequest, 'unread' | 'buyerNickname' | 'sellerNickname'> & { sellerSeenAt: number | null; buyerSeenAt: number | null };
/** wechat：演示里的「微信身份 ↔ 账号」绑定（相当于后端 user_wechat_identities）；绑定票据只在内存里，不进这个库。 */
interface Database { version: 1; users: (User & { password: string; deleted?: boolean })[]; userId: string | null; products: Product[]; favorites: Record<string, string[]>; contacts: StoredContact[]; reports?: { productId: string; reporterId: string; reason: string; createdAt: number }[]; wechat?: { openid: string; userId: string }[]; images?: StoredImage[] }
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
const school = (campus: Campus) => campus === '东校区' || campus === '西校区' ? 'demo-school-a' : 'demo-school-b';
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
      { id: 'other-school', account: 'school002', password: 'demo12345', nickname: '另一所学校的同学', campus: '南校区', contact: 'private-contact' },
    ],
    products: [
      ...goods.map(([title, category, price, picture, condition], i): Product => ({
        id: `demo-product-${i}`, title, category, price, condition,
        originalPrice: Math.round(price * 1.8), description: '同学自用闲置，使用情况已写在成色里。可以约在校内公共地点当面查看，具体时间和地点双方联系后商量。\n这是演示商品，图片是示意插画。',
        campus: i % 3 === 0 ? '西校区' : '东校区', images: [`/assets/goods/${picture}.png`],
        sellerId: 'demo-seller', contact: 'wechat:campus-demo-seller', contactPublic: i === 2,
        status: '在售', createdAt: now - (i + 1) * 3600000, views: 12 + i * 9,
      })),
      { id: 'other-school-product', title: '他校私有商品', category: '其他', condition: '全新', campus: '南校区', price: 10, images: ['/assets/goods/box.png'], sellerId: 'other-school', contact: 'private-contact', description: '只对本校展示', status: '在售', createdAt: now, views: 0 },
    ], favorites: {}, contacts: [],
  };
}
export class MockApi implements MarketApi {
  private db: Database;
  /** 微信绑定票据：只在内存，一次性、10 分钟；与后端一样只认票据本身。 */
  private readonly tickets = new Map<string, { openid: string; expiresAt: number }>();
  constructor(private readonly storage: StoragePort) {
    const saved = storage.get() as Partial<Database> | null;
    this.db = saved?.version === 1 && Array.isArray(saved.users) && Array.isArray(saved.products) && Array.isArray(saved.contacts) && saved.favorites
      ? saved as Database : seedDatabase();
    this.db.contacts = this.db.contacts.map(upgradeContact);
    this.save();
  }
  private save() { this.storage.set(this.db); }
  private user() { const user = this.db.users.find((u) => u.id === this.db.userId); if (!user) throw new Error('请先登录'); return user; }
  private safeUser(user: User): User { const { id, account, nickname, campus, contact } = user; return { id, account, nickname, campus, contact }; }
  private item(id: string) {
    const user = this.user(), product = this.db.products.find((p) => p.id === id);
    if (!product || school(product.campus) !== school(user.campus) || (product.status === '已下架' && product.sellerId !== user.id)) throw new Error('商品不存在或已下架');
    return product;
  }
  private view(product: Product): Product {
    const uid = this.user().id;
    // 只有仍处于「已同意」的申请授权查看；撤回同意（REVOKED）后立即看不到
    const approved = this.db.contacts.some((r) => r.productId === product.id && r.buyerId === uid && r.status === 'APPROVED');
    return { ...product, images: product.images.map((image) => this.signed(image)), contact: product.sellerId === uid || product.contactPublic || approved ? product.contact : '' };
  }
  async restore() { const user = this.db.users.find((u) => u.id === this.db.userId); return user ? this.safeUser(user) : null; }
  async login(account: string, password: string) { const user = this.db.users.find((u) => !u.deleted && u.account === account.trim() && u.password === password); if (!user) throw new Error('账号或密码错误'); this.db.userId = user.id; this.save(); return this.safeUser(user); }
  async register(input: { account: string; password: string; nickname: string; campus: Campus; contact: string }) {
    if (!/^[a-zA-Z0-9]{6,20}$/.test(input.account.trim()) || input.password.length < 8 || !input.nickname.trim()) throw new Error('请填写有效账号、昵称和至少 8 位密码');
    if (this.db.users.some((u) => !u.deleted && u.account === input.account.trim())) throw new Error('该账号已注册');
    const user = { ...input, account: input.account.trim(), nickname: input.nickname.trim(), id: id() };
    this.db.users.push(user); this.db.userId = user.id; this.save(); return this.safeUser(user);
  }
  async logout() { this.db.userId = null; this.save(); }
  async list(query: Query) {
    const user = this.user(), kw = query.keyword?.trim().toLowerCase() ?? '';
    const list = this.db.products.filter((p) => school(p.campus) === school(user.campus) && p.status !== '已下架'
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
    return { id: user.id, nickname: user.nickname, campus: user.campus };
  }
  async publish(input: ProductInput, productId?: string) {
    const user = this.user(), message = validateProduct(input); if (message) throw new ApiError(message, 400);
    // 与后端 ImageService.requireUsable 一致：只能引用本人上传、仍有效的图片
    for (const image of input.images) {
      if (image.startsWith('upload:') && !(isUploadRef(image) && this.uploads().some((u) => `upload:${u.id}` === image && u.ownerId === user.id && u.status === 'ACTIVE'))) throw new ApiError('只能使用自己上传的图片，请重新上传', 400);
    }
    if (school(user.campus) !== school(input.campus)) throw new Error('只能发布本校商品');
    const old = productId ? this.item(productId) : null;
    if (old && old.sellerId !== user.id) throw new Error('只能编辑自己的商品');
    const { inspection, ...fields } = input;
    const product: Product = { ...old, ...fields, inspection: inspection ? { items: inspection.map((item) => ({ code: item.itemCode, label: item.itemCode, condition: item.condition, note: item.note ?? null })) } : old?.inspection ?? null, id: old?.id ?? id(), sellerId: user.id, status: old?.status ?? '在售', createdAt: old?.createdAt ?? Date.now(), views: old?.views ?? 0 };
    this.db.products = [...this.db.products.filter((p) => p.id !== product.id), product]; this.save(); return this.view(product);
  }
  async myListings() { const user = this.user(); return this.db.products.filter((p) => p.sellerId === user.id).sort((a, b) => b.createdAt - a.createdAt).map((p) => this.view(p)); }
  async status(id: string, status: ProductStatus) { const p = this.item(id); if (p.sellerId !== this.user().id) throw new Error('只能管理自己的商品'); p.status = status; this.save(); }
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
        && (product.status !== '已下架' || product.sellerId === user.id);
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
  async updateProfile(input: { nickname: string; campus: Campus; contact: string }) { const u = this.user(); if (!input.nickname.trim()) throw new Error('昵称不能为空'); if (school(input.campus) !== school(u.campus)) throw new Error('不能通过资料修改学校'); Object.assign(u, input); this.save(); return this.safeUser(u); }
  async report(id: string, reason: string) { this.item(id); if (!reason.trim()) throw new Error('请填写举报原因'); this.db.reports ??= []; this.db.reports.push({ productId: id, reporterId: this.user().id, reason: reason.trim(), createdAt: Date.now() }); this.save(); }
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
    // 演示没有后台工作人员与圈子，后端的两种 409 前置条件在这里不会出现
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
    // 与后端一致：本人上传的图片全部失效
    for (const image of this.uploads()) if (image.ownerId === user.id) image.status = 'DELETED';
    Object.assign(user, { account: `deleted-${user.id}`, password: randomHex(), nickname: '已注销用户', contact: '', avatar: '', deleted: true });
    this.db.userId = null; this.save();
    return { productsTakenDown, requestsClosed, membershipsEnded: 0 };
  }
}
