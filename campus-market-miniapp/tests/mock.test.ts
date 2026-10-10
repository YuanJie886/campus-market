import { describe, it, expect } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { validateProduct, type ProductInput } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return { api: new MockApi(storage), storage };
}
const product: ProductInput = { title: '测试台灯', description: '自用，无故障', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区', images: ['/assets/goods/lamp.png'], contact: 'seller-private', contactPublic: false };

describe('小程序演示业务', () => {
  it('访客不能浏览，登录后跨校商品和用户均不可访问', async () => {
    const { api } = setup();
    await expect(api.list({ page: 1, pageSize: 12, sort: 'latest' })).rejects.toThrow('请先登录');
    await api.login('buyer001', 'demo12345');
    const page = await api.list({ page: 1, pageSize: 20, sort: 'latest' });
    expect(page.items.some((p) => p.id === 'other-school-product')).toBe(false);
    await expect(api.detail('other-school-product')).rejects.toThrow('不存在');
    await expect(api.publicUser('other-school')).rejects.toThrow('不存在');
  });
  it('联系方式按商品授权，重复申请不重复创建，卖家审批才能查看', async () => {
    const { api, storage } = setup();
    await api.login('buyer001', 'demo12345');
    expect((await api.detail('demo-product-0')).contact).toBe('');
    const request = await api.requestContact('demo-product-0');
    expect((await api.requestContact('demo-product-0')).id).toBe(request.id);
    await expect(api.decide(request.id, 'APPROVED')).rejects.toThrow('不存在');
    await api.login('seller001', 'demo12345');
    expect(await api.contacts()).toHaveLength(1);
    await api.decide(request.id, 'APPROVED');
    await api.login('buyer001', 'demo12345');
    expect((await api.detail('demo-product-0')).contact).toBeTruthy();
    expect((await api.detail('demo-product-1')).contact).toBe('');
    expect((await api.detail('demo-product-0')).status).toBe('在售');
    const restored = new MockApi(storage);
    expect((await restored.restore())?.id).toBe('demo-buyer');
    expect((await restored.detail('demo-product-0')).contact).toBeTruthy();
  });
  it('公开联系方式可直接查看，拒绝不授权且不能再次更改结论', async () => {
    const { api } = setup(); await api.login('buyer001', 'demo12345');
    expect((await api.detail('demo-product-2')).contact).toBeTruthy();
    const r = await api.requestContact('demo-product-1');
    await api.login('seller001', 'demo12345'); await api.decide(r.id, 'REJECTED');
    await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow('已处理');
    await api.login('buyer001', 'demo12345');
    expect((await api.detail('demo-product-1')).contact).toBe('');
    expect((await api.requestContact('demo-product-1')).status).toBe('REJECTED');
  });
  it('收藏按用户隔离；发布、编辑、下架、售出和重新上架持久化', async () => {
    const { api, storage } = setup(); await api.login('buyer001', 'demo12345');
    await api.favorite('demo-product-0', true); await api.favorite('demo-product-0', true);
    expect(await api.favorites()).toEqual(['demo-product-0']);
    const created = await api.publish(product);
    await api.publish({ ...product, price: 25, title: '修改后的台灯' }, created.id);
    await api.status(created.id, '已下架');
    expect((await api.myListings())[0]).toMatchObject({ price: 25, status: '已下架' });
    await api.login('seller001', 'demo12345');
    expect(await api.favorites()).toEqual([]);
    await expect(api.detail(created.id)).rejects.toThrow('已下架');
    await api.login('buyer001', 'demo12345'); await api.status(created.id, '在售');
    await api.status(created.id, '已售出');
    await api.login('seller001', 'demo12345');
    await expect(api.requestContact(created.id)).rejects.toThrow('不可申请');
    await expect(api.status(created.id, '在售')).rejects.toThrow('自己的');
    const restored = new MockApi(storage); expect((await restored.detail(created.id)).status).toBe('已售出');
  });
  it('关键词、价格、分类和分页一起作用，价格非法或跨校发布被拒绝', async () => {
    const { api } = setup(); await api.login('buyer001', 'demo12345');
    const page = await api.list({ page: 1, pageSize: 1, sort: 'priceAsc', category: '数码电子', minPrice: 0, maxPrice: 100 });
    expect(page.total).toBe(1); expect(page.items[0].price).toBe(80);
    expect((await api.list({ page: 1, pageSize: 12, sort: 'latest', keyword: '高等数学' })).items).toHaveLength(1);
    expect(validateProduct({ ...product, price: Number.NaN })).toContain('价格');
    await expect(api.publish({ ...product, campus: '南校区' })).rejects.toThrow('本校');
    await expect(api.publish({ ...product, images: [] })).rejects.toThrow('图片');
  });
});
