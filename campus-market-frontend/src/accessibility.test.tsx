// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import BuildingScopeBar from './components/BuildingScopeBar';
import BuildingSelect from './components/BuildingSelect';
import DemandSubscribeDialog from './components/demand/DemandSubscribeDialog';
import { RouteErrorBoundary, RouteLoading } from './components/RouteFallback';
import type { BuildingFeedState } from './hooks/useBuildingFeed';
import { axeAllViolations, axeViolations } from './test-axe';
import { fullDisclosure } from './test/inspectionFixtures';

/**
 * 关键流程的无障碍检查（1.7B）。
 *
 * <p>两类证据：axe-core 的结构性自动检查，以及键盘可操作性的交互测试。
 * 自动化结果不代表 WCAG 全面合规，只保证这些关键路径上没有严重的结构性问题。
 */

function shell(node: JSX.Element, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <AuthProvider>
          <MarketProvider>
            <DemandUnreadProvider>{node}</DemandUnreadProvider>
          </MarketProvider>
        </AuthProvider>
      </NotificationProvider>
    </MemoryRouter>,
  );
}

const readyFeed = (overrides: Partial<BuildingFeedState> = {}): BuildingFeedState => ({
  status: 'ready', errorMessage: null, action: null, reload: () => {}, items: [], hasMore: false, loadingMore: false, loadMore: () => {},
  page: {
    requestedScope: 'BUILDING', effectiveScope: 'ZONE', effectiveScopeLabel: '本园区', fallbackApplied: true,
    fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', items: [], page: 1, pageSize: 20, total: 3,
  },
  ...overrides,
});


beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // 6.1A 起首页的商品区需要登录：以一位试点学校的同学登录
  const api = new MockCampusMarketApi();
  await api.register({ account: `a11y-${Math.random().toString(36).slice(2, 8)}`, password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
  setApiClient(api);
});

describe('axe-core：关键页面与组件没有严重违规', () => {
  it('0. 对照：axe 在当前 jsdom 环境里确实能发现问题（否则下面的「零违规」没有意义）', async () => {
    const { container } = render(
      <div>
        <button type="button"><svg /></button>
        <img src="x.png" />
        <input type="text" />
      </div>,
    );
    const found = await axeViolations(container);
    expect(found.some((v) => v.startsWith('button-name'))).toBe(true);
    expect(found.some((v) => v.startsWith('image-alt'))).toBe(true);
    expect(found.some((v) => v.startsWith('label'))).toBe(true);
  });

  it('0b. 报告用：关键页面的全部等级违规（不作为失败条件）', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    const { container } = shell(<App />);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: '商品范围' })).toBeTruthy());
    console.log('AXE home (all impacts):', JSON.stringify(await axeAllViolations(container)));
  });

  // REWRITTEN：「只看本楼」开关已改为 本楼 / 本校区 / 全校 单选组；同时检查展开的「筛选与排序」面板
  it('1. 首页（含范围切换、分类与展开的筛选区）', async () => {
    const { container } = shell(<App />);
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: '商品范围' })).toBeTruthy());
    await screen.findAllByRole('link', { name: /^查看闲置：/ }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /筛选与排序/ }));
    expect(await axeViolations(container)).toEqual([]);
  });

  // REWRITTEN：落地页改为说明产品、三步与协议链接的完整页面，仍以「登录后查看本校在售好物」为登录入口标题
  it('1b. 未登录的首页落地页（6.1A）', async () => {
    const api = new MockCampusMarketApi();
    await api.logout();
    setApiClient(api);
    const { container } = shell(<App />);
    await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 });
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  // REWRITTEN：组件改为范围单选组 + 提示（value / onChange），检查的两种提示不变
  it('2. 降级提示与引导提示', async () => {
    const { container, rerender } = shell(<BuildingScopeBar value="BUILDING" onChange={() => {}} feed={readyFeed()} />);
    expect(await axeViolations(container)).toEqual([]);
    rerender(
      <MemoryRouter><BuildingScopeBar value="BUILDING" onChange={() => {}} feed={readyFeed({ status: 'error', action: 'set-dorm-building', page: null })} /></MemoryRouter>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('3. 楼栋级联选择', async () => {
    const { container } = shell(<BuildingSelect campus="东校区" value={null} onChange={() => {}} />);
    await screen.findByLabelText('楼栋');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('5. 订阅表单（含错误提示）', async () => {
    shell(
      <DemandSubscribeDialog open title="订阅这个需求" submitLabel="确认订阅" initial={{}} userCampus="东校区"
        errorMessage="服务器开小差了" onCancel={() => {}} onSubmit={() => {}} />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('6. 需求匹配页', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({ account: 'a11y-user', password: 'test-password', nickname: '同学', campus: '东校区', contact: '1' });
    const { container } = shell(<App />, '/demands');
    await waitFor(() => expect(screen.getByRole('tab', { name: '匹配收件箱' })).toBeTruthy(), { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('键盘与读屏语义', () => {
  // REWRITTEN：开关改为单选组——每一项是有名称、可聚焦的原生单选框，同组同名（方向键在组内移动），Home / End 跳到首尾
  it('7. 范围单选组：可访问名称、可聚焦、键盘可切换', async () => {
    shell(<App />);
    const group = await screen.findByRole('radiogroup', { name: '商品范围' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label') ?? r.parentElement!.textContent)).toEqual(['本楼', '本校区', '全校']);
    expect(new Set(radios.map((r) => (r as HTMLInputElement).name)).size).toBe(1);
    const campus = within(group).getByRole('radio', { name: '本校区' });
    campus.focus();
    expect(document.activeElement).toBe(campus);
    fireEvent.click(campus);   // 原生单选框：空格 / 方向键触发的正是 click + change
    expect((campus as HTMLInputElement).checked).toBe(true);
    fireEvent.keyDown(campus, { key: 'End' });
    const school = within(group).getByRole('radio', { name: '全校' }) as HTMLInputElement;
    expect(school.checked).toBe(true);
    expect(document.activeElement).toBe(school);
    fireEvent.keyDown(school, { key: 'Home' });
    expect((within(group).getByRole('radio', { name: '本楼' }) as HTMLInputElement).checked).toBe(true);
  });

  it('8. 降级提示使用 polite 的 status，而不是打断式的 alert', () => {
    render(<MemoryRouter><BuildingScopeBar value="BUILDING" onChange={() => {}} feed={readyFeed()} /></MemoryRouter>);
    const notice = screen.getByText(/已为你展示本园区的商品/).closest('[role]')!;
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');
  });

  it('9. 级联选择的每一级都是可聚焦、带标签的组合框', async () => {
    shell(<BuildingSelect campus="东校区" value={null} onChange={() => {}} zoneLabel="园区" buildingLabel="楼栋" />);
    const zone = await screen.findByRole('combobox', { name: '园区' });
    const building = screen.getByRole('combobox', { name: '楼栋' });
    for (const control of [zone, building]) {
      control.focus();
      expect(document.activeElement).toBe(control);
      // MUI Select 以键盘「向下」打开选项列表
      fireEvent.keyDown(control, { key: 'ArrowDown' });
      expect(await screen.findByRole('listbox')).toBeTruthy();
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    }
  });

  it('10. 表单错误通过 aria-describedby 与控件关联', async () => {
    shell(
      <DemandSubscribeDialog open title="t" submitLabel="确认订阅" initial={{}} userCampus="东校区"
        onCancel={() => {}} onSubmit={() => {}} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '确认订阅' }));
    const message = await screen.findByRole('alert');
    const keyword = screen.getByLabelText('关键词');
    expect(keyword.getAttribute('aria-describedby')).toContain(message.id);
    expect(screen.getByRole('button', { name: '确认订阅' }).getAttribute('aria-describedby')).toBe(message.id);
  });

  it('13. 懒加载中以 status 播报；加载失败时焦点移到错误标题', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error('chunk 404')));
    render(
      <RouteErrorBoundary>
        <Suspense fallback={<RouteLoading />}>
          <Broken />
        </Suspense>
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole('status')).toBeTruthy();
    const heading = await screen.findByRole('heading', { name: '页面加载失败' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    error.mockRestore();
  });

  it('14. 导航栏需求匹配入口：可访问名称带上未读数', async () => {
    const api = new MockCampusMarketApi();
    setApiClient(api);
    await api.register({ account: 'seller-a11y', password: 'test-password', nickname: '卖家', campus: '东校区', contact: '1' });
    const sellerId = (await api.getCurrentUser())!.id;
    await api.logout();
    await api.register({ account: 'buyer-a11y', password: 'test-password', nickname: '买家', campus: '东校区', contact: '1' });
    await api.createDemandSubscription({ keyword: '无障碍台灯' });
    // 以卖家身份发布一件命中的商品
    await api.logout();
    await api.login({ account: 'seller-a11y', password: 'test-password' });
    await api.createProduct({ title: '无障碍台灯', description: 'd', price: 10, category: '生活用品', condition: '全新',
      campus: '东校区', images: ['https://example.invalid/a.png'], contact: '1', inspection: fullDisclosure('生活用品') });
    expect(sellerId).toBeTruthy();
    await api.logout();
    await api.login({ account: 'buyer-a11y', password: 'test-password' });

    shell(<App />);
    expect(await screen.findByRole('button', { name: '需求匹配，1 条未读' }, { timeout: 5000 })).toBeTruthy();
  });
});
