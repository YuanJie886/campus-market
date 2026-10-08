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
import { fullDisclosure } from './test/inspectionFixtures';
import { axeViolations } from './test-axe';
import { termLabel, usageLabel, suggestionStatusLabel } from './utils/catalog';

/**
 * 模块 4 的界面：课程搜索、课程详情、教材详情、ISBN 关联、无货订阅、教材建议。
 * axe 严重 / 致命为 0；键盘可达；弹窗关闭后焦点回到触发按钮；错误摘要可跳转；ISBN 错误用 aria-describedby 关联；
 * 加载 / 空态 / 成功消息使用 role=status。
 */

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
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api = new MockCampusMarketApi();
  setApiClient(api);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rnd = () => Math.random().toString(36).slice(2, 10);
async function user(label = 'u') {
  const account = `${label}-${rnd()}`;
  await api.register({ account, password: 'test-password', nickname: label, campus: '东校区', contact: '13800000000' });
  return account;
}
async function book(title: string, editionId: string | null) {
  return api.createProduct({
    title, description: '课程教材图谱界面测试', price: 25, category: '教材书籍', condition: '几乎全新', campus: '东校区',
    images: ['https://example.invalid/a.png'], contact: '13800000000', inspection: fullDisclosure('教材书籍'),
    ...(editionId ? { textbookEditionId: editionId } : {}),
  });
}
const DB_STORAGE_KEY = 'campus_market_mock_database_v1';
/** 测试专用的本校教材（真实格式 ISBN，不是演示数据）：演示教材自 4.8 起都没有 ISBN。 */
function addIsbnEdition() {
  const raw = JSON.parse(window.localStorage.getItem(DB_STORAGE_KEY)!);
  raw.catalog.editions.push({ id: 'isbn10-book', schoolId: 'pilot', isbn10: '080442957X', isbn13: '9780804429573', normalizedIsbn: '9780804429573',
    title: '十位书号教材', authors: ['a'], publisher: '测试出版社', editionLabel: '第 2 版', publishedYear: null, workKey: null, noIsbnFingerprint: null, isDemo: false });
  window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(raw));
  api = new MockCampusMarketApi();
  setApiClient(api);
}
async function pick(label: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('课程搜索页', () => {
  it('演示目录如实标注；搜索结果数用 role=status；结果是可聚焦的链接；axe 通过', async () => {
    await user();
    const { container } = renderApp('/courses');
    expect(await screen.findByText(/当前为演示目录/, undefined, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('共 5 门课程'));
    const form = screen.getByRole('search', { name: '搜索课程' });
    fireEvent.change(within(form).getByLabelText('课程名称或代码'), { target: { value: '线性' } });
    fireEvent.click(within(form).getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('共 1 门课程'));
    const link = within(screen.getByRole('list', { name: '课程列表' })).getByRole('link', { name: '演示课程·线性代数' });
    expect(link.getAttribute('href')).toBe('/courses/demo-linear-algebra');
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(form).getByLabelText('课程名称或代码'), { target: { value: '不存在的课程xyz' } });
    fireEvent.click(within(form).getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('没有找到课程，换个关键词试试。')).toBeTruthy();
  });

  it('未登录访问课程教材会被引导登录（学校由登录用户推导）', async () => {
    renderApp('/courses');
    expect(await screen.findByRole('heading', { name: '欢迎回到校园集市' }, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole('list', { name: '课程列表' })).toBeNull();
  });
});

describe('课程详情页', () => {
  it('写出具体版本（版次、ISBN、出版社）与用途；有货直达商品流；无货可订阅；axe 通过', async () => {
    await user('seller');
    await book('在售的第 8 版', 'demo-calculus-8');
    await user('viewer');
    const { container } = renderApp('/courses/demo-calculus-1');
    const offering = await screen.findByRole('region', { name: /2026-2027 秋季学期/ }, { timeout: 5000 });
    const items = within(offering).getAllByRole('listitem');
    expect(items[0].getAttribute('data-edition-id')).toBe('demo-calculus-8');
    expect(items[0].textContent).toContain('第 8 版');
    expect(items[0].textContent).toContain('无 ISBN');
    expect(offering.textContent).not.toMatch(/979-?0/);
    expect(items[0].textContent).toContain('演示大学出版社');
    expect(within(items[0]).getByText(usageLabel('REQUIRED'))).toBeTruthy();
    expect(within(items[0]).getByRole('link', { name: '查看这个版本的在售商品（1）' }).getAttribute('href')).toBe('/textbooks/demo-calculus-8');
    expect(within(items[1]).getByRole('button', { name: '订阅这个教材版本' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('订阅这个教材版本：弹窗打开、取消后焦点回到按钮；确认后成功消息走 role=status', async () => {
    await user('viewer');
    const { baseElement } = renderApp('/courses/demo-physics-1');
    const trigger = await screen.findByRole('button', { name: '订阅这个教材版本' }, { timeout: 5000 });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '订阅这个教材版本' });
    expect(dialog.textContent).toContain('大学物理（演示）');
    expect(await axeViolations(baseElement)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '确认订阅' }));
    await waitFor(() => expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toMatch(/已订阅/));
    const [sub] = await api.listDemandSubscriptions();
    expect(sub.textbook?.id).toBe('demo-physics-5');
    expect(sub.keyword).toBeNull();
  });

  it('教材建议：提交失败焦点移到错误摘要，摘要条目跳到字段；ISBN 错误通过 aria-describedby 关联；成功后 role=status', async () => {
    await user('author');
    const { baseElement } = renderApp('/courses/demo-programming');
    fireEvent.click(await screen.findByRole('button', { name: '为这门课建议教材' }, { timeout: 5000 }));
    const dialog = await screen.findByRole('dialog', { name: '为这门课建议教材' });
    fireEvent.change(within(dialog).getByLabelText('ISBN'), { target: { value: '9780306406158' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交建议' }));
    const summaryTitle = await within(dialog).findByText(/提交前请先修正以下问题/);
    await waitFor(() => expect(document.activeElement).toBe(summaryTitle.parentElement));
    const isbnInput = within(dialog).getByLabelText('ISBN');
    const describedBy = isbnInput.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toContain('校验位');
    fireEvent.click(within(summaryTitle.parentElement!).getByRole('button', { name: /校验位/ }));
    expect(document.activeElement).toBe(isbnInput);
    expect(await axeViolations(baseElement)).toEqual([]);

    fireEvent.change(isbnInput, { target: { value: '978-0-306-40615-7' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交建议' }));
    await waitFor(() => expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain('待审核（未公开）'));
    const [mine] = await api.listMyTextbookSuggestions();
    expect(mine).toMatchObject({ status: 'PENDING', isbn: '9780306406157' });
  });
});

describe('教材详情页', () => {
  it('精确版本与「其他版本」分区展示、互不混排；无货显示订阅入口；axe 通过', async () => {
    await user('seller');
    const exact = await book('精确第 8 版', 'demo-calculus-8');
    const older = await book('旧的第 7 版', 'demo-calculus-7');
    await user('viewer');
    const { container } = renderApp('/textbooks/demo-calculus-8');
    const exactList = await screen.findByRole('list', { name: '这个版本的在售商品' }, { timeout: 5000 });
    const otherList = screen.getByRole('list', { name: '其他版本的在售商品' });
    expect(exactList.textContent).toContain(exact.title);
    expect(exactList.textContent).not.toContain(older.title);
    expect(otherList.textContent).toContain(older.title);
    expect(screen.getByRole('heading', { name: '其他版本（不是这个版本）' })).toBeTruthy();
    // 卡片写出具体版本
    expect(exactList.querySelector('[data-textbook-edition="demo-calculus-8"]')?.textContent).toContain('第 8 版');
    expect(await axeViolations(container)).toEqual([]);

    cleanup();
    renderApp('/textbooks/demo-programming-2');
    expect(await screen.findByText('本校暂时没有这个版本在卖。', { exact: false }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '订阅这个教材版本' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /其他版本/ })).toBeNull();
  });
});

describe('发布页 ISBN 关联', () => {
  it('只在教材书籍分类出现；格式错误即时提示并用 aria-describedby 关联；命中目录后必须确认；取消确认焦点回到查找按钮', async () => {
    await user('publisher');
    addIsbnEdition();
    const { baseElement } = renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    expect(screen.queryByRole('region', { name: /关联课程教材版本/ })).toBeNull();
    await pick(/^分类/, /教材书籍/);
    const region = await screen.findByRole('region', { name: /关联课程教材版本/ });
    const input = within(region).getByLabelText('ISBN');
    fireEvent.change(input, { target: { value: '9780804429574' } });
    fireEvent.blur(input);
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain('校验位');
    // 4.8：979-0 是乐谱号，不当作图书 ISBN
    fireEvent.change(input, { target: { value: '979-0-000001-02-2' } });
    const ismnIds = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ismnIds.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain('乐谱号');

    fireEvent.change(input, { target: { value: '978-0-8044-2957-3' } });
    const lookup = within(region).getByRole('button', { name: '在目录中查找' });
    lookup.focus();
    fireEvent.click(lookup);
    let dialog = await screen.findByRole('dialog', { name: '确认是这个版本吗？' });
    expect(dialog.textContent).toContain('第 2 版');
    expect(dialog.textContent).toContain('测试出版社');
    expect(await axeViolations(baseElement)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '不是这个版本' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(lookup));
    expect(region.querySelector('[data-linked-edition]')).toBeNull();

    fireEvent.click(lookup);
    dialog = await screen.findByRole('dialog', { name: '确认是这个版本吗？' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认关联这个版本' }));
    await waitFor(() => expect(region.querySelector('[data-linked-edition]')?.getAttribute('data-linked-edition')).toBe('isbn10-book'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // 切离教材分类：关联被清空，字段消失
    await pick(/^分类/, /生活用品/);
    await waitFor(() => expect(screen.queryByRole('region', { name: /关联课程教材版本/ })).toBeNull());
  });

  it('目录中没有的 ISBN：用 role=status 说明可以不关联继续发布，不猜版本', async () => {
    await user('publisher');
    renderApp('/publish');
    await screen.findByRole('heading', { name: /数码电子验货清单/ }, { timeout: 5000 });
    await pick(/^分类/, /教材书籍/);
    const region = await screen.findByRole('region', { name: /关联课程教材版本/ });
    fireEvent.change(within(region).getByLabelText('ISBN'), { target: { value: '9780306406157' } });
    fireEvent.click(within(region).getByRole('button', { name: '在目录中查找' }));
    const status = within(region).getByRole('status');
    await waitFor(() => expect(status.textContent).toContain('本校教材目录中没有这个 ISBN'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('发布教材商品（端到端）', () => {
  it('从教材版本页进入发布（无 ISBN 的版本只能这样关联）：先弹确认框、不自动关联；确认后发布，商品带该版本快照；提交体里没有快照或学校字段', async () => {
    await user('publisher');
    const spy = vi.spyOn(api, 'createProduct');
    renderApp('/textbooks/demo-calculus-8');
    const entry = await screen.findByRole('link', { name: '我有这一版，去发布' }, { timeout: 5000 });
    expect(entry.getAttribute('href')).toBe('/publish?textbookEditionId=demo-calculus-8');
    fireEvent.click(entry);
    const dialog = await screen.findByRole('dialog', { name: '确认是这个版本吗？' }, { timeout: 5000 });
    expect(dialog.textContent).toContain('第 8 版');
    expect(dialog.textContent).toContain('无 ISBN');
    expect(dialog.textContent).not.toMatch(/979-?0/);
    const region = screen.getByRole('region', { name: /关联课程教材版本/, hidden: true });
    expect(region.querySelector('[data-linked-edition]')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认关联这个版本' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(region.querySelector('[data-linked-edition]')?.getAttribute('data-linked-edition')).toBe('demo-calculus-8');
    expect(region.textContent).toContain('无 ISBN');

    await screen.findByRole('heading', { name: /教材书籍验货清单/ });
    fireEvent.change(screen.getByLabelText(/商品标题/), { target: { value: '微积分教程第八版九成新' } });
    fireEvent.change(screen.getByLabelText(/商品描述/), { target: { value: '上学期用过，笔记很少，没有缺页。' } });
    fireEvent.change(screen.getByLabelText(/出售价格/), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText(/联系方式/), { target: { value: '13800000000' } });
    fireEvent.click(screen.getByRole('button', { name: '选择图片 1' }));
    for (const group of screen.getAllByRole('radiogroup')) fireEvent.click(within(group).getAllByRole('radio')[0]);

    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(body.textbookEditionId).toBe('demo-calculus-8');
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['schoolId']));
    expect(JSON.stringify(body)).not.toMatch(/Snapshot|schoolId|sellerId/);
    const created = await spy.mock.results[0].value;
    expect(created.textbook).toMatchObject({ editionId: 'demo-calculus-8', editionLabel: '第 8 版', isbn: null });
  });

  it('预先打开的确认框选「不是这个版本」后不关联，也不会再次弹出', async () => {
    await user('publisher');
    renderApp('/publish?textbookEditionId=demo-calculus-8');
    const dialog = await screen.findByRole('dialog', { name: '确认是这个版本吗？' }, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole('button', { name: '不是这个版本' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const region = screen.getByRole('region', { name: /关联课程教材版本/ });
    expect(region.querySelector('[data-linked-edition]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('4.8 演示教材不再把 ISMN 当作 ISBN', () => {
  it('课程页、教材页、商品详情都显示「无 ISBN」，页面上不出现 979-0 号码', async () => {
    await user('seller');
    const product = await book('关联演示第 8 版', 'demo-calculus-8');
    await user('viewer');
    for (const path of ['/courses/demo-calculus-1', '/textbooks/demo-calculus-8', `/product/${product.id}`]) {
      const { container, unmount } = renderApp(path);
      await waitFor(() => expect(container.textContent).toContain('无 ISBN'), { timeout: 5000 });
      expect(container.textContent, path).not.toMatch(/979-?0{2,}/);
      expect(container.textContent, path).not.toContain('9790');
      unmount();
    }
  });
});

describe('我的教材建议', () => {
  it('只显示本人的建议与「待审核（未公开）」；撤回后 role=status 提示；axe 通过', async () => {
    await user('author');
    await api.createTextbookSuggestion({ courseOfferingId: 'demo-physics-1-2026a', isbn: '9780306406157' });
    const { container } = renderApp('/profile/textbook-suggestions');
    const item = await screen.findByText(/演示课程·大学物理（上） · 2026-2027/, undefined, { timeout: 5000 });
    const li = item.closest('li')!;
    expect(li.textContent).toContain(suggestionStatusLabel('PENDING'));
    expect(li.textContent).toContain(termLabel('AUTUMN'));
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(within(li).getByRole('button', { name: '撤回' }));
    await waitFor(() => expect(screen.getByText('已撤回这条建议').getAttribute('role')).toBe('status'));
    await waitFor(() => expect(document.querySelector('li[data-status]')?.getAttribute('data-status')).toBe('WITHDRAWN'));
  });
});
