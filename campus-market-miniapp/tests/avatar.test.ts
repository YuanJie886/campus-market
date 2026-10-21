import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { RestApi } from '../src/api/rest';
import { Transport, type RequestPort, type Response } from '../src/api/transport';
import { AVATAR_EXTERNAL_REJECTED, AVATAR_INVALID, AVATAR_PALETTE, AVATAR_PRESETS, avatarInitial, avatarView, isLegacyPicsum, presetForId } from '../src/avatar';
import { profileInput } from '../src/profile';

const ctx = (externalAllowed: boolean, resolve = vi.fn((url: string) => `https://api.example${url}`)) => ({ userId: 'u-123', nickname: '小鹿同学', externalAllowed, resolve });

describe('头像：本地绘制，不请求第三方图片服务', () => {
  it('色板与 12 个预设逐项一致（preset:N 用色板第 N-1 个颜色）', () => {
    expect([...AVATAR_PALETTE]).toEqual(['#2F6B5B', '#3D5A80', '#8A4F7D', '#A0522D', '#4B6F2F', '#6B5B95', '#B5651D', '#2E7D8C', '#8C3B3B', '#4A4E69', '#7A6C2F', '#5C6F82']);
    expect(AVATAR_PRESETS).toEqual(Array.from({ length: 12 }, (_, i) => `preset:${i + 1}`));
    AVATAR_PRESETS.forEach((value, i) => expect(avatarView(value, ctx(true))).toEqual({ kind: 'drawn', preset: i + 1, color: AVATAR_PALETTE[i], initial: '小' }));
    expect(avatarView('preset:0', ctx(true)).kind).toBe('drawn');
    expect(avatarView('preset:13', ctx(true))).toMatchObject({ kind: 'drawn', preset: presetForId('u-123') });
  });
  it('网页端旧账号的 picsum 默认头像永远不加载（即使允许外部图片），改为按用户 id 固定的预设；空头像同样', () => {
    const resolve = vi.fn((url: string) => url);
    for (const legacy of ['https://picsum.photos/seed/buyer001/200/200', 'http://picsum.photos/200', 'https://fastly.picsum.photos/id/1/200/200.jpg']) {
      expect(isLegacyPicsum(legacy)).toBe(true);
      const view = avatarView(legacy, { ...ctx(true), resolve });
      expect(view.kind).toBe('drawn');
      expect(JSON.stringify(view)).not.toContain('picsum');
    }
    expect(resolve).not.toHaveBeenCalled();
    const fallback = avatarView('', ctx(true));
    expect(fallback).toEqual({ kind: 'drawn', preset: presetForId('u-123'), color: AVATAR_PALETTE[presetForId('u-123') - 1], initial: '小' });
    // 同一个 id 永远是同一个颜色；不同 id 分散在 1～12
    expect(presetForId('u-123')).toBe(presetForId('u-123'));
    const spread = new Set(Array.from({ length: 200 }, (_, i) => presetForId(`user-${i}`)));
    expect([...spread].every((n) => n >= 1 && n <= 12)).toBe(true);
    expect(spread.size).toBeGreaterThan(6);
  });
  it('昵称第一个字（按字符），没有昵称时用「同」', () => {
    expect(avatarInitial('  𠀋同学')).toBe('𠀋');
    expect(avatarInitial('')).toBe('同');
    expect(avatarInitial(undefined)).toBe('同');
    expect(avatarView('', { ...ctx(false), nickname: '' })).toMatchObject({ initial: '同' });
  });
  it('本人上传的头像：签名相对地址拼接口域名；只有引用没有地址时本地绘制', () => {
    const signed = '/v1/images/0f8fad5b-d9cb-469f-a165-70867728950e?exp=1&sig=x';
    expect(avatarView(signed, ctx(false))).toEqual({ kind: 'image', src: `https://api.example${signed}` });
    expect(avatarView('upload:0f8fad5b-d9cb-469f-a165-70867728950e', ctx(true)).kind).toBe('drawn');
  });
  it('外部 http(s) 头像只在 images.externalAllowed=true 时显示；读取配置前（false）一律本地绘制', () => {
    expect(avatarView('https://cdn.example/a.png', ctx(true))).toEqual({ kind: 'image', src: 'https://cdn.example/a.png' });
    expect(avatarView('https://cdn.example/a.png', ctx(false)).kind).toBe('drawn');
    expect(avatarView('javascript:alert(1)', ctx(true)).kind).toBe('drawn');
  });
});

describe('头像保存', () => {
  const setup = () => { let value: unknown; const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } }; return new MockApi(storage); };
  it('没改头像时 PATCH 不带 avatar（服务端会拒绝未改动的外部旧头像）；改了才带', () => {
    const base = { nickname: '小鹿', campus: '东校区' as const, contact: '13800000000', dormBuildingId: null };
    const legacy = 'https://picsum.photos/seed/buyer001/200/200';
    expect(profileInput({ ...base, avatar: legacy }, { account: 'a' }, legacy)).not.toHaveProperty('avatar');
    const signed = '/v1/images/0f8fad5b-d9cb-469f-a165-70867728950e?exp=1&sig=x';
    expect(profileInput({ ...base, avatar: signed }, { account: 'a' }, signed)).not.toHaveProperty('avatar');
    expect(profileInput({ ...base, avatar: 'preset:7' }, { account: 'a' }, legacy)).toMatchObject({ avatar: 'preset:7' });
    expect(profileInput({ ...base, avatar: 'upload:0f8fad5b-d9cb-469f-a165-70867728950e' }, { account: 'a' }, legacy)).toMatchObject({ avatar: 'upload:0f8fad5b-d9cb-469f-a165-70867728950e' });
  });
  it('REST：PATCH /v1/auth/me 只在改动时带 avatar；两条 400 原样传给页面', async () => {
    const replies: Response[] = [];
    const handler = vi.fn<RequestPort>(async () => replies.shift() ?? { statusCode: 200, data: { code: 0, data: { id: 'me', nickname: '小鹿', campus: '东校区', avatar: 'preset:3' }, message: 'ok' } });
    const api = new RestApi(new Transport(handler, 'https://campus.example', true));
    const base = { nickname: '小鹿', campus: '东校区' as const, contact: '13800000000', avatar: 'https://picsum.photos/seed/x/200', dormBuildingId: null };
    await api.updateProfile(profileInput(base, { account: 'a' }, base.avatar));
    expect(handler.mock.calls[0][0]).toMatchObject({ method: 'PATCH', url: 'https://campus.example/v1/auth/me' });
    expect(handler.mock.calls[0][0].data).not.toHaveProperty('avatar');
    await api.updateProfile(profileInput({ ...base, avatar: 'preset:3' }, { account: 'a' }, base.avatar));
    expect(handler.mock.calls[1][0].data).toMatchObject({ avatar: 'preset:3' });
    for (const message of [AVATAR_INVALID, AVATAR_EXTERNAL_REJECTED]) {
      replies.push({ statusCode: 400, data: { code: 400, message } });
      await expect(api.updateProfile({ ...base, avatar: 'x' })).rejects.toMatchObject({ code: 400, message });
    }
    expect([AVATAR_INVALID, AVATAR_EXTERNAL_REJECTED]).toEqual(['头像无效', '不支持外部头像链接，请选择预设头像或上传图片']);
  });
  it('演示：预设、不使用头像、本人上传的图片可以保存；外部链接与别人的图片 400（原样文案）', async () => {
    const api = setup();
    await api.login('seller001', 'demo12345');
    const theirs = await api.upload('/tmp/seller.png');
    await api.login('buyer001', 'demo12345');
    const base = { nickname: '小鹿同学', campus: '东校区' as const, contact: '' };
    expect((await api.updateProfile({ ...base, avatar: 'preset:12' })).avatar).toBe('preset:12');
    expect((await api.updateProfile({ ...base, avatar: '' })).avatar).toBe('');
    await expect(api.updateProfile({ ...base, avatar: 'https://picsum.photos/seed/buyer001/200/200' })).rejects.toMatchObject({ code: 400, message: AVATAR_EXTERNAL_REJECTED });
    await expect(api.updateProfile({ ...base, avatar: theirs.ref })).rejects.toMatchObject({ code: 400, message: AVATAR_INVALID });
    await expect(api.updateProfile({ ...base, avatar: 'preset:13' })).rejects.toMatchObject({ code: 400, message: AVATAR_INVALID });
    const mine = await api.upload('/tmp/me.png');
    const saved = await api.updateProfile({ ...base, avatar: mine.ref });
    // 响应里是与后端同形的签名地址，显示时换回本机文件
    expect(saved.avatar).toMatch(/^\/v1\/images\//);
    expect(api.imageSrc(saved.avatar!)).toBe('/tmp/me.png');
    expect((await api.clientConfig()).images.externalAllowed).toBe(false);
  });
});
