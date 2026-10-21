/**
 * 渲染用例的公共准备。
 *
 * <p>当前 jsdom 环境没有提供 `localStorage`（`window.localStorage` 为 undefined），
 * 而 Mock 适配层与 0.9A 的遗留 key 清理都会访问它。这里补一个纯内存实现：
 * 只为让测试跑起来，行为与浏览器一致，并在每个文件之间互不残留。
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
}

if (typeof window !== 'undefined' && !window.localStorage) {
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
}

/**
 * jsdom 没有实现 IntersectionObserver（首页用它做图片/列表的懒显示），
 * 也没有实现 window.scrollTo（Layout 在路由切换时调用）。
 * 两者都是纯视觉行为，这里给最小实现，让渲染断言能聚焦在路由本身。
 */
if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
  class NoopIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    value: NoopIntersectionObserver, configurable: true, writable: true,
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: NoopIntersectionObserver, configurable: true, writable: true,
  });
  Object.defineProperty(window, 'scrollTo', { value: () => {}, configurable: true, writable: true });
}

// Vitest 未开启 globals，@testing-library/react 的自动清理不会注册。
// 手动接上，避免上一条用例的 DOM 残留影响下一条的查询。
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  const { afterEach } = await import('vitest');
  afterEach(() => cleanup());
}
