import type { MarketApi, Product, ProductInput, ProductPage, Query, User, ContactRequest, InspectionTemplate, ProductStatus, Campus, Category } from '../model';
import { Transport } from './transport';
export class RestApi implements MarketApi {
  private uid = '';
  constructor(private readonly transport: Transport, private readonly uploader: (path: string, authorization: string) => Promise<string>) {}
  async restore() { const session = await this.transport.restore(); this.uid = session?.user.id ?? ''; return session?.user ?? null; }
  async login(account: string, password: string) { const user = await this.transport.login({ account: account.trim(), password }); this.uid = user.id; return user; }
  async register(input: { account: string; password: string; nickname: string; campus: Campus; contact: string }) { const user = await this.transport.login(input, true); this.uid = user.id; return user; }
  async logout() { try { await this.transport.logout(); } finally { this.uid = ''; } }
  list(query: Query) {
    const parameters = Object.entries(query).filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    return this.transport.request<ProductPage>(`/v1/products?${parameters}`);
  }
  detail(id: string) { return this.transport.request<Product>(`/v1/products/${encodeURIComponent(id)}`); }
  publicUser(id: string) { return this.transport.request<User>(`/v1/users/${encodeURIComponent(id)}`); }
  publish(input: ProductInput, id?: string) { return this.transport.request<Product>(id ? `/v1/products/${encodeURIComponent(id)}` : '/v1/products', id ? 'PATCH' : 'POST', input); }
  async myListings() {
    const result: Product[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.list({ sort: 'latest', page, pageSize: 100 });
      result.push(...batch.items.filter((p) => p.sellerId === this.uid));
      if (!batch.items.length || page * batch.pageSize >= batch.total) break;
    }
    return result;
  }
  async status(id: string, status: ProductStatus) { await this.transport.request(`/v1/products/${encodeURIComponent(id)}/status`, 'POST', { status }); }
  async favorites() { const values = await this.transport.request<{ productId: string }[]>('/v1/favorites'); return values.map((f) => f.productId); }
  async favorite(id: string, active: boolean) { await this.transport.request(`/v1/products/${encodeURIComponent(id)}/favorite`, active ? 'PUT' : 'DELETE'); }
  requestContact(id: string) { return this.transport.request<ContactRequest>(`/v1/products/${encodeURIComponent(id)}/contact-request`, 'POST'); }
  contactState(id: string) { return this.transport.request<ContactRequest | null>(`/v1/products/${encodeURIComponent(id)}/contact-request`); }
  contacts() { return this.transport.request<ContactRequest[]>('/v1/contact-requests'); }
  async decide(id: string, status: 'APPROVED' | 'REJECTED') { await this.transport.request(`/v1/contact-requests/${encodeURIComponent(id)}/decision`, 'POST', { status }); }
  template(category: Category) { return this.transport.request<InspectionTemplate | null>(`/v1/inspection-templates?category=${encodeURIComponent(category)}`); }
  updateProfile(input: { nickname: string; campus: Campus; contact: string }) { return this.transport.request<User>('/v1/auth/me', 'PATCH', input); }
  async report(id: string, reason: string) { await this.transport.request('/v1/moderation-reports', 'POST', { targetType: 'PRODUCT', targetId: id, reasonCode: 'OTHER', note: reason }); }
  upload(path: string) { return this.uploader(path, this.transport.authorization); }
}
