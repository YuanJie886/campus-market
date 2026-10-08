// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import type { CampusMarketApi } from './api/contracts';
import { DEMAND_DRAFT_KEY } from './components/demand/DemandEmptyStateCta';
import { DEMAND_POLL_INTERVAL_MS, useDemandUnread } from './hooks/useDemandUnread';
import { fullDisclosure } from './test/inspectionFixtures';

/**
 * 需求雷达的界面行为：搜索空态入口（2.5）、收件箱与未读（2.4）。
 */

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <DemandUnreadProvider>
              <App />
            </DemandUnreadProvider>
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

/** 首页关键词由 URL 的 ?keyword= 驱动（导航栏搜索提交后即跳到这里）。 */
const searchUrl = (keyword: string, extra = '') => `/?keyword=${encodeURIComponent(keyword)}${extra}`;

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => vi.useRealTimers());

async function signIn(account = `u-${Math.random().toString(36).slice(2)}`) {
  await api.register({ account, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
  return account;
}

describe('2.5 搜索空态订阅入口', () => {
  it('1. 搜索无结果时，入口直接出现在空态里', async () => {
    await signIn();
    renderApp(searchUrl('根本不存在的东西zzz'));
    expect(await screen.findByText('没有找到？订阅一下，有货第一时间通知你。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '订阅这个需求' })).toBeTruthy();
  });

  it('2. 已登录：预填当前关键词，确认后创建；再次提交同条件提示「已订阅」', async () => {
    await signIn();
    renderApp(searchUrl('没有的台灯xyz'));
    fireEvent.click(await screen.findByRole('button', { name: '订阅这个需求' }));
    const keyword = await screen.findByLabelText('关键词');
    expect((keyword as HTMLInputElement).value).toBe('没有的台灯xyz');

    fireEvent.click(screen.getByRole('button', { name: '确认订阅' }));
    expect(await screen.findByText(/订阅成功/)).toBeTruthy();
    expect((await api.listDemandSubscriptions())[0].keyword).toBe('没有的台灯xyz');

    // 对话框关闭动画期间 MUI 仍会给背景加 aria-hidden，这里等它结束
    fireEvent.click(await screen.findByRole('button', { name: '订阅这个需求' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认订阅' }));
    expect(await screen.findByText(/已经订阅过相同条件/)).toBeTruthy();
    expect(await api.listDemandSubscriptions()).toHaveLength(1);
  });

  it('3. 创建后可撤销：订阅被停用', async () => {
    await signIn();
    renderApp(searchUrl('可撤销的需求abc'));
    fireEvent.click(await screen.findByRole('button', { name: '订阅这个需求' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认订阅' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText('已撤销这条订阅')).toBeTruthy();
    expect((await api.listDemandSubscriptions())[0].active).toBe(false);
  });

  it('4. 开启「只看本楼」时预填 canonical 的 BUILDING 范围，而不是展示文案', async () => {
    await signIn();
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    renderApp(searchUrl('本楼没有的东西qqq'));
    fireEvent.click(await screen.findByRole('checkbox', { name: '只看本楼' }));
    fireEvent.click(await screen.findByRole('button', { name: '订阅这个需求' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: '确认订阅' }));
    await screen.findByText(/订阅成功/);
    const [sub] = await api.listDemandSubscriptions();
    expect(sub.geoScope).toBe('BUILDING');
    expect(sub.buildingId).toBe('east-qinyuan-1');
  });

  it('5. 未登录（6.1A）：搜索页只有落地页与登录入口，不展示任何搜索结果或订阅入口，也不写入任何草稿', async () => {
    renderApp(searchUrl('登录后再订阅的东西'));
    expect(await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '订阅这个需求' })).toBeNull();
    expect(screen.queryByText('没有找到？订阅一下，有货第一时间通知你。')).toBeNull();
    expect(window.sessionStorage.getItem(DEMAND_DRAFT_KEY)).toBeNull();
  });

  it('6. 登录回来后恢复草稿并打开订阅确认', async () => {
    window.sessionStorage.setItem(DEMAND_DRAFT_KEY, JSON.stringify({ keyword: '恢复的草稿', geoScope: 'SCHOOL' }));
    await signIn();
    // 回到登录前的同一个搜索页；此时结果是否为空都不影响恢复
    renderApp('/?resumeSubscribe=1');
    const keyword = await screen.findByLabelText('关键词', undefined, { timeout: 5000 });
    expect((keyword as HTMLInputElement).value).toBe('恢复的草稿');
    expect(window.sessionStorage.getItem(DEMAND_DRAFT_KEY)).toBeNull();
  });
});

describe('2.4 收件箱', () => {
  async function seedMatch(title = '收件箱台灯') {
    const buyer = await signIn();
    await api.createDemandSubscription({ keyword: title });
    await api.logout();
    await signIn();
    const product = await api.createProduct({ title, description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: ['https://example.invalid/a.png'], contact: '13900000000', inspection: fullDisclosure('生活用品') });
    await api.logout();
    await api.login({ account: buyer, password: 'test-password' });
    return product;
  }

  it('7. 展示命中条件、匹配理由、匹配档位；「去预约面交」进入现有预约流程', async () => {
    const product = await seedMatch();
    renderApp('/demands');
    expect(await screen.findByText(/命中订阅：关键词「收件箱台灯」/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/匹配理由：标题与关键词完全一致/)).toBeTruthy();
    expect(screen.getByText('一般匹配')).toBeTruthy();
    const book = screen.getByRole('link', { name: '去预约面交' });
    expect(book.getAttribute('href')).toBe(`/product/${product.id}?book=1`);
    // 收件箱里不出现卖家联系方式
    expect(document.body.textContent).not.toContain('13900000000');
  });

  it('8. 标记已读后导航栏角标与列表同步更新', async () => {
    await seedMatch();
    renderApp('/demands');
    expect(await screen.findByRole('button', { name: '需求匹配，1 条未读' }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '标记已读' }));
    expect(await screen.findByRole('button', { name: '需求匹配' })).toBeTruthy();
    expect(screen.queryByText('未读')).toBeNull();
  });

  it('9. 忽略后从列表消失', async () => {
    await seedMatch();
    renderApp('/demands');
    fireEvent.click(await screen.findByRole('button', { name: '忽略' }, { timeout: 5000 }));
    expect(await screen.findByText(/还没有匹配/)).toBeTruthy();
  });

  it('10. 失效的匹配不再提供「去预约面交」', async () => {
    const product = await seedMatch();
    const matches = await api.listDemandMatches();
    // 直接把商品置为已售出，模拟被他人买走
    (api as unknown as { db: { market: { products: Array<{ id: string; status: string }> } } })
      .db.market.products.find((p) => p.id === product.id)!.status = '已售出';
    renderApp('/demands');
    expect(await screen.findByText('已被预约或售出，暂不可购买', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '去预约面交' })).toBeNull();
    expect(matches.items).toHaveLength(1);
  });

  it('11. 未登录访问 /demands 跳转登录', async () => {
    renderApp('/demands');
    expect(await screen.findByRole('button', { name: '一键体验账号' }, { timeout: 5000 })).toBeTruthy();
  });

  it('12. 从匹配进入详情页（?book=1）只是打开现有预约弹窗，必须由用户确认，不会自动下单', async () => {
    const product = await seedMatch();
    renderApp(`/product/${product.id}?book=1`);
    expect(await screen.findByText('预约校园面交', undefined, { timeout: 5000 })).toBeTruthy();
    expect((await api.listOrders('all')).filter((o) => o.productId === product.id)).toHaveLength(0);
  });
});

describe('2.4 未读轮询', () => {
  function apiWith(getDemandUnreadCount: () => Promise<number>): CampusMarketApi {
    return new Proxy(new MockCampusMarketApi(), {
      get(target, prop, receiver) {
        if (prop === 'getDemandUnreadCount') return getDemandUnreadCount;
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as CampusMarketApi;
  }

  it('13. 未登录不发请求', async () => {
    const fn = vi.fn(async () => 1);
    setApiClient(apiWith(fn));
    renderHook(() => useDemandUnread(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).not.toHaveBeenCalled();
  });

  it('14. 前台低频轮询；切到后台停止；重新可见立即刷新', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => 2);
    setApiClient(apiWith(fn));
    const { result } = renderHook(() => useDemandUnread(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0) });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(DEMAND_POLL_INTERVAL_MS) });
    expect(fn).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(DEMAND_POLL_INTERVAL_MS * 3) });
    expect(fn).toHaveBeenCalledTimes(2);   // 后台期间一次都没有

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0) });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('15. 429 严格遵守 Retry-After，期间不重试', async () => {
    vi.useFakeTimers();
    let calls = 0;
    setApiClient(apiWith(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError({ code: 429, message: '太频繁', retryAfterSeconds: 120 });
      return 0;
    }));
    renderHook(() => useDemandUnread(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0) });
    expect(calls).toBe(1);
    // 期间触发焦点刷新也不得提前请求
    window.dispatchEvent(new Event('focus'));
    await act(async () => { await vi.advanceTimersByTimeAsync(119_000) });
    expect(calls).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) });
    expect(calls).toBe(2);
  });

  it('16. 网络失败指数退避，不形成请求风暴', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => { throw new ApiError({ code: -1, message: '网络错误' }) });
    setApiClient(apiWith(fn));
    renderHook(() => useDemandUnread(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) });
    // 10 分钟内：首次 + 2 分钟 + 4 分钟 + ……，远少于每分钟一次
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('17. 登出后立即停止并清零；卸载后不再请求', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => 5);
    setApiClient(apiWith(fn));
    const { result, rerender, unmount } = renderHook(({ on }) => useDemandUnread(on), { initialProps: { on: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0) });
    expect(result.current.count).toBe(5);

    rerender({ on: false });
    expect(result.current.count).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(DEMAND_POLL_INTERVAL_MS * 3) });
    expect(fn).toHaveBeenCalledTimes(1);

    rerender({ on: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0) });
    unmount();
    const before = fn.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DEMAND_POLL_INTERVAL_MS * 3) });
    expect(fn.mock.calls.length).toBe(before);
  });
});
