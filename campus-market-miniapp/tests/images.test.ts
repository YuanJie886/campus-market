import { describe, expect, it } from 'vitest';
import {
  addPickedFiles, addReadySlot, IMAGE_FAILED_PRESENT, IMAGE_PENDING, IMAGE_TOO_LARGE, imageRefFromUrl, imagesForSubmit, MAX_IMAGE_BYTES, MAX_IMAGES,
  moveSlot, parseUploadedImage, photosError, removeSlot, resolveImageUrl, slotFailed, slotProgress, slotsFromImages, slotUploaded,
} from '../src/images';
import { validateProduct, type ProductInput } from '../src/model';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const signed = (id: string) => `/v1/images/${id}?exp=1760000000&sig=abc_DEF-123`;

describe('图片地址解析（渲染）', () => {
  it('以 /v1/ 开头的签名地址拼上接口域名（去掉域名结尾的斜杠）', () => {
    expect(resolveImageUrl(signed(ID), 'https://api.campus.example')).toBe(`https://api.campus.example${signed(ID)}`);
    expect(resolveImageUrl(signed(ID), 'https://api.campus.example/')).toBe(`https://api.campus.example${signed(ID)}`);
    expect(resolveImageUrl('/v1/other/thing', 'http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/v1/other/thing');
  });
  it('外部 HTTP(S) 示例图、本地示意插画、本机临时文件原样返回；空值返回空串', () => {
    expect(resolveImageUrl('https://cdn.example/a.png', 'https://api.campus.example')).toBe('https://cdn.example/a.png');
    expect(resolveImageUrl('/assets/goods/lamp.png', 'https://api.campus.example')).toBe('/assets/goods/lamp.png');
    expect(resolveImageUrl('wxfile://tmp_abc.jpg', 'https://api.campus.example')).toBe('wxfile://tmp_abc.jpg');
    expect(resolveImageUrl('', 'https://api.campus.example')).toBe('');
  });
  it('编辑时签名地址（相对或已拼本接口域名）换回 upload:<id>；其他域名、外部图、引用原样', () => {
    expect(imageRefFromUrl(signed(ID))).toBe(`upload:${ID}`);
    expect(imageRefFromUrl(`https://api.campus.example${signed(ID)}`, 'https://api.campus.example')).toBe(`upload:${ID}`);
    expect(imageRefFromUrl(`https://evil.example${signed(ID)}`, 'https://api.campus.example')).toBe(`https://evil.example${signed(ID)}`);
    expect(imageRefFromUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(imageRefFromUrl(`upload:${ID}`)).toBe(`upload:${ID}`);
    expect(imageRefFromUrl('/v1/images/not-a-uuid?exp=1&sig=x')).toBe('/v1/images/not-a-uuid?exp=1&sig=x');
  });
});

describe('上传响应校验', () => {
  it('接受 { id, ref: upload:<id>, url: /v1/images/…, width, height }', () => {
    expect(parseUploadedImage({ id: ID, ref: `upload:${ID}`, url: signed(ID), width: 1600, height: 1200 }))
      .toEqual({ id: ID, ref: `upload:${ID}`, url: signed(ID), width: 1600, height: 1200 });
  });
  it('引用格式不对或地址不是签名地址 / HTTP(S) 时视为响应异常', () => {
    expect(() => parseUploadedImage({ ref: 'upload:../../etc', url: signed(ID) })).toThrow('服务响应异常');
    expect(() => parseUploadedImage({ ref: `upload:${ID}`, url: 'javascript:alert(1)' })).toThrow('服务响应异常');
    expect(() => parseUploadedImage(null)).toThrow('服务响应异常');
  });
});

describe('发布表单里的照片', () => {
  it('最多 9 张：超出的部分不加入；超过 5 MB 的直接标记失败、不进入上传队列', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({ path: `tmp/${i}.jpg`, size: i === 1 ? MAX_IMAGE_BYTES + 1 : 1000 }));
    const { slots, queued } = addPickedFiles([], files);
    expect(slots).toHaveLength(MAX_IMAGES);
    expect(slots[1]).toMatchObject({ status: 'failed', error: IMAGE_TOO_LARGE });
    expect(queued).toHaveLength(MAX_IMAGES - 1);
    expect(queued.every((slot) => slot.status === 'uploading' && slot.filePath.startsWith('tmp/'))).toBe(true);
  });
  it('每张单独记录进度、成功引用与失败原因；还有上传中 / 失败时不能提交', () => {
    let { slots } = addPickedFiles([], [{ path: 'tmp/a.jpg', size: 10 }, { path: 'tmp/b.jpg', size: 10 }]);
    const [a, b] = slots;
    slots = slotProgress(slots, a.key, 42.6);
    expect(slots[0].progress).toBe(43);
    expect(photosError(slots)).toBe(IMAGE_PENDING);
    slots = slotUploaded(slots, a.key, { id: ID, ref: `upload:${ID}`, url: signed(ID), width: 1, height: 1 });
    slots = slotFailed(slots, b.key, new Error('只支持 JPEG 或 PNG 图片'));
    expect(slots[1]).toMatchObject({ status: 'failed', error: '只支持 JPEG 或 PNG 图片' });
    expect(photosError(slots)).toBe(IMAGE_FAILED_PRESENT);
    slots = removeSlot(slots, b.key);
    expect(photosError(slots)).toBeNull();
    expect(imagesForSubmit(slots)).toEqual([`upload:${ID}`]);
  });
  it('调整顺序决定提交的 images 顺序（第一张为主图）；越界移动不变', () => {
    let slots = slotsFromImages([signed(ID), 'https://cdn.example/a.png', signed(ID2)]);
    expect(imagesForSubmit(slots)).toEqual([`upload:${ID}`, 'https://cdn.example/a.png', `upload:${ID2}`]);
    slots = moveSlot(slots, slots[2].key, -1);
    slots = moveSlot(slots, slots[1].key, -1);
    expect(imagesForSubmit(slots)).toEqual([`upload:${ID2}`, `upload:${ID}`, 'https://cdn.example/a.png']);
    expect(moveSlot(slots, slots[0].key, -1)).toBe(slots);
    expect(moveSlot(slots, slots[2].key, 1)).toBe(slots);
  });
  it('编辑载入：显示用响应里的签名地址，提交用引用；示意图直接加入且不重复', () => {
    const slots = slotsFromImages([signed(ID)]);
    expect(slots[0]).toMatchObject({ preview: signed(ID), ref: `upload:${ID}`, status: 'done' });
    const withSample = addReadySlot(addReadySlot(slots, '/assets/goods/lamp.png'), '/assets/goods/lamp.png');
    expect(imagesForSubmit(withSample)).toEqual([`upload:${ID}`, '/assets/goods/lamp.png']);
  });
});

describe('商品校验的图片规则', () => {
  const product: ProductInput = { title: '台灯', description: '自用', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区', images: [`upload:${ID}`], contact: 'wx', contactPublic: false };
  it('1–9 张（与后端上限一致）', () => {
    expect(validateProduct({ ...product, images: Array.from({ length: 9 }, () => `upload:${ID}`) })).toBeNull();
    expect(validateProduct({ ...product, images: Array.from({ length: 10 }, () => `upload:${ID}`) })).toBe('请选择 1–9 张商品图片');
    expect(validateProduct({ ...product, images: [] })).toBe('请选择 1–9 张商品图片');
  });
  it('不能把 1 小时就过期的签名地址当作图片提交', () => {
    expect(validateProduct({ ...product, images: [signed(ID)] })).toBe('图片地址无效，请重新上传');
  });
});
