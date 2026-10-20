import { describe, expect, it, vi } from 'vitest';
import { Transport, type RequestPort, type Response, type UploadPort } from '../src/api/transport';
import { RestApi } from '../src/api/rest';
import { IMAGE_RATE_LIMITED, IMAGE_TOO_LARGE, imagesForSubmit, slotsFromImages, slotUploaded, addPickedFiles } from '../src/images';
import type { ProductInput, Session } from '../src/model';

const ORIGIN = 'https://api.campus.example';
const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const ID2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const signed = (id: string) => `/v1/images/${id}?exp=1760000000&sig=abc`;
const session = (token: string): Session => ({ accessToken: token, expiresAtIso: '2030-01-01T00:00:00Z', user: { id: 'me', nickname: '同学', campus: '东校区' } });
const ok = (data: unknown, cookies?: string[]): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' }, cookies });
const uploaded = { id: ID, ref: `upload:${ID}`, url: signed(ID), width: 1600, height: 1200 };
/** Taro.uploadFile 的响应体是字符串。 */
const text = (statusCode: number, body: unknown) => ({ statusCode, data: typeof body === 'string' ? body : JSON.stringify(body) });
const SAFETY = '内容可能包含违规信息，请修改后再提交';

function setup(upload: UploadPort, request: RequestPort = async (input) => input.url.endsWith('/v1/auth/refresh') ? ok(session('token-new'), ['cm_refresh=rotated']) : ok({})) {
  const expired = vi.fn();
  const requestPort = vi.fn<RequestPort>(request), uploadPort = vi.fn<UploadPort>(upload);
  const transport = new Transport(requestPort, `${ORIGIN}/`, true, expired, uploadPort);
  transport.setSession(session('token-old'));
  return { transport, api: new RestApi(transport), requestPort, uploadPort, expired };
}

describe('上传图片：请求形状', () => {
  it('POST 到 ${apiOrigin}/v1/images，multipart 字段名 file，带内存里的 Bearer 令牌、不带 Cookie；返回 ref 与签名地址', async () => {
    const { api, uploadPort } = setup(async () => text(200, { code: 0, data: uploaded, message: 'ok' }));
    const result = await api.upload('wxfile://tmp_photo.jpg');
    expect(result).toEqual(uploaded);
    expect(uploadPort).toHaveBeenCalledTimes(1);
    const [input] = uploadPort.mock.calls[0];
    expect(input).toMatchObject({ url: `${ORIGIN}/v1/images`, filePath: 'wxfile://tmp_photo.jpg', name: 'file', header: { Authorization: 'Bearer token-old' } });
    expect(Object.keys(input.header)).toEqual(['Authorization']);
  });
  it('把上传进度转给调用方', async () => {
    const progress = vi.fn();
    const { api } = setup(async (_input, onProgress) => { onProgress?.(30); onProgress?.(100); return text(200, { code: 0, data: uploaded, message: 'ok' }); });
    await api.upload('tmp/a.jpg', progress);
    expect(progress.mock.calls.map(([p]) => p)).toEqual([30, 100]);
  });
});

describe('上传图片：401 只刷新一次再重试', () => {
  it('令牌过期：刷新一次，用新令牌重试一次并成功', async () => {
    const { api, uploadPort, requestPort, expired } = setup(async (input) => input.header.Authorization === 'Bearer token-new'
      ? text(200, { code: 0, data: uploaded, message: 'ok' }) : text(401, { code: 401, message: '请先登录' }));
    expect(await api.upload('tmp/a.jpg')).toEqual(uploaded);
    expect(uploadPort).toHaveBeenCalledTimes(2);
    expect(uploadPort.mock.calls.map(([input]) => input.header.Authorization)).toEqual(['Bearer token-old', 'Bearer token-new']);
    expect(requestPort.mock.calls.filter(([input]) => input.url === `${ORIGIN}/v1/auth/refresh`)).toHaveLength(1);
    expect(expired).not.toHaveBeenCalled();
  });
  it('重试后仍 401：不再刷新第二次，结束会话并通知过期', async () => {
    const { api, transport, uploadPort, requestPort, expired } = setup(async () => text(401, { code: 401, message: '请先登录' }));
    await expect(api.upload('tmp/a.jpg')).rejects.toMatchObject({ code: 401 });
    expect(uploadPort).toHaveBeenCalledTimes(2);
    expect(requestPort.mock.calls.filter(([input]) => input.url.endsWith('/v1/auth/refresh'))).toHaveLength(1);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(transport.authorization).toBe('');
  });
  it('刷新本身 401：会话结束，不重复上传第三次', async () => {
    const { api, uploadPort, expired } = setup(async () => text(401, { code: 401, message: '请先登录' }),
      async () => ({ statusCode: 401, data: { code: 401, message: '登录已过期' } }));
    await expect(api.upload('tmp/a.jpg')).rejects.toMatchObject({ code: 401 });
    expect(uploadPort).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it('两张同时 401 只刷新一次（与普通请求共用刷新）', async () => {
    const { api, requestPort } = setup(async (input) => {
      await new Promise((r) => setTimeout(r, 5));
      return input.header.Authorization === 'Bearer token-new' ? text(200, { code: 0, data: uploaded, message: 'ok' }) : text(401, { code: 401, message: '请先登录' });
    });
    await Promise.all([api.upload('tmp/a.jpg'), api.upload('tmp/b.jpg')]);
    expect(requestPort.mock.calls.filter(([input]) => input.url.endsWith('/v1/auth/refresh'))).toHaveLength(1);
  });
});

describe('上传图片：错误文案', () => {
  it('413（含 nginx 返回的 HTML）→「图片不能超过 5 MB」', async () => {
    await expect(setup(async () => text(413, '<html><body>413 Request Entity Too Large</body></html>')).api.upload('a')).rejects.toThrow(IMAGE_TOO_LARGE);
    await expect(setup(async () => text(413, { code: 413, message: '图片不能超过 5 MB' })).api.upload('a')).rejects.toMatchObject({ message: IMAGE_TOO_LARGE, code: 413 });
  });
  it('400 原样显示后端文案', async () => {
    for (const message of ['只支持 JPEG 或 PNG 图片', '图片尺寸不能超过 6000×6000', '图片无法识别']) {
      await expect(setup(async () => text(400, { code: 400, message })).api.upload('a')).rejects.toMatchObject({ message, code: 400 });
    }
  });
  it('429 → 上传限流提示', async () => {
    await expect(setup(async () => text(429, { code: 429, message: '请求过于频繁，请稍后再试' })).api.upload('a')).rejects.toMatchObject({ message: IMAGE_RATE_LIMITED, code: 429 });
  });
  it('网络失败、2xx 但响应不是 JSON / 缺少 ref 都给出明确错误', async () => {
    await expect(setup(async () => { throw new Error('offline'); }).api.upload('a')).rejects.toThrow('网络连接失败');
    await expect(setup(async () => text(200, 'not json')).api.upload('a')).rejects.toThrow('服务响应异常');
    await expect(setup(async () => text(200, { code: 0, data: { url: signed(ID) }, message: 'ok' })).api.upload('a')).rejects.toThrow('服务响应异常');
  });
});

describe('REST 渲染与提交', () => {
  it('imageSrc：/v1/ 签名地址拼接口域名；外部图原样', () => {
    const { api } = setup(async () => text(200, {}));
    expect(api.imageSrc(signed(ID))).toBe(`${ORIGIN}${signed(ID)}`);
    expect(api.imageSrc('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
  });
  it('新发布：表单里上传得到的引用按顺序放进 images 发给 POST /v1/products（不是本机路径或签名地址）', async () => {
    const { api, requestPort } = setup(async () => text(200, { code: 0, data: uploaded, message: 'ok' }), async (input) => ok({ id: 'p1', ...(input.data as object) }));
    let { slots, queued } = addPickedFiles([], [{ path: 'tmp/a.jpg', size: 100 }, { path: 'tmp/b.jpg', size: 100 }]);
    slots = slotUploaded(slots, queued[0].key, await api.upload(queued[0].filePath));
    slots = slotUploaded(slots, queued[1].key, { ...uploaded, id: ID2, ref: `upload:${ID2}`, url: signed(ID2) });
    const input: ProductInput = { title: '台灯', description: '自用', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区', images: imagesForSubmit(slots), contact: 'wx', contactPublic: false };
    await api.publish(input);
    const call = requestPort.mock.calls.find(([request]) => request.url === `${ORIGIN}/v1/products`)![0];
    expect(call.method).toBe('POST');
    expect((call.data as ProductInput).images).toEqual([`upload:${ID}`, `upload:${ID2}`]);
  });
  it('编辑：响应里的签名地址换回 upload:<id>，外部示例图保留，PATCH 的 images 里没有签名地址', async () => {
    const { api, requestPort } = setup(async () => text(200, {}), async (input) => ok({ id: 'p1', images: [signed(ID), 'https://cdn.example/a.png'] }));
    const product = await api.detail('p1');
    const slots = slotsFromImages(product.images, (url) => api.imageRef(url));
    await api.publish({ title: '台灯', description: '自用', price: 30, category: '生活用品', condition: '几乎全新', campus: '东校区', images: imagesForSubmit(slots), contact: 'wx', contactPublic: false }, 'p1');
    const patch = requestPort.mock.calls.find(([request]) => request.method === 'PATCH')![0];
    expect(patch.url).toBe(`${ORIGIN}/v1/products/p1`);
    expect((patch.data as ProductInput).images).toEqual([`upload:${ID}`, 'https://cdn.example/a.png']);
  });
});

describe('内容安全 400 文案原样显示', () => {
  it('发布商品、修改昵称、注册被拦截时，错误信息就是后端的统一提示', async () => {
    const blocked: RequestPort = async (input) => input.url.endsWith('/v1/auth/refresh') ? ok(session('t')) : { statusCode: 400, data: { code: 400, message: SAFETY } };
    const { api } = setup(async () => text(200, {}), blocked);
    const input: ProductInput = { title: '代 - 考', description: 'x', price: 1, category: '其他', condition: '全新', campus: '东校区', images: [`upload:${ID}`], contact: 'wx', contactPublic: false };
    await expect(api.publish(input)).rejects.toThrow(SAFETY);
    await expect(api.publish(input, 'p1')).rejects.toThrow(SAFETY);
    await expect(api.updateProfile({ nickname: 'x', campus: '东校区', contact: '' })).rejects.toThrow(SAFETY);
    await expect(api.register({ account: 'abc12345', password: 'password1', nickname: 'x', campus: '东校区', contact: '' })).rejects.toThrow(SAFETY);
  });
});
