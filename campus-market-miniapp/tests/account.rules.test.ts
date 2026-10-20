import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  BIND_TICKET_TTL_MS, BindTicketStore, bindPendingWechat, changePasswordError, DELETE_CONFIRMATION, DELETION_BLOCKERS, DELETION_EFFECTS, DELETION_KEPT,
  deletionError, isDeletionConfirmed, newPasswordError, PASSWORD_CHANGED_MESSAGE, RESET_HELP, resetPasswordError, WECHAT_BOUND_MESSAGE, wechatLoginFailure,
} from '../src/account';
import { ApiError, Transport, type RequestPort, type Response } from '../src/api/transport';
import { RestApi } from '../src/api/rest';

const TICKET = 'f'.repeat(64);

describe('密码与确认语校验（纯函数）', () => {
  it('新密码 8–72 位，首尾空白不计（与后端 trim 后计长度一致）', () => {
    expect(newPasswordError('1234567')).toContain('8–72');
    expect(newPasswordError('12345678')).toBeNull();
    expect(newPasswordError('x'.repeat(72))).toBeNull();
    expect(newPasswordError('x'.repeat(73))).toContain('8–72');
    expect(newPasswordError('  1234567  ')).toContain('8–72');
  });
  it('修改密码：当前密码必填、两次一致、新旧不同', () => {
    expect(changePasswordError({ current: '', next: 'new-pass-1', repeat: 'new-pass-1' })).toBe('请输入当前密码');
    expect(changePasswordError({ current: 'old', next: 'short', repeat: 'short' })).toContain('8–72');
    expect(changePasswordError({ current: 'old', next: 'new-pass-1', repeat: 'new-pass-2' })).toBe('两次输入的新密码不一致');
    expect(changePasswordError({ current: 'same-pass-1', next: 'same-pass-1', repeat: 'same-pass-1' })).toBe('新密码不能与当前密码相同');
    expect(changePasswordError({ current: 'old-pass', next: 'new-pass-1', repeat: 'new-pass-1' })).toBeNull();
  });
  it('找回：账号与重置码必填、长度上限，新密码规则同上', () => {
    const valid = { account: 'student01', code: 'ABCD-EFGH-JKMN', next: 'new-pass-1', repeat: 'new-pass-1' };
    expect(resetPasswordError(valid)).toBeNull();
    expect(resetPasswordError({ ...valid, account: ' ' })).toBe('请输入要找回的账号');
    expect(resetPasswordError({ ...valid, code: '' })).toBe('请输入学校管理员提供的重置码');
    expect(resetPasswordError({ ...valid, code: 'x'.repeat(41) })).toBe('请输入学校管理员提供的重置码');
    expect(resetPasswordError({ ...valid, next: '1234567', repeat: '1234567' })).toContain('8–72');
    expect(resetPasswordError({ ...valid, repeat: 'other-pass' })).toBe('两次输入的新密码不一致');
  });
  it('注销：密码必填，确认语必须是「确认注销」', () => {
    expect(DELETE_CONFIRMATION).toBe('确认注销');
    expect(isDeletionConfirmed('确认注销')).toBe(true);
    expect(isDeletionConfirmed(' 确认注销 ')).toBe(true);
    expect(isDeletionConfirmed('确认')).toBe(false);
    expect(isDeletionConfirmed('确认注销账号')).toBe(false);
    expect(deletionError({ password: '', confirmation: '确认注销' })).toBe('请输入当前密码');
    expect(deletionError({ password: 'pw', confirmation: '注销' })).toBe('请输入「确认注销」确认注销');
    expect(deletionError({ password: 'pw', confirmation: '确认注销' })).toBeNull();
  });
});

describe('页面文案与 docs/account-lifecycle.md 一致', () => {
  it('找回说明、修改密码结果、绑定结果', () => {
    expect(RESET_HELP).toBe('请联系本校学校管理员核对身份后获取一次性重置码，30 分钟内有效');
    expect(PASSWORD_CHANGED_MESSAGE).toBe('已修改，其他设备已退出');
    expect(WECHAT_BOUND_MESSAGE).toBe('已绑定微信，下次可以一键登录');
  });
  it('注销说明覆盖 §3 的每一项处理、保留内容和 409 前置条件', () => {
    const effects = DELETION_EFFECTS.join('\n');
    for (const item of ['下架', '联系方式', '取消「公开」', '撤回', '拒绝', '撤回同意', '退出所有圈子', '需求订阅', '协助邀请', '解除微信绑定', '登录全部结束', '已注销用户', '头像', '宿舍楼', '重新注册']) expect(effects).toContain(item);
    const kept = DELETION_KEPT.join('\n');
    for (const item of ['已售出商品', '留言与私信', '治理案件', '举报', '已注销用户']) expect(kept).toContain(item);
    const blockers = DELETION_BLOCKERS.join('\n');
    expect(blockers).toContain('后台工作人员权限'); expect(blockers).toContain('圈子的所有者');
  });
});

describe('微信绑定票据（只在内存）', () => {
  it('10 分钟内有效、取出即作废、可以主动丢弃', () => {
    let now = 1_000;
    const store = new BindTicketStore(() => now);
    expect(store.pending).toBe(false); expect(store.take()).toBeNull();
    store.hold(TICKET); expect(store.pending).toBe(true);
    expect(store.take()).toBe(TICKET); expect(store.take()).toBeNull();
    store.hold(TICKET); now += BIND_TICKET_TTL_MS - 1; expect(store.pending).toBe(true);
    now += 1; expect(store.pending).toBe(false); expect(store.take()).toBeNull();
    store.hold(TICKET); store.clear(); expect(store.take()).toBeNull();
  });

  it('密码登录后绑定：只发 {bindTicket}，成功提示「已绑定微信，下次可以一键登录」，票据随即作废', async () => {
    const handler = vi.fn<RequestPort>(async (): Promise<Response> => ({ statusCode: 200, data: { code: 0, data: { bound: true }, message: 'ok' } }));
    const api = new RestApi(new Transport(handler, 'https://campus.example', true));
    const store = new BindTicketStore();
    expect(await bindPendingWechat(api, store)).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    store.hold(TICKET);
    expect(await bindPendingWechat(api, store)).toBe(WECHAT_BOUND_MESSAGE);
    expect(handler.mock.calls.map(([input]) => [input.url, input.data])).toEqual([['https://campus.example/v1/auth/wechat/bind', { bindTicket: TICKET }]]);
    expect(store.pending).toBe(false);
    expect(await bindPendingWechat(api, store)).toBeNull();
  });

  it('绑定失败不影响登录，只提示后端原因；票据同样作废', async () => {
    const store = new BindTicketStore(); store.hold(TICKET);
    const message = await bindPendingWechat({ wechatBind: async () => { throw new ApiError('这个微信已经绑定了其他账号', 409); } }, store);
    expect(message).toBe('这个微信已经绑定了其他账号');
    expect(store.pending).toBe(false);
  });

  it('处理票据的代码不碰本地存储（票据只在内存）', () => {
    for (const file of ['src/account.ts', 'src/api/rest.ts', 'src/api/transport.ts', 'src/pages/login/index.tsx']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/setStorage|localStorage|sessionStorage|indexedDB/);
    }
  });
});

describe('微信登录失败的处理', () => {
  it('503「微信登录尚未开通」隐藏按钮；其他 503 只提示；400 提示重新尝试', () => {
    expect(wechatLoginFailure(new ApiError('微信登录尚未开通', 503))).toEqual({ hide: true, message: '微信登录尚未开通' });
    expect(wechatLoginFailure(new ApiError('微信登录暂时不可用，请稍后重试', 503))).toEqual({ hide: false, message: '微信登录暂时不可用，请稍后重试' });
    expect(wechatLoginFailure(new ApiError('code 格式无效', 400))).toEqual({ hide: false, message: '微信登录凭证无效或已过期，请重试' });
    expect(wechatLoginFailure(new ApiError('操作太频繁，请稍后重试', 429))).toEqual({ hide: false, message: '操作太频繁，请稍后重试' });
    expect(wechatLoginFailure('boom')).toEqual({ hide: false, message: '微信登录失败，请重试' });
  });
});
