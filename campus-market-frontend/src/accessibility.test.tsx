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
import CampusMap from './components/CampusMap';
import DemandSubscribeDialog from './components/demand/DemandSubscribeDialog';
import { RouteErrorBoundary, RouteLoading } from './components/RouteFallback';
import { seedBuildings, seedMeetingPointCoordinates } from './data/buildings';
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
  status: 'ready', errorMessage: null, action: null, reload: () => {},
  page: {
    requestedScope: 'BUILDING', effectiveScope: 'ZONE', effectiveScopeLabel: '本园区', fallbackApplied: true,
    fallbackReason: 'NO_RESULTS_IN_REQUESTED_SCOPE', items: [], page: 1, pageSize: 20, total: 3,
  },
  ...overrides,
});

const east = seedBuildings.filter((b) => b.campusId === '东校区' && b.active);
const eastPoints = Object.entries(seedMeetingPointCoordinates)
  .filter(([id]) => id.startsWith('东校区'))
  .map(([id, c]) => ({ id, campus: '东校区' as const, name: id, ...c }));

beforeEach(async () => {
  window.localStorage.clear();
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
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '只看本楼' })).toBeTruthy());
    console.log('AXE home (all impacts):', JSON.stringify(await axeAllViolations(container)));
  });

  it('1. 首页（含「只看本楼」开关与筛选区）', async () => {
    const { container } = shell(<App />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '只看本楼' })).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });

  it('1b. 未登录的首页落地页（6.1A）', async () => {
    const api = new MockCampusMarketApi();
    await api.logout();
    setApiClient(api);
    const { container } = shell(<App />);
    await screen.findByRole('heading', { name: '登录后查看本校在售好物' }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('2. 降级提示与引导提示', async () => {
    const { container, rerender } = shell(<BuildingScopeBar enabled onToggle={() => {}} feed={readyFeed()} />);
    expect(await axeViolations(container)).toEqual([]);
    rerender(
      <MemoryRouter><BuildingScopeBar enabled onToggle={() => {}} feed={readyFeed({ status: 'error', action: 'set-dorm-building', page: null })} /></MemoryRouter>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('3. 楼栋级联选择', async () => {
    const { container } = shell(<BuildingSelect campus="东校区" value={null} onChange={() => {}} />);
    await screen.findByLabelText('楼栋');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('4. 校园示意地图', async () => {
    const { container } = render(
      <CampusMap buildings={east} meetingPoints={eastPoints} productBuildingId="east-songyuan-4" viewerBuildingId="east-qinyuan-1" />,
    );
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
  it('7. 「只看本楼」有可访问名称，可用键盘（空格）切换', async () => {
    shell(<App />);
    const toggle = await screen.findByRole('checkbox', { name: '只看本楼' });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);   // 原生 checkbox：空格键触发的正是 click
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });

  it('8. 降级提示使用 polite 的 status，而不是打断式的 alert', () => {
    render(<MemoryRouter><BuildingScopeBar enabled onToggle={() => {}} feed={readyFeed()} /></MemoryRouter>);
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

  it('11. 地图有文字替代；纯装饰色块对读屏隐藏', () => {
    const { container } = render(
      <CampusMap buildings={east} meetingPoints={eastPoints} productBuildingId="east-songyuan-4" viewerBuildingId="east-qinyuan-1" />,
    );
    const svg = screen.getByRole('img', { name: '楼栋与稳定面交点的相对位置示意' });
    const description = document.getElementById(svg.getAttribute('aria-describedby')!)!;
    expect(description.textContent).toContain('推荐面交点为');
    const swatches = container.querySelectorAll('figcaption span > span');
    expect(swatches.length).toBeGreaterThan(0);
    swatches.forEach((s) => expect(s.getAttribute('aria-hidden')).toBe('true'));
  });

  it('12. 面交点可用键盘选择（原生按钮，Tab 可达，状态以 aria-pressed 表达）', () => {
    const onPick = vi.fn();
    render(<CampusMap buildings={east} meetingPoints={eastPoints} productBuildingId="east-songyuan-4"
      viewerBuildingId="east-qinyuan-1" selectedMeetingPointId={eastPoints[0].id} onPick={onPick} />);
    const buttons = within(screen.getByRole('list', { name: '稳定面交点' })).getAllByRole('button');
    buttons.forEach((b) => expect(b.tagName).toBe('BUTTON'));
    expect(buttons.some((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);
    buttons[1].focus();
    fireEvent.click(buttons[1]);   // Enter / 空格在原生按钮上即触发 click
    expect(onPick).toHaveBeenCalledTimes(1);
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
