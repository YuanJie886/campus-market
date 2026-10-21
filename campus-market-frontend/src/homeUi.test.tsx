// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import { ApiError } from './api/errors';
import type { CampusMarketApi, FeedPage, FeedProduct, FeedQuery, ProductCreateInput } from './api/contracts';
import ProductCard from './components/ProductCard';
import { axeViolations } from './test-axe';
import { fullDisclosure } from './test/inspectionFixtures';
import { MARKET_SCOPE_KEY } from './utils/marketScope';
import type { Product } from './types';

/**
 * 首页对齐小程序（主产品）：范围切换 本楼 / 本校区 / 全校 的请求参数、放宽文案、409 / 401 引导、空态订阅入口；
 * 未登录落地页；商品网格与卡片结构；无障碍。小程序的对照实现见 campus-market-miniapp/src/feed.ts 与 pages/market。
 */

let lastPath = '';
function PathProbe() {
  const location = useLocation();
  lastPath = `${location.pathname}${location.search}`;
  return null;
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <DemandUnreadProvider>
              <App />
              <PathProbe />
            </DemandUnreadProvider>
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

function renderInShell(node: JSX.Element) {
  return render(
    <MemoryRouter>
      <NotificationProvider><AuthProvider><MarketProvider>{node}</MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

const last = <T,>(list: T[]): T | undefined => list[list.length - 1];
const radio = (name: '本楼' | '本校区' | '全校') => screen.getByRole('radio', { name }) as HTMLInputElement;
const findRadio = (name: '本楼' | '本校区' | '全校') => screen.findByRole('radio', { name }, { timeout: 5000 }) as Promise<HTMLInputElement>;

function feedPage(overrides: Partial<FeedPage>): FeedPage {
  return {
    requestedScope: 'BUILDING', effectiveScope: 'BUILDING', effectiveScopeLabel: '本楼',
    fallbackApplied: false, fallbackReason: null, items: [], page: 1, pageSize: 40, total: 0,
    ...overrides,
  };
}

function feedItem(overrides: Partial<FeedProduct> = {}): FeedProduct {
  return {
    id: `p-${Math.random().toString(36).slice(2)}`, title: '范围台灯', description: 'd', price: 30, category: '生活用品',
    condition: '全新', campus: '东校区', images: [], contact: '', sellerId: 'u-x', status: '在售', views: 0,
    createdAt: Date.now() - 2 * 3600_000, sameBuilding: false, approximateDistanceMeters: null, approximateWalkMinutes: null,
    ...overrides,
  };
}

/** 记录 feed 请求；其余照常走 Mock */
function spyingApi(feed?: (q: FeedQuery) => Promise<FeedPage>) {
  const base = new MockCampusMarketApi();
  const calls: FeedQuery[] = [];
  const api = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'feedProducts') {
        return (q: FeedQuery) => { calls.push(q); return feed ? feed(q) : base.feedProducts(q) };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as CampusMarketApi;
  setApiClient(api);
  return { base, calls };
}

const listing = (title: string, extra: Partial<ProductCreateInput> = {}): ProductCreateInput => ({
  title, description: 'd', price: 20, category: '生活用品', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000', inspection: fullDisclosure('生活用品'), ...extra,
});

let api: MockCampusMarketApi;
beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
  await api.register({ account: `home-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
});

describe('首页范围切换：与小程序相同的语义', () => {
  it('S1. 单选组「商品范围」依次为 本楼 / 本校区 / 全校，默认全校；全校走原来的商品列表，不请求 feed', async () => {
    await api.createProduct(listing('全校列表台灯'));
    const { calls } = spyingApi();
    renderApp('/');
    const group = await screen.findByRole('radiogroup', { name: '商品范围' }, { timeout: 5000 });
    expect(within(group).getAllByRole('radio').map((r) => r.parentElement!.textContent)).toEqual(['本楼', '本校区', '全校']);
    expect(radio('全校').checked).toBe(true);
    expect((await screen.findAllByText('全校列表台灯', undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });

  it('S2. 本楼：GET feed scope=BUILDING，关键词 / 分类 / 成色 / 价格 / 排序逐条保留，不下发校区', async () => {
    const { calls } = spyingApi(async () => feedPage({ total: 0 }));
    renderApp(`/?keyword=${encodeURIComponent('台灯')}`);
    fireEvent.click(await findRadio('本楼'));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 40, keyword: '台灯' });

    fireEvent.click(screen.getByRole('button', { name: /生活用品/ }));
    await waitFor(() => expect(last(calls)).toEqual({ scope: 'BUILDING', sort: 'latest', page: 1, pageSize: 40, keyword: '台灯', category: '生活用品' }));
    // 「本楼 / 本校区」由范围决定校区：筛选面板里没有校区
    fireEvent.click(screen.getByRole('button', { name: /筛选与排序/ }));
    expect(screen.queryByLabelText('校区')).toBeNull();
    fireEvent.change(screen.getByLabelText('最低价'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('最高价'), { target: { value: '50' } });
    await waitFor(() => expect(last(calls)).toMatchObject({ scope: 'BUILDING', minPrice: 5, maxPrice: 50, category: '生活用品' }));
    expect(calls.every((q) => !('campus' in q))).toBe(true);
  });

  it('S3. 本校区：GET feed scope=CAMPUS（本人校区，不需要宿舍楼）；为空就是空——没有放宽提示，给空态与「订阅这个需求」', async () => {
    const { calls } = spyingApi();   // 真实 Mock：本人东校区、未填宿舍楼
    renderApp(`/?keyword=${encodeURIComponent('本校区没有的东西q9')}`);
    fireEvent.click(await findRadio('本校区'));
    await waitFor(() => expect(last(calls)).toEqual({ scope: 'CAMPUS', sort: 'latest', page: 1, pageSize: 40, keyword: '本校区没有的东西q9' }));
    expect(await screen.findByRole('heading', { name: '暂时没有找到合适的好物' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('换个关键词，或者放宽筛选条件试试。')).toBeTruthy();
    expect(screen.getByText('没有找到？订阅一下，有货第一时间通知你。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '订阅这个需求' })).toBeTruthy();
    expect(screen.queryByText(/本楼暂无匹配|全校都没有|还没有填写宿舍楼/)).toBeNull();
  });

  it('S4. 本校区有结果：只列本人校区的商品，不混入其他校区', async () => {
    await api.createProduct(listing('东校区的书架z1'));
    await api.createProduct(listing('西校区的书架z1', { campus: '西校区' }));
    await api.register({ account: `viewer-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '看', campus: '东校区', contact: '1' });
    spyingApi();
    renderApp(`/?keyword=${encodeURIComponent('书架z1')}`);
    fireEvent.click(await findRadio('本校区'));
    const list = await screen.findByRole('list', { name: '商品列表' }, { timeout: 5000 });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    expect(list.textContent).toContain('东校区的书架z1');
    expect(list.textContent).not.toContain('西校区的书架z1');
  });

  it('S5. 本楼放宽：非阻塞的 polite 提示写明实际范围（小程序原文），商品照常展示', async () => {
    spyingApi(async () => feedPage({
      effectiveScope: 'ZONE', effectiveScopeLabel: '本园区', fallbackApplied: true,
      fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', total: 1, items: [feedItem({ title: '园区里的台灯' })],
    }));
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    const notice = await screen.findByText('本楼暂无匹配，已为你展示本园区的商品（筛选条件保持不变）。');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(screen.getAllByText('园区里的台灯').length).toBeGreaterThan(0);
    // 结果条写实际展示的范围
    expect(screen.getByText(/共 1 件/).textContent).toContain('本园区');
  });

  it('S6. 本楼且全校都没有：提示「全校都没有…」，同时给空态与「订阅这个需求」', async () => {
    spyingApi(async () => feedPage({ effectiveScope: 'SCHOOL', effectiveScopeLabel: '全校', fallbackApplied: true, fallbackReason: 'NO_RESULTS_IN_ANY_SCOPE' }));
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    expect(await screen.findByText('全校都没有符合条件的商品。试着放宽筛选，或发布一条求购。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '暂时没有找到合适的好物' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '订阅这个需求' })).toBeTruthy();
  });

  it('S7. 本楼 409（未填宿舍楼）：只给「去设置」引导（小程序原文），不显示结果、空态或订阅入口', async () => {
    spyingApi();   // 真实 Mock：未填宿舍楼 → 409
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    const notice = await screen.findByText('还没有填写宿舍楼。填写后即可只看本楼的闲置；只需要楼栋，不需要房间号。', undefined, { timeout: 5000 });
    expect(within(notice.parentElement!).getByRole('link', { name: '去设置' }).getAttribute('href')).toBe('/profile');
    expect(screen.queryByRole('list', { name: '商品列表' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '暂时没有找到合适的好物' })).toBeNull();
    expect(screen.queryByRole('button', { name: '订阅这个需求' })).toBeNull();
  });

  it('S8. 本楼 401：给「去登录」引导（小程序原文）', async () => {
    spyingApi(async () => { throw new ApiError({ code: 401, message: '请先登录' }) });
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    const notice = await screen.findByText('登录后才能知道你住哪栋楼。我们不会自动定位，也不会替你猜。');
    expect(within(notice.parentElement!).getByRole('link', { name: '去登录' }).getAttribute('href')).toBe('/login');
  });

  it('S9. 本楼（有宿舍楼）真实 Mock：同楼栋商品标出「同楼栋」，切回全校不再请求 feed', async () => {
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    await api.createProduct(listing('同楼的台灯b7', { buildingId: 'east-qinyuan-1' }));
    const { calls } = spyingApi();
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    await waitFor(() => expect(screen.getAllByText('同楼的台灯b7').length).toBeGreaterThan(0), { timeout: 5000 });
    expect(screen.getByText('同楼栋')).toBeTruthy();
    expect(screen.queryByText(/本楼暂无匹配/)).toBeNull();
    const before = calls.length;
    fireEvent.click(radio('全校'));
    await waitFor(() => expect(screen.queryByText('同楼栋')).toBeNull());
    expect(calls.length).toBe(before);
  });

  // 「本楼」→ BUILDING 的预填见 demandUi.test.tsx #4
  it('S10. 订阅预填：本校区 → CAMPUS + 本人校区（与小程序 demandPrefill 相同）', async () => {
    await api.updateProfile({ dormBuildingId: 'east-qinyuan-1' });
    const { base } = spyingApi();
    renderApp(`/?keyword=${encodeURIComponent('哪里都没有的东西k2')}`);
    fireEvent.click(await findRadio('本校区'));
    fireEvent.click(await screen.findByRole('button', { name: '订阅这个需求' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole('button', { name: '确认订阅' }));
    await screen.findByText(/订阅成功/);
    const [campusSub] = await base.listDemandSubscriptions();
    expect(campusSub.geoScope).toBe('CAMPUS');
    expect(campusSub.campusId).toBe('东校区');
    expect(campusSub.keyword).toBe('哪里都没有的东西k2');
  });

  it('S11. 记住范围（本次会话）：离开首页再回来仍是上次的范围；会话存储清空后回到默认「全校」', async () => {
    spyingApi(async () => feedPage({ requestedScope: 'CAMPUS', effectiveScope: 'CAMPUS', effectiveScopeLabel: '本校区' }));
    const first = renderApp('/');
    fireEvent.click(await findRadio('本校区'));
    expect(window.sessionStorage.getItem(MARKET_SCOPE_KEY)).toBe('CAMPUS');
    first.unmount();
    const second = renderApp('/');
    expect((await findRadio('本校区')).checked).toBe(true);
    second.unmount();
    window.sessionStorage.clear();
    renderApp('/');
    expect((await findRadio('全校')).checked).toBe(true);
  });

  it('S12. 加载更多：总数多于一页时请求下一页并追加，范围不变', async () => {
    const { calls } = spyingApi(async (q) => feedPage({
      requestedScope: 'CAMPUS', effectiveScope: 'CAMPUS', effectiveScopeLabel: '本校区', total: 2, page: q.page,
      items: [feedItem({ id: `p-page-${q.page}`, title: `第 ${q.page} 页的台灯` })],
    }));
    renderApp('/');
    fireEvent.click(await findRadio('本校区'));
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(screen.getAllByText('第 2 页的台灯').length).toBeGreaterThan(0));
    expect(screen.getAllByText('第 1 页的台灯').length).toBeGreaterThan(0);
    expect(calls.map((q) => [q.scope, q.page])).toEqual([['CAMPUS', 1], ['CAMPUS', 2]]);
    expect(screen.getByText('已经看到全部好物了')).toBeTruthy();
  });

  it('S13. 加载中显示与卡片同结构的骨架（不显示空态）', async () => {
    let resolve: (p: FeedPage) => void = () => {};
    spyingApi(() => new Promise<FeedPage>((r) => { resolve = r }));
    renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    const skeleton = await screen.findByRole('status', { name: '正在加载商品' });
    expect(skeleton.querySelectorAll('.cm-card-skeleton').length).toBe(8);
    expect(screen.queryByRole('heading', { name: '暂时没有找到合适的好物' })).toBeNull();
    await act(async () => { resolve(feedPage({ total: 1, items: [feedItem({ title: '加载完的台灯' })] })) });
    expect(screen.queryByRole('status', { name: '正在加载商品' })).toBeNull();
  });
});

describe('首页搜索与工具条', () => {
  it('T1. 首页自带搜索（导航栏不再重复）；提交后地址栏带上关键词；其他页面仍有导航栏搜索', async () => {
    renderApp('/');
    const search = await screen.findByRole('searchbox', { name: '搜索商品' }, { timeout: 5000 });
    expect(screen.getAllByRole('searchbox', { name: '搜索商品' })).toHaveLength(1);
    expect(search.closest('[role="search"]')).not.toBeNull();
    fireEvent.change(search, { target: { value: '台灯' } });
    fireEvent.submit(search.closest('form')!);
    await waitFor(() => expect(lastPath).toBe(`/?keyword=${encodeURIComponent('台灯')}`));
    expect(await screen.findByRole('heading', { name: '「台灯」的搜索结果' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '搜索商品' })).toBeNull();   // 导航栏的搜索框不在首页出现
    cleanup();
    renderApp('/profile/favorites');
    expect((await screen.findAllByRole('textbox', { name: '搜索商品' }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });

  it('T2. 分类是带按下状态的按钮；「筛选与排序」展开 / 收起面板并写明已设置的条件数', async () => {
    renderApp('/');
    const all = await screen.findByRole('button', { name: '全部', pressed: true }, { timeout: 5000 });
    expect(all).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /数码电子/ }));
    expect(screen.getByRole('button', { name: /数码电子/ }).getAttribute('aria-pressed')).toBe('true');
    const toggle = screen.getByRole('button', { name: /筛选与排序/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // 全校时可以按校区筛选
    expect(screen.getByLabelText('校区')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('最低价'), { target: { value: '10' } });
    expect(screen.getByRole('button', { name: /^筛选与排序\s*（已设置 1 项）$/ })).toBeTruthy();
  });
});

describe('未登录落地页', () => {
  beforeEach(async () => { await api.logout() });

  it('L1. 说明产品是什么（同校闲置展示、申请联系方式、卖家同意后才展示、平台不交易不支付），三步，主按钮去登录，协议链接', async () => {
    const { container } = renderApp('/');
    const h1 = await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
    expect(h1.textContent).toBe('同校同学的闲置，在这里展示和找到');
    const text = container.textContent ?? '';
    expect(text).toContain('申请联系方式，卖家同意后才会展示');
    expect(text).toContain('只展示同校商品');
    expect(text).toContain('平台不交易、不支付');
    expect(text).toContain('不建订单、不收款、不担保交易');
    expect(text).toContain('学校信息由用户填写，平台目前不核验学籍或身份。');
    const steps = within(screen.getByRole('region', { name: '三步用起来' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(screen.getByRole('link', { name: '《用户协议》' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: '《隐私政策》' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: '注册新账号' }).getAttribute('href')).toBe('/register');
    // 没有商品、范围切换或搜索
    expect(screen.queryByRole('radiogroup', { name: '商品范围' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('link', { name: /^查看闲置：/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '登录 / 注册' }));
    await waitFor(() => expect(lastPath).toBe('/login'));
  });

  it('L2. 如实：不宣称实名 / 认证，不展示没有来源的统计数字；axe 通过', async () => {
    const { container } = renderApp('/');
    await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 });
    expect(container.textContent ?? '').not.toMatch(/实名|认证|1,400\+|2,300\+|1\.8kg|65%|100%|\d+\s*名同学|\d+\+\s*件/);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('商品网格与卡片', () => {
  const card = (overrides: Partial<Product> = {}): Product => ({
    id: 'p-card', title: '一个标题很长很长需要两行截断的台灯商品', description: 'd', price: 35, originalPrice: 80,
    category: '生活用品', condition: '几乎全新', campus: '东校区', images: [], contact: '', sellerId: 'u-x',
    status: '在售', views: 0, createdAt: Date.now() - 3 * 3600_000, buildingId: 'east-songyuan-4',
    buildingName: '4号楼', buildingZone: '松园', ...overrides,
  });

  it('C1. 卡片结构：价格、标题链接、成色、取货楼栋、相对时间；整卡只有一个链接与一个收藏按钮', () => {
    renderInShell(<ProductCard product={card()} />);
    const article = screen.getByRole('article');
    const link = within(article).getByRole('link', { name: '查看闲置：一个标题很长很长需要两行截断的台灯商品' });
    expect(link.getAttribute('href')).toBe('/product/p-card');
    expect(link.closest('h3')).not.toBeNull();
    expect(article.textContent).toContain('¥35');
    expect(article.textContent).toContain('¥80');
    expect(within(article).getByText('几乎全新')).toBeTruthy();
    expect(within(article).getByText('东校区 · 4号楼')).toBeTruthy();
    expect(within(article).getByText('3 小时前').tagName).toBe('TIME');
    expect(within(article).getAllByRole('link')).toHaveLength(1);
    expect(within(article).getByRole('button', { name: '收藏好物' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('C2. 没有图片显示本地占位「暂无图片」；图片加载失败显示「图片暂时无法显示」', () => {
    const { unmount } = renderInShell(<ProductCard product={card()} />);
    expect(screen.getByText('暂无图片')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    renderInShell(<ProductCard product={card({ images: ['https://example.invalid/broken.png'] })} />);
    fireEvent.error(screen.getByRole('img', { name: card().title }));
    expect(screen.getByText('图片暂时无法显示')).toBeTruthy();
  });

  it('C3. 已售出写在图片上；只有「已申请联系 / 卖家已同意」两种联系申请角标', () => {
    const { unmount } = renderInShell(<ProductCard product={card({ status: '已售出' })} contactStatus="PENDING" />);
    expect(screen.getByText('已售出')).toBeTruthy();
    expect(screen.getByText('已申请联系')).toBeTruthy();
    unmount();
    const second = renderInShell(<ProductCard product={card()} contactStatus="APPROVED" />);
    expect(screen.getByText('卖家已同意')).toBeTruthy();
    second.unmount();
    renderInShell(<ProductCard product={card()} contactStatus="REJECTED" />);
    expect(screen.queryByText(/已申请联系|卖家已同意|拒绝/)).toBeNull();
  });

  it('C4. 首页卡片带上本人联系申请的状态（GET 我发出的申请，只请求一次）', async () => {
    const seller = await api.createProduct(listing('想要联系的台灯c4'));
    const other = await api.createProduct(listing('没申请的台灯c4'));
    await api.register({ account: `buyer-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '买家', campus: '东校区', contact: '1' });
    await api.requestContact(seller.id);
    const spy = vi.spyOn(MockCampusMarketApi.prototype, 'listContactRequests');
    renderApp(`/?keyword=${encodeURIComponent('台灯c4')}`);
    const wanted = await screen.findByRole('link', { name: '查看闲置：想要联系的台灯c4' }, { timeout: 5000 });
    await waitFor(() => expect(within(wanted.closest('article')!).getByText('已申请联系')).toBeTruthy());
    const plain = screen.getByRole('link', { name: `查看闲置：${other.title}` }).closest('article')!;
    expect(within(plain).queryByText('已申请联系')).toBeNull();
    expect(spy.mock.calls.filter(([q]) => q?.role === 'sent')).toHaveLength(1);
    spy.mockRestore();
  });

  it('C5. 网格是带名称的列表，每件商品一个列表项；axe 通过（含放宽提示）', async () => {
    spyingApi(async () => feedPage({
      effectiveScope: 'CAMPUS', effectiveScopeLabel: '本校区', fallbackApplied: true,
      fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', total: 2,
      items: [feedItem({ title: '甲', sameBuilding: false, approximateWalkMinutes: 4 }), feedItem({ title: '乙' })],
    }));
    const { container } = renderApp('/');
    fireEvent.click(await findRadio('本楼'));
    const list = await screen.findByRole('list', { name: '商品列表' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('约 4 分钟步行')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('C6. 409 引导与空态 + 订阅入口两种状态 axe 通过', async () => {
    spyingApi();
    const { container } = renderApp(`/?keyword=${encodeURIComponent('谁都没有zz')}`);
    await screen.findByRole('button', { name: '订阅这个需求' }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(radio('本楼'));
    await screen.findByRole('link', { name: '去设置' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
