import type { MarketApi, User, Product, ProductInput, ContactRequest, Query, ProductStatus, Campus } from '../model';
import { validateProduct } from '../model';

export interface StoragePort { get(): unknown; set(value: unknown): void }
interface Database { version: 1; users: (User & { password: string })[]; userId: string | null; products: Product[]; favorites: Record<string, string[]>; contacts: ContactRequest[]; reports?: { productId: string; reporterId: string; reason: string; createdAt: number }[] }
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
  constructor(private readonly storage: StoragePort) {
    const saved = storage.get() as Partial<Database> | null;
    this.db = saved?.version === 1 && Array.isArray(saved.users) && Array.isArray(saved.products) && Array.isArray(saved.contacts) && saved.favorites
      ? saved as Database : seedDatabase();
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
    const approved = this.db.contacts.some((r) => r.productId === product.id && r.buyerId === uid && r.status === 'APPROVED');
    return { ...product, images: [...product.images], contact: product.sellerId === uid || product.contactPublic || approved ? product.contact : '' };
  }
  async restore() { const user = this.db.users.find((u) => u.id === this.db.userId); return user ? this.safeUser(user) : null; }
  async login(account: string, password: string) { const user = this.db.users.find((u) => u.account === account.trim() && u.password === password); if (!user) throw new Error('账号或密码错误'); this.db.userId = user.id; this.save(); return this.safeUser(user); }
  async register(input: { account: string; password: string; nickname: string; campus: Campus; contact: string }) {
    if (!/^[a-zA-Z0-9]{6,20}$/.test(input.account.trim()) || input.password.length < 8 || !input.nickname.trim()) throw new Error('请填写有效账号、昵称和至少 8 位密码');
    if (this.db.users.some((u) => u.account === input.account.trim())) throw new Error('该账号已注册');
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
    const user = this.user(), message = validateProduct(input); if (message) throw new Error(message);
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
  async requestContact(id: string) {
    const p = this.item(id), buyer = this.user();
    if (p.sellerId === buyer.id) throw new Error('不能申请自己的联系方式');
    if (p.status !== '在售') throw new Error('该商品当前不可申请联系');
    if (p.contactPublic) throw new Error('卖家已公开联系方式');
    const existing = this.db.contacts.find((r) => r.productId === id && r.buyerId === buyer.id);
    if (existing) return { ...existing };
    const request: ContactRequest = { id: `request_${Math.random().toString(36).slice(2)}`, productId: id, productTitle: p.title, buyerId: buyer.id, sellerId: p.sellerId, buyerNickname: buyer.nickname, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    this.db.contacts.push(request); this.save(); return { ...request };
  }
  async contactState(id: string) { this.item(id); const result = this.db.contacts.find((r) => r.productId === id && r.buyerId === this.user().id); return result ? { ...result } : null; }
  async contacts() { const uid = this.user().id; return this.db.contacts.filter((r) => r.buyerId === uid || r.sellerId === uid).map((r) => ({ ...r })).sort((a, b) => b.createdAt - a.createdAt); }
  async decide(id: string, status: 'APPROVED' | 'REJECTED') { const r = this.db.contacts.find((r) => r.id === id && r.sellerId === this.user().id); if (!r) throw new Error('联系申请不存在'); if (r.status !== 'PENDING' && r.status !== status) throw new Error('该申请已处理'); r.status = status; r.updatedAt = Date.now(); this.save(); }
  async template() { return null; }
  async updateProfile(input: { nickname: string; campus: Campus; contact: string }) { const u = this.user(); if (!input.nickname.trim()) throw new Error('昵称不能为空'); if (school(input.campus) !== school(u.campus)) throw new Error('不能通过资料修改学校'); Object.assign(u, input); this.save(); return this.safeUser(u); }
  async report(id: string, reason: string) { this.item(id); if (!reason.trim()) throw new Error('请填写举报原因'); this.db.reports ??= []; this.db.reports.push({ productId: id, reporterId: this.user().id, reason: reason.trim(), createdAt: Date.now() }); this.save(); }
  async upload(path: string) { this.user(); return path; }
}
