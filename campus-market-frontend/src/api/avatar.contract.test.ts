// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCampusMarketApi } from './mockCampusMarketApi';
import { RestCampusMarketApi } from './restCampusMarketApi';
import { HttpTransport } from './httpTransport';
import { ApiError, toUserMessage } from './errors';
import { authTokenStore } from '../utils/authTokenStore';
import { AVATAR_EXTERNAL_NOT_ALLOWED, AVATAR_INVALID, AVATAR_PALETTE, AVATAR_PRESET_COUNT, avatarAppearance, avatarInitial, fallbackPresetFor } from '../utils/avatar';
import { seedUsers } from '../data/seed';

/**
 * 头像契约：PATCH /v1/auth/me 的 avatar。REST 适配层提交的请求体逐字节断言；Mock 与后端的校验与两句 400 原话一致。
 * UI 部分见 src/avatarUi.test.tsx。
 */
const UUID = '0b6a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const SIGNED = `/v1/images/${UUID}?exp=1893456000&sig=abc`;
const PALETTE = ['#2F6B5B', '#3D5A80', '#8A4F7D', '#A0522D', '#4B6F2F', '#6B5B95', '#B5651D', '#2E7D8C', '#8C3B3B', '#4A4E69', '#7A6C2F', '#5C6F82'];

function png() {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(b.buffer);
  view.setUint32(16, 2);
  view.setUint32(20, 3);
  return b;
}
const pngFile = () => new File([png()], 'face.png', { type: 'image/png' });

/** 假的后端：记录每一次请求；PATCH /v1/auth/me 按 reply 回应 */
function restApi(reply: (body: Record<string, unknown>) => { status: number; data?: unknown; message?: string } = () => ({ status: 200 })) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const r = method === 'PATCH' && path === '/v1/auth/me' ? reply(body) : { status: 200, data: null };
    const data = r.data !== undefined ? r.data : r.status === 200 ? { id: 'u1', nickname: '小鹿', avatar: (body as { avatar?: string })?.avatar ?? '' } : null;
    return new Response(JSON.stringify({ code: r.status === 200 ? 0 : r.status, data, message: r.message ?? (r.status === 200 ? 'ok' : '服务拒绝') }),
      { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  authTokenStore.setAccessToken('test-access-token', new Date(Date.now() + 900_000).toISOString());
  return { rest: new RestCampusMarketApi(new HttpTransport({ fetchImpl })), calls };
}

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
async function register(mock = api, nickname = '头像同学') {
  return (await mock.register({ account: `avatar-${rnd()}`, password: 'test-password', nickname, campus: '东校区', contact: '13800000000' })).user;
}
async function rejection(p: Promise<unknown>): Promise<{ code: number; message: string }> {
  try { await p } catch (e) { return { code: (e as ApiError).code, message: (e as ApiError).message } }
  throw new Error('expected a rejection');
}

beforeEach(() => { api = new MockCampusMarketApi() });
afterEach(() => { vi.restoreAllMocks(); authTokenStore.clearAccessToken() });

describe('调色板与预设', () => {
  it('12 个预设；调色板逐项等于规定的列表（预设 N 用第 N-1 个颜色）', () => {
    expect(AVATAR_PRESET_COUNT).toBe(12);
    expect([...AVATAR_PALETTE]).toEqual(PALETTE);
    for (let n = 1; n <= 12; n++) expect(avatarAppearance(`preset:${n}`, 'any')).toEqual({ kind: 'preset', preset: n, color: PALETTE[n - 1] });
    expect(Object.isFrozen(AVATAR_PALETTE)).toBe(true);
  });

  it('兜底预设只由用户 id 决定：同一 id 永远相同、落在 1..12、不同 id 会分散到不同颜色；空昵称画「同」', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u_${i}`);
    for (const id of ids) {
      const n = fallbackPresetFor(id);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(12);
      expect(fallbackPresetFor(id)).toBe(n);
      expect(avatarAppearance('', id)).toEqual({ kind: 'preset', preset: n, color: PALETTE[n - 1] });
    }
    expect(new Set(ids.map(fallbackPresetFor)).size).toBeGreaterThan(6);
    expect(avatarInitial('')).toBe('同');
    expect(avatarInitial('   ')).toBe('同');
    expect(avatarInitial(null)).toBe('同');
    expect(avatarInitial('林小满')).toBe('林');
  });
});

describe('REST：PATCH /v1/auth/me 的请求体', () => {
  it.each([
    ['""（不使用头像）', '', ''],
    ['preset:1', 'preset:1', 'preset:1'],
    ['preset:12', 'preset:12', 'preset:12'],
    ['upload:<uuid>', `upload:${UUID}`, `upload:${UUID}`],
    ['响应里的签名相对地址 → 还原成 upload:<uuid>', SIGNED, `upload:${UUID}`],
    ['按 API 基址补全过的签名地址 → 还原成 upload:<uuid>', `https://api.campus.example${SIGNED}`, `upload:${UUID}`],
    ['外部 http(s)（是否接受由后端按 externalAllowed 决定）', 'https://example.invalid/me.png', 'https://example.invalid/me.png'],
  ])('%s', async (_label, sent, expected) => {
    const { rest, calls } = restApi();
    await rest.updateProfile({ avatar: sent });
    expect(calls).toEqual([{ method: 'PATCH', path: '/v1/auth/me', body: { avatar: expected } }]);
  });

  it('与其他字段一起提交时只改 avatar 的值，字段集合不变；不传 avatar 时请求体里没有 avatar', async () => {
    const { rest, calls } = restApi();
    await rest.updateProfile({ nickname: '小鹿', campus: '东校区', contact: '13800000000', avatar: SIGNED, dormBuildingId: null });
    await rest.updateProfile({ nickname: '小鹿' });
    expect(calls.map((c) => c.body)).toEqual([
      { nickname: '小鹿', campus: '东校区', contact: '13800000000', avatar: `upload:${UUID}`, dormBuildingId: null },
      { nickname: '小鹿' },
    ]);
  });

  it.each([AVATAR_INVALID, AVATAR_EXTERNAL_NOT_ALLOWED])('400「%s」原样交给界面', async (message) => {
    const { rest } = restApi(() => ({ status: 400, message }));
    const error = await rest.updateProfile({ avatar: 'preset:99' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).httpStatus).toBe(400);
    expect(toUserMessage(error)).toBe(message);
  });
});

describe('Mock 与后端一致（校验与原话）', () => {
  it('两句 400 原话逐字相同', () => {
    expect(AVATAR_INVALID).toBe('头像无效');
    expect(AVATAR_EXTERNAL_NOT_ALLOWED).toBe('不支持外部头像链接，请选择预设头像或上传图片');
  });

  it('注册的默认头像是 ""（不再用账号名生成外部头像地址）；演示种子用户都是预设头像', async () => {
    const user = await register();
    expect(user.avatar).toBe('');
    expect((await api.getCurrentUser())!.avatar).toBe('');
    expect(seedUsers.map((u) => u.avatar)).toEqual(['preset:1', 'preset:2', 'preset:3', 'preset:4', 'preset:5']);
  });

  it('接受 "" 与 preset:1..12，响应里原样返回；他人通过 getUser 看到同样的值', async () => {
    const me = await register();
    for (const value of ['preset:1', 'preset:7', 'preset:12', '']) {
      expect((await api.updateProfile({ avatar: value })).avatar).toBe(value);
      expect((await api.getCurrentUser())!.avatar).toBe(value);
    }
    await api.updateProfile({ avatar: 'preset:4' });
    await register();
    expect((await api.getUser(me.id)).avatar).toBe('preset:4');
  });

  it('本人上传的图片：提交 upload:<id>，保存引用，响应给显示地址；把显示地址原样带回也被还原成引用', async () => {
    const me = await register();
    const image = await api.uploadImage(pngFile());
    const saved = await api.updateProfile({ avatar: image.ref });
    expect(saved.avatar).toBe(image.url);
    expect(saved.avatar).toMatch(/^data:image\/png;/);
    const again = await api.updateProfile({ avatar: saved.avatar, nickname: '换个昵称' });
    expect(again.avatar).toBe(image.url);
    const stored = (api as unknown as { db: { users: Array<{ id: string; avatar: string }> } }).db.users.find((u) => u.id === me.id)!;
    expect(stored.avatar).toBe(image.ref);
  });

  it.each([
    ['preset:0', 'preset:0'], ['preset:13', 'preset:13'], ['preset:01', 'preset:01'], ['PRESET:1', 'PRESET:1'], ['preset:1 ', 'preset:1 '],
    ['不存在的上传', `upload:${UUID}`], ['协议相对地址', '//cdn.example/a.png'], ['ftp', 'ftp://example.invalid/a.png'],
    ['javascript:', 'javascript:alert(1)'], ['随便的字符串', 'avatar.png'], ['数字', 7], ['null', null],
  ])('400「头像无效」：%s', async (_label, value) => {
    await register();
    expect(await rejection(api.updateProfile({ avatar: value as string }))).toEqual({ code: 400, message: AVATAR_INVALID });
  });

  it('别人的上传图片：400「头像无效」，同一次请求里的其他字段也不写入', async () => {
    await register();
    const theirs = await api.uploadImage(pngFile());
    await register(api, '原昵称');
    expect(await rejection(api.updateProfile({ avatar: theirs.ref, nickname: '新昵称' }))).toEqual({ code: 400, message: AVATAR_INVALID });
    const me = (await api.getCurrentUser())!;
    expect(me.nickname).toBe('原昵称');
    expect(me.avatar).toBe('');
  });

  it('外部 http(s)：externalAllowed=false 时 400「不支持外部头像链接，请选择预设头像或上传图片」；允许时接受（与 GET /v1/config 一致）', async () => {
    const strict = new MockCampusMarketApi({ externalImagesAllowed: false });
    expect((await strict.getClientConfig()).images.externalAllowed).toBe(false);
    await register(strict);
    for (const url of ['https://example.invalid/me.png', 'http://example.invalid/me.png']) {
      expect(await rejection(strict.updateProfile({ avatar: url }))).toEqual({ code: 400, message: AVATAR_EXTERNAL_NOT_ALLOWED });
    }
    expect((await strict.getCurrentUser())!.avatar).toBe('');
    expect((await strict.updateProfile({ avatar: 'preset:3' })).avatar).toBe('preset:3');

    expect((await api.getClientConfig()).images.externalAllowed).toBe(true);
    await register();
    expect((await api.updateProfile({ avatar: 'https://example.invalid/me.png' })).avatar).toBe('https://example.invalid/me.png');
  });
});
