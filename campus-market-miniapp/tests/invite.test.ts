import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MockApi, type StoragePort } from '../src/api/mock';
import { DEMO_REGISTRATION_INVITES } from '../src/api/mockRules';
import { RestApi } from '../src/api/rest';
import { ApiError, Transport, type RequestPort, type Response } from '../src/api/transport';
import { AGREEMENT_REQUIRED_MESSAGE, registerAccount, registrationError, type RegistrationInput } from '../src/account';
import {
  INVITE_ALPHABET, INVITE_HELP, INVITE_INVALID_MESSAGE, INVITE_LABEL, INVITE_PLACEHOLDER, INVITE_REQUIRED_MESSAGE,
  inviteCodeFromParams, inviteField, inviteRequired, isInviteRequiredError, loginEntryFromParams, normalizeInviteCode,
} from '../src/invite';
import { normalizeClientConfig, type User } from '../src/model';

const BASE = 'https://campus.example';
const ok = (data: unknown): Response => ({ statusCode: 200, data: { code: 0, data, message: 'ok' } });
const bad = (message: string, statusCode = 400): Response => ({ statusCode, data: { code: statusCode, message } });
const session = (user: User) => ({ accessToken: 'token-new', expiresAtIso: '2030-01-01T00:00:00Z', user });
const me: User = { id: 'u1', nickname: '小明', campus: 'aust-huainan' };

function rest(reply: (input: Parameters<RequestPort>[0]) => Response) {
  const handler = vi.fn<RequestPort>(async (input) => reply(input));
  return { api: new RestApi(new Transport(handler, BASE, true)), wire: () => handler.mock.calls.map(([i]) => [i.method, i.url.replace(BASE, ''), i.data]) };
}
function memory() {
  let value: unknown;
  const storage: StoragePort = { get: () => value, set: (db) => { value = structuredClone(db); } };
  return storage;
}
const form: RegistrationInput = { account: ' student01 ', password: 'password123', nickname: ' 小明 ', campus: 'aust-huainan', contact: '' };
const pilotForm = (account: string, inviteCode?: string): RegistrationInput => ({ account, password: 'password123', nickname: '新同学', campus: '东校区', contact: '', ...(inviteCode === undefined ? {} : { inviteCode }) });

describe('GET /v1/config 的 registration.inviteRequired', () => {
  it('REST：true 时需要；缺失、非布尔、旧后端 404 一律按 false', async () => {
    const config = (body: unknown) => rest((input) => input.url.endsWith('/v1/config') ? ok(body) : bad('x')).api.clientConfig();
    expect((await config({ registration: { inviteRequired: true } })).registration).toEqual({ inviteRequired: true });
    expect((await config({ images: { maxCount: 6 } })).registration).toEqual({ inviteRequired: false });
    expect((await config({ registration: { inviteRequired: 'true' } })).registration).toEqual({ inviteRequired: false });
    expect((await config({ registration: null })).registration).toEqual({ inviteRequired: false });
    expect((await rest(() => ({ statusCode: 404, data: '<html>' })).api.clientConfig()).registration).toEqual({ inviteRequired: false });
    // 新字段不影响已有的图片配置解析
    expect((await config({ images: { maxCount: 6 }, registration: { inviteRequired: true } })).images.maxCount).toBe(6);
  });
});

describe('注册表单的邀请码输入框', () => {
  it('只在 inviteRequired 为 true 时显示且必填；文案为「邀请码」与固定说明', () => {
    expect(inviteField(normalizeClientConfig({ registration: { inviteRequired: true } }))).toEqual({
      visible: true, required: true, label: '邀请码', help: '目前为小范围测试，需要学校工作人员发放的邀请码', placeholder: 'XXXX-XXXX-XXXX',
    });
    expect([INVITE_LABEL, INVITE_HELP, INVITE_PLACEHOLDER]).toEqual(['邀请码', '目前为小范围测试，需要学校工作人员发放的邀请码', 'XXXX-XXXX-XXXX']);
    for (const config of [normalizeClientConfig({}), normalizeClientConfig({ registration: { inviteRequired: false } }), null, undefined]) {
      expect(inviteField(config)).toMatchObject({ visible: false, required: false });
      expect(inviteRequired(config)).toBe(false);
    }
  });

  it('需要邀请码时未填写（含只有空格或短横线）：提示「请输入邀请码」，不发请求', async () => {
    for (const inviteCode of [undefined, '', '   ', ' - - ']) {
      const register = vi.fn(async () => me);
      expect(registrationError({ ...form, inviteCode }, true, true)).toBe(INVITE_REQUIRED_MESSAGE);
      await expect(registerAccount({ register }, { ...form, inviteCode }, true, true)).rejects.toThrow('请输入邀请码');
      expect(register).not.toHaveBeenCalled();
    }
    // 填写后通过；其余资料与协议的检查照旧
    expect(registrationError({ ...form, inviteCode: 'ABCD-EFGH-JKMN' }, true, true)).toBeNull();
    expect(registrationError({ ...form, inviteCode: 'ABCD-EFGH-JKMN' }, false, true)).toBe(AGREEMENT_REQUIRED_MESSAGE);
    expect(registrationError({ ...form, password: 'short', inviteCode: '' }, true, true)).toBe('请填写账号、密码和注册资料');
  });

  it('不需要邀请码时不检查邀请码', () => {
    expect(registrationError(form, true)).toBeNull();
    expect(registrationError({ ...form, inviteCode: '' }, true, false)).toBeNull();
  });
});

describe('POST /v1/auth/register 请求体（REST 线上请求逐字段）', () => {
  it('需要邀请码：带上归一化后的 inviteCode（XXXX-XXXX-XXXX）', async () => {
    const { api, wire } = rest(() => ok(session(me)));
    await expect(registerAccount(api, { ...form, inviteCode: ' abcd efgh-jkmn ' }, true, true)).resolves.toEqual(me);
    expect(wire()).toEqual([['POST', '/v1/auth/register', { account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '', inviteCode: 'ABCD-EFGH-JKMN' }]]);
  });

  it('不需要邀请码：请求体里没有 inviteCode 字段（即使输入框里还留着内容）', async () => {
    for (const inviteCode of [undefined, 'ABCD-EFGH-JKMN']) {
      const { api, wire } = rest(() => ok(session(me)));
      await registerAccount(api, { ...form, inviteCode }, true, false);
      expect(wire()).toEqual([['POST', '/v1/auth/register', { account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '' }]]);
      expect(wire()[0][2]).not.toHaveProperty('inviteCode');
    }
  });

  it('RestApi.register 只发送白名单字段，不会把调用方多带的字段透传给后端', async () => {
    const { api, wire } = rest(() => ok(session(me)));
    await api.register({ account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '', agreed: true } as never);
    expect(wire()[0][2]).toEqual({ account: 'student01', password: 'password123', nickname: '小明', campus: 'aust-huainan', contact: '' });
  });
});

describe('后端错误原样提示', () => {
  it('400「请输入邀请码」「邀请码无效或已用完」原样抛给页面；只有前者触发重新读取配置', async () => {
    for (const message of [INVITE_REQUIRED_MESSAGE, INVITE_INVALID_MESSAGE]) {
      const { api } = rest(() => bad(message));
      const error = await registerAccount(api, { ...form, inviteCode: 'ABCD-EFGH-JKMN' }, true, true).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 400, message });
      expect(isInviteRequiredError(error)).toBe(message === INVITE_REQUIRED_MESSAGE);
    }
    // 本地以为不需要邀请码、后端却要求：同样原样提示，并据此刷新配置
    const { api } = rest(() => bad('请输入邀请码'));
    const stale = await registerAccount(api, form, true, false).catch((e: unknown) => e);
    expect(stale).toMatchObject({ code: 400, message: '请输入邀请码' });
    expect(isInviteRequiredError(stale)).toBe(true);
    expect(isInviteRequiredError(new Error('请输入邀请码'))).toBe(false);
  });
});

describe('邀请码显示归一化', () => {
  it('大写、去空格与短横线、每 4 位一组、最多 12 位', () => {
    expect(normalizeInviteCode('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode(' abcd efgh jkmn ')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode('ab-cd-ef-gh-jk-mn')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode('ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode('ABCDEFGHJKMNPQ')).toBe('ABCD-EFGH-JKMN');
  });
  it('输入过程中逐步分组；删除时不留多余短横线', () => {
    expect(['a', 'abcd', 'abcde', 'ABCD-', 'ABCD-EFGH-J'].map(normalizeInviteCode)).toEqual(['A', 'ABCD', 'ABCD-E', 'ABCD', 'ABCD-EFGH-J']);
  });
  it('全角字符转半角；粘贴时带上的说明文字与其他符号被去掉；空值为空串', () => {
    expect(normalizeInviteCode('ＡＢＣＤ－ＥＦＧＨ－ＪＫＭＮ')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode('邀请码：abcd—efgh—jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(normalizeInviteCode('')).toBe('');
    expect(normalizeInviteCode(undefined)).toBe('');
    expect(normalizeInviteCode(' -- ')).toBe('');
  });
  it('字母表外的字母数字不在本地丢弃，交给后端判定', () => {
    expect(normalizeInviteCode('o0i1-lxyz-2345')).toBe('O0I1-LXYZ-2345');
  });
});

describe('页面参数 invite 预填', () => {
  it('带邀请码进入：直接进入注册模式，并按显示格式预填', () => {
    expect(loginEntryFromParams({ invite: 'abcd-efgh-jkmn' })).toEqual({ register: true, inviteCode: 'ABCD-EFGH-JKMN' });
    expect(loginEntryFromParams({ invite: 'ABCDEFGHJKMN', returnTo: '/pages/profile/index' })).toEqual({ register: true, inviteCode: 'ABCD-EFGH-JKMN' });
  });
  it('原生页面参数仍是 URI 编码时先解码；+ 视为空格；编码不合法时按原文归一化', () => {
    expect(inviteCodeFromParams({ invite: 'ABCD%2DEFGH%2DJKMN' })).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromParams({ invite: encodeURIComponent('abcd efgh jkmn') })).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromParams({ invite: 'abcd+efgh+jkmn' })).toBe('ABCD-EFGH-JKMN');
    expect(inviteCodeFromParams({ invite: 'ABCD%E0EFGH' })).toBe('ABCD-E0EF-GH');
  });
  it('没有参数或参数为空：停在登录模式，输入框为空', () => {
    for (const params of [{}, { invite: '' }, { invite: '---' }, null, undefined]) expect(loginEntryFromParams(params)).toEqual({ register: false, inviteCode: '' });
  });
});

describe('演示模式与后端同语义（mock parity）', () => {
  it('默认不需要邀请码：配置为 false，不带邀请码即可注册，且不消耗任何演示邀请码', async () => {
    const storage = memory(), api = new MockApi(storage);
    expect((await api.clientConfig()).registration).toEqual({ inviteRequired: false });
    expect(inviteField(await api.clientConfig()).visible).toBe(false);
    await expect(registerAccount(api, pilotForm('newmate01'), true)).resolves.toMatchObject({ account: 'newmate01' });
    expect((storage.get() as { registrationInviteUses?: unknown }).registrationInviteUses).toBeUndefined();
  });

  it('inviteRequired：配置为 true；未填、无效、已用完分别给出后端同样的 400 文案', async () => {
    const api = new MockApi(memory(), { inviteRequired: true });
    expect((await api.clientConfig()).registration).toEqual({ inviteRequired: true });
    await expect(api.register(pilotForm('newmate01'))).rejects.toMatchObject({ code: 400, message: '请输入邀请码' });
    await expect(api.register(pilotForm('newmate01', '  '))).rejects.toMatchObject({ code: 400, message: '请输入邀请码' });
    await expect(api.register(pilotForm('newmate01', 'ZZZZ-ZZZZ-ZZZZ'))).rejects.toMatchObject({ code: 400, message: '邀请码无效或已用完' });
    // 与后端一致：只有短横线、不是字符串、不是所选校区那所学校的邀请码，都是「邀请码无效或已用完」
    await expect(api.register(pilotForm('newmate01', ' - - '))).rejects.toMatchObject({ code: 400, message: '邀请码无效或已用完' });
    await expect(api.register({ ...pilotForm('newmate01'), inviteCode: 12 as never })).rejects.toMatchObject({ code: 400, message: '邀请码无效或已用完' });
    await expect(api.register({ ...pilotForm('newmate01', 'CAMP-US23-4567'), campus: 'demo-b-main' })).rejects.toMatchObject({ code: 400, message: '邀请码无效或已用完' });
    // 单次邀请码：小写、空格写法同样有效（后端忽略大小写、空格与短横线）；用完后第二次注册 400
    await expect(api.register(pilotForm('newmate01', 'xyzw 2345 6789'))).resolves.toMatchObject({ account: 'newmate01' });
    await expect(api.register(pilotForm('newmate02', 'XYZW-2345-6789'))).rejects.toMatchObject({ code: 400, message: '邀请码无效或已用完' });
  });

  it('只有注册成功才计数；计数存在演示库里，重新打开仍然有效；注册资料不保存邀请码', async () => {
    const storage = memory(), api = new MockApi(storage, { inviteRequired: true });
    // 账号已存在 → 注册失败，单次邀请码不被消耗
    await expect(api.register(pilotForm('buyer001', 'XYZW-2345-6789'))).rejects.toThrow('该账号已注册');
    await api.register(pilotForm('newmate01', 'XYZW-2345-6789'));
    await api.register(pilotForm('newmate02', 'CAMP-US23-4567'));
    await api.register(pilotForm('newmate03', 'campus234567'));
    const db = storage.get() as { registrationInviteUses: Record<string, number>; users: Record<string, unknown>[] };
    expect(db.registrationInviteUses).toEqual({ XYZW23456789: 1, CAMPUS234567: 2 });
    expect(db.users.some((u) => 'inviteCode' in u)).toBe(false);
    const reopened = new MockApi(storage, { inviteRequired: true });
    await expect(reopened.register(pilotForm('newmate04', 'XYZW-2345-6789'))).rejects.toMatchObject({ message: '邀请码无效或已用完' });
  });

  it('同一组输入，演示与 REST 页面看到的结果一致（请求体同为 XXXX-XXXX-XXXX，错误同为后端原文）', async () => {
    const cases: [string | undefined, string | null][] = [[undefined, '请输入邀请码'], ['zzzz-zzzz-zzzz', '邀请码无效或已用完'], ['camp us23 4567', null]];
    const mock = new MockApi(memory(), { inviteRequired: true });
    // 模拟后端：与契约一致地处理邀请码
    const { api: restApi, wire } = rest((input) => {
      const code = (input.data as { inviteCode?: string }).inviteCode;
      if (!code) return bad('请输入邀请码');
      return code.toUpperCase().replace(/[\s-]/g, '') === 'CAMPUS234567' ? ok(session(me)) : bad('邀请码无效或已用完');
    });
    for (const [i, [inviteCode, expected]] of cases.entries()) {
      const input = pilotForm(`paritymate0${i}`, inviteCode);
      const required = inviteRequired(await mock.clientConfig());
      const outcome = async (api: Pick<MockApi, 'register'>) => registerAccount(api, input, true, required).then(() => null, (e: Error) => e.message);
      // 不带邀请码时两边都由本地检查拦下，不发请求
      expect(await outcome(mock)).toBe(expected);
      expect(await outcome(restApi)).toBe(expected);
    }
    expect(wire().map(([, , body]) => (body as { inviteCode?: string }).inviteCode)).toEqual(['ZZZZ-ZZZZ-ZZZZ', 'CAMP-US23-4567']);
  });

  it('演示邀请码符合后端格式与字母表', () => {
    for (const { code, maxUses, school } of DEMO_REGISTRATION_INVITES) {
      expect(school).toBe('pilot');
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect([...code.replace(/-/g, '')].every((c) => INVITE_ALPHABET.includes(c))).toBe(true);
      expect(maxUses).toBeGreaterThan(0);
    }
  });
});

describe('REST 构建不含演示邀请码（源码检查，仅作补充）', () => {
  it('演示邀请码只出现在 api/mockRules.ts；非演示代码不引用 mockRules', () => {
    const files = ['src/invite.ts', 'src/account.ts', 'src/model.ts', 'src/api/rest.ts', 'src/api/index.ts', 'src/api/transport.ts', 'src/pages/login/index.tsx', 'src/state.tsx'];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const { code } of DEMO_REGISTRATION_INVITES) {
        expect(source).not.toContain(code);
        expect(source).not.toContain(code.replace(/-/g, ''));
      }
      expect(source).not.toMatch(/(?:from|require\()\s*['"][^'"]*mockRules['"]/);
    }
  });
});
