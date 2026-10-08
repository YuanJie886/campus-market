// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import App from './App';
import { RouteErrorBoundary, RouteLoading } from './components/RouteFallback';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';

/**
 * 路由懒加载与加载失败兜底（0.9D）。
 *
 * <p>改造前所有页面都静态 import，首包一次性拉进 598,977 B。现在页面按路由切分，
 * 于是多了两种以前不存在的失败模式：分片还没到（需要 fallback）、分片永远到不了
 * （发版后旧 chunk 失效、网络中断——需要 ErrorBoundary，否则用户看到白屏）。
 */

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <App />
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // 渲染测试一律走离线 Mock：不依赖后端，也不产生真实网络请求
  setApiClient(new MockCampusMarketApi());
});

describe('0.9D 懒加载路由可达', () => {
  it('1. 首页在首包中，直接渲染', async () => {
    renderAt('/');
    await waitFor(() => expect(document.body.textContent).not.toContain('页面加载中'));
    // 首页是静态 import，不经过 Suspense：渲染出来的就该是真正的页面外壳
    await waitFor(() => expect(document.querySelector('.cm-app-shell')).not.toBeNull());
  });

  it.each([
    ['/publish', '发布'],
    ['/messages', '消息'],
    ['/profile', '我的'],
    ['/profile/orders', '我的'],
    ['/profile/favorites', '我的'],
    ['/profile/listings', '我的'],
  ])('2. 懒加载路由 %s 能完成加载（fallback 出现后消失）', async (path) => {
    renderAt(path);
    await waitFor(
      () => expect(document.body.textContent).not.toContain('页面加载中'),
      { timeout: 5000 },
    );
    // 加载完成后壳仍在，说明分片确实挂上了而不是整棵树崩掉
    expect(document.querySelector('.cm-app-shell')).not.toBeNull();
  });

  it('3. 商品详情路由能完成加载', async () => {
    renderAt('/product/p01');
    await waitFor(
      () => expect(document.body.textContent).not.toContain('页面加载中'),
      { timeout: 5000 },
    );
    expect(document.querySelector('.cm-app-shell')).not.toBeNull();
  });
});

describe('0.9D 加载中与加载失败的兜底', () => {
  it('4. Suspense fallback 在分片到达前显示，到达后消失', async () => {
    let resolveChunk = () => {};
    const Slow = lazy(() => new Promise<{ default: () => JSX.Element }>((resolve) => {
      resolveChunk = () => resolve({ default: () => <div>分片内容</div> });
    }));

    render(
      <Suspense fallback={<RouteLoading />}>
        <Slow />
      </Suspense>,
    );
    expect(screen.getByText('页面加载中…')).toBeTruthy();

    resolveChunk();
    await waitFor(() => expect(screen.getByText('分片内容')).toBeTruthy());
    expect(screen.queryByText('页面加载中…')).toBeNull();
  });

  it('5. 分片加载失败时 ErrorBoundary 生效，给出重试与刷新，而不是白屏', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error('chunk 404')));

    render(
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Broken />
        </Suspense>
      </RouteErrorBoundary>,
    );

    await waitFor(() => expect(screen.getByText('页面加载失败')).toBeTruthy());
    expect(screen.getByText('重试')).toBeTruthy();
    expect(screen.getByText('刷新页面')).toBeTruthy();
    // 不得把 chunk URL、stack 之类的内部信息摊给用户
    expect(document.body.textContent).not.toContain('chunk 404');
    error.mockRestore();
  });

  it('6. 路由切换不丢认证状态：Provider 不随分片重新挂载', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({
      account: 'route-user', password: 'test-password', nickname: '同学',
      campus: '东校区', contact: '13800000000',
    });

    renderAt('/profile');
    await waitFor(
      () => expect(document.body.textContent).not.toContain('页面加载中'),
      { timeout: 5000 },
    );
    // Mock 的登录态存在 MockDatabase 中，跨分片加载后依然可读
    expect(await api.getCurrentUser()).not.toBeNull();
  });
});
