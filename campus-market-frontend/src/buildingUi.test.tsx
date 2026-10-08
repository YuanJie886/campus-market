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
import CampusMap from './components/CampusMap';
import { seedBuildings, seedMeetingPointCoordinates } from './data/buildings';
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

function toggle() {
  return screen.getByRole('checkbox', { name: '只看本楼' });
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
  // 6.1A 起商品需要登录：默认以一位试点学校的同学登录（登录态写进 Mock 存储，apiWith 新建的 Mock 同样读到）
  const api = new MockCampusMarketApi();
  await api.register({ account: `viewer-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
  setApiClient(api);
});

describe('1.4 首页「只看本楼」', () => {
  it('1. 开关常驻可见，且不在折叠的高级筛选里', async () => {
    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    expect(toggle().closest('[hidden]')).toBeNull();
    expect((toggle() as HTMLInputElement).checked).toBe(false);
  });

  it('2. 未登录：首页只有落地页与登录注册入口，没有「只看本楼」开关、商品或搜索结果（6.1A）', async () => {
    const api = new MockCampusMarketApi();
    await api.logout();
    setApiClient(api);
    renderApp('/');
    const heading = await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 });
    expect(within(heading.closest('section')!).getByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '只看本楼' })).toBeNull();
    expect(document.querySelector('.cm-apple-grid-wrapper')).toBeNull();
  });

  it('3. 已登录但未设置宿舍楼：引导去资料页，不偷偷扩大范围', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({ account: 'nodorm-ui', password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });

    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByText(/还没有填写宿舍楼/)).toBeTruthy());
    expect(screen.getByRole('link', { name: '去设置' }).getAttribute('href')).toBe('/profile');
  });

  it('4. 本楼有结果：不出现降级提示', async () => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({ total: 1, items: [feedItem({ sameBuilding: true })] }),
    }));
    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getAllByText('同楼栋').length).toBeGreaterThan(0));
    expect(screen.queryByText(/本楼暂无匹配/)).toBeNull();
  });

  it.each([
    ['ZONE', '本园区'], ['CAMPUS', '本校区'], ['SCHOOL', '全校'],
  ] as const)('5. 降级到 %s：非阻塞提示说明实际范围', async (scope, label) => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({
        effectiveScope: scope, effectiveScopeLabel: label, fallbackApplied: true,
        fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', total: 1, items: [feedItem({})],
      }),
    }));
    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByText(new RegExp(`已为你展示${label}的商品`))).toBeTruthy());
    // 非阻塞：不是 dialog，商品照常展示
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('6. 全校也为空：正常空态提示', async () => {
    setApiClient(apiWith({
      feedProducts: async () => feedPage({
        effectiveScope: 'SCHOOL', effectiveScopeLabel: '全校', fallbackApplied: true,
        fallbackReason: 'NO_RESULTS_IN_ANY_SCOPE', total: 0, items: [],
      }),
    }));
    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByText(/全校都没有符合条件的商品/)).toBeTruthy());
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
    await waitFor(() => expect(toggle()).toBeTruthy());

    fireEvent.click(toggle());          // 第 1 次请求（慢）
    fireEvent.click(toggle());          // 关
    fireEvent.click(toggle());          // 第 2 次请求（快）
    await waitFor(() => expect(screen.getAllByText('新结果商品').length).toBeGreaterThan(0));

    await act(async () => {
      resolveSlow(feedPage({ total: 1, items: [feedItem({ title: '过期旧结果' })] }));
    });
    expect(screen.queryByText('过期旧结果')).toBeNull();
    expect(screen.getAllByText('新结果商品').length).toBeGreaterThan(0);
  });

  it('8. feed 出错时提示仍带 requestId', async () => {
    setApiClient(apiWith({
      feedProducts: async () => { throw new ApiError({ code: 500, message: '服务器开小差了', requestId: 'rid-feed-01' }) },
    }));
    renderApp('/');
    await waitFor(() => expect(toggle()).toBeTruthy());
    fireEvent.click(toggle());
    await waitFor(() => expect(screen.getByText(/rid-feed-01/)).toBeTruthy());
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
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
  it('9. 有楼栋：显示「园区 · 楼栋」', () => {
    renderInShell(<ProductCard product={baseProduct({ buildingId: 'east-songyuan-4', buildingName: '4号楼', buildingZone: '松园' })} />);
    expect(screen.getByText('松园 · 4号楼')).toBeTruthy();
  });

  it('10. 同楼栋：显示「同楼栋」而不是 0 分钟', () => {
    renderInShell(<ProductCard product={feedItem({ sameBuilding: true, approximateWalkMinutes: null })} />);
    expect(screen.getByText('同楼栋')).toBeTruthy();
    expect(screen.queryByText(/0 分钟/)).toBeNull();
  });

  it('11. 异楼栋：显示「步行约 N 分钟」并注明是直线估算', () => {
    renderInShell(<ProductCard product={feedItem({ approximateWalkMinutes: 5 })} />);
    const label = screen.getByText('步行约 5 分钟');
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

describe('1.5 校园示意地图', () => {
  const eastBuildings = seedBuildings.filter((b) => b.campusId === '东校区');
  const eastPoints = Object.entries(seedMeetingPointCoordinates)
    .filter(([id]) => id.startsWith('东校区'))
    .map(([id, c]) => ({ id, campus: '东校区' as const, name: id.endsWith('library') ? '图书馆门口' : id.endsWith('canteen') ? '食堂入口' : '快递站', ...c }));

  it('17. 楼栋点与面交点都被绘制，图例与「直线估算」说明存在', () => {
    render(<CampusMap buildings={eastBuildings} meetingPoints={eastPoints}
      productBuildingId="east-songyuan-4" viewerBuildingId="east-qinyuan-1" />);
    for (const b of eastBuildings) expect(screen.getByTestId(`map-building-${b.id}`)).toBeTruthy();
    for (const p of eastPoints) expect(screen.getByTestId(`map-point-${p.id}`)).toBeTruthy();
    expect(screen.getByText('取货楼栋')).toBeTruthy();
    expect(screen.getByText('稳定面交点')).toBeTruthy();
    expect(screen.getByText(/距离为直线估算，实际路线以校园道路为准/)).toBeTruthy();
  });

  it('18. 推荐恰好一个，且只是建议：点选后才成为候选，不会自动提交', () => {
    const onPick = vi.fn();
    render(<CampusMap buildings={eastBuildings} meetingPoints={eastPoints}
      productBuildingId="east-songyuan-4" viewerBuildingId="east-qinyuan-1" onPick={onPick} />);
    const list = screen.getByRole('list', { name: '稳定面交点' });
    expect(within(list).getAllByText('推荐')).toHaveLength(1);
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(within(list).getAllByRole('button')[0]);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('19. 缺坐标安全降级：不推荐、给出说明', () => {
    render(<CampusMap buildings={eastBuildings} meetingPoints={eastPoints}
      productBuildingId={null} viewerBuildingId="east-qinyuan-1" />);
    expect(screen.queryByText('推荐')).toBeNull();
    expect(screen.getByText(/缺少楼栋坐标，无法估算距离/)).toBeTruthy();
  });

  it('20. 不调用浏览器定位，也不加载任何第三方地图脚本', () => {
    const geolocation = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    const scriptsBefore = document.querySelectorAll('script').length;

    render(<CampusMap buildings={eastBuildings} meetingPoints={eastPoints}
      productBuildingId="east-songyuan-4" viewerBuildingId="east-qinyuan-1" />);

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('21. 移动端不溢出：SVG 以 viewBox 自适应宽度', () => {
    render(<CampusMap buildings={eastBuildings} meetingPoints={eastPoints} />);
    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBeTruthy();
    expect(svg.getAttribute('class')).toContain('w-full');
    expect(svg.getAttribute('class')).toContain('max-w-full');
    expect(svg.getAttribute('width')).toBeNull();   // 不写死像素宽度
  });
});
