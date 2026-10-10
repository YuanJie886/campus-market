// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import type { ProductCreateInput } from './contracts';

let api: MockCampusMarketApi;
const listing: ProductCreateInput = { title: '联系流程测试', description: '仅展示商品与联系方式', category: '其他', condition: '全新', price: 12, campus: '东校区', images: ['https://example.invalid/a.png'], contact: 'wechat:seller' };
async function user(name: string, campus: '东校区' | '南校区' = '东校区') { return (await api.register({ account: name, nickname: name, password: 'test-pass', campus })).user; }
async function login(account: string) { await api.login({ account, password: 'test-pass' }); }
beforeEach(() => { localStorage.clear(); api = new MockCampusMarketApi(); });

describe('商品联系方式授权', () => {
  it('默认私密；申请不预约商品、不生成订单；仅卖家可批准，且仅批准的买家可查看', async () => {
    await user('seller'); const product = await api.createProduct(listing);
    await user('buyer');
    expect((await api.getProduct(product.id)).contact).toBe('');
    expect((await api.feedProducts({ sort: 'latest', page: 1, pageSize: 100, scope: 'SCHOOL' })).items.find((p) => p.id === product.id)?.contact).toBe('');
    const request = await api.requestContact(product.id);
    expect((await api.requestContact(product.id)).id).toBe(request.id);
    expect((await api.getProduct(product.id)).status).toBe('在售');
    expect((await api.getProduct(product.id)).contact).toBe('');
    await expect(api.decideContactRequest(request.id, 'APPROVED')).rejects.toMatchObject({ code: 404 });
    await login('seller');
    expect(await api.listContactRequests()).toHaveLength(1);
    await api.decideContactRequest(request.id, 'APPROVED');
    await login('buyer');
    expect((await api.getProduct(product.id)).contact).toBe(listing.contact);
    expect((await api.listProducts({ sort: 'latest', page: 1, pageSize: 100 })).items.find((p) => p.id === product.id)?.contact).toBe('');
    await user('other'); expect((await api.getProduct(product.id)).contact).toBe('');
    expect(await api.listContactRequests()).toEqual([]);
    await expect(api.decideContactRequest(request.id, 'APPROVED')).rejects.toMatchObject({ code: 404 });
    const db = JSON.parse(localStorage.getItem('campus_market_mock_database_v1')!);
    expect(db.market.orders.filter((o: { productId: string }) => o.productId === product.id)).toHaveLength(0);
  });
  it('公开开关需卖家主动选择；关闭后未授权用户不可见；重载保留选项', async () => {
    await user('seller'); const product = await api.createProduct({ ...listing, contactPublic: true });
    await user('buyer'); expect((await api.getProduct(product.id)).contact).toBe(listing.contact);
    await expect(api.requestContact(product.id)).rejects.toMatchObject({ code: 409 });
    await login('seller'); await api.updateProduct(product.id, { contactPublic: false });
    api = new MockCampusMarketApi(); await login('buyer'); expect((await api.getProduct(product.id)).contact).toBe('');
    await expect(api.updateProduct(product.id, { contactPublic: true })).rejects.toMatchObject({ code: 403 });
  });
  it('拒绝、下架、自身和跨校申请不会暴露联系方式', async () => {
    await user('seller'); const product = await api.createProduct(listing);
    await expect(api.requestContact(product.id)).rejects.toMatchObject({ code: 400 });
    await user('buyer'); const request = await api.requestContact(product.id);
    await login('seller'); await api.decideContactRequest(request.id, 'REJECTED');
    await login('buyer'); expect((await api.getProduct(product.id)).contact).toBe('');
    expect((await api.requestContact(product.id)).status).toBe('REJECTED');
    await login('seller'); await api.setProductStatus(product.id, '已下架');
    await login('buyer'); await expect(api.getProduct(product.id)).rejects.toMatchObject({ code: 404 });
    await user('outsider', '南校区');
    const db = JSON.parse(localStorage.getItem('campus_market_mock_database_v1')!); db.campusSchools['南校区'] = 'foreign'; localStorage.setItem('campus_market_mock_database_v1', JSON.stringify(db));
    api = new MockCampusMarketApi(); await expect(api.requestContact(product.id)).rejects.toMatchObject({ code: 404 });
  });
  it('同意只对具体商品和买家生效，且圈子权限仍生效', async () => {
    await user('seller'); const first = await api.createProduct(listing); const second = await api.createProduct(listing);
    await user('buyer'); const request = await api.requestContact(first.id);
    await login('seller'); await api.decideContactRequest(request.id, 'APPROVED');
    await login('buyer'); expect((await api.getProduct(first.id)).contact).toBe(listing.contact); expect((await api.getProduct(second.id)).contact).toBe('');
    await login('seller');
    const circle = await api.createCircle({ name: '私密圈', type: 'INTEREST', visibility: 'PRIVATE' });
    await api.updateProduct(first.id, { visibility: 'CIRCLE_ONLY', circleIds: [circle.id] });
    await login('buyer'); await expect(api.getProduct(first.id)).rejects.toMatchObject({ code: 404 });
    expect(await api.listContactRequests()).toEqual([]);
  });
  it('旧数据迁移不自动公开联系方式，保留商品并释放旧预约', async () => {
    await user('seller'); const product = await api.createProduct(listing);
    const db = JSON.parse(localStorage.getItem('campus_market_mock_database_v1')!);
    db.schemaVersion = 11; delete db.contactRequests;
    const stored = db.market.products.find((p: { id: string }) => p.id === product.id); delete stored.contactPublic; stored.status = '预约中';
    localStorage.setItem('campus_market_mock_database_v1', JSON.stringify(db));
    api = new MockCampusMarketApi(); await user('buyer'); const view = await api.getProduct(product.id);
    expect(view.contact).toBe(''); expect(view.contactPublic).toBe(false); expect(view.status).toBe('在售');
  });
  it('旧订单、预约地点和交易履历 API 已停用', async () => {
    await expect(api.listMeetingPoints()).rejects.toMatchObject({ code: 410 });
    await expect(api.listOrders('all')).rejects.toMatchObject({ code: 410 });
    await expect(api.getOwnTradeHistory()).rejects.toMatchObject({ code: 410 });
  });
});
