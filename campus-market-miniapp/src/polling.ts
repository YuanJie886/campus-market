/**
 * 只在页面显示时进行的轮询（不依赖 Taro，便于测试）：页面显示时 start（立即执行一次再按间隔执行），
 * 隐藏或卸载时 stop。上一次还没结束时跳过这一拍，不叠加请求。
 */
export interface TimerPort { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void }
const defaultTimers: TimerPort = { set: (callback, ms) => setInterval(callback, ms), clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>) };

export class Poller {
  private handle: unknown = null;
  private running = false;
  constructor(private readonly task: () => Promise<unknown> | unknown, private readonly intervalMs: number, private readonly timers: TimerPort = defaultTimers) {}
  get active() { return this.handle !== null; }
  start() {
    if (this.handle !== null) return;
    this.handle = this.timers.set(() => { void this.tick(); }, this.intervalMs);
    void this.tick();
  }
  stop() { if (this.handle !== null) { this.timers.clear(this.handle); this.handle = null; } }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.task(); } catch { /* 轮询失败不打断页面，下一拍再试 */ } finally { this.running = false; }
  }
}
