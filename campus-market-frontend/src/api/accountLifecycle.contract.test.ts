// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi, imageRefOf } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError } from './errors';
import { authTokenStore } from '../utils/authTokenStore';
import { CONTENT_BLOCKED_MESSAGE, PASSWORD_RESET_FAILURE, type ProductCreateInput } from './contracts';

/**
 * 阶段 3（docs/account-lifecycle.md）与阶段 4（docs/images-and-content-safety.md）的前端契约：
 *   · REST：用假的 fetch 核对路径、方法、请求体字段逐字一致（后端 JsonFieldPolicy 拒绝未知字段），multipart 字段名为 file、
 *     带内存里的 Bearer 令牌、401 时刷新一次后重试；错误原样传到调用方；
 *   · Mock：与后端 AccountService / ImageService / ContentSafetyService 相同的规则与原话。
 */

const DB = 'campus_market_mock_database_v1';
let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
const ids = new Map<string, string>();
const PASSWORD = 'test-password';
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const session = await api.register({ account, password: PASSWORD, nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  ids.set(label, session.user.id);
  return session.user.id;
}
const as = (label: string, password = PASSWORD) => api.login({ account: accounts.get(label)!, password });
const listing = (title: string, extra: Partial<ProductCreateInput> = {}): ProductCreateInput => ({
  title, description: '阶段三四契约测试商品', price: 20, category: '其他', condition: '全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: 'wechat:lifecycle-seller', ...extra,
});
async function failure(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(() => null).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}
function makeStaff(userId: string) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.staffMembers.push({ userId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
}
/** 最小的 PNG 文件头（签名 + IHDR 宽高），足够按文件头判断类型与尺寸 */
function png(width = 2, height = 3) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}
const pngFile = (name = 'photo.png') => new File([png()], name, { type: 'image/png' });

beforeEach(async () => {
  window.localStorage.clear();
  api = new MockCampusMarketApi();
  await user('seller');
  await user('buyer');
});
afterEach(() => { vi.useRealTimers(); authTokenStore.clearAccessToken() });

// ---------------------------------------------------------------------------------------------
// REST：路径、方法、请求体与认证
// ---------------------------------------------------------------------------------------------
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data, message: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ code: status, data: null, message }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
type Call = { url: string; method: string; headers: Headers; body: BodyInit | null | undefined };
function rest(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body };
    calls.push(call);
    return handler(call);
  });
  return { calls, api: new RestCampusMarketApi(new HttpTransport({ fetchImpl: fetchImpl as unknown as typeof fetch })) };
}
const seedToken = (token = 'token-1') => authTokenStore.setAccessToken(token, new Date(Date.now() + 900_000).toISOString());

describe('REST：账号生命周期的请求与后端路由逐字一致', () => {
  it('修改密码：POST /v1/auth/password，请求体只有 currentPassword / newPassword，带内存里的 Bearer 令牌；返回其他会话数', async () => {
    seedToken();
    const { calls, api: http } = rest(() => ok({ changed: true, otherSessionsEnded: 2 }));
    const result = await http.changePassword({ currentPassword: 'old-pass-1', newPassword: 'new-pass-12' });
    expect(result).toEqual({ changed: true, otherSessionsEnded: 2 });
    expect([calls[0].method, calls[0].url]).toEqual(['POST', '/v1/auth/password']);
    expect(JSON.parse(String(calls[0].body))).toEqual({ currentPassword: 'old-pass-1', newPassword: 'new-pass-12' });
    expect(calls[0].headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('修改密码的 400 / 429 原样交给调用方（含 Retry-After），不自动重试', async () => {
    seedToken();
    const bad = rest(() => fail(400, '当前密码不正确'));
    expect(await failure(bad.api.changePassword({ currentPassword: 'x', newPassword: 'new-pass-12' }))).toMatchObject({ code: 400, message: '当前密码不正确' });
    const limited = rest(() => fail(429, '请求过于频繁，请稍后再试', { 'Retry-After': '120' }));
    const e = await failure(limited.api.changePassword({ currentPassword: 'x', newPassword: 'new-pass-12' }));
    expect([e.code, e.message, e.retryAfterSeconds]).toEqual([429, '请求过于频繁，请稍后再试', 120]);
    expect(limited.calls).toHaveLength(1);
  });

  it('凭重置码找回：POST /v1/auth/password-reset，请求体只有 account / code / newPassword；重置码按输入原样提交（大小写与短横线由服务端处理）', async () => {
    const { calls, api: http } = rest(() => ok({ reset: true }));
    await http.resetPasswordWithCode({ account: 'stu-1', code: 'abcd efgh-jkmn', newPassword: 'new-pass-12' });
    expect([calls[0].method, calls[0].url]).toEqual(['POST', '/v1/auth/password-reset']);
    expect(JSON.parse(String(calls[0].body))).toEqual({ account: 'stu-1', code: 'abcd efgh-jkmn', newPassword: 'new-pass-12' });
    const uniform = rest(() => fail(400, PASSWORD_RESET_FAILURE));
    expect((await failure(uniform.api.resetPasswordWithCode({ account: 'a', code: 'b', newPassword: 'new-pass-12' }))).message).toBe(PASSWORD_RESET_FAILURE);
  });

  it('注销：POST /v1/auth/me/deletion，请求体只有 password / confirmation；成功后丢弃内存里的访问令牌；409 原样', async () => {
    seedToken();
    const { calls, api: http } = rest(() => ok({ deleted: true, productsTakenDown: 1, requestsClosed: 0, membershipsEnded: 0 }));
    await http.deleteAccount({ password: 'pw', confirmation: '确认注销' });
    expect([calls[0].method, calls[0].url]).toEqual(['POST', '/v1/auth/me/deletion']);
    expect(JSON.parse(String(calls[0].body))).toEqual({ password: 'pw', confirmation: '确认注销' });
    expect(authTokenStore.getAccessToken()).toBeNull();
    seedToken();
    const owner = rest(() => fail(409, '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销'));
    expect(await failure(owner.api.deleteAccount({ password: 'pw', confirmation: '确认注销' })))
      .toMatchObject({ code: 409, message: '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销' });
    expect(authTokenStore.getAccessToken()).toBe('token-1');
  });
});

describe('REST：图片上传', () => {
  it('POST /v1/images 是 multipart，字段名 file，不写 JSON 的 Content-Type，带 Bearer 令牌；返回 ref 与签名地址', async () => {
    seedToken();
    const uploaded = { id: '11111111-2222-3333-4444-555555555555', ref: 'upload:11111111-2222-3333-4444-555555555555', url: '/v1/images/11111111-2222-3333-4444-555555555555?exp=1&sig=s', width: 2, height: 3 };
    const { calls, api: http } = rest(() => ok(uploaded));
    const file = pngFile();
    expect(await http.uploadImage(file)).toEqual(uploaded);
    expect([calls[0].method, calls[0].url]).toEqual(['POST', '/v1/images']);
    expect(calls[0].body).toBeInstanceOf(FormData);
    const sent = (calls[0].body as FormData).get('file') as File;
    expect(sent.name).toBe('photo.png');
    expect(sent.size).toBe(file.size);
    expect(calls[0].headers.get('Content-Type')).toBeNull();
    expect(calls[0].headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('访问令牌过期：401 后单飞刷新一次，用新令牌重发同一个文件', async () => {
    seedToken('expired');
    const { calls, api: http } = rest((call) => {
      if (call.url.endsWith('/v1/auth/refresh')) return ok({ accessToken: 'fresh', expiresAtIso: new Date(Date.now() + 900_000).toISOString() });
      return call.headers.get('Authorization') === 'Bearer fresh' ? ok({ id: 'x', ref: 'upload:x', url: '/v1/images/x', width: 1, height: 1 }) : fail(401, '请先登录');
    });
    await http.uploadImage(pngFile());
    expect(calls.map((c) => c.url)).toEqual(['/v1/images', '/v1/auth/refresh', '/v1/images']);
    expect(((calls[2].body as FormData).get('file') as File).name).toBe('photo.png');
  });

  it('413 / 400 / 429 原样交给调用方', async () => {
    seedToken();
    for (const [status, message] of [[413, '图片不能超过 5 MB'], [400, '只支持 JPEG 或 PNG 图片'], [429, '请求过于频繁，请稍后再试']] as const) {
      const { api: http } = rest(() => fail(status, message));
      expect(await failure(http.uploadImage(pngFile()))).toMatchObject({ code: status, message });
    }
  });

  it('编辑商品时，响应里的签名地址（相对或已补全基址）还原成 upload:<id> 引用；外部示例图原样提交', async () => {
    seedToken();
    const id = 'abcdefab-1234-5678-9abc-def012345678';
    expect(imageRefOf(`/v1/images/${id}?exp=1&sig=abc`)).toBe(`upload:${id}`);
    expect(imageRefOf(`https://api.example.edu/v1/images/${id}?exp=1&sig=abc`)).toBe(`upload:${id}`);
    expect(imageRefOf('https://picsum.photos/seed/x/600/600')).toBe('https://picsum.photos/seed/x/600/600');
    const { calls, api: http } = rest(() => ok({ id: 'p1' }));
    await http.updateProduct('p1', { images: [`/v1/images/${id}?exp=9&sig=zz`, 'https://example.invalid/a.png'] });
    expect(JSON.parse(String(calls[0].body)).images).toEqual([`upload:${id}`, 'https://example.invalid/a.png']);
    await http.createProduct(listing('上传图片商品', { images: [`upload:${id}`] }));
    expect(JSON.parse(String(calls[1].body)).images).toEqual([`upload:${id}`]);
  });
});

// ---------------------------------------------------------------------------------------------
// Mock：与后端相同的规则
// ---------------------------------------------------------------------------------------------
describe('Mock：修改密码（AccountService.changePassword）', () => {
  it('核对当前密码、长度 8～72、新旧不能相同、未知字段 400；成功后旧密码不能登录、新密码可以', async () => {
    await as('seller');
    expect((await failure(api.changePassword({ currentPassword: 'wrong-password', newPassword: 'new-pass-12' }))).message).toBe('当前密码不正确');
    expect((await failure(api.changePassword({ currentPassword: PASSWORD, newPassword: 'short' }))).message).toBe('newPassword 长度无效');
    expect((await failure(api.changePassword({ currentPassword: PASSWORD, newPassword: 'x'.repeat(73) }))).message).toBe('newPassword 长度无效');
    expect((await failure(api.changePassword({ currentPassword: PASSWORD, newPassword: PASSWORD }))).message).toBe('新密码不能与当前密码相同');
    expect((await failure(api.changePassword({ currentPassword: PASSWORD, newPassword: 'new-pass-12', extra: 1 } as never))).code).toBe(400);
    expect(await api.changePassword({ currentPassword: PASSWORD, newPassword: 'new-pass-12' })).toEqual({ changed: true, otherSessionsEnded: 0 });
    // 当前会话保留
    expect((await api.getCurrentUser())?.id).toBe(ids.get('seller'));
    expect((await failure(as('seller'))).code).toBe(401);
    expect((await as('seller', 'new-pass-12')).user.id).toBe(ids.get('seller'));
  });

  it('按用户每小时 10 次，第 11 次 429（带 Retry-After），不再核对密码', async () => {
    await as('seller');
    for (let i = 0; i < 10; i++) await failure(api.changePassword({ currentPassword: 'wrong-password', newPassword: 'new-pass-12' }));
    const limited = await failure(api.changePassword({ currentPassword: PASSWORD, newPassword: 'new-pass-12' }));
    expect([limited.code, limited.message]).toEqual([429, '请求过于频繁，请稍后再试']);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('Mock：凭重置码找回（AccountService.resetWithCode）', () => {
  it('演示签发 XXXX-XXXX-XXXX；大小写与短横线 / 空格无关；只能用一次；成功后结束会话、新密码可登录', async () => {
    await as('seller');
    const issued = (await api.demoIssueResetCode(accounts.get('seller')!))!;
    expect(issued.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const typed = issued.code.toLowerCase().replace(/-/g, ' ');
    expect(await api.resetPasswordWithCode({ account: accounts.get('seller')!, code: typed, newPassword: 'reset-pass-12' })).toEqual({ reset: true });
    expect(await api.getCurrentUser()).toBeNull();
    expect((await as('seller', 'reset-pass-12')).user.id).toBe(ids.get('seller'));
    // 用过的码不能再用：同一句话
    expect((await failure(api.resetPasswordWithCode({ account: accounts.get('seller')!, code: issued.code, newPassword: 'again-pass-12' }))).message).toBe(PASSWORD_RESET_FAILURE);
  });

  it('错误的码、不存在的账号、没有签发过：一律「账号或重置码无效或已过期」，不透露账号是否存在', async () => {
    const issued = (await api.demoIssueResetCode(accounts.get('buyer')!))!;
    const messages = [
      await failure(api.resetPasswordWithCode({ account: accounts.get('buyer')!, code: 'AAAA-AAAA-AAAA', newPassword: 'reset-pass-12' })),
      await failure(api.resetPasswordWithCode({ account: 'nobody-here', code: issued.code, newPassword: 'reset-pass-12' })),
      await failure(api.resetPasswordWithCode({ account: accounts.get('seller')!, code: issued.code, newPassword: 'reset-pass-12' })),
    ].map((e) => [e.code, e.message]);
    expect(messages).toEqual([[400, PASSWORD_RESET_FAILURE], [400, PASSWORD_RESET_FAILURE], [400, PASSWORD_RESET_FAILURE]]);
  });

  it('5 次错误后作废（正确的码也不行）；签发新码让旧码作废；30 分钟后过期', async () => {
    const account = accounts.get('buyer')!;
    const first = (await api.demoIssueResetCode(account))!;
    for (let i = 0; i < 5; i++) await failure(api.resetPasswordWithCode({ account, code: 'AAAA-AAAA-AAAA', newPassword: 'reset-pass-12' }));
    expect((await failure(api.resetPasswordWithCode({ account, code: first.code, newPassword: 'reset-pass-12' }))).message).toBe(PASSWORD_RESET_FAILURE);
    const second = (await api.demoIssueResetCode(account))!;
    const third = (await api.demoIssueResetCode(account))!;
    expect((await failure(api.resetPasswordWithCode({ account, code: second.code, newPassword: 'reset-pass-12' }))).message).toBe(PASSWORD_RESET_FAILURE);
    vi.useFakeTimers({ now: Date.now() + 31 * 60_000, toFake: ['Date'] });
    expect((await failure(api.resetPasswordWithCode({ account, code: third.code, newPassword: 'reset-pass-12' }))).message).toBe(PASSWORD_RESET_FAILURE);
  });

  it('按账号每小时 10 次（成功与失败都计数），第 11 次 429；新密码长度与未知字段先 400', async () => {
    const account = accounts.get('buyer')!;
    expect((await failure(api.resetPasswordWithCode({ account, code: 'x', newPassword: 'short' }))).message).toBe('newPassword 长度无效');
    expect((await failure(api.resetPasswordWithCode({ account, code: 'x', newPassword: 'reset-pass-12', note: 'x' } as never))).code).toBe(400);
    for (let i = 0; i < 10; i++) await failure(api.resetPasswordWithCode({ account, code: 'AAAA-AAAA-AAAA', newPassword: 'reset-pass-12' }));
    expect((await failure(api.resetPasswordWithCode({ account, code: 'AAAA-AAAA-AAAA', newPassword: 'reset-pass-12' }))).code).toBe(429);
  });
});

describe('Mock：注销（AccountService.deleteAccount）', () => {
  it('确认语与密码都要对；仍是工作人员或在用圈子的所有者时 409 原话', async () => {
    await as('seller');
    expect((await failure(api.deleteAccount({ password: PASSWORD, confirmation: '注销' }))).message).toBe('请输入「确认注销」确认注销');
    expect((await failure(api.deleteAccount({ password: 'wrong', confirmation: '确认注销' }))).message).toBe('密码不正确');
    const circle = await api.createCircle({ type: 'CLUB', name: '注销测试社团' });
    const owner = await failure(api.deleteAccount({ password: PASSWORD, confirmation: '确认注销' }));
    expect([owner.code, owner.message]).toEqual([409, '你还是在用圈子的所有者，请先移交所有者或归档圈子后再注销']);
    await api.archiveCircle(circle.id);
    makeStaff(ids.get('seller')!);
    await as('seller');
    const staff = await failure(api.deleteAccount({ password: PASSWORD, confirmation: '确认注销' }));
    expect([staff.code, staff.message]).toEqual([409, '你仍有后台工作人员权限，请先请学校管理员停用后再注销']);
    expect((await api.getCurrentUser())?.nickname).toBe('seller');
  });

  it('下架在售商品、清除联系方式、联系申请收尾、退出圈子、图片删除、资料匿名化、会话结束；原账号名可以重新注册', async () => {
    // 卖家：一件在售商品（带上传图片），收到一条待处理申请与一条已同意的申请；买家：发出一条待处理申请
    await as('seller');
    const image = await api.uploadImage(pngFile());
    const sold = await api.createProduct(listing('卖家的商品一', { images: [image.ref] }));
    const other = await api.createProduct(listing('卖家的商品二'));
    const open = await api.createProduct(listing('公开联系方式的商品', { contactPublic: true }));
    await as('buyer');
    await api.requestContact(sold.id);
    const approved = await api.requestContact(other.id);
    await as('seller');
    await api.decideContactRequest(approved.id, 'APPROVED');
    await user('third');
    const circle = await api.createCircle({ type: 'CLUB', name: '第三人的社团' });
    const invite = await api.createCircleInvite(circle.id);
    await as('seller');
    await api.redeemCircleInvite(invite.token);
    const sellerAccount = accounts.get('seller')!;

    const result = await api.deleteAccount({ password: PASSWORD, confirmation: '确认注销' });
    expect(result).toEqual({ deleted: true, productsTakenDown: 3, requestsClosed: 2, membershipsEnded: 1 });
    expect(await api.getCurrentUser()).toBeNull();
    expect((await failure(as('seller'))).code).toBe(404);

    const raw = JSON.parse(window.localStorage.getItem(DB)!);
    const mine = raw.market.products.filter((p: { id: string }) => [sold.id, other.id, open.id].includes(p.id));
    expect(mine.map((p: { status: string }) => p.status)).toEqual(['已下架', '已下架', '已下架']);
    expect(mine.every((p: { contact: string; contactPublic: boolean }) => p.contact === '' && p.contactPublic === false)).toBe(true);
    const anonymised = raw.users.find((u: { id: string }) => u.id === ids.get('seller'));
    expect([anonymised.account, anonymised.nickname, anonymised.avatar, anonymised.contact, anonymised.dormBuildingId])
      .toEqual([`deleted-${ids.get('seller')}`, '已注销用户', '', '', null]);
    expect(anonymised.password).not.toBe(PASSWORD);
    // 上传的图片不再可读：商品响应里对应位置是空地址（界面显示占位图）
    const images = JSON.parse(window.localStorage.getItem('campus_market_mock_uploaded_images_v1')!);
    expect(images[image.id].status).toBe('DELETED');

    await as('buyer');
    const sent = await api.listContactRequests({ role: 'sent' });
    expect(sent.items.map((r) => r.status).sort()).toEqual(['REJECTED', 'REVOKED']);
    expect(sent.items.every((r) => r.sellerNickname === '已注销用户')).toBe(true);
    await api.login({ account: accounts.get('third')!, password: PASSWORD });
    expect((await api.listCircleMembers(circle.id)).items.map((m) => m.userId)).not.toContain(ids.get('seller'));

    // 原账号名可以重新注册（是一个新账号）
    const again = await api.register({ account: sellerAccount, password: PASSWORD, nickname: '新的我', campus: '东校区' });
    expect(again.user.id).not.toBe(ids.get('seller'));
  });
});

describe('Mock：图片上传（ImageService）', () => {
  it('按文件头判断类型（扩展名与 Content-Type 不算数）；超过 5 MB 413；空文件 400；返回 upload:<id> 与可显示的地址及宽高', async () => {
    await as('seller');
    const fake = new File([new TextEncoder().encode('GIF89a not a png')], 'fake.png', { type: 'image/png' });
    expect(await failure(api.uploadImage(fake))).toMatchObject({ code: 400, message: '只支持 JPEG 或 PNG 图片' });
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
    expect(await failure(api.uploadImage(huge))).toMatchObject({ code: 413, message: '图片不能超过 5 MB' });
    expect(await failure(api.uploadImage(new File([], 'empty.png', { type: 'image/png' })))).toMatchObject({ code: 400, message: '请选择一张图片' });
    const ok = await api.uploadImage(new File([png(40, 30)], 'renamed.jpg', { type: 'image/jpeg' }));
    expect(ok.ref).toBe(`upload:${ok.id}`);
    expect(ok.url.startsWith('data:image/png;base64,')).toBe(true);
    expect([ok.width, ok.height]).toEqual([40, 30]);
  });

  it('商品保存引用、响应里是可显示的地址；只能引用本人上传的有效图片；编辑时显示地址还原成引用', async () => {
    await as('seller');
    const mine = await api.uploadImage(pngFile());
    const product = await api.createProduct(listing('有上传图片的商品', { images: [mine.ref, 'https://example.invalid/b.png'] }));
    expect(product.images).toEqual([mine.url, 'https://example.invalid/b.png']);
    const stored = JSON.parse(window.localStorage.getItem(DB)!).market.products.find((p: { id: string }) => p.id === product.id);
    expect(stored.images).toEqual([mine.ref, 'https://example.invalid/b.png']);
    // 编辑：表单带回的是显示地址，Mock 与 REST 一样还原成引用
    const edited = await api.updateProduct(product.id, { images: [...product.images].reverse() });
    expect(edited.images).toEqual(['https://example.invalid/b.png', mine.url]);
    await as('buyer');
    const theirs = await api.uploadImage(pngFile('buyer.png'));
    await as('seller');
    expect(await failure(api.createProduct(listing('偷用别人的图片', { images: [theirs.ref] }))))
      .toMatchObject({ code: 400, message: '只能使用自己上传的图片，请重新上传' });
    expect(await failure(api.updateProduct(product.id, { images: [theirs.ref] })))
      .toMatchObject({ code: 400, message: '只能使用自己上传的图片，请重新上传' });
  });

  it('按用户每小时 60 张，第 61 张 429', async () => {
    await as('seller');
    for (let i = 0; i < 60; i++) await api.uploadImage(pngFile(`p${i}.png`));
    expect((await failure(api.uploadImage(pngFile()))).code).toBe(429);
  });
});

describe('Mock：内容安全（ContentSafetyService 的关键词过滤）', () => {
  it('商品发布 / 编辑、留言、昵称、注册昵称都检查，统一原话；拆分写法也挡住；正常词不误伤；私信默认只收快捷消息', async () => {
    await as('seller');
    const blocked = async (p: Promise<unknown>) => expect(await failure(p)).toMatchObject({ code: 400, message: CONTENT_BLOCKED_MESSAGE });
    await blocked(api.createProduct(listing('出售 代 - 考 服务')));
    await blocked(api.createProduct(listing('普通的标题', { description: '可以帮忙办证，价格好说' })));
    const product = await api.createProduct(listing('一个大麻袋，可装被子'));
    await blocked(api.updateProduct(product.id, { description: '另外提供刷单' }));
    await blocked(api.updateProfile({ nickname: '校园贷专员' }));
    await as('buyer');
    await blocked(api.addComment({ productId: product.id, content: '有没有替考？' }));
    const conversation = await api.getOrCreateConversation(product.id);
    // REWRITTEN（私信只能发送快捷消息）：默认不开放文字，文字私信在内容安全之前就被拒绝；开放文字时的内容安全见 messageTemplates.contract.test.ts
    expect(await failure(api.sendMessage(conversation.id, { content: '要不要冰毒' }))).toMatchObject({ code: 400, message: '私信目前只能发送预设的快捷消息' });
    await blocked(api.register({ account: `x-${rnd()}`, password: PASSWORD, nickname: '赌博达人', campus: '东校区' }));
    expect((await api.addComment({ productId: product.id, content: '大麻袋还在吗？' })).content).toBe('大麻袋还在吗？');
  });
});

describe('Mock：利益回避 CONTACT_PARTY（V17 staff_case_conflict）', () => {
  it('申请过这件商品联系方式的工作人员不能立案或查看该商品的案件：403 CONFLICT_OF_INTEREST / CONTACT_PARTY', async () => {
    await as('seller');
    const product = await api.createProduct(listing('工作人员申请过的商品'));
    await as('buyer');
    await api.requestContact(product.id);
    makeStaff(ids.get('buyer')!);
    await as('buyer');
    const e = await failure(api.openModerationCase({ targetType: 'PRODUCT', targetId: product.id }));
    expect([e.code, e.details]).toEqual([403, { code: 'CONFLICT_OF_INTEREST', reason: 'CONTACT_PARTY' }]);
  });
});
