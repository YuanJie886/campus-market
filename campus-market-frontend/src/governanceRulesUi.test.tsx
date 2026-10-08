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
 * 模块 7.1 界面：下单时明确的面交时段、卖家接单看到完整时段、旧原始预约的说明、隐藏的留言与隔离的私信占位、
 * 工作人员回避页、「我的举报」等待可回避工作人员、「我的限制」里的依据与纠正记录。axe 只覆盖结构性规则。
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
  title, description: '7.1 界面测试', price: 30, category: '其他', condition: '几乎全新', campus: '东校区',
  images: ['https://example.invalid/a.png'], contact: '13800000000',
} as ProductCreateInput);
const hourStart = (hours: number) => { const at = new Date(Date.now() + hours * 3_600_000); at.setMinutes(0, 0, 0); return at };
function mutate(fn: (raw: Record<string, any>) => void) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  fn(raw);
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
  setApiClient(api);
}
function staff(userId: string) {
  mutate((raw) => raw.staffMembers.push({ userId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() }));
}
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('7.1A 明确档期（界面）', () => {
  it('下单：选择时长后明确显示完整时段，提交的结束时间 = 开始 + 时长；卖家接单处看到同一完整时段；axe 通过', async () => {
    await user('seller');
    const p = await api.createProduct(product('时段台灯'));
    await user('buyer');
    const spy = vi.spyOn(api, 'createOrder');
    renderApp(`/product/${p.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '我想要' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '预约校园面交' });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '面交地点' }));
    fireEvent.click(await screen.findByRole('option', { name: /图书馆/ }));
    const start = hourStart(30);
    fireEvent.change(within(dialog).getByLabelText('面交时间'), { target: { value: localInput(start) } });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '面交时长' }));
    fireEvent.click(await screen.findByRole('option', { name: '45 分钟' }));
    const slot = await within(dialog).findByTestId('booking-slot');
    expect(slot.textContent).toMatch(/（45 分钟）/);
    expect(slot.getAttribute('aria-live')).toBe('polite');
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '确认预约' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const input = spy.mock.calls[0][0];
    expect(Date.parse(input.meetingEndsAtIso!) - Date.parse(input.meetingAtIso)).toBe(45 * 60_000);
    cleanup();

    await as('seller');
    renderApp('/profile/orders');
    fireEvent.click(await screen.findByRole('tab', { name: /我卖出的|卖出/ }, { timeout: 5000 }));
    const accept = await screen.findByRole('button', { name: '接受预约' });
    const describedBy = accept.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)!.textContent).toMatch(/接受即确认完整时段：.*（45 分钟）/);
  });

  it('旧原始预约：面交安排说明「没有明确的结束时间、不会推测爽约」，爽约面板给出 NO_EXPLICIT_SLOT 的说明且没有报告按钮', async () => {
    await user('seller2');
    const p = await api.createProduct(product('旧预约'));
    await user('buyer2');
    const o = await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: hourStart(26).toISOString(), contact: '1', idempotencyKey: rnd() });
    await as('seller2');
    await api.transitionOrder(o.id, { to: 'PENDING_MEETING' });
    mutate((raw) => {
      const x = raw.market.orders.find((y: { id: string }) => y.id === o.id);
      x.meetingAtIso = new Date(Date.now() - 5 * 3_600_000).toISOString();
      x.meetingEndsAtIso = null;
      raw.slotAgreements = raw.slotAgreements.filter((a: { orderId: string }) => a.orderId !== o.id);
    });
    await as('seller2');
    const { container } = renderApp(`/orders/${o.id}`);
    expect((await screen.findByText(/原始预约没有明确的结束时间：平台不会据此推测爽约/, undefined, { timeout: 5000 })).getAttribute('role')).toBe('note');
    expect(await screen.findByText(/平台不会据此推测爽约；如需报告，请先通过改约确认一个完整的新档期/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '报告对方爽约' })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('7.1E 内容处置（界面）', () => {
  it('被隐藏的留言：访客只看到「该留言已被平台隐藏」，作者看到可申诉的提示；原文都不出现；隔离的私信显示占位、仍可继续发送', async () => {
    await user('author');
    await user('shop');
    const p = await api.createProduct(product('留言台灯'));
    await as('author');
    const c = await api.addComment({ productId: p.id, content: '需要隐藏的原文' });
    const conv = await api.getOrCreateConversation(p.id);
    await as('shop');
    const bad = await api.sendMessage(conv.id, '被隔离的原文');
    await api.createModerationReport({ targetType: 'COMMENT', targetId: c.id, reasonCode: 'HARASSMENT' });
    await as('author');
    await api.createModerationReport({ targetType: 'MESSAGE', targetId: bad.id, reasonCode: 'HARASSMENT' });
    staff(await user('mod'));
    await as('mod');
    for (const item of (await api.listModerationCases({ size: 100 })).items) {
      await api.decideModerationCase(item.id, { action: item.targetType === 'COMMENT' ? 'HIDE_COMMENT' : 'QUARANTINE_MESSAGE', reasonCode: 'HARASSMENT' });
    }
    await as('shop');
    let view = renderApp(`/product/${p.id}`);
    expect(await screen.findByText('该留言已被平台隐藏。', undefined, { timeout: 5000 })).toBeTruthy();
    expect(view.container.textContent).not.toContain('需要隐藏的原文');
    expect(screen.queryByRole('button', { name: '举报留言' })).toBeNull();
    view.unmount();
    await as('author');
    view = renderApp(`/product/${p.id}`);
    expect(await screen.findByText(/你的这条留言已被平台隐藏.*可以在「我的限制」里查看并申诉一次/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(view.container.textContent).not.toContain('需要隐藏的原文');
    view.unmount();
    await as('shop');
    view = renderApp(`/messages/${conv.id}`);
    expect(await screen.findByText(/你发送的这条消息已被平台隔离/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(view.container.textContent).not.toContain('被隔离的原文');
    expect(await axeViolations(view.container)).toEqual([]);
  });
});

describe('7.1B / 7.1C 治理页面', () => {
  it('工作人员打开与本人有关的案件：显示回避说明与原因，不显示任何案件细节；axe 通过', async () => {
    const mod = await user('selfmod');
    staff(mod);
    await as('selfmod');
    const p = await api.createProduct(product('工作人员自己的商品'));
    await user('complainer');
    await api.createModerationReport({ targetType: 'PRODUCT', targetId: p.id, reasonCode: 'MISLEADING' });
    const caseId = JSON.parse(window.localStorage.getItem(DB)!).moderationCases[0].id;
    await as('selfmod');
    const { container } = renderApp(`/moderation/cases/${caseId}`);
    expect(await screen.findByRole('heading', { name: '这个案件需要回避' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/涉及你本人发布的内容，你不能查看细节、领取或结案/)).toBeTruthy();
    expect(container.textContent).not.toContain('工作人员自己的商品');
    expect(screen.queryByRole('button', { name: /领取|提交处理/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('「我的举报」：没有可回避的工作人员时明确写明保持待处理、不会被自动驳回', async () => {
    const only = await user('onlymod');
    staff(only);
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId: only, reasonCode: 'HARASSMENT' });
    const { container } = renderApp('/profile/reports');
    const note = await screen.findByText(/本校暂时没有可以回避利益冲突的工作人员，这份举报保持待处理，不会被自动驳回/, undefined, { timeout: 5000 });
    expect(note.getAttribute('role')).toBe('note');
    expect(container.textContent).not.toContain('onlymod');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('「我的限制」：自动限制写明公开规则与规则版本、按确认时间列出依据（被推翻的标明）、纠正记录；axe 通过', async () => {
    await user('flaky');
    const orders: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const s = `sel${i}`;
      await user(s);
      const p = await api.createProduct(product(`爽约 ${i}`));
      await as('flaky');
      orders.push((await api.createOrder({ productId: p.id, meetingPointId: '东校区-library', meetingAtIso: hourStart(26).toISOString(), contact: '1', idempotencyKey: rnd() })).id);
      await as(s);
      await api.transitionOrder(orders[i], { to: 'PENDING_MEETING' });
    }
    const reports: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      mutate((raw) => {
        const o = raw.market.orders.find((y: { id: string }) => y.id === orders[i]);
        const end = Date.now() - 30 * 60_000;
        o.meetingAtIso = new Date(end - 3_600_000).toISOString();
        o.meetingEndsAtIso = new Date(end).toISOString();
        for (const a of raw.slotAgreements) if (a.orderId === orders[i]) Object.assign(a, { startsAt: end - 3_600_000, endsAt: end });
      });
      await as(`sel${i}`);
      const r = await api.reportNoShow(orders[i], { reasonCode: 'DID_NOT_ARRIVE' });
      reports.push(r.id);
      await as('flaky');
      await api.acknowledgeNoShow(r.id);
    }
    staff(await user('reviewer'));
    await as('flaky');
    const second = (await api.getMyGovernance()).restrictions.find((r) => r.endsAt - r.startsAt === 24 * 3_600_000)!;
    const appeal = await api.submitAppeal({ restrictionId: second.id, reason: '第二次是误会' });
    await as('reviewer');
    await api.decideModerationAppeal(appeal.id, { accept: true, reasonCode: 'APPEAL_ACCEPTED' });
    await as('flaky');
    const { container } = renderApp('/profile/restrictions');
    expect(await screen.findByText(/来源：已确认爽约的公开规则（自动）（规则版本 NO_SHOW_V1）/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/依据：30 天内按确认时间计的 3 次已确认爽约.*已被推翻/)).toBeTruthy();
    const corrections = screen.getByRole('list', { name: '纠正记录' });
    expect(corrections.textContent).toMatch(/已按规则缩短：剩余 2 次/);
    expect(await axeViolations(container)).toEqual([]);
  });
});
