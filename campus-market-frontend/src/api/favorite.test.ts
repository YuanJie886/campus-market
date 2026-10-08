import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { fullDisclosure } from '../test/inspectionFixtures';

/**
 * 收藏接口幂等性的前端契约测试（0.7C）。
 *
 * <p>改造前 `toggleFavorite()` 让底层 API 自行翻转状态：同一个 PUT 发两次，
 * 第二次会把用户刚加的收藏删掉。现在改为 `setFavorite(productId, desired)`，
 * 由调用方声明期望状态——true 走幂等 PUT，false 走幂等 DELETE。
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

describe('REST 适配层：收藏使用 PUT / DELETE 而非 toggle', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  });

  function restApiWith(fetchImpl: typeof fetch) {
    return new RestCampusMarketApi(new HttpTransport({ fetchImpl }));
  }

  function jsonResponse(active: boolean) {
    return new Response(JSON.stringify({ code: 0, data: { active }, message: 'ok' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  it('desired=true 发出 PUT', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true)) as unknown as typeof fetch;
    const api = restApiWith(fetchImpl);

    await expect(api.setFavorite('p-1', true)).resolves.toBe(true);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/v1/products/p-1/favorite');
    expect(init.method).toBe('PUT');
  });

  it('desired=false 发出 DELETE（而不是再发一次 PUT）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(false)) as unknown as typeof fetch;
    const api = restApiWith(fetchImpl);

    await expect(api.setFavorite('p-1', false)).resolves.toBe(false);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/v1/products/p-1/favorite');
    expect(init.method).toBe('DELETE');
  });

  it('重复 desired=true 每次都发 PUT，语义保持「确保已收藏」', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(true)) as unknown as typeof fetch;
    const api = restApiWith(fetchImpl);

    await api.setFavorite('p-1', true);
    await api.setFavorite('p-1', true);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls.every(([, init]) => init.method === 'PUT')).toBe(true);
  });
});

describe('Mock 适配层：收藏幂等且与 REST 语义一致', () => {
  let api: MockCampusMarketApi;
  let productId: string;

  beforeEach(async () => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
    api = new MockCampusMarketApi();
    await api.register({
      account: `owner-${Math.random().toString(36).slice(2)}`,
      password: 'test-password', nickname: '卖家', campus: '东校区', contact: '13800000000',
    });
    productId = (await api.createProduct({
      title: '收藏幂等测试商品', description: '仅供 Mock 契约测试', price: 10,
      category: '生活用品', condition: '全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '13800000000',
      inspection: fullDisclosure('生活用品'),
    })).id;
    await api.register({
      account: `user-${Math.random().toString(36).slice(2)}`,
      password: 'test-password', nickname: '收藏者', campus: '东校区', contact: '13800000001',
    });
  });

  it('重复 add 保持已收藏，且只有一条记录', async () => {
    await expect(api.setFavorite(productId, true)).resolves.toBe(true);
    expect(await api.listFavorites()).toHaveLength(1);

    await expect(api.setFavorite(productId, true)).resolves.toBe(true);
    await expect(api.setFavorite(productId, true)).resolves.toBe(true);
    expect(await api.listFavorites()).toHaveLength(1);
  });

  it('重复 remove 保持未收藏', async () => {
    await api.setFavorite(productId, true);
    await expect(api.setFavorite(productId, false)).resolves.toBe(false);
    expect(await api.listFavorites()).toHaveLength(0);

    await expect(api.setFavorite(productId, false)).resolves.toBe(false);
    await expect(api.setFavorite(productId, false)).resolves.toBe(false);
    expect(await api.listFavorites()).toHaveLength(0);
  });

  it('连续 add / remove 交替时状态始终等于最后一次期望值', async () => {
    for (const desired of [true, true, false, false, true]) {
      await api.setFavorite(productId, desired);
    }
    expect(await api.listFavorites()).toHaveLength(1);

    await api.setFavorite(productId, false);
    expect(await api.listFavorites()).toHaveLength(0);
  });

  it('不存在的商品返回 404', async () => {
    await expect(api.setFavorite('does-not-exist', true)).rejects.toMatchObject({ code: 404 });
    await expect(api.setFavorite('does-not-exist', false)).rejects.toMatchObject({ code: 404 });
  });
});
