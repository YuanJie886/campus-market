import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { imagesForSubmit, isUploadRef, slotsFromImages } from '../src/images';
import type { ProductInput } from '../src/model';

function setup() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return { api: new MockApi(storage), storage, reopen: () => new MockApi(storage) };
}
const base: Omit<ProductInput, 'images'> = { title: '演示台灯', description: '自用', price: 30, category: '生活用品', condition: '几乎全新', campus: '西校区', contact: 'wx-seller', contactPublic: false };

describe('演示模式的照片（离线）', () => {
  it('「上传」只记下本机文件路径，返回与后端同形的 upload:<id> 引用和 /v1/images 签名地址；显示时换回本机路径', async () => {
    const { api } = setup();
    await api.login('seller001', 'demo12345');
    const progress = vi.fn();
    const image = await api.upload('wxfile://store_photo_1.jpg', progress);
    expect(isUploadRef(image.ref)).toBe(true);
    expect(image.url).toMatch(new RegExp(`^/v1/images/${image.id}\\?exp=\\d+&sig=demo$`));
    expect(progress).toHaveBeenCalledWith(100);
    expect(api.imageSrc(image.url)).toBe('wxfile://store_photo_1.jpg');
    expect(api.imageSrc('/assets/goods/lamp.png')).toBe('/assets/goods/lamp.png');
  });
  it('商品里存引用；详情返回签名地址；重新打开（本地缓存）后仍能显示；编辑时换回同一个引用', async () => {
    const { api, reopen } = setup();
    await api.login('seller001', 'demo12345');
    const a = await api.upload('wxfile://a.jpg'), b = await api.upload('wxfile://b.jpg');
    const product = await api.publish({ ...base, images: [b.ref, a.ref, '/assets/goods/lamp.png'] });
    expect(product.images[0]).toMatch(/^\/v1\/images\//);
    const again = reopen();
    const detail = await again.detail(product.id);
    expect(detail.images.map((url) => again.imageSrc(url))).toEqual(['wxfile://b.jpg', 'wxfile://a.jpg', '/assets/goods/lamp.png']);
    const refs = imagesForSubmit(slotsFromImages(detail.images, (url) => again.imageRef(url)));
    expect(refs).toEqual([b.ref, a.ref, '/assets/goods/lamp.png']);
    await again.publish({ ...base, images: refs }, product.id);
  });
  it('与后端一致：不能引用别人上传的图片；未登录不能上传', async () => {
    const { api } = setup();
    await expect(api.upload('wxfile://x.jpg')).rejects.toThrow('请先登录');
    await api.login('buyer001', 'demo12345');
    const theirs = await api.upload('wxfile://buyer.jpg');
    await api.logout(); await api.login('seller001', 'demo12345');
    await expect(api.publish({ ...base, images: [theirs.ref] })).rejects.toThrow('只能使用自己上传的图片，请重新上传');
    await expect(api.publish({ ...base, images: ['upload:not-a-uuid'] })).rejects.toThrow('只能使用自己上传的图片');
  });
  it('注销后本人上传的图片不可再显示', async () => {
    const { api } = setup();
    await api.login('seller001', 'demo12345');
    const image = await api.upload('wxfile://mine.jpg');
    await api.deleteAccount({ password: 'demo12345', confirmation: '确认注销' });
    expect(api.imageSrc(image.url)).toBe('');
  });
});
