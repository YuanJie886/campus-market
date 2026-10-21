// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './context/NotificationContext';
import { AuthProvider } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';
import { DemandUnreadProvider } from './context/DemandUnreadContext';
import { setApiClient } from './api/client';
import { MockCampusMarketApi } from './api/mockCampusMarketApi';
import type { ProductCreateInput } from './api/contracts';
import { axeViolations } from './test-axe';

/**
 * 模块 7 界面：举报对话框、爽约报告、我的限制、我的举报、管理案件列表、案件详情、二次确认、申诉表单。
 * axe 只覆盖结构性规则，不等于 WCAG 合规；键盘测试在 jsdom 中用焦点与按键事件模拟。
 */

const DB = 'campus_market_mock_database_v1';
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider><AuthProvider><MarketProvider><DemandUnreadProvider>
        <App />
      </DemandUnreadProvider></MarketProvider></AuthProvider></NotificationProvider>
    </MemoryRouter>,
  );
}

let api: MockCampusMarketApi;
const rnd = () => Math.random().toString(36).slice(2, 10);
const accounts = new Map<string, string>();
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  const s = await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  accounts.set(label, account);
  return s.user.id;
}
const as = (label: string) => api.login({ account: accounts.get(label)!, password: 'test-password' });
const product = (title: string): ProductCreateInput => ({
  title, description: '治理界面测试', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
} as ProductCreateInput);
function staff(userId: string, role: 'MODERATOR' | 'SENIOR_MODERATOR' = 'MODERATOR') {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  raw.staffMembers.push({ userId, schoolId: 'pilot', role, active: true, createdAt: Date.now() });
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
  setApiClient(api);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('7 举报（用户侧；爽约报告与取消预约已随交易 / 预约功能移除）', () => {
  it('举报对话框：原因不预选；空提交错误摘要获得焦点并能跳到原因；提交后 polite 状态；关闭后焦点回到触发按钮；axe 通过', async () => {
    await user('seller');
    const p = await api.createProduct(product('被举报的台灯'));
    await user('viewer');
    renderApp(`/product/${p.id}`);
    const trigger = await screen.findByRole('button', { name: '举报这件商品' }, { timeout: 5000 });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '举报商品' });
    expect(within(dialog).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '提交举报' }));
    const summary = await within(dialog).findByText(/提交前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    fireEvent.click(within(dialog).getByRole('button', { name: '请选择举报原因' }));
    expect((document.activeElement as HTMLInputElement).type).toBe('radio');
    fireEvent.click(within(dialog).getByRole('radio', { name: '描述明显不实' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '提交举报' }));
    const status = await within(dialog).findByText(/已收到举报/);
    expect(status.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '举报这件商品' })));
    const mine = await api.listMyModerationReports();
    expect(mine[0]).toMatchObject({ targetType: 'PRODUCT', reasonCode: 'MISLEADING', status: 'RECEIVED' });
  });
});

describe('7 我的限制与我的举报', () => {
  async function restricted() {
    const target = await user('target');
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId: target, reasonCode: 'SPAM' });
    const s = await user('staffer');
    staff(s);
    await as('staffer');
    const c = (await api.listModerationCases({ status: 'OPEN' })).items[0];
    await api.decideModerationCase(c.id, { action: 'RESTRICT_CONTACT', reasonCode: 'POLICY_VIOLATION', durationHours: 48 });
  }

  it('我的限制：写明范围与「生效中」、具体到期时间与还剩多久、仍可做的事；申诉表单错误摘要与提交；axe 通过', async () => {
    await restricted();
    await as('target');
    const { container } = renderApp('/profile/restrictions');
    const item = (await screen.findByText(/暂时不能：申请联系方式（生效中）/, undefined, { timeout: 5000 })).closest('li')!;
    expect(item.textContent).toMatch(/解除时间：.*（约 2 天后）|解除时间：.*（约 48 小时后）/);
    expect(item.textContent).toContain('仍然可以浏览、私信，查看与撤回已经发出的联系申请。');
    expect(item.textContent).not.toMatch(/订单|预约|验货|核销|爽约/);
    expect(await axeViolations(container)).toEqual([]);
    const trigger = within(item).getByRole('button', { name: '对「申请联系方式」限制提出申诉' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '提出申诉' });
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '提交申诉' }));
    const summary = await within(dialog).findByText(/提交前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    fireEvent.click(within(dialog).getByRole('button', { name: '请写明申诉理由' }));
    expect(document.activeElement).toBe(within(dialog).getByLabelText('申诉理由'));
    fireEvent.change(within(dialog).getByLabelText('申诉理由'), { target: { value: '我没有发垃圾广告' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交申诉' }));
    expect(await screen.findByText(/申诉已提交，将由另一位平台工作人员处理/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '对「申请联系方式」限制提出申诉' })).toBeNull();
    expect(container.textContent).not.toMatch(/reporter|staffer/);
  });

  it('我的举报：只显示状态摘要与是否采取措施；axe 通过', async () => {
    await restricted();
    await as('reporter');
    const { container } = renderApp('/profile/reports');
    expect(await screen.findByText(/状态：已结束（平台已处理）/, undefined, { timeout: 5000 })).toBeTruthy();
    // 不透露处罚内容与时长（「48 小时」），也不出现工作人员；提交时间里可能恰好有「48」分，所以匹配完整说法
    expect(container.textContent).not.toMatch(/限制预约|48 ?小时|staffer/);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('7 平台工作人员工作台', () => {
  it('非工作人员看不到入口，直接访问得到「需要平台工作人员权限」；工作人员看到入口', async () => {
    const normal = await user('normal');
    void normal;
    renderApp('/moderation');
    expect(await screen.findByRole('heading', { name: '需要平台工作人员权限' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '治理工作台' })).toBeNull();
    cleanup();
    const s = await user('staffer');
    staff(s);
    renderApp('/');
    expect(await screen.findByRole('button', { name: '治理工作台' }, { timeout: 5000 })).toBeTruthy();
  });

  it('案件列表与详情：领取、选择动作、高风险动作二次确认写明影响与到期时间、结果在 polite 区域显示操作编号；axe 通过', async () => {
    await user('seller');
    const p = await api.createProduct(product('违规商品界面'));
    await user('reporter');
    await api.createModerationReport({ targetType: 'PRODUCT', targetId: p.id, reasonCode: 'PROHIBITED_ITEM' });
    const s = await user('staffer');
    staff(s);
    await as('staffer');
    const list = renderApp('/moderation');
    const link = await screen.findByRole('link', { name: '商品案件' }, { timeout: 5000 });
    expect(await axeViolations(list.container)).toEqual([]);
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: '商品案件' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/13800000000|reporter/);
    fireEvent.click(screen.getByRole('button', { name: '领取这个案件' }));
    expect(await screen.findByText(/已领取这个案件/)).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }));
    const summary = await screen.findByText(/处理前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    fireEvent.click(screen.getByRole('radio', { name: '隐藏商品（需要二次确认）' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /处理原因/ }));
    fireEvent.click(await screen.findByRole('option', { name: '违禁物品' }));
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }));
    const confirm = await screen.findByRole('dialog', { name: '确认执行「隐藏商品」？' });
    expect(confirm.textContent).toContain('其他同学将看不到这件商品');
    expect(confirm.textContent).toContain('结果写入后不能修改');
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: '确认隐藏商品' }));
    const result = await screen.findByText(/已处理：隐藏商品。操作已写入审计，操作编号 mock-/);
    expect(result.getAttribute('aria-live') ?? result.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('button', { name: '提交处理' })).toBeNull();
  });

  it('限制类动作：确认框写明到期时间（具体时间 + 还剩多久）；申诉页由另一位工作人员二次确认后接受；axe 通过', async () => {
    const target = await user('target');
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId: target, reasonCode: 'HARASSMENT' });
    const a = await user('staffA');
    staff(a);
    const b = await user('staffB');
    staff(b, 'SENIOR_MODERATOR');
    await as('staffA');
    const caseId = (await api.listModerationCases({ status: 'OPEN' })).items[0].id;
    renderApp(`/moderation/cases/${caseId}`);
    fireEvent.click(await screen.findByRole('radio', { name: '限制申请联系方式（需要二次确认）' }, { timeout: 5000 }));
    // 历史上的「限制预约新订单」与爽约动作不再提供
    expect(screen.queryByRole('radio', { name: /预约|爽约/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /处理原因/ }));
    fireEvent.click(await screen.findByRole('option', { name: '骚扰' }));
    fireEvent.click(screen.getByRole('button', { name: '提交处理' }));
    const confirm = await screen.findByRole('dialog', { name: '确认执行「限制申请联系方式」？' });
    expect(confirm.textContent).toMatch(/到期时间：.*（约 24 小时后），到期自动解除/);
    expect(confirm.textContent).toContain('对方在期限内不能发起新的联系申请');
    fireEvent.click(within(confirm).getByRole('button', { name: '确认限制申请联系方式' }));
    expect(await screen.findByText(/已处理：限制申请联系方式/)).toBeTruthy();
    cleanup();

    await as('target');
    const restriction = (await api.getMyGovernance()).restrictions[0];
    const submitted = await api.submitAppeal({ restrictionId: restriction.id, reason: '我没有骚扰' });
    await as('staffA');
    const mine = renderApp('/moderation/appeals');
    // 7.1C：原处理人的队列里根本没有这条申诉（后端 / Mock 按利益回避过滤），不只是隐藏按钮
    expect(await screen.findByText(/与你本人或你做出的处理有关的申诉会由其他工作人员决定/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText(/我没有骚扰/)).toBeNull();
    expect(screen.queryByRole('button', { name: '接受申诉' })).toBeNull();
    // 直接调用也被拒绝：403 CONFLICT_OF_INTEREST（OWN_ACTION）
    await expect(api.decideModerationAppeal(submitted.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' }))
      .rejects.toMatchObject({ code: 403, details: { code: 'CONFLICT_OF_INTEREST', reason: 'OWN_ACTION' } });
    mine.unmount();
    await as('staffB');
    const { container } = renderApp('/moderation/appeals');
    fireEvent.click(await screen.findByRole('button', { name: '接受申诉' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '接受这条申诉？' });
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认接受申诉' }));
    expect(await screen.findByText(/申诉已接受，已写入审计/)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await as('target');
    expect((await api.getMyGovernance()).restrictions[0].active).toBe(false);
  });
});
