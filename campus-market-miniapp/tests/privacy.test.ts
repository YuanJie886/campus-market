import { describe, expect, it, vi } from 'vitest';
import { ensurePrivacy, isPrivacyDenied, PRIVACY_AGREE_BUTTON_ID, PRIVACY_REQUIRED_MESSAGE, PrivacyAuthorization } from '../src/privacy';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('微信隐私授权状态机（wx.onNeedPrivacyAuthorization）', () => {
  it('收到 resolve 后只打开弹窗，不会自动同意；等待期间不调用 resolve', async () => {
    const store = new PrivacyAuthorization(), resolve = vi.fn(), opened = vi.fn();
    store.subscribe(opened);
    store.need(resolve);
    await tick();
    expect(store.open).toBe(true);
    expect(opened).toHaveBeenLastCalledWith(true);
    expect(resolve).not.toHaveBeenCalled();
    expect(store.decision).toBeNull();
  });
  it('只有明确点击「同意」才 resolve({ event: "agree", buttonId })；排队的多个接口一起放行，弹窗关闭', () => {
    const store = new PrivacyAuthorization(), first = vi.fn(), second = vi.fn(), opened = vi.fn();
    store.subscribe(opened);
    store.need(first); store.need(second);
    store.agree(PRIVACY_AGREE_BUTTON_ID);
    expect(first).toHaveBeenCalledExactlyOnceWith({ event: 'agree', buttonId: PRIVACY_AGREE_BUTTON_ID });
    expect(second).toHaveBeenCalledExactlyOnceWith({ event: 'agree', buttonId: PRIVACY_AGREE_BUTTON_ID });
    expect(store.open).toBe(false);
    expect(opened).toHaveBeenLastCalledWith(false);
    expect(store.decision).toBe('agree');
  });
  it('点击「拒绝」resolve({ event: "disagree" })，不带 buttonId；之后再点同意不会重复 resolve', () => {
    const store = new PrivacyAuthorization(), resolve = vi.fn();
    store.need(resolve);
    store.disagree();
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ event: 'disagree' });
    store.agree();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(store.decision).toBe('disagree');
  });
  it('拒绝后下一次需要授权时会再次询问（不记住拒绝而直接放行）', () => {
    const store = new PrivacyAuthorization(), first = vi.fn(), second = vi.fn();
    store.need(first); store.disagree();
    store.need(second);
    expect(store.open).toBe(true);
    expect(second).not.toHaveBeenCalled();
    store.agree();
    expect(second).toHaveBeenCalledWith({ event: 'agree', buttonId: PRIVACY_AGREE_BUTTON_ID });
  });
});

describe('调用隐私接口前的主动检查', () => {
  it('不需要授权（已同意或非微信端读不到设置）时直接放行，不弹窗', async () => {
    const store = new PrivacyAuthorization();
    await ensurePrivacy(store, { needAuthorization: false });
    await ensurePrivacy(store, null);
    expect(store.open).toBe(false);
  });
  it('需要授权时弹窗并等待：同意后继续调用接口', async () => {
    const store = new PrivacyAuthorization(), next = vi.fn();
    const pending = ensurePrivacy(store, { needAuthorization: true }).then(next);
    await tick();
    expect(store.open).toBe(true);
    expect(next).not.toHaveBeenCalled();
    store.agree();
    await pending;
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('拒绝时抛出提示，接口不会被调用', async () => {
    const store = new PrivacyAuthorization(), chooseMedia = vi.fn();
    const pending = ensurePrivacy(store, { needAuthorization: true }).then(chooseMedia);
    await tick();
    store.disagree();
    await expect(pending).rejects.toThrow(PRIVACY_REQUIRED_MESSAGE);
    expect(chooseMedia).not.toHaveBeenCalled();
  });
  it('识别微信因未同意隐私协议拦下的接口错误', () => {
    expect(isPrivacyDenied({ errno: 104, errMsg: 'chooseMedia:fail privacy permission is not authorized' })).toBe(true);
    expect(isPrivacyDenied({ errMsg: 'setClipboardData:fail api scope is not declared in the privacy agreement' })).toBe(true);
    expect(isPrivacyDenied({ errMsg: 'chooseMedia:fail cancel' })).toBe(false);
    expect(isPrivacyDenied(null)).toBe(false);
  });
});
