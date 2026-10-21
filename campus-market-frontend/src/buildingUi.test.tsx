// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import type { CampusMarketApi, FeedPage, FeedProduct } from './api/contracts';
import ProductCard from './components/ProductCard';
import BuildingSelect from './components/BuildingSelect';
import { seedBuildings } from './data/buildings';
import type { Product } from './types';

/**
 * 楼栋集市的界面行为（1.4）与校园示意地图（1.5）。
 */

function renderApp(path = '/') {
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

function renderInShell(node: JSX.Element) {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>{node}</MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

/** 范围切换里的某一项（REWRITTEN：原「只看本楼」开关已改为与小程序一致的 本楼 / 本校区 / 全校 单选组） */
function scope(name: '本楼' | '本校区' | '全校' = '本楼') {
  return screen.getByRole('radio', { name });
}

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-ui', title: '测试台灯', description: 'd', price: 30, category: '生活用品', condition: '全新',
    campus: '东校区', images: ['https://example.invalid/a.png'], contact: '', sellerId: 'u-x',
    status: '在售', views: 0, createdAt: Date.now(), ...overrides,
  };
}

function feedPage(overrides: Partial<FeedPage>): FeedPage {
  return {
    requestedScope: 'BUILDING', effectiveScope: 'BUILDING', effectiveScopeLabel: '本楼',
    fallbackApplied: false, fallbackReason: null, items: [], page: 1, pageSize: 100, total: 0,
    ...overrides,
  };
}

/** 在指定方法上替换行为，其余照常走 Mock。 */
function apiWith(overrides: Partial<CampusMarketApi>): CampusMarketApi {
  const base = new MockCampusMarketApi();
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop in overrides) return (overrides as Record<string | symbol, unknown>)[prop];
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as CampusMarketApi;
}

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();   // 首页范围按会话记忆：每条用例从默认的「全校」开始
  // 6.1A 起商品需要登录：默认以一位试点学校的同学登录（登录态写进 Mock 存储，apiWith 新建的 Mock 同样读到）
  const api = new MockCampusMarketApi();
  await api.register({ account: `viewer-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
  setApiClient(api);
});

/*
 * REWRITTEN（首页范围切换对齐小程序）：1–8 原先操作「只看本楼」开关（checkbox），开关已替换为 本楼 / 本校区 / 全校 单选组；
 * 断言的行为不变（常驻可见、未登录只有落地页、409 引导、降级提示、全校为空、无竞态、错误带 requestId），
 * 只是触发方式改为选择「本楼」，文案改为小程序 src/feed.ts 的原文。完整的范围语义矩阵见 homeUi.test.tsx。
 */
describe('1.4 首页范围切换（本楼）', () => {
  it('1. 范围切换常驻可见（不在折叠的高级筛选里），默认「全校」', async () => {
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    expect(scope().closest('[hidden]')).toBeNull();
    expect((scope('全校') as HTMLInputElement).checked).toBe(true);
    expect((scope() as HTMLInputElement).checked).toBe(false);
  });

  it('2. 未登录：首页只有落地页与登录注册入口，没有范围切换、商品或搜索结果（6.1A）', async () => {
    const api = new MockCampusMarketApi();
    await api.logout();
    setApiClient(api);
    renderApp('/');
    const heading = await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 });
    expect(within(heading.parentElement!).getByRole('button', { name: '登录 / 注册' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: '商品范围' })).toBeNull();
    expect(screen.queryByRole('list', { name: '商品列表' })).toBeNull();
  });

  it('3. 已登录但未设置宿舍楼：引导去资料页，不偷偷扩大范围', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({ account: 'nodorm-ui', password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });

    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    fireEvent.click(scope());
    await waitFor(() => expect(screen.getByText(/还没有填写宿舍楼/)).toBeTruthy());
    expect(screen.getByRole('link', { name: '去设置' }).getAttribute('href')).toBe('/profile');
    expect(screen.queryByRole('list', { name: '商品列表' })).toBeNull();
  });

  it('4. 本楼有结果：不出现降级提示', async () => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({ total: 1, items: [feedItem({ sameBuilding: true })] }),
    }));
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    fireEvent.click(scope());
    await waitFor(() => expect(screen.getAllByText('同楼栋').length).toBeGreaterThan(0));
    expect(screen.queryByText(/本楼暂无匹配/)).toBeNull();
  });

  it.each([
    ['ZONE', '本园区'], ['CAMPUS', '本校区'], ['SCHOOL', '全校'],
  ] as const)('5. 降级到 %s：非阻塞提示说明实际范围', async (effective, label) => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({
        effectiveScope: effective, effectiveScopeLabel: label, fallbackApplied: true,
        fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', total: 1, items: [feedItem({})],
      }),
    }));
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    fireEvent.click(scope());
    await waitFor(() => expect(screen.getByText(`本楼暂无匹配，已为你展示${label}的商品（筛选条件保持不变）。`)).toBeTruthy());
    // 非阻塞：不是 dialog，商品照常展示
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('list', { name: '商品列表' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('6. 全校也为空：提示「全校都没有」，并给出空态与订阅入口', async () => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({
        effectiveScope: 'SCHOOL', effectiveScopeLabel: '全校', fallbackApplied: true,
        fallbackReason: 'NO_RESULTS_IN_ANY_SCOPE', total: 0, items: [],
      }),
    }));
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    fireEvent.click(scope());
    await waitFor(() => expect(screen.getByText('全校都没有符合条件的商品。试着放宽筛选，或发布一条求购。')).toBeTruthy());
    expect(screen.getByRole('button', { name: '订阅这个需求' })).toBeTruthy();
  });

  it('7. 快速切换无竞态：慢的旧响应不会覆盖新结果', async () => {
    let resolveSlow: (page: FeedPage) => void = () => {};
    let call = 0;
    setApiClient(apiWith({
      feedProducts: () => {
        call += 1;
        if (call === 1) return new Promise<FeedPage>((resolve) => { resolveSlow = resolve });
        return Promise.resolve(feedPage({ total: 1, items: [feedItem({ title: '新结果商品' })] }));
      },
    }));
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());

    fireEvent.click(scope());           // 第 1 次请求（慢）
    fireEvent.click(scope('全校'));     // 切走
    fireEvent.click(scope());           // 第 2 次请求（快）
    await waitFor(() => expect(screen.getAllByText('新结果商品').length).toBeGreaterThan(0));

    await act(async () => {
      resolveSlow(feedPage({ total: 1, items: [feedItem({ title: '过期旧结果' })] }));
    });
    expect(screen.queryByText('过期旧结果')).toBeNull();
    expect(screen.getAllByText('新结果商品').length).toBeGreaterThan(0);
  });

  it('8. feed 出错时提示仍带 requestId，可重新加载', async () => {
    setApiClient(apiWith({
      feedProducts: async () => { throw new ApiError({ code: 500, message: '服务器开小差了', requestId: 'rid-feed-01' }) },
    }));
    renderApp('/');
    await waitFor(() => expect(scope()).toBeTruthy());
    fireEvent.click(scope());
    await waitFor(() => expect(screen.getByText(/rid-feed-01/)).toBeTruthy());
    expect(screen.getByRole('heading', { name: '暂时无法加载' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
  });
});

function feedItem(overrides: Partial<FeedProduct>): FeedProduct {
  return {
    ...baseProduct({ id: `p-${Math.random().toString(36).slice(2)}`, buildingId: 'east-qinyuan-2', buildingName: '2号楼', buildingZone: '沁园' }),
    sameBuilding: false, approximateDistanceMeters: 100, approximateWalkMinutes: 2,
    ...overrides,
  };
}

describe('1.4 商品卡片', () => {
  it('9. 有楼栋：显示「校区 · 楼栋」（与小程序一致，REWRITTEN：原为园区）', () => {
    renderInShell(<ProductCard product={baseProduct({ buildingId: 'east-songyuan-4', buildingName: '4号楼', buildingZone: '松园' })} />);
    expect(screen.getByText('东校区 · 4号楼')).toBeTruthy();
    expect(screen.queryByText('松园 · 4号楼')).toBeNull();
  });

  it('10. 同楼栋：显示「同楼栋」而不是 0 分钟', () => {
    renderInShell(<ProductCard product={feedItem({ sameBuilding: true, approximateWalkMinutes: null })} />);
    expect(screen.getByText('同楼栋')).toBeTruthy();
    expect(screen.queryByText(/0 分钟/)).toBeNull();
  });

  // REWRITTEN：距离文案改为与小程序 distanceText 相同的「约 N 分钟步行」（原为「步行约 N 分钟」），仍注明直线估算
  it('11. 异楼栋：显示「约 N 分钟步行」并注明是直线估算', () => {
    renderInShell(<ProductCard product={feedItem({ approximateWalkMinutes: 5 })} />);
    const label = screen.getByText('约 5 分钟步行');
    expect(label.getAttribute('title')).toContain('直线估算');
  });

  it('12. 无楼栋：回退显示校区，不显示任何距离', () => {
    renderInShell(<ProductCard product={baseProduct({ buildingId: null, buildingName: null })} />);
    expect(screen.getByText('东校区')).toBeTruthy();
    expect(screen.queryByText(/分钟/)).toBeNull();
    expect(screen.queryByText('同楼栋')).toBeNull();
  });
});

describe('1.4 楼栋选择（资料页 / 发布页共用）', () => {
  it('13. 级联选择：label 与控件正确关联，可键盘聚焦，提供「不填写」', async () => {
    const onChange = vi.fn();
    renderInShell(<BuildingSelect campus="东校区" value={null} onChange={onChange} emptyLabel="不填写" buildingLabel="宿舍楼" zoneLabel="宿舍园区" />);
    const building = await screen.findByLabelText('宿舍楼');
    const zone = screen.getByLabelText('宿舍园区');
    expect(building).toBeTruthy();
    expect(zone).toBeTruthy();
    building.focus();
    expect(document.activeElement).toBe(building);
  });

  it('14. 校区切换后，不属于新校区的旧选择被立即清空', async () => {
    const onChange = vi.fn();
    const { rerender } = renderInShell(<BuildingSelect campus="东校区" value="east-qinyuan-1" onChange={onChange} />);
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());

    rerender(
      <MemoryRouter><NotificationProvider><AuthProvider><MarketProvider>
        <BuildingSelect campus="西校区" value="east-qinyuan-1" onChange={onChange} />
      </MarketProvider></AuthProvider></NotificationProvider></MemoryRouter>,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it('15. 同校区的合法旧选择被保留（编辑页场景）', async () => {
    const onChange = vi.fn();
    renderInShell(<BuildingSelect campus="东校区" value="east-songyuan-4" onChange={onChange} />);
    await screen.findByLabelText('楼栋');
    // 等列表加载完成后，合法值不应触发清空
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalledWith(null);
  });

  it('16. 发布页预填本人宿舍楼，并明确写出将公开的楼栋；可改为「不指定楼栋」', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({ account: 'publisher-ui', password: 'test-password', nickname: '卖家', campus: '东校区', contact: '13800000000' });
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-2' });

    renderApp('/publish');
    await waitFor(() => expect(screen.getByText(/买家会在商品页看到：沁园 · 2号楼/)).toBeTruthy(), { timeout: 5000 });

    // 通过 MUI Select 的原生 input 改为「不指定」
    const hidden = document.querySelectorAll<HTMLInputElement>('input[type="hidden"], input.MuiSelect-nativeInput');
    const buildingInput = Array.from(hidden).find((input) => input.value === 'east-qinyuan-2');
    expect(buildingInput).toBeTruthy();
    fireEvent.change(buildingInput!, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/不指定楼栋时，买家只会看到校区/)).toBeTruthy());
  });
});
