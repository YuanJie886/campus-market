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
import type { Category } from './types';
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';

/**
 * 模块 3 的界面行为、键盘与焦点、无障碍（axe 严重/致命为 0）。
 * 数据走真实的 MockCampusMarketApi，与 REST 契约由 api/trustedFlow.contract.test.ts 覆盖。
 *
 * <p>平台已改为只展示商品与联系方式：订单验货页（3.3）、档期握手（3.4）、出发与到达（3.5）、
 * 订单时间线与交易履历（3.6）已移除，对应界面用例随功能删除；发布页清单与商品页声明（3.2）仍然有效。
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

async function publish(category: Category = '生活用品', declared = true, condition: 'NORMAL' | 'DEFECT' = 'NORMAL') {
  const seller = await user('seller');
  const product = await api.createProduct({
    title: `界面测试 ${rnd()}`, description: '模块 3 界面测试商品', price: 20, category, condition: '全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000',
    ...(declared ? { inspection: fullDisclosure(category, condition)!.map((d, i) => (i === 0 && condition === 'DEFECT' ? { ...d, note: '开关有点松' } : d)) } : {}),
  });
  return { seller, product };
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
  it('4+15. 商品页展示卖家声明（含问题说明）；不再有交易履历区块，未经卖家同意不展示联系方式', async () => {
    const { product } = await publish('生活用品', true, 'DEFECT');
    await user('buyer');
    const { container } = renderApp(`/product/${product.id}`);
    const section = await screen.findByRole('region', { name: '卖家验货声明' }, { timeout: 5000 });
    expect(within(section).getAllByText('存在问题').length).toBeGreaterThan(0);
    expect(within(section).getByText('开关有点松')).toBeTruthy();
    expect(within(section).getByText(/不代表平台鉴定或担保/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: '我想要' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '交易履历' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/13800000000|信用分|靠谱/);
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
