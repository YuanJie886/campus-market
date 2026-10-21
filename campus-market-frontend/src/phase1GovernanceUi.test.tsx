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
import { ACTION_IMPACT, SCOPE_STILL_ALLOWED } from './utils/governance';
import { axeViolations } from './test-axe';

/**
 * 阶段 1（V16）治理界面：新的「申请联系方式」限制、不再提供的预约 / 爽约动作、只读的历史订单 / 爽约案件，
 * 以及历史记录（已停用规则的自动限制、历史爽约确认、爽约复核举报）的展示。
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
/** 直接改写当前版本的 Mock 存储（与运维受控 SQL 等价），然后重新装载 */
function patchDb(fn: (raw: Record<string, Array<Record<string, unknown>>> & { market: Record<string, Array<Record<string, unknown>>> }) => void) {
  const raw = JSON.parse(window.localStorage.getItem(DB)!);
  fn(raw);
  window.localStorage.setItem(DB, JSON.stringify(raw));
  api = new MockCampusMarketApi();
  setApiClient(api);
}
const staff = (userId: string) => patchDb((raw) => { raw.staffMembers.push({ userId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: Date.now() }) });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('阶段 1 治理文案', () => {
  it('影响说明与「仍然可以做的事」不再把订单、预约、验货、核销或爽约写成当前功能；隐藏商品不再提「订单对方仍能看到」', () => {
    for (const [code, text] of Object.entries(ACTION_IMPACT)) expect(text, code).not.toMatch(/订单|预约|验货|核销|爽约/);
    expect(ACTION_IMPACT.HIDE_PRODUCT).not.toContain('已成立订单');
    expect(ACTION_IMPACT.RESTRICT_CONTACT).toContain('不能发起新的联系申请');
    expect(SCOPE_STILL_ALLOWED.CONTACT).toBe('仍然可以浏览、私信，查看与撤回已经发出的联系申请。');
    for (const [scope, text] of Object.entries(SCOPE_STILL_ALLOWED)) expect(text, scope).not.toMatch(/订单|预约|验货|核销|爽约/);
  });
});

describe('工作人员：处理表单与历史案件', () => {
  it('用户案件的处理动作是「限制申请联系方式」等现有动作，不再提供预约 / 爽约动作，处理原因里没有「爽约属实」；axe 通过', async () => {
    const target = await user('target');
    await user('reporter');
    await api.createModerationReport({ targetType: 'USER', targetId: target, reasonCode: 'HARASSMENT' });
    staff(await user('staffer'));
    await as('staffer');
    const caseId = (await api.listModerationCases({ status: 'OPEN' })).items[0].id;
    const { container } = renderApp(`/moderation/cases/${caseId}`);
    await screen.findByRole('radio', { name: '限制申请联系方式（需要二次确认）' }, { timeout: 5000 });
    const radios = screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent ?? '');
    expect(radios).toEqual(['限制申请联系方式（需要二次确认）', '限制发布商品（需要二次确认）', '限制创建圈子（需要二次确认）', '不采取措施']);
    fireEvent.click(screen.getByRole('radio', { name: '限制申请联系方式（需要二次确认）' }));
    expect(screen.getByText(/影响：对方在期限内不能发起新的联系申请/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: /处理原因/ }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).not.toContain('爽约属实（历史）');
    expect(options.join('')).not.toMatch(/爽约/);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(await axeViolations(container)).toEqual([]);
  });

  it('历史订单案件只读：标题写明「订单（历史）」，处理记录用历史标签展示，不提供领取或处理（即使服务端仍给出可选动作）；axe 通过', async () => {
    const buyer = await user('buyer');
    const seller = await user('seller');
    const staffId = await user('staffer');
    const now = Date.now();
    patchDb((raw) => {
      raw.staffMembers.push({ userId: staffId, schoolId: 'pilot', role: 'SENIOR_MODERATOR', active: true, createdAt: now });
      raw.market.products.push({ id: 'p-hist', sellerId: seller, title: '历史商品', description: 'd', price: 10, category: '其他', condition: '全新',
        campus: '东校区', images: [], status: '在售', views: 0, createdAt: now, contactPublic: false, contact: '1', moderationHiddenAt: null });
      raw.market.orders.push({ id: 'o-hist', productId: 'p-hist', buyerId: buyer, sellerId: seller, price: 10, status: '已取消', canonicalStatus: 'EXPIRED', createdAt: now, updatedAt: now });
      raw.moderationCases.push({ id: 'case-open-order', schoolId: 'pilot', targetType: 'ORDER', targetId: 'o-hist', status: 'OPEN', assignedStaffId: null,
        resolutionCode: null, reportCount: 1, createdAt: now, updatedAt: now, resolvedAt: null, noShowReportId: null });
      raw.moderationCases.push({ id: 'case-noshow', schoolId: 'pilot', targetType: 'NO_SHOW', targetId: 'ns-hist', status: 'RESOLVED', assignedStaffId: 'old',
        resolutionCode: 'CONFIRM_NO_SHOW', reportCount: 1, createdAt: now, updatedAt: now, resolvedAt: now, noShowReportId: 'ns-hist' });
      raw.moderationActions.push({ id: 'act-hist', schoolId: 'pilot', caseId: 'case-noshow', appealId: null, staffId: 'old', actionCode: 'CONFIRM_NO_SHOW',
        reasonCode: 'CONFIRMED_NO_SHOW', note: null, targetType: 'NO_SHOW', targetId: 'ns-hist', restrictionId: null, expiresAt: null, effective: true, createdAt: now, subjectId: buyer });
      raw.noShowReports.push({ id: 'ns-hist', orderId: 'o-hist', meetingRevision: 1, schoolId: 'pilot', reporterId: seller, reportedId: buyer, status: 'CONFIRMED',
        reasonCode: 'DID_NOT_ARRIVE', note: null, responseNote: null, createdAt: now, respondedAt: null, decidedAt: now, decidedBy: 'old', confirmedAt: now });
    });
    await as('staffer');
    // Mock 与后端一样：仍在待处理的历史订单案件只给出「不采取措施」
    expect((await api.getModerationCase('case-open-order')).allowedActions).toEqual(['NO_ACTION']);
    const open = renderApp('/moderation/cases/case-open-order');
    expect(await screen.findByRole('heading', { name: '订单（历史）案件' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('这是站内交易停用前留下的历史案件，只能查看');
    expect(screen.queryByRole('button', { name: '领取这个案件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '提交处理' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(await axeViolations(open.container)).toEqual([]);
    open.unmount();

    renderApp('/moderation/cases/case-noshow');
    expect(await screen.findByRole('heading', { name: '爽约复核（历史）案件' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/状态：已处理 · 结果：确认爽约（历史）/)).toBeTruthy();
    expect(screen.getByText(/确认爽约（历史） · 爽约属实（历史）/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '提交处理' })).toBeNull();
    cleanup();

    renderApp('/moderation');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: '对象类型' }, { timeout: 5000 }));
    const types = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(types).toEqual(['全部类型', '商品', '用户', '圈子', '留言', '私信', '订单（历史）', '爽约复核（历史）']);
  });
});

describe('本人：历史记录与举报', () => {
  it('「我的限制」：已停用规则的自动限制显示「规则已停用，自动撤销」；历史爽约确认显示为不再生效、没有申诉按钮；没有爽约提醒；axe 通过', async () => {
    const me = await user('me');
    const now = Date.now();
    patchDb((raw) => {
      raw.userRestrictions.push({ id: 'rule-old', userId: me, schoolId: 'pilot', scope: 'BOOKING', source: 'SYSTEM_RULE', caseId: null, noShowReportId: 'ns-1',
        createdBy: null, reasonCode: 'CONFIRMED_NO_SHOW', startsAt: now - 7200_000, endsAt: now + 86_400_000, createdAt: now - 7200_000, revokedAt: now - 3600_000,
        revokedBy: null, revokeReason: 'RULE_RETIRED', ruleVersion: 'NO_SHOW_V1', decidedAt: now - 7200_000, basis: [{ reportId: 'ns-1', confirmedAt: now - 7200_000 }], lastCorrectionId: null });
      raw.moderationActions.push({ id: 'act-ns', schoolId: 'pilot', caseId: null, appealId: null, staffId: 'old', actionCode: 'CONFIRM_NO_SHOW',
        reasonCode: 'CONFIRMED_NO_SHOW', note: null, targetType: 'NO_SHOW', targetId: 'ns-1', restrictionId: null, expiresAt: null, effective: true, createdAt: now - 7200_000, subjectId: me });
      raw.noShowReports.push({ id: 'ns-1', orderId: 'o-1', meetingRevision: 1, schoolId: 'pilot', reporterId: 'x', reportedId: me, status: 'CONFIRMED',
        reasonCode: 'DID_NOT_ARRIVE', note: null, responseNote: null, createdAt: now - 7200_000, respondedAt: null, decidedAt: now - 7200_000, decidedBy: 'old', confirmedAt: now - 7200_000 });
    });
    await as('me');
    const { container } = renderApp('/profile/restrictions');
    expect(await screen.findByText('目前没有生效中的限制。', undefined, { timeout: 5000 })).toBeTruthy();
    const history = screen.getByRole('list', { name: '其他处理记录' }).querySelector('li')!;
    expect(history.textContent).toContain('爽约确认（历史）：一次爽约确认（历史，已不再生效）（已不再生效）');
    expect(history.textContent).toContain('不再计入任何限制，也不需要申诉');
    expect(within(history).queryByRole('button')).toBeNull();
    fireEvent.click(screen.getByText('已结束的限制（1）'));
    expect(screen.getByText(/申请联系方式（原「预约新订单」限制） · 来源：已停用的爽约自动规则（历史） · 规则已停用，自动撤销/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/爽约提醒|30 天内已确认/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('「我的举报」：历史上的爽约复核举报以历史标签展示；举报对话框只有现有的七个原因，没有爽约复核', async () => {
    const me = await user('me');
    const now = Date.now();
    patchDb((raw) => {
      raw.moderationCases.push({ id: 'case-ns', schoolId: 'pilot', targetType: 'NO_SHOW', targetId: 'ns-9', status: 'DISMISSED', assignedStaffId: null,
        resolutionCode: 'NO_ACTION', reportCount: 1, createdAt: now, updatedAt: now, resolvedAt: now, noShowReportId: 'ns-9' });
      raw.moderationReports.push({ id: 'rep-ns', schoolId: 'pilot', caseId: 'case-ns', reporterId: me, targetType: 'NO_SHOW', targetId: 'ns-9',
        reasonCode: 'NO_SHOW_REVIEW', note: null, snapshot: null, createdAt: now });
    });
    await as('me');
    const view = renderApp('/profile/reports');
    expect(await screen.findByText('爽约复核（历史） · 请求复核爽约（历史）', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/状态：已结束（未采取措施）/)).toBeTruthy();
    view.unmount();

    await user('seller');
    const product = await api.createProduct({ title: '可以举报的商品', description: 'd', price: 5, category: '其他', condition: '全新', campus: '东校区',
      images: ['https://example.invalid/a.png'], contact: '1' });
    await as('me');
    renderApp(`/product/${product.id}`);
    fireEvent.click(await screen.findByRole('button', { name: '举报这件商品' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '举报商品' });
    const reasons = within(dialog).getAllByRole('radio').map((r) => r.closest('label')?.textContent);
    expect(reasons).toEqual(['违禁或不允许交易的物品', '描述明显不实', '疑似诈骗', '骚扰或辱骂', '垃圾广告或刷屏', '冒充他人或组织', '其他（请写一句说明）']);
    await waitFor(() => expect(dialog.textContent).not.toMatch(/爽约|订单/));
  });
});
