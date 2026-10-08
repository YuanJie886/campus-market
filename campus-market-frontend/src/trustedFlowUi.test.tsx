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
import { ApiError } from './api/errors';
import type { Category } from './types';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';
import {
  actorLabel, blockedReasonLabel, conditionLabel, eventLabel, inspectionStatusLabel, orderStatusLabel,
  presenceLabel, proposalStatusLabel, resultLabel,
} from './utils/trustedFlow';

/**
 * 模块 3 的界面行为、键盘与焦点、无障碍（axe 严重/致命为 0）。
 * 数据走真实的 MockCampusMarketApi，与 REST 契约由 api/trustedFlow.contract.test.ts 覆盖。
 */

function renderApp(path: string) {
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

let api: MockCampusMarketApi;
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label: string) {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
const as = (account: string) => api.login({ account, password: 'test-password' });

async function publish(category: Category = '生活用品', declared = true, condition: 'NORMAL' | 'DEFECT' = 'NORMAL') {
  const seller = await user('seller');
  const product = await api.createProduct({
    title: `界面测试 ${rnd()}`, description: '模块 3 界面测试商品', price: 20, category, condition: '全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(declared ? { inspection: fullDisclosure(category, condition)!.map((d, i) => (i === 0 && condition === 'DEFECT' ? { ...d, note: '开关有点松' } : d)) } : {}),
  });
  return { seller, product };
}
async function orderScenario(opts: { accept?: boolean; declared?: boolean } = {}) {
  const declared = opts.declared ?? true;
  const { seller, product } = await publish(declared ? '生活用品' : '其他', declared);
  const buyer = await user('buyer');
  const order = await api.createOrder({
    productId: product.id, meetingPointId: '东校区-library',
    meetingAtIso: new Date(Date.now() + 3 * 86_400_000).toISOString(), contact: '13800000001', idempotencyKey: rnd(),
  });
  if (opts.accept ?? true) {
    await as(seller);
    await api.transitionOrder(order.id, { to: 'PENDING_MEETING' });
  }
  return { seller, buyer, product, orderId: order.id };
}
function slot(daysAhead: number, hour: number) {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysAhead, hour, 0, 0, 0);
  return { startsAtIso: start.toISOString(), endsAtIso: new Date(start.getTime() + 3_600_000).toISOString() };
}
async function pick(label: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
const radios = (name: string) => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));
const allRadios = (prefix: string) => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name^="${prefix}"]`));

describe('3.2 发布页验货清单', () => {
  it('1+2. 不默认勾选任何一项；模板随分类切换，旧分类的选择不会带到新分类', async () => {
    await user('publisher');
    renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    const digital = allRadios('decl-');
    expect(digital.length).toBe(8 * 4);
    expect(digital.every((r) => !r.checked)).toBe(true);

    fireEvent.click(radios('decl-POWER_ON')[0]);
    expect(radios('decl-POWER_ON')[0].checked).toBe(true);

    await pick(/^分类/, /教材书籍/);
    await screen.findByRole('heading', { name: /教材书籍验货清单/ });
    expect(screen.queryByText('能正常开机')).toBeNull();
    expect(screen.getByText('版本与描述一致')).toBeTruthy();
    expect(allRadios('decl-').every((r) => !r.checked)).toBe(true);

    await pick(/^分类/, /其他/);
    expect(await screen.findByText('该分类暂无结构化验货清单，可以直接发布。')).toBeTruthy();
    expect(allRadios('decl-')).toHaveLength(0);
  });

  it('20a. 提交失败：焦点移到错误摘要；摘要条目把焦点带到对应单选组', async () => {
    await user('publisher');
    renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    const summary = await screen.findByText(/提交前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement));
    const item = within(summary.parentElement!).getByRole('button', { name: '请为「能正常开机」选择一项' });
    fireEvent.click(item);
    expect(document.activeElement).toBe(radios('decl-POWER_ON')[0]);
    // 错误与单选组通过 aria-describedby 关联
    const group = radios('decl-POWER_ON')[0].closest('[role="radiogroup"]')!;
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('请为「能正常开机」选择一项');
  });

  it('键盘：每个条目是同名原生单选组，选项都有可访问名称并可 Tab 到达', async () => {
    await user('publisher');
    renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    const group = screen.getAllByRole('radiogroup')[0];
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => (o as HTMLInputElement).name)).toEqual(Array(4).fill('decl-POWER_ON'));
    expect(options.map((o) => o.getAttribute('tabindex'))).not.toContain('-1');
    expect(within(group).getByRole('radio', { name: '存在问题' })).toBeTruthy();
    // 选择「存在问题」后出现说明输入框
    fireEvent.click(within(group).getByRole('radio', { name: '存在问题' }));
    expect(await screen.findByLabelText('问题说明（建议简短写清）')).toBeTruthy();
  });

  it('19a. axe：发布页验货清单无严重/致命问题', async () => {
    await user('publisher');
    const { container } = renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('3.2 商品页声明与公共履历', () => {
  it('4+15. 商品页展示卖家声明（含问题说明）；公共履历只有聚合数字，没有联系方式与宿舍楼', async () => {
    const { product } = await publish('生活用品', true, 'DEFECT');
    const { container } = renderApp(`/product/${product.id}`);
    const section = await screen.findByRole('region', { name: '卖家验货声明' }, { timeout: 5000 });
    expect(within(section).getAllByText('存在问题').length).toBeGreaterThan(0);
    expect(within(section).getByText('开关有点松')).toBeTruthy();
    expect(within(section).getByText(/不代表平台鉴定或担保/)).toBeTruthy();
    const summary = await screen.findByRole('region', { name: '交易履历' });
    await within(summary).findByText('完成交易');
    expect(within(summary).getByText('不足 3 条，暂不显示平均')).toBeTruthy();
    expect(summary.textContent).not.toMatch(/13800000000|宿舍|楼|信用|靠谱/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('3. 旧商品 / 无清单商品：明确提示未提供声明，不显示任何「正常」（也覆盖首帧走加载分支时的 Hook 顺序）', async () => {
    const { product } = await publish('其他', false);
    renderApp(`/product/${product.id}`);
    const section = await screen.findByRole('region', { name: '卖家验货声明' }, { timeout: 5000 });
    expect(within(section).getByText(/该商品未提供结构化验货声明/)).toBeTruthy();
    expect(within(section).queryByText('正常')).toBeNull();
  });
});

describe('3.3 订单验货页', () => {
  it('5. 买家草稿保存后刷新可恢复；成功提示走 role=status 而不是 alert', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    renderApp(`/orders/${orderId}`);
    await screen.findByRole('region', { name: '验货记录' }, { timeout: 5000 });
    fireEvent.click(radios('result-FUNCTION')[0]);
    fireEvent.click(radios('result-CLEAN')[2]);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toBe('草稿已保存'));
    expect(screen.queryAllByRole('alert').map((a) => a.textContent)).not.toContain('草稿已保存');

    cleanup();
    renderApp(`/orders/${orderId}`);
    await screen.findByRole('region', { name: '验货记录' }, { timeout: 5000 });
    await waitFor(() => expect(radios('result-FUNCTION')[0].checked).toBe(true));
    expect(radios('result-CLEAN')[2].checked).toBe(true);
    expect(radios('result-APPEARANCE').every((r) => !r.checked)).toBe(true);
  });

  it('20b. 最终提交缺项：焦点到错误摘要；确认对话框关闭后焦点回到触发按钮', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    renderApp(`/orders/${orderId}`);
    await screen.findByRole('region', { name: '验货记录' }, { timeout: 5000 });
    const submit = screen.getByRole('button', { name: '提交验货结果' });
    fireEvent.click(submit);
    const title = await screen.findByText(/提交前请补全验货结果/);
    await waitFor(() => expect(document.activeElement).toBe(title.parentElement));

    for (const code of ['FUNCTION', 'APPEARANCE', 'CLEAN', 'PARTS_COMPLETE', 'ELECTRICAL']) fireEvent.click(radios(`result-${code}`)[0]);
    submit.focus();
    fireEvent.click(submit);
    const dialog = await screen.findByRole('dialog', { name: '提交后不能修改' });
    fireEvent.click(within(dialog).getByRole('button', { name: '再检查一下' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(submit));
  });

  it('6. 最终提交后记录锁定：不再有任何可编辑控件', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    renderApp(`/orders/${orderId}`);
    await screen.findByRole('region', { name: '验货记录' }, { timeout: 5000 });
    for (const code of ['FUNCTION', 'APPEARANCE', 'CLEAN', 'PARTS_COMPLETE', 'ELECTRICAL']) fireEvent.click(radios(`result-${code}`)[0]);
    fireEvent.click(screen.getByRole('button', { name: '提交验货结果' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认提交' }));
    expect(await screen.findByText(/记录已锁定/)).toBeTruthy();
    expect(allRadios('result-')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull();
    expect(screen.getByText(/不代表平台鉴定或担保/)).toBeTruthy();
  });

  it('7. mismatch：页面与订单列表都明确阻止继续确认 / 核销，只提供取消交易，不暗示平台仲裁', async () => {
    const { buyer, seller, orderId } = await orderScenario();
    await as(buyer);
    const flow = await api.getOrderFlow(orderId);
    await api.submitInspection(orderId, flow.inspection.items.map((i) => ({ itemCode: i.code, result: i.code === 'CLEAN' ? 'MISMATCH' : 'MATCH' })));
    renderApp(`/orders/${orderId}`);
    expect(await screen.findByText(/验货不一致：不能确认面交或核销/, undefined, { timeout: 5000 })).toBeTruthy();
    const chip = document.querySelector('[data-status]')!;
    expect(chip.getAttribute('data-status')).toBe('DISPUTED');
    expect(chip.textContent).toBe('验货不一致');
    // 3.8C：只说明可执行的操作，不暗示平台仲裁 / 判责 / 赔付
    expect(document.body.textContent).toMatch(/取消交易.*查看验货记录.*等待订单到期/);
    expect(document.body.textContent).not.toMatch(/仲裁|判定卖家责任|赔付|保证退款|待处理/);
    expect(document.querySelector('[data-item-code="CLEAN"] [data-result]')?.getAttribute('data-result')).toBe('MISMATCH');
    expect(screen.getByText('（不一致）')).toBeTruthy();

    cleanup();
    await as(seller);
    renderApp('/profile/orders');
    await screen.findByRole('tab', { name: '我卖出的' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('tab', { name: '我卖出的' }));
    expect(await screen.findByRole('button', { name: '取消交易' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '核验并完成交易' })).toBeNull();
    expect(screen.queryByRole('button', { name: '已验货付款，确认面交' })).toBeNull();
  });

  it('无清单订单：明确显示「未提供结构化验货声明」，不渲染任何结果控件', async () => {
    const { buyer, orderId } = await orderScenario({ declared: false });
    await as(buyer);
    renderApp(`/orders/${orderId}`);
    expect(await screen.findByText(/该商品发布时未提供结构化验货声明/, undefined, { timeout: 5000 })).toBeTruthy();
    expect(allRadios('result-')).toHaveLength(0);
  });

  it('18. 失败提示带 requestId，且不回显请求内容', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    vi.spyOn(api, 'updatePresence').mockRejectedValue(new ApiError({ code: 409, message: '订单已结束', requestId: 'rid-presence-042', httpStatus: 409 }));
    renderApp(`/orders/${orderId}`);
    fireEvent.click(await screen.findByRole('button', { name: '我已出发' }, { timeout: 5000 }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('订单已结束');
    expect(alert.textContent).toContain('rid-presence-042');
    expect(alert.textContent).not.toMatch(/DEPART|action/);
  });
});

describe('3.4 档期握手', () => {
  it('8+10+20c. 提议：对话框只有离散选项；发送后旧档期仍显示；关闭对话框焦点回到触发按钮', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    renderApp(`/orders/${orderId}`);
    const trigger = await screen.findByRole('button', { name: '提议改约' }, { timeout: 5000 });
    trigger.focus();
    fireEvent.click(trigger);
    let dialog = await screen.findByRole('dialog', { name: '提议面交档期' });
    // 没有自由文本时间输入：日期 / 开始 / 时长都是下拉
    expect(within(dialog).queryByLabelText(/时间（|datetime/)).toBeNull();
    expect(dialog.querySelector('input[type="datetime-local"], input[type="time"], input[type="date"]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    dialog = await screen.findByRole('dialog', { name: '提议面交档期' });
    await pick(/^面交点/, '食堂入口');
    await pick(/^日期/, /^明天/);
    await pick(/^开始时间/, '14:00');
    fireEvent.click(within(dialog).getByRole('button', { name: '发送提议' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('改约提议待回应期间，上面的档期仍然有效。')).toBeTruthy();
    expect(document.querySelector('[data-agreement-revision]')?.textContent).toContain('图书馆门口');
    expect(document.querySelector('[data-proposal-status="PENDING"]')?.textContent).toContain('食堂入口');
    expect(screen.getByRole('button', { name: '撤回提议' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '提议改约' })).toHaveProperty('disabled', true);
  });

  it('9. 对方看到接受 / 拒绝；接受后新档期生效，旧提议进入历史', async () => {
    const { buyer, seller, orderId } = await orderScenario();
    await as(buyer);
    await api.proposeMeeting(orderId, { meetingPointId: '东校区-canteen', ...slot(2, 10) });
    await as(seller);
    renderApp(`/orders/${orderId}`);
    expect(await screen.findByRole('button', { name: '拒绝' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤回提议' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '接受' }));
    await waitFor(() => expect(document.querySelector('[data-agreement-revision]')?.getAttribute('data-agreement-revision')).toBe('1'));
    expect(document.querySelector('[data-agreement-revision]')?.textContent).toContain('食堂入口');
    expect(screen.getByText(/档期历史（1）/)).toBeTruthy();
  });

  it('19b. axe：档期、面交点选择对话框、出发/到达、验货页、时间线', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    const { container, baseElement } = renderApp(`/orders/${orderId}`);
    await screen.findByRole('region', { name: '验货记录' }, { timeout: 5000 });
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '提议改约' }));
    await screen.findByRole('dialog', { name: '提议面交档期' });
    expect(await axeViolations(baseElement)).toEqual([]);
  });
});

describe('3.5 出发与到达', () => {
  it('11+12+13. 快速连点只发一次请求；已到达后按钮禁用；不调用定位与通知权限', async () => {
    const geolocation = { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    const requestPermission = vi.fn();
    Object.defineProperty(window, 'Notification', { value: { requestPermission, permission: 'default' }, configurable: true });

    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    const spy = vi.spyOn(api, 'updatePresence');
    renderApp(`/orders/${orderId}`);
    const depart = await screen.findByRole('button', { name: '我已出发' }, { timeout: 5000 });
    expect(screen.getByText(/人工状态，不是定位结果/)).toBeTruthy();
    fireEvent.click(depart);
    fireEvent.click(depart);
    fireEvent.click(depart);
    await waitFor(() => expect(document.querySelector('[data-presence="me"]')?.getAttribute('data-status')).toBe('DEPARTED'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '我已出发' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: '我已到达' }));
    await waitFor(() => expect(document.querySelector('[data-presence="me"]')?.getAttribute('data-status')).toBe('ARRIVED'));
    expect(screen.getByRole('button', { name: '我已到达' })).toHaveProperty('disabled', true);
    // 到达不会完成订单
    expect((await api.getOrderFlow(orderId)).status).toBe('PENDING_MEETING');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('3.6 时间线与履历', () => {
  it('14. 时间线机器码映射为中文；未知码安全降级', async () => {
    const { buyer, orderId } = await orderScenario();
    await as(buyer);
    await api.updatePresence(orderId, 'ARRIVE');
    renderApp(`/orders/${orderId}`);
    const timeline = await screen.findByRole('region', { name: '订单进展' }, { timeout: 5000 });
    const items = within(timeline).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-code'))).toEqual(['ORDER_CREATED', 'SELLER_ACCEPTED', 'PRESENCE_ARRIVED']);
    expect(items.map((li) => li.querySelector('span')!.textContent)).toEqual(['发起预约', '卖家接受预约', '标记「我已到达」']);
    expect(items[2].textContent).toContain('我');

    expect(eventLabel('SOMETHING_NEW')).toBe('其他进展');
    expect(conditionLabel('WEIRD')).toBe('未声明');
    expect(resultLabel(undefined)).toBe('未填写');
    expect(inspectionStatusLabel('X')).toBe('验货状态未知');
    expect(proposalStatusLabel('X')).toBe('状态未知');
    expect(presenceLabel(null)).toBe('状态未知');
    expect(orderStatusLabel('X')).toBe('状态未知');
    expect(blockedReasonLabel('X')).toBe('当前还不能确认面交。');
    expect(actorLabel('SYSTEM', 'BUYER')).toBe('系统');
  });

  it('本人履历：计数与最近订单入口；无信用分；axe 通过', async () => {
    const { buyer } = await orderScenario();
    await as(buyer);
    const { container } = renderApp('/profile/history');
    const section = await screen.findByRole('region', { name: '我的交易履历' }, { timeout: 5000 });
    expect(within(section).getByText('进行中').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByRole('link', { name: '查看进展' })).toBeTruthy();
    // 页面只有「不计算信用分」的说明，没有任何分数或指数
    expect(container.textContent).toContain('不计算信用分');
    expect(container.textContent).not.toMatch(/信用分[：:]\s*\d|靠谱指数|credit/i);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('他人打开订单流程页得到统一的「订单不存在」', async () => {
    const { orderId } = await orderScenario();
    await user('stranger');
    renderApp(`/orders/${orderId}`);
    expect(await screen.findByText(/订单不存在/, undefined, { timeout: 5000 })).toBeTruthy();
  });
});
