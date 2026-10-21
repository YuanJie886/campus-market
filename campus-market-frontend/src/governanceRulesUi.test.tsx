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
 * 模块 7.1 界面：隐藏的留言与隔离的私信占位、工作人员回避页、「我的举报」等待可回避工作人员。axe 只覆盖结构性规则。
 *
 * <p>平台已改为只展示商品与联系方式：下单时的明确面交时段、旧原始预约说明、爽约自动限制的依据与纠正记录
 * 随交易 / 预约 / 爽约功能移除，对应界面用例已删除。
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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks() });

describe('7.1E 内容处置（界面）', () => {
  it('被隐藏的留言：访客只看到「该留言已被平台隐藏」，作者看到可申诉的提示；原文都不出现；隔离的私信显示占位、仍可继续发送', async () => {
    await user('author');
    await user('shop');
    const p = await api.createProduct(product('留言台灯'));
    await as('author');
    const c = await api.addComment({ productId: p.id, content: '需要隐藏的原文' });
    const conv = await api.getOrCreateConversation(p.id);
    await as('shop');
    // REWRITTEN（私信只能发送快捷消息）：被隔离的是一条卖家的快捷消息；断言限定在聊天记录里（快捷消息按钮本身会显示模板文字）
    const bad = await api.sendMessage(conv.id, { templateCode: 'SELLER_PRICE_FIRM' });
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
    expect(screen.getByRole('log', { name: '聊天记录' }).textContent).not.toContain('价格不议，谢谢理解。');
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
});
