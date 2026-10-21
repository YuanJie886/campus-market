/**
 * 微信隐私授权（wx.onNeedPrivacyAuthorization）的状态机，不依赖 Taro，便于测试。
 *
 * 规则：
 * - 微信把 resolve 交给我们以后，只记下来、显示弹窗，**绝不自动同意**；
 * - 只有用户点击「同意」按钮（open-type="agreePrivacyAuthorization"）才 resolve({ event: 'agree', buttonId })；
 * - 点击「拒绝」时 resolve({ event: 'disagree' })，被拦下的接口由微信返回失败，界面提示原因；
 * - 主动检查（getPrivacySetting.needAuthorization 为 true）时同样打开弹窗，等用户决定。
 */
export type PrivacyEvent = 'agree' | 'disagree';
export type PrivacyResolve = (option: { event: PrivacyEvent; buttonId?: string }) => void;
export const PRIVACY_AGREE_BUTTON_ID = 'privacy-agree-button';
export const PRIVACY_REQUIRED_MESSAGE = '需要先同意《隐私政策》才能使用这项功能';
export type PrivacyListener = (open: boolean) => void;

export class PrivacyAuthorization {
  private resolvers: PrivacyResolve[] = [];
  private waiters: ((agreed: boolean) => void)[] = [];
  private readonly listeners = new Set<PrivacyListener>();
  private last: PrivacyEvent | null = null;

  /** 是否需要显示弹窗。 */
  get open() { return this.resolvers.length > 0 || this.waiters.length > 0; }
  /** 本次运行里用户最近一次的选择（尚未选择为 null）。 */
  get decision() { return this.last; }

  subscribe(listener: PrivacyListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { const open = this.open; for (const listener of this.listeners) listener(open); }

  /** wx.onNeedPrivacyAuthorization 的回调：微信暂停了某个隐私接口，等我们的答复。 */
  need(resolve: PrivacyResolve) { this.resolvers.push(resolve); this.emit(); }

  /** 主动询问：resolve 为 true 表示用户点了同意。 */
  ask(): Promise<boolean> {
    return new Promise((resolve) => { this.waiters.push(resolve); this.emit(); });
  }

  /** 只能由「同意」按钮的 agreeprivacyauthorization 事件调用。 */
  agree(buttonId: string = PRIVACY_AGREE_BUTTON_ID) { this.settle('agree', buttonId); }
  disagree() { this.settle('disagree'); }

  private settle(event: PrivacyEvent, buttonId?: string) {
    if (!this.open) return;
    const resolvers = this.resolvers, waiters = this.waiters;
    this.resolvers = []; this.waiters = []; this.last = event;
    for (const resolve of resolvers) resolve(event === 'agree' ? { event, buttonId } : { event });
    for (const waiter of waiters) waiter(event === 'agree');
    this.emit();
  }
}

/**
 * 调用隐私接口之前的检查：读不到设置（非微信端 / 旧基础库）时放行，交给 onNeedPrivacyAuthorization 兜底；
 * 需要授权时打开弹窗，用户拒绝则抛出 PRIVACY_REQUIRED_MESSAGE。
 */
export async function ensurePrivacy(store: PrivacyAuthorization, setting: { needAuthorization: boolean } | null): Promise<void> {
  if (!setting?.needAuthorization) return;
  if (!(await store.ask())) throw new Error(PRIVACY_REQUIRED_MESSAGE);
}

/** 微信因未同意隐私协议而拦下接口时的错误（errno 104 / 112，或 errMsg 提到 privacy）。 */
export function isPrivacyDenied(error: unknown): boolean {
  const e = (error ?? {}) as { errno?: unknown; errMsg?: unknown; message?: unknown };
  if (e.errno === 104 || e.errno === 112) return true;
  const text = `${typeof e.errMsg === 'string' ? e.errMsg : ''} ${typeof e.message === 'string' ? e.message : ''}`.toLowerCase();
  return text.includes('privacy');
}
