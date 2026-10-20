/** 联系申请站内未读数：所有页面与自定义 tabBar 共享一份；不依赖 Taro，便于测试。 */
import type { UnreadCount } from './model';

export const NO_UNREAD: UnreadCount = { received: 0, updates: 0, total: 0 };
type Listener = (count: UnreadCount) => void;

export class UnreadStore {
  private value: UnreadCount = NO_UNREAD;
  private sequence = 0;
  private readonly listeners = new Set<Listener>();
  constructor(private readonly fetchCount: () => Promise<UnreadCount>) {}
  get current() { return this.value; }
  subscribe(listener: Listener) { this.listeners.add(listener); listener(this.value); return () => { this.listeners.delete(listener); }; }
  /** 直接写入后端返回的未读数（如「标记已读」的响应）；同时让仍在路上的旧刷新作废。 */
  set(count: UnreadCount) { this.sequence++; this.value = count; this.listeners.forEach((listener) => listener(count)); }
  /** 退出登录等场景清零。 */
  clear() { this.set(NO_UNREAD); }
  /** 重新读取未读数；先发后到的旧响应不会覆盖新结果，读取失败保留原值且不打断页面。 */
  async refresh() {
    const request = ++this.sequence;
    try {
      const count = await this.fetchCount();
      if (request === this.sequence) { this.value = count; this.listeners.forEach((listener) => listener(count)); }
    } catch { /* 未读数失败不影响主流程 */ }
    return this.value;
  }
}
